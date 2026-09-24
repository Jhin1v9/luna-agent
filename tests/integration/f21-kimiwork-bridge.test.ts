/**
 * Testes de INTEGRAção — ponte Kimi Work anti double-send (fix 2026-09-24,
 * ordem Jhino). Postgres real (banco luna_test).
 *
 * Bug ao vivo: a mesma mensagem de WhatsApp gerava AMBOS um evento na
 * kimiwork_inbox (via canônica, respondida pela varredura dedicada) E um
 * turno no model router (handler → adapter.sendTurn) — o cliente recebia a
 * mesma resposta DUAS vezes ("Por nada, Enoque!" duplicada no painel).
 *
 * Fix (handler.ts): para whatsapp.message.received cuja correlation_id já
 * tem evento 'whatsapp.message' na kimiwork_inbox, o model router NÃO
 * responde. EXCEÇÃO §8.1: pedido explícito de humano segue escalando.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import pino from 'pino';
import { migrate } from '../../packages/database/src/migrate.js';
import { publishEvent, resolveIngressIdentity, insertInboundMessage } from '../../packages/database/src/index.js';
import { EventBus } from '../../apps/orchestrator/src/events/bus.js';
import { createMessageHandler } from '../../apps/orchestrator/src/agent/handler.js';
import type { KimiLiveAdapter } from '../../packages/agent/src/types.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://luna:luna@localhost:5433/luna_test';
const ADMIN_URL = (() => {
  const u = new URL(TEST_URL);
  u.pathname = '/postgres';
  return u.toString();
})();
const TEST_DB_NAME = new URL(TEST_URL).pathname.slice(1);

let pool: pg.Pool;
const log = pino({ level: 'silent' });

/** Adapter espião: falha o teste se sendTurn for chamado (turno = duplicata). */
function spyAdapter(calls: { sendTurn: number }): KimiLiveAdapter {
  return {
    mode: 'kimiwork' as const,
    async ensureSession(sessionKey: string) {
      return { session_id: sessionKey, busy: false };
    },
    async sendTurn() {
      calls.sendTurn += 1;
      return {
        reply_text: '{"type":"ANSWER","text":"resposta do router"}',
        session_id: 'spy',
        duration_ms: 1,
        model: 'spy',
        provider: 'spy',
      };
    },
    async readMessages() {
      return [];
    },
    async close() {},
  };
}

async function setupConversation(): Promise<{ conversationId: string; clientId: string }> {
  const identity = await resolveIngressIdentity(pool, {
    client_name: 'HDM - Industrial (SBD) - 26',
    contact_name: 'HDM - Industrial (SBD) - 26',
    channel: 'whatsapp',
    address: '120363428577835024@g.us',
  });
  return { conversationId: identity.conversation_id, clientId: identity.client_id };
}

/** Publica whatsapp.message.received + evento de ponte kimiwork (como o ingest faz). */
async function publishBridgedMessage(opts: {
  conversationId: string;
  clientId: string;
  text: string;
  withBridge: boolean;
}): Promise<{ eventId: string; correlationId: string }> {
  const messageId = await insertInboundMessage(pool, {
    conversation_id: opts.conversationId,
    channel: 'whatsapp',
    text: opts.text,
    external_id: `wamid-f21-${Math.random().toString(36).slice(2, 10)}`,
    author_name: 'Matheus',
  });
  const { event } = await publishEvent(pool, {
    event_type: 'whatsapp.message.received',
    source: 'whatsplay',
    client_id: opts.clientId,
    conversation_id: opts.conversationId,
    payload: {
      conversation_id: opts.conversationId,
      message_id: messageId,
      text: opts.text,
      author_name: 'Matheus',
      is_group: true,
      deliver: false,
      chat_id: '120363428577835024@g.us',
    },
  });
  if (opts.withBridge) {
    await pool.query(
      `INSERT INTO kimiwork_inbox (kind, payload, idempotency_key)
       VALUES ('whatsapp.message', $1::jsonb, $2)`,
      [
        JSON.stringify({
          conversation_id: opts.conversationId,
          message_id: messageId,
          chat_id: '120363428577835024@g.us',
          text: opts.text,
          author_name: 'Matheus',
          correlation_id: event.correlation_id,
        }),
        `kimiwork:f21:${event.event_id}`,
      ],
    );
  }
  return { eventId: event.event_id, correlationId: event.correlation_id };
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
    `TRUNCATE organizations, clients, contacts, conversations, messages, events,
     jobs, outbox, dead_letter_events, idempotency_keys, audit_log, activity_log,
     agent_runs, usage_entries, escalations, kimiwork_inbox, kimiwork_llm_turns
     RESTART IDENTITY CASCADE`,
  );
});

describe('ponte Kimi Work — anti double-send', () => {
  it('mensagem com ponte na inbox: model router NÃO responde e NÃO cria turno', async () => {
    const calls = { sendTurn: 0 };
    const { conversationId, clientId } = await setupConversation();
    await publishBridgedMessage({
      conversationId,
      clientId,
      text: 'oi, o site já ficou pronto?',
      withBridge: true,
    });

    const bus = new EventBus(pool, { dispatcherId: 'orch-f21' });
    bus.on('whatsapp.message.received', createMessageHandler({ pool, adapter: spyAdapter(calls), log }));
    await bus.dispatchOnce();

    expect(calls.sendTurn).toBe(0); // zero IA = zero duplicata
    const outbound = await pool.query(
      "SELECT id FROM messages WHERE direction = 'outbound'",
    );
    expect(outbound.rowCount).toBe(0); // resposta sai só pela varredura dedicada
    const audit = await pool.query(
      "SELECT id FROM audit_log WHERE action = 'agent.reply.bridge_kimiwork_skipped'",
    );
    expect(audit.rowCount).toBe(1);
    // Evento de ponte continua pending — é a varredura que consome
    const inbox = await pool.query("SELECT status FROM kimiwork_inbox");
    expect(inbox.rows[0]!.status).toBe('pending');
  });

  it('pedido explícito de humano (§8.1) NUNCA é skipado pela ponte — escalona', async () => {
    const calls = { sendTurn: 0 };
    const { conversationId, clientId } = await setupConversation();
    await publishBridgedMessage({
      conversationId,
      clientId,
      text: 'quero falar com um atendente humano',
      withBridge: true,
    });

    const bus = new EventBus(pool, { dispatcherId: 'orch-f21' });
    bus.on('whatsapp.message.received', createMessageHandler({ pool, adapter: spyAdapter(calls), log }));
    await bus.dispatchOnce();

    expect(calls.sendTurn).toBe(0); // §8.1: zero tentativas de IA
    const esc = await pool.query(
      "SELECT id, reason FROM escalations WHERE conversation_id = $1",
      [conversationId],
    );
    expect(esc.rowCount).toBe(1);
    expect(esc.rows[0]!.reason).toContain('humano');
    const skipped = await pool.query(
      "SELECT id FROM audit_log WHERE action = 'agent.reply.bridge_kimiwork_skipped'",
    );
    expect(skipped.rowCount).toBe(0); // não foi skip de ponte, foi escalación
  });

  it('mensagem SEM ponte (fluxo legado): model router responde normalmente', async () => {
    const calls = { sendTurn: 0 };
    const { conversationId, clientId } = await setupConversation();
    await publishBridgedMessage({
      conversationId,
      clientId,
      text: 'oi, o site já ficou pronto?',
      withBridge: false,
    });

    const bus = new EventBus(pool, { dispatcherId: 'orch-f21' });
    bus.on('whatsapp.message.received', createMessageHandler({ pool, adapter: spyAdapter(calls), log }));
    await bus.dispatchOnce();

    expect(calls.sendTurn).toBe(1);
    const outbound = await pool.query(
      "SELECT body, send_state FROM messages WHERE direction = 'outbound'",
    );
    expect(outbound.rowCount).toBe(1);
    expect(outbound.rows[0]!.send_state).toBe('simulated'); // deliver=false no teste
  });
});
