/**
 * Testes de INTEGRAção da F2 — Notifications engine + workspace ingress,
 * contra Postgres real (banco luna_test). Falso-positivo proposital:
 * "integration" no nome por convenção da suíte.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import pino from 'pino';
import { migrate } from '../../packages/database/src/migrate.js';
import { publishEvent, resolveIngressIdentity, readHeartbeats } from '../../packages/database/src/index.js';
import { createNotificationHandler } from '../../apps/orchestrator/src/notifications/engine.js';
import { createWorkspaceIngress } from '../../apps/orchestrator/src/workspace/ingress.js';
import { EventBus } from '../../apps/orchestrator/src/events/bus.js';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgres://luna:luna@localhost:5433/luna_test';
const ADMIN_URL = (() => {
  const u = new URL(TEST_URL);
  u.pathname = '/postgres';
  return u.toString();
})();
const TEST_DB_NAME = new URL(TEST_URL).pathname.slice(1);

let pool: pg.Pool;
const log = pino({ level: 'silent' });

function fakeReqRes(method: string, body: unknown, auth?: string): {
  req: Partial<IncomingMessage>;
  res: Partial<ServerResponse> & { statusCode?: number; body?: string };
} {
  const req = new EventEmitter() as unknown as Partial<IncomingMessage>;
  req.method = method;
  req.headers = auth ? { authorization: auth } : {};
  const res: Partial<ServerResponse> & { statusCode?: number; body?: string } = {
    writeHead(status: number) {
      this.statusCode = status;
      return this;
    },
    end(chunk?: string) {
      this.body = chunk;
    },
  };
  // simula o stream do body
  setImmediate(() => {
    (req as EventEmitter).emit('data', JSON.stringify(body));
    (req as EventEmitter).emit('end');
  });
  return { req: req as IncomingMessage, res: res as ServerResponse };
}

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();
  await migrate(TEST_URL);
  pool = new pg.Pool({ connectionString: TEST_URL });
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
     audit_log, activity_log, agent_runs, notifications, escalations RESTART IDENTITY CASCADE`,
  );
});

describe('notifications engine (§22) — fan-out por preferência + dedupe', () => {
  const deps = {
    pool: null as unknown as pg.Pool,
    log,
    email: {}, // SMTP não configurado → email deve falhar EXPLICITO
    push: {},
  };

  async function setupClient(): Promise<string> {
    deps.pool = pool;
    const identity = await resolveIngressIdentity(pool, {
      client_name: 'Cliente Notif',
      contact_name: 'Contato',
      channel: 'whatsapp',
      address: 'Pai',
    });
    await pool.query(
      `INSERT INTO contacts (client_id, name, channel, address) VALUES ($1, 'Email', 'email', 'cliente@nexo.dev')`,
      [identity.client_id],
    );
    await pool.query(
      `INSERT INTO channel_preferences (client_id, channel, enabled) VALUES ($1, 'whatsapp', true), ($1, 'email', true)`,
      [identity.client_id],
    );
    return identity.client_id;
  }

  it('fan-out pelos canais habilitados: whatsapp queued, email failed explícito (sem SMTP)', async () => {
    const clientId = await setupClient();
    const handler = createNotificationHandler(deps);
    const { event } = await publishEvent(pool, {
      event_type: 'notification.requested',
      source: 'test',
      client_id: clientId,
      payload: { client_id: clientId, title: 'Site atualizado', body: 'O hero novo entrou no ar.' },
    });
    await handler(event);

    const rows = await pool.query<{ channel: string; status: string; error: string | null }>(
      'SELECT channel, status, error FROM notifications ORDER BY channel',
    );
    expect(rows.rowCount).toBe(2);
    const wa = rows.rows.find((r) => r.channel === 'whatsapp')!;
    const em = rows.rows.find((r) => r.channel === 'email')!;
    expect(wa.status).toBe('sent');
    expect(em.status).toBe('failed');
    expect(em.error).toContain('SMTP_URL'); // fail-closed explícito
  });

  it('dedupe por idempotency_key: mesmo notification.requested não duplica deliveries', async () => {
    const clientId = await setupClient();
    const handler = createNotificationHandler(deps);
    const input = {
      event_type: 'notification.requested',
      source: 'test',
      client_id: clientId,
      payload: { client_id: clientId, title: 'T', body: 'B', idempotency_key: 'notif:fixa:1' },
    };
    const first = await publishEvent(pool, input);
    await handler(first.event);
    const second = await publishEvent(pool, input);
    await handler(second.event);

    expect((await pool.query('SELECT * FROM notifications')).rowCount).toBe(2); // 2 canais, 1x cada
  });

  it('sem preferências: cai no whatsapp com nota (canal base)', async () => {
    const identity = await resolveIngressIdentity(pool, {
      client_name: 'Cliente Sem Prefs',
      channel: 'whatsapp',
      address: 'Pai',
    });
    const handler = createNotificationHandler({ ...deps, pool });
    const { event } = await publishEvent(pool, {
      event_type: 'notification.requested',
      source: 'test',
      client_id: identity.client_id,
      payload: { client_id: identity.client_id, title: 'T', body: 'B' },
    });
    await handler(event);
    const rows = await pool.query<{ channel: string }>('SELECT channel FROM notifications');
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]!.channel).toBe('whatsapp');
  });
});

describe('workspace ingress (BLOCO 5) — auth por token de serviço', () => {
  it('sem token configurado: 503 fail-closed explícito', async () => {
    const ingress = createWorkspaceIngress({ pool, bus: null as unknown as EventBus, log, serviceToken: undefined });
    const { req, res } = fakeReqRes('POST', { event_type: 'x', payload: {} });
    await ingress(req as IncomingMessage, res as ServerResponse);
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body!).error).toBe('workspace_ingress_disabled');
  });

  it('token errado: 401; token certo: publica e devolve event_id', async () => {
    const bus = new EventBus(pool, { dispatcherId: 'ws-test' });
    const ingress = createWorkspaceIngress({ pool, bus, log, serviceToken: 'segredo' });

    const bad = fakeReqRes('POST', { event_type: 'task.completed', payload: {} }, 'Bearer errado');
    await ingress(bad.req as IncomingMessage, bad.res as ServerResponse);
    expect(bad.res.statusCode).toBe(401);

    const good = fakeReqRes(
      'POST',
      { event_type: 'task.completed', payload: { task_id: '42' }, idempotency_key: 'ws:task:42' },
      'Bearer segredo',
    );
    await ingress(good.req as IncomingMessage, good.res as ServerResponse);
    expect(good.res.statusCode).toBe(202);
    const body = JSON.parse(good.res.body!);
    expect(body.event_id).toMatch(/^evt_/);
    expect(body.correlation_id).toMatch(/^corr_/);
    expect((await pool.query("SELECT * FROM events WHERE event_type='task.completed'")).rowCount).toBe(1);

    // idempotência no ingress também
    const dup = fakeReqRes(
      'POST',
      { event_type: 'task.completed', payload: { task_id: '42' }, idempotency_key: 'ws:task:42' },
      'Bearer segredo',
    );
    await ingress(dup.req as IncomingMessage, dup.res as ServerResponse);
    expect(JSON.parse(dup.res.body!).duplicate).toBe(true);
  });
});

describe('router estruturado em Postgres real (§10/§8)', () => {
  it('ESCALATE_HUMAN persiste escalations + NEEDS_HUMAN/HUMAN_NOTIFIED na conversa', async () => {
    const identity = await resolveIngressIdentity(pool, {
      client_name: 'Cliente Esc',
      contact_name: 'Pai',
      channel: 'whatsapp',
      address: 'Pai',
    });
    const { event } = await publishEvent(pool, {
      event_type: 'whatsapp.message.received',
      source: 'test',
      client_id: identity.client_id,
      conversation_id: identity.conversation_id,
      payload: { conversation_id: identity.conversation_id, text: 'quero falar com alguém', deliver: false },
      idempotency_key: 'wa:esc:1',
    });
    const bus = new EventBus(pool, { dispatcherId: 'orch-test' });
    const adapter = {
      mode: 'kimi-api' as const,
      async ensureSession(k: string) {
        return { session_id: `kimi-api:${k}`, busy: false };
      },
      async sendTurn() {
        throw new Error('IA NÃO deveria ser chamada em pedido explícito de humano');
      },
      async readMessages() {
        return [];
      },
    };
    const { createMessageHandler } = await import('../../apps/orchestrator/src/agent/handler.js');
    bus.on('whatsapp.message.received', createMessageHandler({ pool, adapter: adapter as never, log }));
    await bus.dispatchOnce();

    const conv = await pool.query<{ state: string }>(
      'SELECT state FROM conversations WHERE id = $1',
      [identity.conversation_id],
    );
    expect(['NEEDS_HUMAN', 'HUMAN_NOTIFIED']).toContain(conv.rows[0]!.state);
    const esc = await pool.query<{ reason: string; priority: string }>('SELECT reason, priority FROM escalations');
    expect(esc.rowCount).toBe(1);
    expect(esc.rows[0]!.reason).toContain('explícito');
  });
});
