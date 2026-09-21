import type { Pool, PoolClient } from 'pg';

/**
 * Reaper de locks travados (deixado de propósito na F1.2, entra na F1.3):
 * se o processo morre no meio de um dispatch/job, a linha fica presa em
 * 'running' para sempre. Depois do timeout, o reaper devolve para a fila.
 */

export type Sql = Pick<Pool | PoolClient, 'query'>;

export interface ReapResult {
  outbox_requeued: number;
  jobs_requeued: number;
}

export async function reapStaleLocks(db: Sql, lockTimeoutMs: number): Promise<ReapResult> {
  const cutoff = new Date(Date.now() - lockTimeoutMs);

  const outbox = await db.query<{ id: string }>(
    `UPDATE outbox
     SET status = 'pending', locked_at = NULL, next_retry_at = now()
     WHERE status = 'running' AND locked_at < $1
     RETURNING id`,
    [cutoff],
  );

  const jobs = await db.query<{ id: string }>(
    `UPDATE jobs
     SET status = 'pending', locked_by = NULL, locked_at = NULL,
         run_at = now(), updated_at = now()
     WHERE status = 'running' AND locked_at < $1
     RETURNING id`,
    [cutoff],
  );

  return { outbox_requeued: outbox.rowCount ?? 0, jobs_requeued: jobs.rowCount ?? 0 };
}
