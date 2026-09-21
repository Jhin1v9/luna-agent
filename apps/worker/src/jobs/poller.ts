import type { Pool } from 'pg';
import { recordAudit, recordActivity, type ActivityEntry } from '@luna/database';

/**
 * Job runner do worker (§7.12 — cola = tabela `jobs` + worker).
 *
 * Poll com FOR UPDATE SKIP LOCKED: workers paralelos não pegam o mesmo job;
 * a mesma conversa pode ser serializada por prioridade no ORDER BY.
 *
 * Falhas: backoff exponencial até max_attempts → `dead` + dead_letter_events
 * (§7.7) com motivo, último erro, tentativas e stack.
 */

export interface JobRow {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  idempotency_key: string | null;
  [key: string]: unknown;
}

export interface JobContext {
  recordActivity: (entry: ActivityEntry) => Promise<void>;
}

export type JobHandler = (job: JobRow, ctx: JobContext) => void | Promise<void>;

export interface JobRunnerOptions {
  workerId?: string;
  pollIntervalMs?: number;
  batchSize?: number;
  baseBackoffMs?: number;
}

export function jobBackoffMs(attempts: number, base = 1000): number {
  return base * 2 ** Math.max(0, attempts - 1);
}

function errorInfo(err: unknown): { message: string; stack: string | null } {
  if (err instanceof Error) return { message: err.message, stack: err.stack ?? null };
  return { message: String(err), stack: null };
}

export class JobRunner {
  private handlers = new Map<string, JobHandler>();
  private timer: NodeJS.Timeout | null = null;
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly baseBackoffMs: number;

  constructor(
    private readonly pool: Pool,
    opts: JobRunnerOptions = {},
  ) {
    this.workerId = opts.workerId ?? `worker-${process.pid}`;
    this.pollIntervalMs = opts.pollIntervalMs ?? 1000;
    this.batchSize = opts.batchSize ?? 5;
    this.baseBackoffMs = opts.baseBackoffMs ?? 1000;
  }

  register(jobType: string, handler: JobHandler): void {
    this.handlers.set(jobType, handler);
  }

  /** Um ciclo de poll: pega jobs pendentes e executa. Retorna nº processados. */
  async runOnce(): Promise<number> {
    const claimed = await this.pool.query<JobRow>(
      `WITH picked AS (
         SELECT id FROM jobs
         WHERE status = 'pending' AND run_at <= now()
         ORDER BY priority DESC, run_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE jobs j
       SET status = 'running', locked_by = $2, locked_at = now(),
           attempts = j.attempts + 1, updated_at = now()
       FROM picked WHERE j.id = picked.id
       RETURNING j.*`,
      [this.batchSize, this.workerId],
    );

    for (const job of claimed.rows) {
      const startedAt = Date.now();
      const handler = this.handlers.get(job.job_type);
      const ctx: JobContext = {
        recordActivity: (entry) => recordActivity(this.pool, entry),
      };
      try {
        if (!handler) throw new Error(`nenhum handler registrado para job_type '${job.job_type}'`);
        await handler(job, ctx);
        await this.pool.query(
          `UPDATE jobs SET status = 'completed', completed_at = now(),
             locked_by = NULL, locked_at = NULL, updated_at = now()
           WHERE id = $1`,
          [job.id],
        );
        await recordAudit(this.pool, {
          actor: this.workerId,
          action: 'job.completed',
          tool: job.job_type,
          correlation_id: typeof job.idempotency_key === 'string' ? job.idempotency_key : null,
          duration_ms: Date.now() - startedAt,
          result: 'success',
          metadata: { job_id: job.id },
        });
      } catch (err) {
        const { message, stack } = errorInfo(err);
        const attempts = job.attempts; // já incrementado pelo claim
        await recordAudit(this.pool, {
          actor: this.workerId,
          action: 'job.failed',
          tool: job.job_type,
          duration_ms: Date.now() - startedAt,
          result: 'failed',
          metadata: { job_id: job.id, error: message, attempts },
        });
        if (attempts >= job.max_attempts) {
          await this.pool.query(
            `UPDATE jobs SET status = 'dead', last_error = $2,
               locked_by = NULL, locked_at = NULL, updated_at = now()
             WHERE id = $1`,
            [job.id, message],
          );
          await this.pool.query(
            `INSERT INTO dead_letter_events
               (event_id, event_type, source, payload, reason, last_error, attempts, stack)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [job.idempotency_key, job.job_type, this.workerId, job.payload, 'job_failed', message, attempts, stack],
          );
        } else {
          const retryAt = new Date(Date.now() + jobBackoffMs(attempts, this.baseBackoffMs));
          await this.pool.query(
            `UPDATE jobs SET status = 'pending', last_error = $2, run_at = $3,
               locked_by = NULL, locked_at = NULL, updated_at = now()
             WHERE id = $1`,
            [job.id, message, retryAt],
          );
        }
      }
    }
    return claimed.rows.length;
  }

  /** Loop contínuo de poll. Chamar stop() no shutdown. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.runOnce().catch(() => {
        // Ciclo falho (ex.: pg fora) — o próximo tenta de novo.
      });
    }, this.pollIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
