import type { Pool } from 'pg';

/**
 * Ponte Kimi Work (decreto owner 2026-09-24): caixa de entrada de eventos do
 * WhatsApp consumida pelo cérebro Kimi Work (agente no workspace do
 * luna-agent, via Automation local_conversation). O daemon SÓ enfileira
 * fatos; quem decide e age é o Kimi Work — pelas vias já existentes:
 *   - resposta em texto → INSERT em messages + pg_notify('luna_outbound')
 *     (reusa allowlist, send-safety e auditoria do outbound);
 *   - chamada → NOTIFY whatsapp_actions { action: 'call.answer'|... }.
 */

export interface KimiWorkEventInput {
  kind: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

/** Enfileira evento (idempotente por chave). Retorna null se duplicado. */
export async function insertKimiWorkEvent(pool: Pool, input: KimiWorkEventInput): Promise<string | null> {
  const r = await pool.query(
    `INSERT INTO kimiwork_inbox (kind, payload, idempotency_key)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [input.kind, JSON.stringify(input.payload), input.idempotencyKey],
  );
  return r.rows[0]?.id ?? null;
}

export interface KimiWorkEventRow {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  status: string;
  received_at: Date;
  idempotency_key: string | null;
}

/** Próximos eventos pendentes (SKIP LOCKED: consumidores paralelos seguros). */
export async function listPendingKimiWorkEvents(pool: Pool, limit = 20): Promise<KimiWorkEventRow[]> {
  const r = await pool.query(
    `SELECT id, kind, payload, status, received_at, idempotency_key
     FROM kimiwork_inbox
     WHERE status = 'pending'
     ORDER BY received_at
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [limit],
  );
  return r.rows as KimiWorkEventRow[];
}

/** Marca evento como processado (ou erro), com resultado opcional. */
export async function markKimiWorkEvent(
  pool: Pool,
  id: string,
  status: 'processing' | 'done' | 'error',
  result?: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    `UPDATE kimiwork_inbox
     SET status = $2, processed_at = now(), result = COALESCE($3::jsonb, result)
     WHERE id = $4`,
    [id, status, result ? JSON.stringify(result) : null, id],
  );
}
