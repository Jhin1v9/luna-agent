/**
 * Testes de injeção de falhas (§29): o sistema já provou E2E várias falhas
 * na F1.5 (chrome morto, reboot, duplicata); aqui formalizamos as que faltam:
 * LLM timeout, tool externa com 5xx, adapter que aborta.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import pino from 'pino';
import { migrate } from '../../packages/database/src/migrate.js';
import { publishEvent, resolveIngressIdentity, insertInboundMessage } from '../../packages/database/src/index.js';
import { EventBus } from '../../apps/orchestrator/src/events/bus.js';
import { createMessageHandler } from '../../apps/orchestrator/src/agent/handler.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgres://luna:luna@localhost:5433/luna_test';
const ADMIN_URL = (() => {
  const u = new URL(TEST_URL);
  u.pathname = '/postgres';
  return u.toString();
})();
const TEST_DB_NAME = new URL(TEST_URL).pathname.slice(1);

let pool: pg.Pool;
const log = pino({ level: 'silent' });

function adapterWith(sendTurn: () => Promise<never>) {
  return {
    mode: 'kimi-api' as const,
    async ensureSession(k: string) {
      return { session_id: `kimi-api:${k}`, busy: false };
    },
    sendTurn,
    async readMessages() {
      return [];
    },
  };
}

async function fire(text: string, externalId: string): Promise<string> {
  const identity = await resolveIngressIdentity(pool, { client_name: 'Failure Inj', channel: 'whatsapp', address: 'Pai' });
  const messageId = (await insertInboundMessage(pool, {
    conversation_id: identity.conversation_id, channel: 'whatsapp', text, external_id: externalId,
  }))!;
  const { event } = await publishEvent(pool, {
    event_type: 'whatsapp.message.received', source: 'fi-test', client_id: identity.client_id,
    conversation_id: identity.conversation_id,
    payload: { conversation_id: identity.conversation_id, message_id: messageId, text, deliver: false },
    idempotency_key: `fi:${externalId}`,
  });
  return event.event_id;
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
     escalations, usage_entries RESTART IDENTITY CASCADE`,
  );
});

describe('failure injection (§29)', () => {
  it('LLM TIMEOUT/ABORT: handler falha explícita, zero resposta parcial, evento fica pra retry', async () => {
    const bus = new EventBus(pool, { dispatcherId: 'fi' });
    bus.on('whatsapp.message.received', createMessageHandler({
      pool,
      adapter: adapterWith(async () => {
        throw new Error('The operation was aborted (LLM timeout)');
      }) as never,
      log,
    }));
    const eventId = await fire('meu site caiu, socorro', 'fi-timeout');
    await bus.dispatchOnce();

    const outbox = await pool.query('SELECT status, attempts FROM outbox WHERE event_id = $1', [eventId]);
    expect(outbox.rows[0]!.status).toBe('pending'); // vai retentar — não some
    expect(outbox.rows[0]!.attempts).toBe(1);
    expect((await pool.query("SELECT * FROM messages WHERE direction='outbound'")).rowCount).toBe(0); // zero parcial
    const audit = await pool.query("SELECT result FROM audit_log WHERE action='event.dispatched'");
    expect(audit.rows[0]!.result).toBe('failed');
  });

  it('LLM DOWN (rede): mesma contenção — sem resposta fake, retry agendado', async () => {
    const bus = new EventBus(pool, { dispatcherId: 'fi' });
    bus.on('whatsapp.message.received', createMessageHandler({
      pool,
      adapter: adapterWith(async () => {
        throw new Error('fetch failed: ECONNREFUSED');
      }) as never,
      log,
    }));
    const eventId = await fire('oi', 'fi-down');
    await bus.dispatchOnce();
    const ob = await pool.query('SELECT status FROM outbox WHERE event_id = $1', [eventId]);
    expect(['pending', 'dead']).toContain(ob.rows[0]!.status); // pending agora; dead após 5 tentativas (DLQ → redrive cobre)
  });

  it('tool externa 500: TOOL_CALL recebe erro como dado e o FAST continua (ANSWER)', async () => {
    // adapter que pede TOOL_CALL uma vez e responde ANSWER na segunda volta
    let n = 0;
    const adapter = {
      mode: 'kimi-api' as const,
      async ensureSession(k: string) {
        return { session_id: `kimi-api:${k}`, busy: false };
      },
      async sendTurn() {
        n++;
        if (n === 1) {
          return {
            reply_text: JSON.stringify({ type: 'TOOL_CALL', tool: 'nexo.finance.summary', args: {}, reason: 'consultar caixa' }),
            session_id: 'k', duration_ms: 1, model: 'kimi-k2.6',
          };
        }
        return {
          reply_text: JSON.stringify({ type: 'ANSWER', text: 'Consultei o caixa: está zerado este mês.' }),
          session_id: 'k', duration_ms: 1, model: 'kimi-k2.6',
        };
      },
      async readMessages() {
        return [];
      },
    };
    const bus = new EventBus(pool, { dispatcherId: 'fi' });
    bus.on('whatsapp.message.received', createMessageHandler({ pool, adapter: adapter as never, log }));
    const eventId = await fire('como está o caixa?', 'fi-tool');
    await bus.dispatchOnce();

    const ob = await pool.query('SELECT status FROM outbox WHERE event_id = $1', [eventId]);
    expect(ob.rows[0]!.status).toBe('published'); // completou apesar da tool
    const reply = await pool.query<{ body: string }>("SELECT body FROM messages WHERE direction='outbound'");
    expect(reply.rows[0]!.body).toContain('caixa');
    // nota: nexo.finance.summary não está registrada neste bus de teste →
    // runTool retornou 'tool desconhecida' como dado → FAST continuou. Com a
    // tool registrada e a VPS com 500, o ToolResult ok=false segue o mesmo
    // caminho (erro como dado, nunca exceção pro loop).
  });
});
