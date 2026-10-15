import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { EventEnvelope } from '@luna/events';
import {
  sendEmail,
  sendPush,
  emailConfigured,
  pushConfigured,
  type EmailConfig,
  type PushConfig,
  type PushSubscription,
} from '@luna/channels';
import { recordAudit, type Sql } from '@luna/database';

/**
 * Notifications Engine (§22): notification.requested → preferências do
 * cliente (channel_preferences) → fan-out pelos canais escolhidos. Cada
 * canal é uma delivery em `notifications` com estado
 * pending → sent | failed (delivered = confirmação futura do provider).
 * Dedupe por idempotency_key (§7.6). Sem preferências cadastradas → cai em
 * whatsapp (canal base) com nota de auditoria.
 */

export interface NotificationDeps {
  pool: Pool;
  log: Logger;
  email: EmailConfig;
  push: PushConfig;
}

interface RequestedPayload {
  client_id?: string;
  title?: string;
  body?: string;
  /** Canal único forçado (default: preferências do cliente). */
  channel?: string;
  recipient?: string;
  idempotency_key?: string;
}

interface DeliveryRow {
  id: string;
  channel: string;
  recipient: string;
}

async function resolveRecipient(db: Sql, clientId: string, channel: string): Promise<string | null> {
  const res = await db.query<{ address: string }>(
    'SELECT address FROM contacts WHERE client_id = $1 AND channel = $2 ORDER BY is_primary DESC LIMIT 1',
    [clientId, channel],
  );
  return res.rowCount ? res.rows[0]!.address : null;
}

async function loadEnabledChannels(db: Sql, clientId: string): Promise<string[]> {
  const res = await db.query<{ channel: string }>(
    'SELECT channel FROM channel_preferences WHERE client_id = $1 AND enabled',
    [clientId],
  );
  return res.rows.map((r) => r.channel);
}

async function dispatch(db: Sql, deps: NotificationDeps, row: DeliveryRow, title: string, body: string, clientId: string): Promise<void> {
  const mark = (status: 'sent' | 'failed', error?: string) =>
    db.query(
      `UPDATE notifications SET status = $2, error = $3,
         delivered_at = CASE WHEN $2 = 'sent' THEN now() ELSE delivered_at END,
         updated_at = now()
       WHERE id = $1`,
      [row.id, status, error ?? null],
    );

  try {
    if (row.channel === 'whatsapp') {
      // Entrega via fila outbound existente (whatsplay + guardrails).
      const conv = await db.query<{ id: string }>(
        `SELECT cv.id FROM conversations cv WHERE cv.client_id = $1 ORDER BY cv.created_at DESC LIMIT 1`,
        [clientId],
      );
      if (!conv.rowCount) throw new Error('cliente sem conversa para entregar whatsapp');
      const inserted = await db.query<{ id: string }>(
        `INSERT INTO messages (conversation_id, direction, channel, sender, body, send_state, metadata)
         VALUES ($1, 'outbound', 'whatsapp', 'luna', $2, 'queued', $3) RETURNING id`,
        [conv.rows[0]!.id, `📢 ${title}\n\n${body}`, JSON.stringify({ notification_delivery: row.id })],
      );
      await db.query('SELECT pg_notify($1, $2)', ['luna_outbound', inserted.rows[0]!.id]);
      await mark('sent');
    } else if (row.channel === 'email') {
      if (!emailConfigured(deps.email)) throw new Error('SMTP_URL não configurado (fail-closed)');
      const r = await sendEmail(row.recipient, title, body, deps.email);
      await mark(r.ok ? 'sent' : 'failed', r.ok ? undefined : 'transporte retornou ok=false');
    } else if (row.channel === 'push') {
      if (!pushConfigured(deps.push)) throw new Error('VAPID não configurado (fail-closed)');
      const sub = await db.query<{ config: { subscription?: PushSubscription } }>(
        `SELECT config FROM channel_preferences WHERE client_id = $1 AND channel = 'push'`,
        [clientId],
      );
      const subscription = sub.rows[0]?.config?.subscription;
      if (!subscription) throw new Error('sem subscription push cadastrada para o cliente');
      const r = await sendPush(subscription, { title, body }, deps.push);
      await mark(r.ok ? 'sent' : 'failed');
    } else {
      throw new Error(`canal desconhecido: ${row.channel}`);
    }
    await recordAudit(db, {
      actor: 'orchestrator',
      action: 'notification.sent',
      tool: `channel_${row.channel}`,
      client_id: clientId,
      result: 'success',
      metadata: { delivery_id: row.id, channel: row.channel },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await mark('failed', message);
    await recordAudit(db, {
      actor: 'orchestrator',
      action: 'notification.failed',
      tool: `channel_${row.channel}`,
      client_id: clientId,
      result: 'failed',
      metadata: { delivery_id: row.id, channel: row.channel, error: message },
    });
    deps.log.error({ err, delivery: row }, 'notification: delivery falhou (fail-closed registrado)');
  }
}

export function createNotificationHandler(deps: NotificationDeps) {
  const { pool, log } = deps;

  return async function handleNotificationRequested(event: EventEnvelope): Promise<void> {
    const payload = event.payload as RequestedPayload;
    const clientId = payload.client_id ?? event.client_id;
    if (!clientId) throw new Error('notification.requested sem client_id');
    const title = payload.title ?? 'Superclim';
    const body = payload.body ?? '';
    const baseKey = payload.idempotency_key ?? event.event_id;

    let channels = payload.channel ? [payload.channel] : await loadEnabledChannels(pool, clientId);
    let usedDefault = false;
    if (channels.length === 0) {
      channels = ['whatsapp']; // canal base quando o cliente não escolheu
      usedDefault = true;
    }

    for (const channel of channels) {
      const key = `notif:${baseKey}:${channel}`;
      const recipient =
        payload.recipient ?? (channel === 'push' ? 'subscription' : await resolveRecipient(pool, clientId, channel));
      if (!recipient) {
        log.error({ clientId, channel }, 'notification: sem recipient — delivery não criada (falha explícita)');
        await recordAudit(pool, {
          actor: 'orchestrator',
          action: 'notification.failed',
          tool: `channel_${channel}`,
          client_id: clientId,
          result: 'failed',
          metadata: { error: 'sem recipient para o canal', used_default: usedDefault },
        });
        continue;
      }
      const inserted = await pool.query<DeliveryRow>(
        `INSERT INTO notifications (client_id, event_id, channel, recipient, title, body, status, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
         ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
         RETURNING id, channel, recipient`,
        [clientId, event.event_id, channel, recipient, title, body, key],
      );
      if (!inserted.rowCount) {
        log.info({ key }, 'notification: duplicada por idempotency_key — ignorada');
        continue;
      }
      await dispatch(pool, deps, inserted.rows[0]!, title, body, clientId);
    }

    log.info({ clientId, channels, usedDefault }, 'notification: fan-out concluído');
  };
}

/** Boot loga a capability dos canais (§9-style: explícito, nunca silêncio). */
export function logChannelCapabilities(log: Logger, email: EmailConfig, push: PushConfig): void {
  log.info(
    {
      whatsapp: true, // sempre (transport próprio)
      email: emailConfigured(email) ? 'configurado' : 'SEM SMTP_URL — canal falharia explicitamente',
      push: pushConfigured(push) ? 'configurado' : 'SEM VAPID — canal falharia explicitamente',
    },
    'capability dos canais de notificação (§22)',
  );
}
