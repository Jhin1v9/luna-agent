import type { Pool } from 'pg';
import { resolveIngressIdentity } from './ingress.js';
import { recordAudit } from './audit.js';
import { registryCheck } from './registry.js';

/**
 * ALERTA DE ESCALAÇÃO NO WHATSAPP DO OWNER (decreto owner 2026-10-14):
 * o canal Telegram do time NUNCA foi configurado em produção — ninguém
 * recebia escalation nenhuma ("é só clicar um botão" não, tem que CHEGAR).

 * O destino é configurado por LUNA_ESCALATION_CONTACT (fallback legado:
 * SUPERCLIM_ESCALATION_CONTACT) e precisa existir no Chat Registry.
 * Sem default pessoal (decreto owner 15/10: infos internas ficam em cada
 * repo) — cada deploy configura sua env; sem ela, falha fechado.

 */
function escalationContact(): string {
  return (
    process.env.LUNA_ESCALATION_CONTACT?.trim() ||
    process.env.SUPERCLIM_ESCALATION_CONTACT?.trim() ||
    ''
  );
}

export async function alertOwnerWhatsApp(
  pool: Pool,
  text: string,
  meta: { escalation_id: string; priority?: string; stage?: string },
): Promise<{ ok: boolean; message_id?: string; error?: string }> {
  try {

    const target = escalationContact();
    if (!target) return { ok: false, error: 'LUNA_ESCALATION_CONTACT não configurado' };

    const allowed = await registryCheck(pool, target, 'receber alerta');
    if (!allowed.ok) return { ok: false, error: allowed.reason };
    const identity = await resolveIngressIdentity(pool, {
      client_name: allowed.entry.canonicalName,
      contact_name: allowed.entry.canonicalName,
      channel: 'whatsapp',
      address: allowed.entry.chatKey,
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
