import pg from 'pg';

let pool: pg.Pool | null = null;

export function getPool(databaseUrl?: string): pg.Pool {
  if (pool) return pool;
  pool = new pg.Pool({
    connectionString: databaseUrl ?? process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on('error', (err) => {
    // Erros de cliente idle não devem derrubar o processo.
    console.error('[db] idle client error', err.message);
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** SELECT 1 — checagem mínima de conectividade. */
export async function checkConnection(p?: pg.Pool): Promise<boolean> {
  const db = p ?? getPool();
  try {
    await db.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export { recordAudit, recordActivity } from './audit.js';
export type { AuditEntry, AuditResult, ActivityEntry, ActivityKind, Sql } from './audit.js';
export { enqueueJob } from './jobs.js';
export type { EnqueueJobInput, EnqueueJobResult } from './jobs.js';
export { reapStaleLocks } from './reaper.js';
export type { ReapResult } from './reaper.js';
export { writeHeartbeat, readHeartbeats } from './heartbeat.js';
export type { HeartbeatRow } from './heartbeat.js';
export { redriveDeadLetter, redriveTransientDeadLetters } from './redrive.js';
export type { RedriveResult } from './redrive.js';
export { publishEvent } from './publisher.js';
export type { PublishInput, PublishResult } from './publisher.js';
export {
  ensureOrganization,
  ensureClient,
  ensureContact,
  openConversation,
  insertInboundMessage,
  resolveIngressIdentity,
} from './ingress.js';
export type { IngressIdentity } from './ingress.js';

export { buildAdminFullPack } from './admin-pack.js';
export type { AdminPack } from './admin-pack.js';
export { insertKimiWorkEvent, listPendingKimiWorkEvents, markKimiWorkEvent } from './kimiwork.js';
export type { KimiWorkEventInput, KimiWorkEventRow } from './kimiwork.js';
export { buildContactContext, formatContactContextText, resolveContactFacts } from './context-builder.js';
export type { ContactContext, ContactFacts, MessageFact } from './context-builder.js';
