/**
 * Integração F5 — Escalação avançada (contrato §18 + ADR-025/026).
 * Postgres real (luna_test). Telegram sem credencial = falha explícita em log
 * (o tick não depende de Telegram pra gravar estado/audit).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import pino from 'pino';
import { migrate } from '../../packages/database/src/migrate.js';
import {
  publishEvent,
  resolveIngressIdentity,
  insertInboundMessage,
} from '../../packages/database/src/index.js';
import { EventBus } from '../../apps/orchestrator/src/events/bus.js';
import { createMessageHandler } from '../../apps/orchestrator/src/agent/handler.js';
import { runEscalationTick } from '../../apps/worker/src/jobs/escalation-tick.js';
import { transitionConversation } from '../../apps/orchestrator/src/agent/attention.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgres://luna:luna@localhost:5433/luna_test';
const ADMIN_URL = (() => {
  const u = new URL(TEST_URL);
  u.pathname = '/postgres';
  return u.toString();
})();
const TEST_DB_NAME = new URL(TEST_URL).pathname.slice(1);

let pool: pg.Pool;
const log = pino({ level: 'silent' });

const adapter = {
  mode: 'kimi-api' as const,
  async ensureSession(k: string) {
    return { session_id: `kimi-api:${k}`, busy: false };
  },
  async sendTurn() {
    return {
      reply_text: JSON.stringify({ type: 'ANSWER', text: 'Entendido, anotei aqui.' }),
      session_id: 'k',
      duration_ms: 1,
      model: 'kimi-k2.6',
    };
  },
  async readMessages() {
    return [];
  },
};

async function makeBus(): Promise<EventBus> {
  const bus = new EventBus(pool, { dispatcherId: 'orch-f5' });
  bus.on('whatsapp.message.received', createMessageHandler({ pool, adapter: adapter as never, log }));
  return bus;
}

async function fireWhatsapp(
  bus: EventBus,
  identity: { conversation_id: string; client_id: string },
  text: string,
  externalId: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const messageId = await insertInboundMessage(pool, {
    conversation_id: identity.conversation_id,
    channel: 'whatsapp',
    text,
    external_id: externalId,
  });
  await publishEvent(pool, {
    event_type: 'whatsapp.message.received',
    source: 'f5-test',
    client_id: identity.client_id,
    conversation_id: identity.conversation_id,
    payload: {
      conversation_id: identity.conversation_id,
      message_id: messageId,
      text,
      deliver: false,
      ...extra,
    },
    idempotency_key: `wa:f5:${externalId}`,
  });
  await bus.dispatchOnce();
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
    `TRUNCATE organizations, clients, contacts, conversations, messages, events, jobs,
     outbox, dead_letter_events, idempotency_keys, audit_log, activity_log, agent_runs,
     escalations RESTART IDENTITY CASCADE`,
  );
});

describe('F5 — SLA timers e follow-up (§18)', () => {
  it('CRÍTICA sem atendimento há 10min → follow-up de degrau (uma vez)', async () => {
    const identity = await resolveIngressIdentity(pool, { client_name: 'Esc SLA', channel: 'whatsapp', address: 'Pai' });
    await pool.query(
      `INSERT INTO escalations (client_id, conversation_id, reason, priority, status, notified_at)
       VALUES ($1, $2, 'site fora do ar', 'CRITICA', 'notified', now() - interval '10 minutes')`,
      [identity.client_id, identity.conversation_id],
    );
    const r = await runEscalationTick({ pool, log });
    expect(r.followUps).toBe(1);
    const esc = await pool.query('SELECT followed_up FROM escalations');
    expect(esc.rows[0]!.followed_up).toBe(true);
    expect((await pool.query("SELECT * FROM audit_log WHERE action='escalation.followup_sent'")).rowCount).toBe(1);
    // não repete no próximo tick
    const r2 = await runEscalationTick({ pool, log });
    expect(r2.followUps).toBe(0);
  });

  it('ALTA dentro do SLA (5min, limite 10min) → nada ainda', async () => {
    const identity = await resolveIngressIdentity(pool, { client_name: 'Esc SLA2', channel: 'whatsapp', address: 'Pai' });
    await pool.query(
      `INSERT INTO escalations (client_id, conversation_id, reason, priority, status, notified_at)
       VALUES ($1, $2, 'reclamação', 'ALTA', 'notified', now() - interval '5 minutes')`,
      [identity.client_id, identity.conversation_id],
    );
    const r = await runEscalationTick({ pool, log });
    expect(r.followUps).toBe(0);
  });

  it('humano atendeu e SUMIU (20min, cliente ativo) → cascata retoma', async () => {
    const identity = await resolveIngressIdentity(pool, { client_name: 'Esc Gone', channel: 'whatsapp', address: 'Pai' });
    await pool.query(
      `INSERT INTO escalations (client_id, conversation_id, reason, priority, status, notified_at, followed_up, handled_by, last_handled_at)
       VALUES ($1, $2, 'caso difícil', 'ALTA', 'handling', now() - interval '30 minutes', true, 'Jhin', now() - interval '20 minutes')`,
      [identity.client_id, identity.conversation_id],
    );
    // cliente falou DEPOIS que o humano sumiu
    await insertInboundMessage(pool, {
      conversation_id: identity.conversation_id, channel: 'whatsapp', text: 'alguém aí?', external_id: 'wamid-f5-gone',
    });
    const r = await runEscalationTick({ pool, log });
    expect(r.cascadesResumed).toBe(1);
    const esc = await pool.query('SELECT status FROM escalations');
    expect(esc.rows[0]!.status).toBe('followed_up');
    expect((await pool.query("SELECT * FROM audit_log WHERE action='escalation.cascade.resumed'")).rowCount).toBe(1);
  });
});

describe('F5 — coordenação consciente (ADR-025) e silêncio da Luna (ADR-026)', () => {
  it('humano responde no grupo → HUMAN_HANDLING + handled_by + human.responded', async () => {
    const identity = await resolveIngressIdentity(pool, { client_name: 'Cliente Esc', contact_name: 'Jess', channel: 'whatsapp', address: 'grupo-x' });
    const bus = await makeBus();
    // pergunta que escala
    await fireWhatsapp(bus, identity, 'quero falar com alguém', 'wamid-f5-e1');
    let conv = await pool.query<{ state: string }>('SELECT state FROM conversations WHERE id=$1', [identity.conversation_id]);
    expect(['NEEDS_HUMAN', 'HUMAN_NOTIFIED']).toContain(conv.rows[0]!.state);

    // HUMANO (autor != contato do cliente) fala no grupo
    await fireWhatsapp(bus, identity, 'sou eu Jhin, deixa comigo', 'wamid-f5-e2', { author_name: 'Jhin', is_group: true });
    conv = await pool.query('SELECT state FROM conversations WHERE id=$1', [identity.conversation_id]);
    expect(conv.rows[0]!.state).toBe('HUMAN_HANDLING');
    const esc = await pool.query<{ handled_by: string; status: string }>('SELECT handled_by, status FROM escalations');
    expect(esc.rows[0]!.handled_by).toBe('Jhin');
    expect(esc.rows[0]!.status).toBe('handling');
    expect((await pool.query("SELECT * FROM audit_log WHERE action='escalation.human.responded'")).rowCount).toBe(1);
    // e a Luna NÃO respondeu o humano (sem outbound nova)
    const out = await pool.query("SELECT * FROM messages WHERE direction='outbound'");
    expect(out.rowCount).toBe(1); // só a resposta de escalção original
  });

  it('humano EXTRA entra → coordination.status, JAMÁS re-escalação', async () => {
    const identity = await resolveIngressIdentity(pool, { client_name: 'Cliente Esc2', contact_name: 'Jess', channel: 'whatsapp', address: 'grupo-y' });
    const bus = await makeBus();
    await fireWhatsapp(bus, identity, 'quero falar com alguém', 'wamid-f5-e3');
    await fireWhatsapp(bus, identity, 'aqui é Jhin', 'wamid-f5-e4', { author_name: 'Jhin', is_group: true });
    const escBefore = await pool.query('SELECT id FROM escalations');
    // Enoque entra depois
    await fireWhatsapp(bus, identity, 'precisa de ajuda? sou Enoque', 'wamid-f5-e5', { author_name: 'Enoque', is_group: true });
    const escAfter = await pool.query('SELECT count(*)::int AS n FROM escalations');
    expect(escAfter.rows[0]!.n).toBe(escBefore.rowCount); // sem nova escalção
    expect((await pool.query("SELECT * FROM audit_log WHERE action='escalation.coordination.status'")).rowCount).toBe(1);
    const esc = await pool.query<{ handled_by: string }>('SELECT handled_by FROM escalations');
    expect(esc.rows[0]!.handled_by).toBe('Jhin'); // segue com quem atende
  });

  it('cliente fala durante HUMAN_HANDLING → anexado, ZERO resposta automática', async () => {
    const identity = await resolveIngressIdentity(pool, { client_name: 'Cliente Esc3', contact_name: 'Jess', channel: 'whatsapp', address: 'grupo-z' });
    const bus = await makeBus();
    await fireWhatsapp(bus, identity, 'quero falar com alguém', 'wamid-f5-e6');
    await fireWhatsapp(bus, identity, 'aqui é Jhin', 'wamid-f5-e7', { author_name: 'Jhin', is_group: true });
    const outBefore = await pool.query("SELECT count(*)::int AS n FROM messages WHERE direction='outbound'");
    await fireWhatsapp(bus, identity, 'oi, alguém viu minha msg?', 'wamid-f5-e8', { author_name: 'Jess', is_group: true });
    const outAfter = await pool.query("SELECT count(*)::int AS n FROM messages WHERE direction='outbound'");
    expect(outAfter.rows[0]!.n).toBe(outBefore.rows[0]!.n); // Luna silenciada
    expect((await pool.query("SELECT * FROM audit_log WHERE action='escalation.client_message_appended'")).rowCount).toBeGreaterThan(0);
  });

  it('transição inválida protege: HUMAN_HANDLING não vai pra RESOLVED sem humano', async () => {
    const identity = await resolveIngressIdentity(pool, { client_name: 'Cliente Esc4', channel: 'whatsapp', address: 'Pai' });
    await transitionConversation(pool, identity.conversation_id, 'AI_HANDLING');
    await transitionConversation(pool, identity.conversation_id, 'NEEDS_HUMAN');
    await transitionConversation(pool, identity.conversation_id, 'HUMAN_NOTIFIED');
    await transitionConversation(pool, identity.conversation_id, 'HUMAN_HANDLING');
    const conv = await pool.query('SELECT state FROM conversations WHERE id=$1', [identity.conversation_id]);
    expect(conv.rows[0]!.state).toBe('HUMAN_HANDLING');
  });
});
