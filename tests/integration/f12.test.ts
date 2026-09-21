/**
 * Testes de INTEGRAção da F1.2 — rodam contra Postgres real.
 *
 * Banco dedicado `luna_test` (nunca o `luna` de dev): criado no beforeAll,
 * migrado pelo migrator real, truncado entre testes e derrubado no afterAll.
 * Override: TEST_DATABASE_URL=postgres://luna:luna@localhost:5433/outro_db
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { migrate } from '../../packages/database/src/migrate.js';
import {
  enqueueJob,
  recordAudit,
  recordActivity,
  checkConnection,
} from '../../packages/database/src/index.js';
import { EventBus } from '../../apps/orchestrator/src/events/bus.js';
import { JobRunner } from '../../apps/worker/src/jobs/poller.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://luna:luna@localhost:5433/luna_test';
const ADMIN_URL = (() => {
  const u = new URL(TEST_URL);
  u.pathname = '/postgres';
  return u.toString();
})();
const TEST_DB_NAME = new URL(TEST_URL).pathname.slice(1);

const TABLES = [
  'organizations', 'plans', 'clients', 'contacts', 'channel_preferences',
  'conversations', 'messages', 'events', 'jobs', 'notifications',
  'agent_runs', 'run_buffer_lines', 'tool_runs', 'escalations', 'incidents',
  'usage_entries', 'memory_index', 'projects', 'tasks', 'reports',
  'brain_commits', 'outbox', 'dead_letter_events', 'idempotency_keys',
  'audit_log', 'activity_log',
];

let pool: pg.Pool;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();

  await migrate(TEST_URL); // migrator real, aplica 001 + 002
  pool = new pg.Pool({ connectionString: TEST_URL });
  expect(await checkConnection(pool)).toBe(true);
});

afterAll(async () => {
  await pool.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
  await admin.end();
});

beforeEach(async () => {
  await pool.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
});

const q = <T>(text: string, values?: unknown[]) => pool.query<T>(text, values);

// ─────────────────────────── migrator ───────────────────────────

describe('migrator (integração)', () => {
  it('aplica 001+002 em banco fresco e registra em schema_migrations', async () => {
    const scratch = 'luna_migrator_it';
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${scratch}`);
    await admin.end();

    try {
      const scratchUrl = TEST_URL.replace(TEST_DB_NAME, scratch);
      const applied = await migrate(scratchUrl);
      expect(applied).toEqual([
        '001_foundation.sql',
        '002_events_outbox_dlq_audit.sql',
        '003_messages_send_tracking.sql',
      ]);

      const c = new pg.Client({ connectionString: scratchUrl });
      await c.connect();
      const tables = await c.query<{ t: string | null }>(
        `SELECT to_regclass('public.outbox') AS t
         UNION ALL SELECT to_regclass('public.dead_letter_events')
         UNION ALL SELECT to_regclass('public.idempotency_keys')
         UNION ALL SELECT to_regclass('public.audit_log')
         UNION ALL SELECT to_regclass('public.activity_log')
         UNION ALL SELECT to_regclass('public.events')
         UNION ALL SELECT to_regclass('public.jobs')`,
      );
      expect(tables.rows.every((r) => r.t !== null)).toBe(true);
      await c.end();

      // Idempotente: rerun não reaplica nada.
      expect(await migrate(scratchUrl)).toEqual([]);
    } finally {
      const admin2 = new pg.Client({ connectionString: ADMIN_URL });
      await admin2.connect();
      await admin2.query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
      await admin2.end();
    }
  });

  it('002 adiciona completed_at em jobs sem tocar na 001', async () => {
    const col = await q<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'jobs' AND column_name = 'completed_at'`,
    );
    expect(col.rowCount).toBe(1);
  });
});

// ─────────────────────────── event bus ───────────────────────────

describe('event bus (integração)', () => {
  it('publish persiste envelope em events + outbox na mesma transação (§7.8)', async () => {
    const bus = new EventBus(pool);
    const { event, duplicate } = await bus.publish({
      event_type: 'client.message.received',
      source: 'whatsplay',
      payload: { text: 'oi' },
    });
    expect(duplicate).toBe(false);
    expect(event.event_id).toMatch(/^evt_/);

    const ev = await q('SELECT * FROM events WHERE event_id = $1', [event.event_id]);
    expect(ev.rowCount).toBe(1);
    expect(ev.rows[0]!.event_type).toBe('client.message.received');
    const envelope = ev.rows[0]!.payload as { payload: { text: string } };
    expect(envelope.payload.text).toBe('oi');

    const ob = await q('SELECT * FROM outbox WHERE event_id = $1', [event.event_id]);
    expect(ob.rowCount).toBe(1);
    expect(ob.rows[0]!.status).toBe('pending');
  });

  it('idempotency_key duplicada nunca executa 2x (§7.6)', async () => {
    const bus = new EventBus(pool);
    const first = await bus.publish({
      event_type: 'whatsapp.message.received',
      source: 'whatsplay',
      payload: { wamid: 'ABC-1' },
      idempotency_key: 'wamid:ABC-1',
    });
    const second = await bus.publish({
      event_type: 'whatsapp.message.received',
      source: 'whatsplay',
      payload: { wamid: 'ABC-1' },
      idempotency_key: 'wamid:ABC-1',
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.event.event_id).toBe(first.event.event_id);

    expect((await q('SELECT * FROM events')).rowCount).toBe(1);
    expect((await q('SELECT * FROM outbox')).rowCount).toBe(1);
    expect((await q('SELECT * FROM idempotency_keys')).rowCount).toBe(1);
  });

  it('dispatchOnce entrega aos handlers registrados e audita sucesso (§20)', async () => {
    const bus = new EventBus(pool);
    const { event } = await bus.publish({
      event_type: 'client.message.received',
      source: 'whatsplay',
      payload: { text: 'oi' },
    });

    const received: unknown[] = [];
    bus.on('client.message.received', (evt) => {
      received.push(evt);
    });
    const dispatched = await bus.dispatchOnce();
    expect(dispatched).toBe(1);
    expect(received).toHaveLength(1);
    expect((received[0] as { event_id: string }).event_id).toBe(event.event_id);

    const ob = await q('SELECT status, published_at FROM outbox WHERE event_id = $1', [
      event.event_id,
    ]);
    expect(ob.rows[0]!.status).toBe('published');
    expect(ob.rows[0]!.published_at).not.toBeNull();

    const audit = await q(
      `SELECT * FROM audit_log WHERE action = 'event.dispatched' AND result = 'success'`,
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0]!.correlation_id).toBe(event.correlation_id);
  });

  it('dispatchOnce: evento sem handler é publicado limpo (nada quebra)', async () => {
    const bus = new EventBus(pool);
    const { event } = await bus.publish({
      event_type: 'system.health.degraded',
      source: 'worker',
      payload: { component: 'pg' },
    });
    await bus.dispatchOnce();
    const ob = await q('SELECT status FROM outbox WHERE event_id = $1', [event.event_id]);
    expect(ob.rows[0]!.status).toBe('published');
  });

  it('handler que falha faz retry com backoff e vai pra DLQ com motivo/erro/stack (§7.7)', async () => {
    const bus = new EventBus(pool, { maxAttempts: 2, baseBackoffMs: 60_000 });
    const { event } = await bus.publish({
      event_type: 'agent.run.failed',
      source: 'worker',
      payload: { boom: true },
    });

    let calls = 0;
    bus.on('agent.run.failed', () => {
      calls++;
      throw new Error('handler explodiu');
    });

    await bus.dispatchOnce(); // tentativa 1 → falha, fica pending com backoff
    let ob = await q('SELECT * FROM outbox WHERE event_id = $1', [event.event_id]);
    expect(ob.rows[0]!.status).toBe('pending');
    expect(ob.rows[0]!.attempts).toBe(1);
    expect(new Date(ob.rows[0]!.next_retry_at as string).getTime()).toBeGreaterThan(Date.now());

    await q('UPDATE outbox SET next_retry_at = now() WHERE event_id = $1', [event.event_id]);
    await bus.dispatchOnce(); // tentativa 2 = máx. → dead + DLQ
    expect(calls).toBe(2);

    ob = await q('SELECT status FROM outbox WHERE event_id = $1', [event.event_id]);
    expect(ob.rows[0]!.status).toBe('dead');

    const dlq = await q('SELECT * FROM dead_letter_events WHERE event_id = $1', [event.event_id]);
    expect(dlq.rowCount).toBe(1);
    expect(dlq.rows[0]!.reason).toBe('handler_failed');
    expect(dlq.rows[0]!.last_error).toBe('handler explodiu');
    expect(dlq.rows[0]!.attempts).toBe(2);
    expect(String(dlq.rows[0]!.stack)).toContain('handler explodiu');

    const audit = await q(`SELECT * FROM audit_log WHERE result = 'failed'`);
    expect(audit.rowCount).toBe(2); // uma por tentativa falha
  });
});

// ─────────────────────────── worker / jobs ───────────────────────────

describe('worker + cola de jobs (integração)', () => {
  it('executa job registrado até completed_at', async () => {
    const { id } = await enqueueJob(pool, { job_type: 'ping', payload: { n: 1 } });
    const seen: unknown[] = [];
    const runner = new JobRunner(pool);
    runner.register('ping', (job) => {
      seen.push(job.payload);
    });

    expect(await runner.runOnce()).toBe(1);
    expect(seen).toEqual([{ n: 1 }]);

    const job = await q('SELECT * FROM jobs WHERE id = $1', [id]);
    expect(job.rows[0]!.status).toBe('completed');
    expect(job.rows[0]!.completed_at).not.toBeNull();
  });

  it('enqueueJob com idempotency_key não duplica (§7.6)', async () => {
    const a = await enqueueJob(pool, {
      job_type: 'report.generate',
      payload: { month: '2026-09' },
      idempotency_key: 'report:2026-09',
    });
    const b = await enqueueJob(pool, {
      job_type: 'report.generate',
      payload: { month: '2026-09' },
      idempotency_key: 'report:2026-09',
    });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.id).toBe(a.id);
    expect((await q('SELECT * FROM jobs')).rowCount).toBe(1);
  });

  it('job que falha faz retry até max_attempts e vira dead + DLQ (§7.7)', async () => {
    const { id } = await enqueueJob(pool, { job_type: 'boom', max_attempts: 2 });
    const runner = new JobRunner(pool, { baseBackoffMs: 60_000 });
    runner.register('boom', () => {
      throw new Error('kabum');
    });

    await runner.runOnce(); // tentativa 1 → pending com backoff
    let job = await q('SELECT * FROM jobs WHERE id = $1', [id]);
    expect(job.rows[0]!.status).toBe('pending');
    expect(job.rows[0]!.attempts).toBe(1);
    expect(job.rows[0]!.last_error).toBe('kabum');

    await q('UPDATE jobs SET run_at = now() WHERE id = $1', [id]);
    await runner.runOnce(); // tentativa 2 = máx. → dead + DLQ
    job = await q('SELECT * FROM jobs WHERE id = $1', [id]);
    expect(job.rows[0]!.status).toBe('dead');

    const dlq = await q(`SELECT * FROM dead_letter_events WHERE reason = 'job_failed'`);
    expect(dlq.rowCount).toBe(1);
    expect(dlq.rows[0]!.event_type).toBe('boom');
    expect(dlq.rows[0]!.last_error).toBe('kabum');
    expect(dlq.rows[0]!.attempts).toBe(2);
  });

  it('job_type sem handler registrado vira dead (poison message não trava a fila)', async () => {
    const { id } = await enqueueJob(pool, { job_type: 'tipo.que.nao.existe', max_attempts: 1 });
    const runner = new JobRunner(pool);
    await runner.runOnce();
    const job = await q('SELECT * FROM jobs WHERE id = $1', [id]);
    expect(job.rows[0]!.status).toBe('dead');
    expect((await q(`SELECT * FROM dead_letter_events WHERE reason = 'job_failed'`)).rowCount).toBe(1);
  });
});

// ─────────────────────────── audit / activity ───────────────────────────

describe('audit + activity log (§20)', () => {
  it('recordAudit grava evidência de máquina completa', async () => {
    await recordAudit(pool, {
      actor: 'luna',
      action: 'tool.executed',
      tool: 'Read',
      correlation_id: 'corr_1',
      duration_ms: 42,
      result: 'success',
      commit_hash: 'abc123',
      metadata: { file: 'x.ts' },
    });
    const rows = await q('SELECT * FROM audit_log');
    expect(rows.rowCount).toBe(1);
    const r = rows.rows[0]!;
    expect(r.actor).toBe('luna');
    expect(r.action).toBe('tool.executed');
    expect(r.duration_ms).toBe(42);
    expect(r.commit_hash).toBe('abc123');
  });

  it('recordActivity grava frase legível para humanos', async () => {
    await recordActivity(pool, {
      kind: 'action',
      summary: 'Respondi a Jess sobre o status do site.',
      correlation_id: 'corr_9',
    });
    const rows = await q('SELECT * FROM activity_log');
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]!.actor).toBe('luna');
    expect(rows.rows[0]!.kind).toBe('action');
    expect(rows.rows[0]!.summary).toContain('Jess');
  });
});
