import type { Pool } from 'pg';
import { resolveIngressIdentity } from './ingress.js';
import { recordAudit } from './audit.js';

/**
 * ALERTA DE ESCALAÇÃO NO WHATSAPP DO OWNER (decreto owner 2026-10-14):
 * o canal Telegram do time NUNCA foi configurado em produção — ninguém
 * recebia escalation nenhuma ("é só clicar um botão" não, tem que CHEGAR).
 * Todo alerta de escalation agora vai também como DM da Luna pro Abner,
 * gravado em messages (fica registrado) + audit_log.
 */
export async function alertOwnerWhatsApp(
  pool: Pool,
  text: string,
  meta: { escalation_id: string; priority?: string; stage?: string },
): Promise<{ ok: boolean; message_id?: string; error?: string }> {
  try {
    const identity = await resolveIngressIdentity(pool, {
      client_name: 'Abner',
      contact_name: 'Abner',
      channel: 'whatsapp',
      address: 'Abner',
    });
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO messages (conversation_id, direction, channel, sender, body, author_name, metadata, send_state)
       VALUES ($1, 'outbound', 'whatsapp', 'luna', $2, 'Luna', $3, 'queued') RETURNING id`,
      [
        identity.conversation_id,
        text,
        {
          kind: 'escalation_alert',
          escalation_id: meta.escalation_id,
          priority: meta.priority ?? null,
          stage: meta.stage ?? 'alert',
          notify_send: '1',
        },
      ],
    );
    const id = inserted.rows[0]!.id;
    await pool.query('SELECT pg_notify($1, $2)', ['luna_outbound', id]);
    await recordAudit(pool, {
      actor: 'escalation',
      action: 'escalation.whatsapp_alert',
      tool: 'escalation_alert',
      client_id: identity.client_id,
      result: 'success',
      metadata: { escalation_id: meta.escalation_id, stage: meta.stage ?? 'alert', message_id: id },
    });
    return { ok: true, message_id: id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
