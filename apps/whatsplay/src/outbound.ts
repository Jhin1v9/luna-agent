import type { Pool, PoolClient } from 'pg';
import type { Logger } from 'pino';
import { recordAudit } from '@luna/database';
import type { WhatsAppTransport } from './transport.js';

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
  /**
   * GUARDRAIL DE CÓDIGO (decreto do owner, ADR-020): fora de produção, só
   * estes destinatários (nome ou jid) podem receber mensagem da Luna.
   * Lista vazia com enforce=true = recusa TUDO (fail-closed). Nunca
   * silencioso: recusa gera audit explícito + send_state='failed'.
   */
  allowlist?: string[];
  enforceAllowlist?: boolean;
}

interface OutboundMessageRow {
  id: string;
  body: string;
  address: string | null;
  contact_name: string | null;
  correlation_id: string | null;
}

export function createOutboundListener(deps: OutboundDeps) {
  const { pool, transport, log } = deps;
  const allowlist = (deps.allowlist ?? []).map((s) => s.trim()).filter(Boolean);
  const enforce = deps.enforceAllowlist ?? false;

  /** GUARDRAIL: fora de produção, destino precisa estar na allowlist.
   *  Match estrito (fail-closed): exato, ou jid (entrada com @ casa por
   *  sufixo). Substring solto NÃO vale — falso-positivo de allow é o pior
   *  cenário deste guardrail. */
  function refusedByAllowlist(target: string): string | null {
    if (!enforce) return null;
    const hit = allowlist.some((entry) =>
      entry.includes('@') ? target.endsWith(entry) : entry === target,
    );
    if (hit) return null;
    return allowlist.length === 0
      ? 'allowlist vazia em modo teste/dev — envio recusado (fail-closed, decreto do owner)'
      : `destinatário fora da allowlist de teste [${allowlist.join(', ')}]`;
  }

  async function deliverOne(messageId: string): Promise<void> {
    const res = await pool.query<OutboundMessageRow>(
      `SELECT m.id, m.body, ct.address, ct.name AS contact_name,
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
      log.error({ message_id: messageId, target, refusal }, 'GUARDRAIL: envio recusado pela allowlist');
      return;
    }
    try {
      // Anti-ban: gente não responde em 300ms. Espera configurada + jitter,
      // e o sendMessage ainda soma delay de digitação (ADR-004).
      const base = deps.humanDelayMs ?? 6_000;
      const wait = base + Math.floor(Math.random() * 3_000);
      deps.log.info({ message_id: messageId, wait_ms: wait }, 'espera humana antes de enviar');
      await new Promise((r) => setTimeout(r, wait));
      await transport.sendMessage(target, row.body);
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
      await mark(messageId, 'failed', err instanceof Error ? err.message : String(err));
      await recordAudit(pool, {
        actor: 'whatsplay',
        action: 'whatsapp.message.send_failed',
        tool: 'whatsplay_transport',
        correlation_id: row.correlation_id,
        result: 'failed',
        metadata: { message_id: messageId, target, error: String(err) },
      });
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
