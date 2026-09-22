import type { Pool } from 'pg';

/**
 * DLQ redrive (§7.7): evento que esgotou retry (quota, provedor fora...) não
 * é fim — guardamos motivo/erro/tentativas e, quando a causa passa, o redrive
 * devolve o evento pro outbox pra reprocessar. Idempotente: o handler tem
 * dedupe por reply_to_event, então reprocessar nunca duplica resposta.
 */

export interface RedriveResult {
  redriven: string[];
  skipped: Array<{ event_id: string; reason: string }>;
}

/** Reenfileira um dead-letter de volta no outbox. Retorna false se não achou. */
export async function redriveDeadLetter(pool: Pool, eventId: string): Promise<boolean> {
  const dlq = await pool.query<{ event_id: string; event_type: string; payload: unknown }>(
    'SELECT event_id, event_type, payload FROM dead_letter_events WHERE event_id = $1',
    [eventId],
  );
  if (!dlq.rowCount) return false;

  // Limpa o outbox morto do evento (mesmo event_id) e reinsere como pending.
  await pool.query('DELETE FROM outbox WHERE event_id = $1', [eventId]);
  const original = await pool.query<{ payload: unknown; occurred_at: string }>(
    'SELECT payload, occurred_at FROM events WHERE event_id = $1',
    [eventId],
  );
  const envelope = original.rows[0]?.payload ?? dlq.rows[0]!.payload;
  await pool.query(
    `INSERT INTO outbox (event_id, event_type, payload, occurred_at)
     VALUES ($1, $2, $3, $4)`,
    [eventId, dlq.rows[0]!.event_type, envelope, original.rows[0]?.occurred_at ?? new Date()],
  );
  await pool.query('DELETE FROM dead_letter_events WHERE event_id = $1', [eventId]);
  return true;
}

/** Redrive em lote: por padrão só eventos mortos por falha TRANSIENTE
 *  (quota 403, timeout, 5xx) — erro de payload/validação NÃO reentra (seria
 *  loop eterno). */
export async function redriveTransientDeadLetters(pool: Pool): Promise<RedriveResult> {
  const TRANSIENT = /403|429|timeout|inaccessible|502|503|500|rate/i;
  const rows = await pool.query<{ event_id: string; last_error: string | null }>(
    'SELECT event_id, last_error FROM dead_letter_events ORDER BY created_at ASC LIMIT 50',
  );
  const result: RedriveResult = { redriven: [], skipped: [] };
  for (const row of rows.rows) {
    if (row.last_error && TRANSIENT.test(row.last_error)) {
      if (await redriveDeadLetter(pool, row.event_id)) result.redriven.push(row.event_id);
    } else {
      result.skipped.push({ event_id: row.event_id, reason: 'erro não transiente (precisa de fix, não de retry)' });
    }
  }
  return result;
}
