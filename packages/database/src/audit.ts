import type { Pool, PoolClient } from 'pg';

/**
 * Audit log (§20 — máquina): toda ação importante deixa evidência.
 * actor, action, tool, client, correlation_id, duration, result, timestamp, commit.
 */

export type Sql = Pick<Pool | PoolClient, 'query'>;

export type AuditResult = 'success' | 'failed';

export interface AuditEntry {
  actor: string;
  action: string;
  tool?: string;
  client_id?: string | null;
  correlation_id?: string | null;
  duration_ms?: number;
  result?: AuditResult;
  commit_hash?: string;
  metadata?: Record<string, unknown>;
}

export async function recordAudit(db: Sql, entry: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_log
       (actor, action, tool, client_id, correlation_id, duration_ms, result, commit_hash, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      entry.actor,
      entry.action,
      entry.tool ?? null,
      entry.client_id ?? null,
      entry.correlation_id ?? null,
      entry.duration_ms ?? null,
      entry.result ?? 'success',
      entry.commit_hash ?? null,
      entry.metadata ?? {},
    ],
  );
}

/**
 * Activity log (§20 — humano): "14:31 — Respondi a Jess."
 * Frases curtas para gente ler. Nunca secrets, nunca razonamento interno.
 */

export type ActivityKind = 'info' | 'action' | 'incident';

export interface ActivityEntry {
  actor?: string;
  client_id?: string | null;
  kind?: ActivityKind;
  summary: string;
  correlation_id?: string | null;
}

export async function recordActivity(db: Sql, entry: ActivityEntry): Promise<void> {
  await db.query(
    `INSERT INTO activity_log (actor, client_id, kind, summary, correlation_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      entry.actor ?? 'luna',
      entry.client_id ?? null,
      entry.kind ?? 'info',
      entry.summary,
      entry.correlation_id ?? null,
    ],
  );
}
