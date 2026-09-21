import type { Pool, PoolClient } from 'pg';
import type { Logger } from 'pino';
import type { KimiLiveAdapter } from '@luna/agent';
import { sendTeamMessage, type TelegramConfig } from '@luna/channels';
import { recordAudit } from '@luna/database';
import type { WhatsAppTransport } from './transport.js';
import { matchesAllowlist, parseAllowlist } from './allowlist.js';
import { withAutoRepair, type RepairableTransport } from './auto-repair.js';

/**
 * Fila de saída (zero polling): o handler da Luna grava a resposta com
 * send_state='queued' e dispara pg_notify('luna_outbound', message_id).
 * Aqui o WhatsPlay escuta (LISTEN), envia pela transport e marca 'sent'.
 */

export interface OutboundDeps {
  pool: Pool;
  transport: WhatsAppTransport;
  log: Logger;
  /** Anti-ban (ADR-004): espera humana (com jitter) antes de enviar. Default 6s. */
  humanDelayMs?: number;
  /** GUARDRAIL DE CÓDIGO (decreto do owner, ADR-020): fora de produção, só
   * estes destinatários (nome ou jid) podem receber mensagem da Luna.
   * Lista vazia com enforce=true = recusa TUDO (fail-closed). Nunca
   * silencioso: recusa gera audit explícito + send_state='failed'. */
  allowlist?: string[];
  enforceAllowlist?: boolean;
  /** Auto-reparo visual (§14): brain p/ análise + Telegram p/ alerta. */
  adapter?: KimiLiveAdapter;
  telegram?: TelegramConfig;
}

interface OutboundMessageRow {
  id: string;
  body: string;
  conversation_id: string;
  address: string | null;
  contact_name: string | null;
  correlation_id: string | null;
}

export function createOutboundListener(deps: OutboundDeps) {
  const { pool, transport, log } = deps;
  const allowlist = parseAllowlist(deps.allowlist?.join(','));
  const enforce = deps.enforceAllowlist ?? false;

  /** GUARDRAIL: fora de produção, destino precisa estar na allowlist. */
  function refusedByAllowlist(target: string): string | null {
    if (!enforce) return null;
    if (matchesAllowlist(allowlist, target)) return null;
    return allowlist.length === 0
      ? 'allowlist vazia em modo teste/dev — envio recusado (fail-closed, decreto do owner)'
      : `destinatário fora da allowlist de teste [${allowlist.join(', ')}]`;
  }

  /**
   * SEND-SAFETY (decreto owner, pós-incidente 2026-09-21): a resposta tem que
   * ir SEMPRE pro mesmo chat de onde veio a pergunta. Antes de entregar,
   * verifica se a conversa da mensagem outbound == conversa de origem do
   * evento que a gerou (reply_to_event → events.payload.conversation_id).
   *   mismatch PROVADO → bloqueio INCONDICIONAL + alerta imediato pro owner
   *   no Telegram ("tentei responder no chat errado") + audit.
   *   evento de origem ausente → segue com nota de auditoria (sem evidência
   *   de mismatch não se bloqueia; com evidência, nunca se envia).
   */
  async function sendSafetyCheck(messageId: string, conversationId: string): Promise<void> {
    const msg = await pool.query<{ reply_to_event: string | null }>(
      `SELECT metadata->>'reply_to_event' AS reply_to_event FROM messages WHERE id = $1`,
      [messageId],
    );
    const replyTo = msg.rows[0]?.reply_to_event;
    if (!replyTo) {
      await recordAudit(pool, {
        actor: 'whatsplay', action: 'send_safety.skipped', tool: 'send_safety',
        result: 'success', metadata: { message_id: messageId, motivo: 'sem reply_to_event (envio manual)' },
      });
      return;
    }
    const origin = await pool.query<{ origin_conv: string | null }>(
      `SELECT payload->'payload'->>'conversation_id' AS origin_conv FROM events WHERE event_id = $1`,
      [replyTo],
    );
    const originConv = origin.rows[0]?.origin_conv;
    if (!originConv) {
      await recordAudit(pool, {
        actor: 'whatsplay', action: 'send_safety.skipped', tool: 'send_safety',
        result: 'success', metadata: { message_id: messageId, motivo: 'evento de origem não encontrado' },
      });
      return;
    }
    if (originConv === conversationId) return; // vínculo íntegro

    const alvo = await pool.query<{ address: string | null }>(
      `SELECT ct.address FROM conversations cv LEFT JOIN contacts ct ON ct.id = cv.contact_id WHERE cv.id = $1`,
      [conversationId],
    );
    const origem = await pool.query<{ address: string | null }>(
      `SELECT ct.address FROM conversations cv LEFT JOIN contacts ct ON ct.id = cv.contact_id WHERE cv.id = $1`,
      [originConv],
    );
    const destinoAlvo = alvo.rows[0]?.address ?? conversationId;
    const destinoOrigem = origem.rows[0]?.address ?? originConv;

    await mark(messageId, 'failed', `SEND-SAFETY: resposta ia para '${destinoAlvo}' mas a pergunta veio de '${destinoOrigem}' — bloqueado`);
    await recordAudit(pool, {
      actor: 'whatsplay', action: 'send_safety.blocked', tool: 'send_safety',
      result: 'failed',
      metadata: { message_id: messageId, ia_para: destinoAlvo, pergunta_veio_de: destinoOrigem, evento_origem: replyTo },
    });
    const alerta =
      `🚨 SEND-SAFETY: bloqueei uma resposta no chat errado!\n` +
      `Pergunta veio de: ${destinoOrigem}\nResposta ia para: ${destinoAlvo}\n` +
      `Nada foi enviado. Confere o roteamento aí. — Luna`;
    if (deps.telegram?.botToken && deps.telegram.teamChatId) {
      try {
        await sendTeamMessage(alerta, deps.telegram);
      } catch (err) {
        log.error({ err }, 'send-safety: alerta Telegram falhou');
      }
    } else {
      log.error({ alerta }, 'send-safety: TELEGRAM não configurado — alerta NÃO enviado (falha explícita registrada)');
    }
    log.error({ message_id: messageId, ia_para: destinoAlvo, pergunta_veio_de: destinoOrigem }, 'SEND-SAFETY: entrega bloqueada (mismatch de conversa)');
    throw new Error('send_safety_blocked');
  }

  async function deliverOne(messageId: string): Promise<void> {
    const res = await pool.query<OutboundMessageRow>(
      `SELECT m.id, m.body, m.conversation_id, ct.address, ct.name AS contact_name,
              m.metadata->>'correlation_id' AS correlation_id
       FROM messages m
       JOIN conversations cv ON cv.id = m.conversation_id
       LEFT JOIN contacts ct ON ct.id = cv.contact_id
       WHERE m.id = $1 AND m.send_state = 'queued'`,
      [messageId],
    );
    if (!res.rowCount) return; // já entregue ou não existe
    const row = res.rows[0]!;
    const target = row.address ?? row.contact_name;
    if (!target) {
      await mark(messageId, 'failed', 'sem contato/alvo de entrega');
      return;
    }
    // SEND-SAFETY antes de tudo: vínculo pergunta→resposta íntegro.
    try {
      await sendSafetyCheck(messageId, row.conversation_id);
    } catch (err) {
      if (String(err).includes('send_safety_blocked')) return; // já auditado/alertado/bloqueado
      throw err;
    }
    const refusal = refusedByAllowlist(target);
    if (refusal) {
      // Falha EXPLÍCITA: marca failed, audita a recusa, nunca silencioso.
      await mark(messageId, 'failed', refusal);
      await recordAudit(pool, {
        actor: 'whatsplay',
        action: 'whatsapp.message.send_refused',
        tool: 'whatsplay_transport',
        correlation_id: row.correlation_id,
        result: 'failed',
        metadata: { message_id: messageId, target, reason: 'outbound_allowlist', detail: refusal },
      });
      // Se a mensagem era uma delivery de notificação (§22), reflete o
      // resultado real na notifications — 'sent' da fila ≠ entregue.
      const notifId = await pool
        .query<{ id: string }>(
          `SELECT id FROM notifications WHERE id = (SELECT (metadata->>'notification_delivery')::text FROM messages WHERE id = $1)`,
          [messageId],
        )
        .catch(() => ({ rows: [] as Array<{ id: string }> }));
      if (notifId.rows[0]) {
        await pool.query(
          `UPDATE notifications SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
          [notifId.rows[0].id, `entrega recusada: ${refusal}`],
        );
      }
      log.error({ message_id: messageId, target, refusal }, 'GUARDRAIL: envio recusado pela allowlist');
      return;
    }
    try {
      // Anti-ban: gente não responde em 300ms. Espera configurada + jitter
      // curto (3-4s, decreto owner), e o sendMessage ainda soma typing delay.
      // Anti-ban: espera humana DENTRO de cada tentativa (inclusive reparos).
      const send = async (opts: { suggestedSelector: string | null; attempt: number }) => {
        const base = deps.humanDelayMs ?? 3_500;
        const wait = base + Math.floor(Math.random() * 1_000);
        deps.log.info({ message_id: messageId, wait_ms: wait }, 'espera humana antes de enviar');
        await new Promise((r) => setTimeout(r, wait));
        return transport.sendMessage(
          target,
          row.body,
          opts.suggestedSelector ? { inputSelector: opts.suggestedSelector } : undefined,
        );
      };
      if (deps.adapter) {
        // §14: envio com auto-reparo (screenshot + visão + máx 3 tentativas).
        await withAutoRepair(
          { pool, adapter: deps.adapter, transport: transport as RepairableTransport, log, telegram: deps.telegram },
          'sendMessage',
          { conversationTarget: target, correlationId: row.correlation_id },
          send,
        );
      } else {
        await send({ suggestedSelector: null, attempt: 1 });
      }
      await mark(messageId, 'sent');
      await recordAudit(pool, {
        actor: 'whatsplay',
        action: 'whatsapp.message.sent',
        tool: 'whatsplay_transport',
        correlation_id: row.correlation_id,
        result: 'success',
        metadata: { message_id: messageId, target },
      });
      log.info({ message_id: messageId, target }, 'resposta entregue no WhatsApp');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await mark(messageId, 'failed', errorMsg);
      await recordAudit(pool, {
        actor: 'whatsplay',
        action: 'whatsapp.message.send_failed',
        tool: 'whatsplay_transport',
        correlation_id: row.correlation_id,
        result: 'failed',
        metadata: { message_id: messageId, target, error: errorMsg },
      });
      // Paridade com o caminho de recusa: delivery de notificação (§22)
      // reflete o resultado real.
      const notifId = await pool
        .query<{ id: string }>(
          `SELECT id FROM notifications WHERE id = (SELECT (metadata->>'notification_delivery')::text FROM messages WHERE id = $1)`,
          [messageId],
        )
        .catch(() => ({ rows: [] as Array<{ id: string }> }));
      if (notifId.rows[0]) {
        await pool.query(
          `UPDATE notifications SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
          [notifId.rows[0].id, `entrega falhou: ${errorMsg}`],
        );
      }
      log.error({ err, message_id: messageId }, 'falha ao entregar resposta');
    }
  }

  async function mark(messageId: string, state: 'sent' | 'failed', error?: string): Promise<void> {
    await pool.query(
      `UPDATE messages SET send_state = $2, sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END,
         metadata = metadata || $3::jsonb
       WHERE id = $1`,
      [messageId, state, error ? JSON.stringify({ send_error: error }) : '{}'],
    );
  }

  /** Conecta e escuta. Retorna o client LISTEN para o shutdown fechar. */
  async function start(): Promise<PoolClient> {
    const client = await pool.connect();
    await client.query('LISTEN luna_outbound');
    client.on('notification', (n) => {
      if (n.payload) deliverOne(n.payload).catch((err) => log.error({ err }, 'entrega falhou'));
    });
    log.info('ouvindo NOTIFY luna_outbound (fila de saída)');
    return client;
  }

  return { start, deliverOne };
}
