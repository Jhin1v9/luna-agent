/**
 * Testes de INTEGRAção da F1.3 — primeiro evento end-to-end contra Postgres real.
 *
 * Ciclo verificado: mensagem de cliente simulada → client.message.received →
 * dispatcher → handler (Context Builder + adapter) → resposta persistida +
 * state machine + activity/audit com correlation_id → RESOLVED.
 *
 * Mesmo banco `luna_test` (criado/derrubado no beforeAll) das integrações F1.2.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import pino from 'pino';
import { migrate } from '../../packages/database/src/migrate.js';
import { createAdapter, type KimiAdapterConfig } from '../../packages/agent/src/index.js';
import { EventBus } from '../../apps/orchestrator/src/events/bus.js';
import { createMessageHandler } from '../../apps/orchestrator/src/agent/handler.js';
import { simulateMessage } from '../../apps/orchestrator/src/test/simulate.js';
import {
  canTransition,
  transitionConversation,
  InvalidTransition,
} from '../../apps/orchestrator/src/agent/attention.js';
import {
  buildClientConversationPack,
  renderConversationPrompt,
} from '../../apps/orchestrator/src/agent/context.js';
import { reapStaleLocks } from '../../packages/database/src/index.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://luna:luna@localhost:5433/luna_test';
const ADMIN_URL = (() => {
  const u = new URL(TEST_URL);
  u.pathname = '/postgres';
  return u.toString();
})();
const TEST_DB_NAME = new URL(TEST_URL).pathname.slice(1);

const TEST_DB: pg.PoolConfig = { connectionString: TEST_URL };
let pool: pg.Pool;
const log = pino({ level: 'silent' });
const adapter = createAdapter({ mode: 'mock' } as KimiAdapterConfig);

async function makeBus(): Promise<EventBus> {
  const bus = new EventBus(pool, { dispatcherId: 'orchestrator-test' });
  bus.on('client.message.received', createMessageHandler({ pool, adapter, log }));
  return bus;
}

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();
  await migrate(TEST_URL);
  pool = new pg.Pool(TEST_DB);
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
    `TRUNCATE organizations, clients, contacts, conversations, messages, events,
     jobs, outbox, dead_letter_events, idempotency_keys, audit_log, activity_log,
     agent_runs RESTART IDENTITY CASCADE`,
  );
});

// ─────────────────────────── state machine (§7.11) ───────────────────────────

describe('state machine de atenção (§7.11 — nasce mínima)', () => {
  it('permite NEW → AI_HANDLING → RESOLVED e reabre', () => {
    expect(canTransition('NEW', 'AI_HANDLING')).toBe(true);
    expect(canTransition('AI_HANDLING', 'RESOLVED')).toBe(true);
    expect(canTransition('RESOLVED', 'AI_HANDLING')).toBe(true);
    expect(canTransition('NEW', 'RESOLVED')).toBe(false);
  });

  it('transição inválida levanta e NÃO persiste', async () => {
    const org = await pool.query<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ('NEXO', 'nexo-t') RETURNING id",
    );
    const client = await pool.query<{ id: string }>(
      'INSERT INTO clients (organization_id, name, code) VALUES ($1, $2, $3) RETURNING id',
      [org.rows[0]!.id, 'Teste', 'teste-t'],
    );
    const conv = await pool.query<{ id: string }>(
      `INSERT INTO conversations (client_id, channel, state)
       VALUES ($1, 'whatsapp', 'NEW') RETURNING id`,
      [client.rows[0]!.id],
    );
    const id = conv.rows[0]!.id;
    await expect(transitionConversation(pool, id, 'NEEDS_HUMAN')).rejects.toThrow(
      InvalidTransition,
    );
    const after = await pool.query('SELECT state FROM conversations WHERE id = $1', [id]);
    expect(after.rows[0]!.state).toBe('NEW');
  });
});

// ─────────────────────────── context builder (§7.9) ───────────────────────────

describe('Context Builder — pack CLIENT_CONVERSATION (§7.9)', () => {
  it('monta só o contexto relevante: cliente, histórico recente, preferências', async () => {
    const bus = await makeBus();
    const r = await simulateMessage(pool, bus, {
      client_name: 'Jess',
      contact_name: 'Jessica',
      text: 'oi, o site já ficou pronto?',
      external_id: 'wamid-ctx-1',
    });
    await bus.dispatchOnce(); // responde, conversa vira RESOLVED

    const pack = await buildClientConversationPack(pool, r.conversation_id);
    expect(pack.client_name).toBe('Jess');
    expect(pack.contact_name).toBe('Jessica');
    expect(pack.recent_messages.length).toBe(2); // inbound + resposta da Luna
    expect(pack.recent_messages[0]!.direction).toBe('inbound');

    const prompt = renderConversationPrompt(pack, 'e o prazo?');
    expect(prompt).toContain('Luna');
    expect(prompt).toContain('Jess');
    expect(prompt).toContain('e o prazo?');
    expect(prompt).toContain('Jessica: oi, o site já ficou pronto?'); // transcrição nomeada pelo autor
  });
});

// ─────────────────────────── E2E: primeiro evento ───────────────────────────

describe('primeiro evento end-to-end (mensagem simulada → Luna responde)', () => {
  it('ciclo completo: persistência, persona, estado, activity, audit, correlation', async () => {
    const bus = await makeBus();
    const r = await simulateMessage(pool, bus, {
      client_name: 'Jess',
      contact_name: 'Jessica',
      text: 'oi, já terminou o site?',
      external_id: 'wamid-e2e-1',
    });
    expect(r.duplicate).toBe(false);
    expect(r.correlation_id).toMatch(/^corr_/);

    await bus.dispatchOnce();

    // Resposta outbound persistida, ligada ao evento
    const msgs = await pool.query<{ direction: string; sender: string; body: string }>(
      'SELECT direction, sender, body FROM messages WHERE conversation_id = $1 ORDER BY created_at',
      [r.conversation_id],
    );
    expect(msgs.rowCount).toBe(2);
    const reply = msgs.rows[1]!;
    expect(reply.direction).toBe('outbound');
    expect(reply.sender).toBe('luna');
    expect(reply.body).toContain('[mock-luna]');

    // Estado da conversa persistido: RESOLVED
    const conv = await pool.query<{ state: string }>(
      'SELECT state FROM conversations WHERE id = $1',
      [r.conversation_id],
    );
    expect(conv.rows[0]!.state).toBe('RESOLVED');

    // agent_runs com input/output
    const run = await pool.query<{ status: string; brain: string; output: { reply_text: string } }>(
      'SELECT status, brain, output FROM agent_runs',
    );
    expect(run.rowCount).toBe(1);
    expect(run.rows[0]!.status).toBe('completed');
    expect(run.rows[0]!.brain).toBe('mock');
    expect(run.rows[0]!.output.reply_text).toContain('[mock-luna]');

    // Activity (humano) com correlation_id
    const act = await pool.query<{ summary: string; correlation_id: string; kind: string }>(
      'SELECT summary, correlation_id, kind FROM activity_log',
    );
    expect(act.rowCount).toBe(1);
    expect(act.rows[0]!.kind).toBe('action');
    expect(act.rows[0]!.summary).toContain('Jess');
    expect(act.rows[0]!.correlation_id).toBe(r.correlation_id);

    // Audit (máquina) com correlation_id — nunca vazio no fluxo novo
    const audit = await pool.query<{ action: string; correlation_id: string; result: string }>(
      "SELECT action, correlation_id, result FROM audit_log WHERE action = 'agent.run.completed'",
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0]!.result).toBe('success');
    expect(audit.rows[0]!.correlation_id).toBe(r.correlation_id);
  });

  it('mensagem duplicada (mesmo external_id) não gera segunda resposta (§7.6)', async () => {
    const bus = await makeBus();
    const first = await simulateMessage(pool, bus, {
      client_name: 'Jess',
      text: 'oi',
      external_id: 'wamid-dup-1',
    });
    await bus.dispatchOnce();

    const dup = await simulateMessage(pool, bus, {
      client_name: 'Jess',
      text: 'oi',
      external_id: 'wamid-dup-1',
    });
    expect(dup.duplicate).toBe(true);
    expect(dup.message_id).toBeNull();
    await bus.dispatchOnce();

    const msgs = await pool.query(
      'SELECT * FROM messages WHERE conversation_id = $1',
      [first.conversation_id],
    );
    expect(msgs.rowCount).toBe(2); // 1 inbound + 1 resposta — nunca 3
  });

  it('segunda mensagem na mesma conversa reabre e responde de novo', async () => {
    const bus = await makeBus();
    const r1 = await simulateMessage(pool, bus, {
      client_name: 'Matheus',
      text: 'bom dia!',
      external_id: 'wamid-m-1',
    });
    await bus.dispatchOnce();

    const r2 = await simulateMessage(pool, bus, {
      client_name: 'Matheus',
      text: 'e aí, me tira uma dúvida?',
      external_id: 'wamid-m-2',
    });
    expect(r2.conversation_id).toBe(r1.conversation_id);
    await bus.dispatchOnce();

    const conv = await pool.query<{ state: string }>(
      'SELECT state FROM conversations WHERE id = $1',
      [r1.conversation_id],
    );
    expect(conv.rows[0]!.state).toBe('RESOLVED');
    const msgs = await pool.query(
      'SELECT * FROM messages WHERE conversation_id = $1',
      [r1.conversation_id],
    );
    expect(msgs.rowCount).toBe(4); // 2 inbound + 2 respostas
  });
});

// ─────────────────────────── reaper de locks ───────────────────────────

describe('reaper de locks travados (F1.3)', () => {
  it('devolve outbox e jobs presos em running para a fila', async () => {
    const stale = new Date(Date.now() - 3600_000);
    await pool.query(
      `INSERT INTO events (event_id, event_type, version, correlation_id, priority, payload, occurred_at)
       VALUES ('evt_stale', 'test.stale', 1, 'corr_stale', 0, '{}', now())`,
    );
    await pool.query(
      `INSERT INTO outbox (event_id, event_type, payload, status, locked_at, occurred_at)
       VALUES ('evt_stale', 'test.stale', '{}', 'running', $1, now())`,
      [stale],
    );
    await pool.query(
      `INSERT INTO jobs (job_type, status, locked_at, attempts)
       VALUES ('ping', 'running', $1, 1)`,
      [stale],
    );

    const r = await reapStaleLocks(pool, 300_000);
    expect(r.outbox_requeued).toBe(1);
    expect(r.jobs_requeued).toBe(1);

    const ob = await pool.query('SELECT status, locked_at FROM outbox');
    expect(ob.rows[0]!.status).toBe('pending');
    expect(ob.rows[0]!.locked_at).toBeNull();
    const job = await pool.query('SELECT status FROM jobs');
    expect(job.rows[0]!.status).toBe('pending');
  });

  it('não toca em locks recentes', async () => {
    await pool.query(
      `INSERT INTO jobs (job_type, status, locked_at) VALUES ('ping', 'running', now())`,
    );
    const r = await reapStaleLocks(pool, 300_000);
    expect(r.jobs_requeued).toBe(0);
  });
});

// ─────────────────────────── autor por mensagem (decreto owner) ───────────────────────────

describe('autor por mensagem — persistência + transcrição nomeada (decreto owner)', () => {
  it('messages.author_name gravado no inbound e na resposta; Context Builder nomeia quem falou', async () => {
    const bus = await makeBus();
    const r = await simulateMessage(pool, bus, {
      client_name: 'Grupo Teste',
      contact_name: 'Nonoke', // autor extraído do [data-testid="author"] no grupo
      text: '@luna alguém pegou o relatório?',
      external_id: 'wamid-author-1',
    });
    await bus.dispatchOnce();

    // inbound persistido com autor
    const inbound = await pool.query<{ author_name: string | null }>(
      "SELECT author_name FROM messages WHERE direction='inbound' AND conversation_id=$1",
      [r.conversation_id],
    );
    expect(inbound.rows[0]!.author_name).toBe('Nonoke');

    // resposta da Luna persistida como autora
    const outbound = await pool.query<{ author_name: string | null }>(
      "SELECT author_name FROM messages WHERE direction='outbound' AND conversation_id=$1",
      [r.conversation_id],
    );
    expect(outbound.rows[0]!.author_name).toBe('Luna');

    // pack nomeia quem falou o quê
    const pack = await buildClientConversationPack(pool, r.conversation_id);
    const nonoke = pack.recent_messages.find((m) => m.direction === 'inbound');
    expect(nonoke!.author_name).toBe('Nonoke');
    const prompt = renderConversationPrompt(pack, 'e o relatório?');
    expect(prompt).toContain('Nonoke: @luna alguém pegou o relatório?');
    expect(prompt).toContain('Luna: ');
    // persona instrui tratar pela pessoa pelo nome
    expect(prompt).toContain('pelo NOME');
  });

  it('activity cita o autor real (não só o nome do chat)', async () => {
    const bus = await makeBus();
    await simulateMessage(pool, bus, {
      client_name: 'Grupo Teste 2',
      contact_name: 'Abner',
      text: '@luna teste de autor',
      external_id: 'wamid-author-2',
    });
    await bus.dispatchOnce();
    const act = await pool.query<{ summary: string }>(
      "SELECT summary FROM activity_log WHERE summary LIKE '%Abner%' ORDER BY id DESC LIMIT 1",
    );
    expect(act.rowCount).toBe(1);
    expect(act.rows[0]!.summary).toContain('Respondi Abner');
  });
});
