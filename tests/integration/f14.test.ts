/**
 * Testes de INTEGRAção da F1.4 — pipeline WhatsApp end-to-end (com transport
 * fake) + anti-mock no fluxo de produção. Postgres real (banco luna_test).
 *
 * Cobre: ingest → whatsapp.message.received → handler → resposta queued →
 * outbound listener (transport fake) → sent + evidência. E a regra de ouro do
 * decreto: com adapter de produção sem key, o fluxo FALHA EXPLICITAMENTE
 * (nunca cai pro mock em silêncio).
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
import { createAdapter, KimiApiMissingKey } from '../../packages/agent/src/index.js';
import { EventBus } from '../../apps/orchestrator/src/events/bus.js';
import { createMessageHandler } from '../../apps/orchestrator/src/agent/handler.js';
import { createIngest } from '../../apps/whatsplay/src/ingest.js';
import type { UnreadMessage, WhatsAppTransport } from '../../apps/whatsplay/src/transport.js';

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
const mockAdapter = createAdapter({ mode: 'mock' });

/** Transport fake: entrega mensagens sem rede (test double do WhatsAppTransport). */
function fakeTransport(sent: Array<{ target: string; text: string }>): WhatsAppTransport {
  return {
    async getStatus() {
      return {
        state: 'LOGGED_IN',
        pageAlive: true,
        lastHeartbeatAt: new Date().toISOString(),
        outgoingQueued: sent.length,
      };
    },
    async getUnread() {
      return [];
    },
    async readConversation() {
      return [];
    },
    async sendMessage(target: string, text: string) {
      sent.push({ target, text });
      return `fake:${sent.length}`;
    },
  };
}

async function makeBus(adapter = mockAdapter): Promise<EventBus> {
  const bus = new EventBus(pool, { dispatcherId: 'orchestrator-test' });
  bus.on('whatsapp.message.received', createMessageHandler({ pool, adapter, log }));
  return bus;
}

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();
  await migrate(TEST_URL); // 001 + 002 + 003
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
     agent_runs, usage_entries RESTART IDENTITY CASCADE`,
  );
});

// ─────────────────────────── pipeline WhatsApp (transport fake) ───────────────────────────

describe('pipeline WhatsApp end-to-end (ingest → brain → entrega)', () => {
  it('msg real → evento → resposta → transport → sent, com evidência completa', async () => {
    const sent: Array<{ target: string; text: string }> = [];
    const transport = fakeTransport(sent);
    const ingest = createIngest({ pool, transport, log });
    const bus = await makeBus();

    // 1. Mensagem chega no transporte (captura por mutação, já normalizada)
    const msg: UnreadMessage = {
      chat_id: '5511999990000@s.whatsapp.net',
      chat_name: 'Jess',
      is_group: false,
      text: 'oi Luna, o site já ficou pronto?',
      external_id: 'wamid-f14-1',
      mentioned_luna: false,
      reply_to_luna: false,
      received_at: new Date().toISOString(),
    };
    expect(await ingest.ingestOne(msg)).toBe('published');
    expect(await ingest.ingestOne(msg)).toBe('skipped'); // idempotência §7.6

    // Fix anti double-send 2026-09-24: com a ponte Kimi Work na inbox, o model
    // router faz SKIP (a resposta canônica é da varredura dedicada — testada em
    // f21). Este teste exercita o caminho do ROUTER, então removemos a ponte
    // (equivale a um cenário legado sem varredura ativa).
    await pool.query(`DELETE FROM kimiwork_inbox WHERE kind = 'whatsapp.message'`);

    // 2. Orchestrator despacha: brain gera, resposta fica queued
    await bus.dispatchOnce();
    const queued = await pool.query<{ body: string; send_state: string }>(
      "SELECT body, send_state FROM messages WHERE direction = 'outbound'",
    );
    expect(queued.rowCount).toBe(1);
    expect(queued.rows[0]!.send_state).toBe('queued');
    expect(queued.rows[0]!.body).toContain('[mock-luna]'); // adapter de teste

    // 3. WhatsPlay entrega (aqui chamado direto — ao vivo é LISTEN/NOTIFY)
    const row = await pool.query<{ id: string }>(
      "SELECT id FROM messages WHERE send_state = 'queued'",
    );
    const { createOutboundListener } = await import('../../apps/whatsplay/src/outbound.js');
    const outbound = createOutboundListener({ pool, transport, log });
    await outbound.deliverOne(row.rows[0]!.id);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.target).toBe('5511999990000@s.whatsapp.net');
    expect(sent[0]!.text).toContain('[mock-luna]');

    const after = await pool.query<{ send_state: string; sent_at: string | null }>(
      "SELECT send_state, sent_at FROM messages WHERE direction = 'outbound'",
    );
    expect(after.rows[0]!.send_state).toBe('sent');
    expect(after.rows[0]!.sent_at).not.toBeNull();

    // 4. Evidência: audit com correlation em todas as pontas
    const audits = await pool.query<{ action: string; correlation_id: string | null }>(
      `SELECT action, correlation_id FROM audit_log
       WHERE action IN ('whatsapp.message.ingested', 'agent.run.completed', 'whatsapp.message.sent')`,
    );
    expect(audits.rowCount).toBe(3);
    const corrs = new Set(audits.rows.map((r) => r.correlation_id));
    expect(corrs.size).toBe(1); // TODA a cadeia no mesmo correlation_id (§7.4)
    expect([...corrs][0]).toMatch(/^corr_/);
  });

  it('grupo sem menção não vira evento (silêncio absoluto, §5)', async () => {
    const i = createIngest({ pool, transport: fakeTransport([]), log });
    const result = await i.ingestOne({
      chat_id: 'g-1',
      chat_name: 'Time Nexo',
      is_group: true,
      text: 'alguém viu o deploy?',
      external_id: 'wamid-grp-1',
      mentioned_luna: false,
      reply_to_luna: false,
      received_at: new Date().toISOString(),
    });
    expect(result).toBe('skipped');
    expect((await pool.query('SELECT * FROM events')).rowCount).toBe(0);
  });

  it('uso de tokens vira usage_entries (§23)', async () => {
    // adapter fake estilo kimi-api (resposta com usage)
    const apiLike = {
      mode: 'kimi-api' as const,
      async ensureSession(k: string) {
        return { session_id: `kimiapi:${k}`, busy: false };
      },
      async sendTurn() {
        return {
          reply_text: 'resposta do brain real',
          session_id: 'kimiapi:x',
          duration_ms: 10,
          usage: { input_tokens: 150, output_tokens: 25 },
        };
      },
      async readMessages() {
        return [];
      },
    };
    const bus = await makeBus(apiLike as never);
    const identity = await resolveIngressIdentity(pool, {
      client_name: 'Jess',
      contact_name: 'Jess',
      channel: 'whatsapp',
      address: '5511',
    });
    const messageId = (await insertInboundMessage(pool, {
      conversation_id: identity.conversation_id,
      channel: 'whatsapp',
      text: 'oi',
      external_id: 'wamid-usage-1',
    }))!;
    await publishEvent(pool, {
      event_type: 'whatsapp.message.received',
      source: 'whatsplay',
      client_id: identity.client_id,
      conversation_id: identity.conversation_id,
      payload: { conversation_id: identity.conversation_id, message_id: messageId, text: 'oi', deliver: true },
      idempotency_key: 'wa:msg:wamid-usage-1',
    });
    await bus.dispatchOnce();

    const usage = await pool.query<{ input_tokens: number; output_tokens: number; provider: string }>(
      'SELECT input_tokens, output_tokens, provider FROM usage_entries',
    );
    expect(usage.rowCount).toBe(1);
    expect(usage.rows[0]!).toMatchObject({ input_tokens: 150, output_tokens: 25, provider: 'kimi-api' });
  });
});

// ─────────────────────────── decreto anti-mock (ADR-016) ───────────────────────────

describe('resposta de cliente NUNCA vem do mock em produção (ADR-016)', () => {
  it('adapter kimi-api sem key: factory falha na cara — sem fallback silencioso', () => {
    delete process.env.KIMI_API_KEY;
    expect(() => createAdapter({ mode: 'kimi-api' })).toThrow(KimiApiMissingKey);
  });

  it('handler com adapter que falha: erro sobe (retry → DLQ), mensagem NÃO fica queued', async () => {
    const failing = {
      mode: 'kimi-api' as const,
      async ensureSession(k: string) {
        return { session_id: `kimiapi:${k}`, busy: false };
      },
      async sendTurn(): Promise<never> {
        throw new KimiApiMissingKey();
      },
      async readMessages() {
        return [];
      },
    };
    const bus = await makeBus(failing as never);
    const identity = await resolveIngressIdentity(pool, {
      client_name: 'Jess',
      channel: 'whatsapp',
      address: '5511',
    });
    const messageId = (await insertInboundMessage(pool, {
      conversation_id: identity.conversation_id,
      channel: 'whatsapp',
      text: 'oi',
      external_id: 'wamid-fail-1',
    }))!;
    await publishEvent(pool, {
      event_type: 'whatsapp.message.received',
      source: 'whatsplay',
      client_id: identity.client_id,
      conversation_id: identity.conversation_id,
      payload: { conversation_id: identity.conversation_id, message_id: messageId, text: 'oi', deliver: true },
      idempotency_key: 'wa:msg:wamid-fail-1',
    });

    // dispatchOnce absorve a falha do handler: retry com backoff + audit failed
    await bus.dispatchOnce();

    const outbox = await pool.query<{ status: string }>('SELECT status FROM outbox');
    expect(outbox.rows[0]!.status).toBe('pending'); // vai retentar, depois DLQ

    const queued = await pool.query(
      "SELECT * FROM messages WHERE direction = 'outbound' AND send_state = 'queued'",
    );
    expect(queued.rowCount).toBe(0); // nenhuma resposta parcial/falsa

    const audit = await pool.query<{ result: string }>(
      "SELECT result FROM audit_log WHERE action = 'event.dispatched'",
    );
    expect(audit.rows[0]!.result).toBe('failed');
  });
});

// ─────────────────────────── GUARDRAIL outbound allowlist (ADR-020) ───────────────────────────

describe('GUARDRAIL outbound allowlist em Postgres real (decreto do owner)', () => {
  async function setupConversation(address: string): Promise<{ conversationId: string; messageId: string }> {
    const identity = await resolveIngressIdentity(pool, {
      client_name: `Teste ${address}`,
      contact_name: address,
      channel: 'whatsapp',
      address,
    });
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO messages (conversation_id, direction, channel, sender, body, send_state, metadata)
       VALUES ($1, 'outbound', 'whatsapp', 'luna', 'resposta de teste', 'queued', $2) RETURNING id`,
      [identity.conversation_id, JSON.stringify({ correlation_id: 'corr_guardrail' })],
    );
    return { conversationId: identity.conversation_id, messageId: inserted.rows[0]!.id };
  }

  it('destino fora da allowlist → recusado: failed + audit send_refused, zero envio', async () => {
    const { messageId } = await setupConversation('Contato Proibido');
    const sent: string[] = [];
    const { createOutboundListener } = await import('../../apps/whatsplay/src/outbound.js');
    const listener = createOutboundListener({
      pool,
      transport: fakeTransport(sent),
      log,
      humanDelayMs: 0,
      allowlist: ['Pai'],
      enforceAllowlist: true,
    });
    await listener.deliverOne(messageId);

    expect(sent).toHaveLength(0);
    const msg = await pool.query<{ send_state: string }>('SELECT send_state FROM messages WHERE id = $1', [messageId]);
    expect(msg.rows[0]!.send_state).toBe('failed');
    const audit = await pool.query<{ action: string; metadata: { reason: string } }>(
      "SELECT action, metadata FROM audit_log WHERE action = 'whatsapp.message.send_refused'",
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0]!.metadata.reason).toBe('outbound_allowlist');
  });

  it('destino na allowlist → enviado normalmente', async () => {
    const { messageId } = await setupConversation('Pai');
    const sent: string[] = [];
    const { createOutboundListener } = await import('../../apps/whatsplay/src/outbound.js');
    const listener = createOutboundListener({
      pool,
      transport: fakeTransport(sent),
      log,
      humanDelayMs: 0,
      allowlist: ['Pai'],
      enforceAllowlist: true,
    });
    await listener.deliverOne(messageId);

    expect(sent).toHaveLength(1);
    const msg = await pool.query<{ send_state: string }>('SELECT send_state FROM messages WHERE id = $1', [messageId]);
    expect(msg.rows[0]!.send_state).toBe('sent');
  });

  it('lista vazia em dev → recusa tudo (fail-closed)', async () => {
    const { messageId } = await setupConversation('Pai');
    const sent: string[] = [];
    const { createOutboundListener } = await import('../../apps/whatsplay/src/outbound.js');
    const listener = createOutboundListener({
      pool,
      transport: fakeTransport(sent),
      log,
      humanDelayMs: 0,
      allowlist: [],
      enforceAllowlist: true,
    });
    await listener.deliverOne(messageId);

    expect(sent).toHaveLength(0);
    const msg = await pool.query<{ send_state: string }>('SELECT send_state FROM messages WHERE id = $1', [messageId]);
    expect(msg.rows[0]!.send_state).toBe('failed');
  });
});

// ─────────────────────────── SEND-SAFETY (decreto owner, pós-incidente 2026-09-21) ───────────────────────────

describe('SEND-SAFETY: resposta vai SEMPRE pro chat da pergunta (mismatch = bloqueio incondicional)', () => {
  async function setupOutboundWithOrigin(originConv: string, outboundConv: string): Promise<string> {
    // evento de origem apontando pra conversation X
    const ev = await pool.query<{ event_id: string }>(
      `INSERT INTO events (event_id, event_type, version, correlation_id, priority, payload, occurred_at)
       VALUES ('evt_safety_1', 'whatsapp.message.received', 1, 'corr_safety_1', 0,
               $1::jsonb, now()) RETURNING event_id`,
      [JSON.stringify({ payload: { conversation_id: originConv, text: 'pergunta' } })],
    );
    void ev;
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO messages (conversation_id, direction, channel, sender, body, send_state, metadata)
       VALUES ($1, 'outbound', 'whatsapp', 'luna', 'resposta', 'queued',
               jsonb_build_object('reply_to_event', 'evt_safety_1', 'correlation_id', 'corr_safety_1'))
       RETURNING id`,
      [outboundConv],
    );
    return inserted.rows[0]!.id;
  }

  it('mismatch PROVADO: bloqueado, nada enviado, audit send_safety.blocked', async () => {
    const a = await resolveIngressIdentity(pool, { client_name: 'Chat A', channel: 'whatsapp', address: 'Pai' });
    const b = await resolveIngressIdentity(pool, { client_name: 'Chat B', channel: 'whatsapp', address: '🏆Production - 2026🙏🏻' });
    const messageId = await setupOutboundWithOrigin(a.conversation_id, b.conversation_id);

    const sent: string[] = [];
    const { createOutboundListener } = await import('../../apps/whatsplay/src/outbound.js');
    const listener = createOutboundListener({
      pool, transport: fakeTransport(sent), log, humanDelayMs: 0,
      allowlist: ['Pai', '🏆Production - 2026🙏🏻'], enforceAllowlist: true,
    });
    await listener.deliverOne(messageId);

    expect(sent).toHaveLength(0); // NADA foi enviado
    const msg = await pool.query<{ send_state: string }>('SELECT send_state FROM messages WHERE id = $1', [messageId]);
    expect(msg.rows[0]!.send_state).toBe('failed');
    expect((await pool.query("SELECT * FROM audit_log WHERE action = 'send_safety.blocked'")).rowCount).toBe(1);
  });

  it('vínculo íntegro (resposta na conversa da pergunta): entrega normal', async () => {
    const a = await resolveIngressIdentity(pool, { client_name: 'Chat A2', channel: 'whatsapp', address: 'Pai' });
    const messageId = await setupOutboundWithOrigin(a.conversation_id, a.conversation_id);

    const sent: string[] = [];
    const { createOutboundListener } = await import('../../apps/whatsplay/src/outbound.js');
    const listener = createOutboundListener({
      pool, transport: fakeTransport(sent), log, humanDelayMs: 0,
      allowlist: ['Pai', '🏆Production - 2026🙏🏻'], enforceAllowlist: true,
    });
    await listener.deliverOne(messageId);

    expect(sent).toHaveLength(1);
    const msg = await pool.query<{ send_state: string }>('SELECT send_state FROM messages WHERE id = $1', [messageId]);
    expect(msg.rows[0]!.send_state).toBe('sent');
  });
});
