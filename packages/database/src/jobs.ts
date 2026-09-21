import type { Pool, PoolClient } from 'pg';

/**
 * Enqueue de jobs na tabela `jobs` (a "cola" do sistema — sem Kafka, §7.12).
 * Idempotente por idempotency_key: mesma chave nunca cria dois jobs.
 */

export type Sql = Pick<Pool | PoolClient, 'query'>;

export interface EnqueueJobInput {
  job_type: string;
  payload?: Record<string, unknown>;
  priority?: number;
  run_at?: Date;
  max_attempts?: number;
  idempotency_key?: string;
}

export interface EnqueueJobResult {
  id: string;
  /** false quando a idempotency_key já existia (job retornado é o original). */
  created: boolean;
}

export async function enqueueJob(db: Sql, input: EnqueueJobInput): Promise<EnqueueJobResult> {
  const values = [
    input.job_type,
    input.payload ?? {},
    input.priority ?? 0,
    input.run_at ?? new Date(),
    input.max_attempts ?? 3,
    input.idempotency_key ?? null,
  ];

  if (input.idempotency_key) {
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO jobs (job_type, payload, priority, run_at, max_attempts, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      values,
    );
    if (inserted.rowCount && inserted.rowCount > 0) {
      return { id: inserted.rows[0]!.id, created: true };
    }
    const existing = await db.query<{ id: string }>(
      'SELECT id FROM jobs WHERE idempotency_key = $1',
      [input.idempotency_key],
    );
    return { id: existing.rows[0]!.id, created: false };
  }

  const inserted = await db.query<{ id: string }>(
    `INSERT INTO jobs (job_type, payload, priority, run_at, max_attempts, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    values,
  );
  return { id: inserted.rows[0]!.id, created: true };
}
