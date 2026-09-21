/**
 * Integração do classifier pós-conversa (§27): handler RESOLVED → job
 * 'conversation.classify' → worker classifica (adapter fake determinístico)
 * → conversations.classification + clients.profile + Brain (OPINIONES +
 * sinapse em root temporário) + memory_index. Postgres real (luna_test).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import pino from 'pino';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../../packages/database/src/migrate.js';
import { EventBus } from '../../apps/orchestrator/src/events/bus.js';
import { JobRunner } from '../../apps/worker/src/jobs/poller.js';
import { createClassifyHandler } from '../../apps/worker/src/jobs/classify.js';
import { createMessageHandler } from '../../apps/orchestrator/src/agent/handler.js';
import { simulateMessage } from '../../apps/orchestrator/src/test/simulate.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgres://luna:luna@localhost:5433/luna_test';
const ADMIN_URL = (() => {
  const u = new URL(TEST_URL);
  u.pathname = '/postgres';
  return u.toString();
})();
const TEST_DB_NAME = new URL(TEST_URL).pathname.slice(1);

let pool: pg.Pool;
let brainRoot: string;
const log = pino({ level: 'silent' });

const CLASSIFY_JSON = JSON.stringify({
  outcome: 'cliente_feliz',
  sentiment: 'positivo',
  topic: 'site',
  product: 'Site Onadance',
  urgency: 'baixa',
  follow_up_required: false,
  follow_up_note: '',
  quality_score: 5,
  summary: 'Cliente aprovou o hero novo e elogiou o prazo.',
  client_signal: 'elogio',
});

const adapterClassify = {
  mode: 'kimi-api' as const,
  async ensureSession(k: string) {
    return { session_id: `kimi-api:${k}`, busy: false };
  },
  async sendTurn(req: { prompt: string }) {
    if (req.prompt.includes('classificando uma conversa')) {
      return { reply_text: CLASSIFY_JSON, session_id: 'k', duration_ms: 1, model: 'kimi-k2.6' };
    }
    // handler turn (estruturado)
    return {
      reply_text: JSON.stringify({ type: 'ANSWER', text: 'Perfeito, anotado aqui!' }),
      session_id: 'k',
      duration_ms: 1,
      model: 'kimi-k2.6',
    };
  },
  async readMessages() {
    return [];
  },
};

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();
  await migrate(TEST_URL);
  pool = new pg.Pool({ connectionString: TEST_URL });
  brainRoot = mkdtempSync(join(tmpdir(), 'brain-it-'));
});

afterAll(async () => {
  await pool.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
  await admin.end();
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE organizations, clients, contacts, channel_preferences, conversations,
     messages, events, jobs, outbox, dead_letter_events, idempotency_keys,
     audit_log, activity_log, agent_runs, usage_entries, memory_index,
     projects, tasks, reports RESTART IDENTITY CASCADE`,
  );
});

describe('classifier pós-conversa (§27) — pipeline completo', () => {
  it('RESOLVED → job → worker classifica → DB + Brain + memory_index', async () => {
    const bus = new EventBus(pool, { dispatcherId: 'orch-test' });
    bus.on('client.message.received', createMessageHandler({ pool, adapter: adapterClassify as never, log }));
    const r = await simulateMessage(pool, bus, {
      client_name: 'Jess',
      contact_name: 'Jess',
      text: 'amei o hero novo, ficou perfeito!',
      external_id: 'wamid-cls-1',
    });
    await bus.dispatchOnce(); // handler → RESOLVED + enfileira classify

    const queued = await pool.query<{ id: string }>(
      "SELECT id FROM jobs WHERE job_type = 'conversation.classify'",
    );
    expect(queued.rowCount).toBe(1);

    const runner = new JobRunner(pool, { workerId: 'worker-test' });
    runner.register('conversation.classify', createClassifyHandler({ pool, adapter: adapterClassify as never, log, brainRoot }));
    await runner.runOnce();

    const job = await pool.query<{ status: string }>('SELECT status FROM jobs WHERE id = $1', [queued.rows[0]!.id]);
    expect(job.rows[0]!.status).toBe('completed');

    const conv = await pool.query<{ classification: { outcome: string; topic: string; client_signal: string } }>(
      'SELECT classification FROM conversations WHERE id = $1',
      [r.conversation_id],
    );
    expect(conv.rows[0]!.classification.outcome).toBe('cliente_feliz');
    expect(conv.rows[0]!.classification.topic).toBe('site');

    const client = await pool.query<{ profile: { last_outcome: string; signals: { elogio: boolean } } }>(
      'SELECT profile FROM clients WHERE id = $1',
      [(await pool.query('SELECT client_id FROM conversations WHERE id=$1', [r.conversation_id])).rows[0]!.client_id],
    );
    expect(client.rows[0]!.profile.last_outcome).toBe('cliente_feliz');
    expect(client.rows[0]!.profile.signals.elogio).toBe(true);

    // Brain: OPINIONES + sinapse
    const code = (await pool.query('SELECT code FROM clients')).rows[0]!.code;
    const opPath = join(brainRoot, 'clients', code, 'OPINIONES.md');
    expect(existsSync(opPath)).toBe(true);
    expect(readFileSync(opPath, 'utf8')).toContain('hero novo');

    const synDir = join(brainRoot, 'luna', 'synapses');
    expect(existsSync(synDir)).toBe(true);

    const mem = await pool.query('SELECT * FROM memory_index');
    expect(mem.rowCount).toBe(1);
  });

  it('classify idempotente por evento: republicar o evento não duplica job', async () => {
    const bus = new EventBus(pool, { dispatcherId: 'orch-test' });
    bus.on('client.message.received', createMessageHandler({ pool, adapter: adapterClassify as never, log }));
    const input = {
      client_name: 'Jess',
      text: 'oi',
      external_id: 'wamid-cls-2',
    };
    const first = await simulateMessage(pool, bus, input);
    await bus.dispatchOnce();
    const dup = await simulateMessage(pool, bus, input);
    expect(dup.duplicate).toBe(true);
    await bus.dispatchOnce();
    expect((await pool.query("SELECT * FROM jobs WHERE job_type='conversation.classify'")).rowCount).toBe(1);
    void first;
  });
});
