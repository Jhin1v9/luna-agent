import { describe, it, expect } from 'vitest';
import pino from 'pino';
import type { EventEnvelope } from '@luna/events';
import { parseStructured, isExplicitHumanRequest } from './structured.js';
import { routeFor, loadRouterConfig } from './config.js';
import { runFastRoute, TOOL_CALL_MAX_ITERATIONS } from './router.js';
import { estimateCost } from '../handler.js';

const log = pino({ level: 'silent' });

function fakeEvent(over: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    event_id: 'evt_t1',
    event_type: 'whatsapp.message.received',
    version: 1,
    timestamp: new Date().toISOString(),
    source: 'test',
    organization_id: null,
    client_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    conversation_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    correlation_id: 'corr_t1',
    causation_id: null,
    priority: 0,
    payload: { text: 'oi', conversation_id: 'conv-1' },
    metadata: {},
    ...over,
  } as EventEnvelope;
}

/** Adapter fake: responde JSON estruturado por script de respostas. */
function fakeAdapter(replies: string[]) {
  let n = 0;
  return {
    mode: 'kimi-api' as const,
    async ensureSession(k: string) {
      return { session_id: `kimi-api:${k}`, busy: false };
    },
    async sendTurn() {
      const reply = replies[Math.min(n, replies.length - 1)]!;
      n++;
      return { reply_text: reply, session_id: 'kimi-api:x', duration_ms: 1, model: 'kimi-k2.6' };
    },
    async readMessages() {
      return [];
    },
  };
}

/** Pool stub mínimo (tools de leitura retornam vazio; publishEvent no-op). */
const stubPool = {
  async query(sql: string, params?: unknown[]) {
    if (sql.startsWith('INSERT INTO events') || sql.startsWith('INSERT INTO outbox')) return { rowCount: 1, rows: [] };
    if (sql.startsWith('INSERT INTO idempotency_keys')) return { rowCount: 1, rows: [] };
    if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) return { rowCount: 0, rows: [] };
    return { rowCount: 0, rows: [] };
  },
  async connect() {
    const client = {
      async query() {
        return { rowCount: 0, rows: [] };
      },
      async release() {},
    };
    return client;
  },
} as never;

describe('saídas estruturadas (§5)', () => {
  it('parse: JSON puro, embrulhado, e degradação para ANSWER', () => {
    expect(parseStructured('{"type":"ANSWER","text":"oi!"}').output).toEqual({ type: 'ANSWER', text: 'oi!' });
    expect(parseStructured('claro! {"type":"HANDOFF_LIVE","objective":"ver logs"} fim').output.type).toBe('HANDOFF_LIVE');
    const deg = parseStructured('texto sem json nenhum');
    expect(deg.output).toEqual({ type: 'ANSWER', text: 'texto sem json nenhum' });
    expect(deg.degraded).toBe(true);
  });

  it('pedido explícito de humano (§8.1): zero tentativas de IA', async () => {
    const adapter = fakeAdapter([]); // se fosse chamado, replies vazio estouraria
    const d = await runFastRoute(
      { pool: stubPool, adapter: adapter as never, log },
      { event: fakeEvent({ payload: { text: 'me liga por favor', conversation_id: 'conv-1' } }), prompt: 'p', sessionKey: 'conv-1', allowLiveHandoff: true },
    );
    expect(d.escalate).toBe(true);
    expect(d.output.type).toBe('ESCALATE_HUMAN');
    expect(d.toolRounds).toBe(0);
    expect(d.answerText).toContain('chamei o time');
  });

  it('variações de pedido explícito', () => {
    expect(isExplicitHumanRequest('quero falar com alguém')).toBe(true);
    expect(isExplicitHumanRequest('chama o atendente')).toBe(true);
    expect(isExplicitHumanRequest('preciso de um humano')).toBe(true);
    expect(isExplicitHumanRequest('quanto custa o site?')).toBe(false);
    expect(isExplicitHumanRequest('o status do projeto?')).toBe(false);
    // nota: "me liga" cru sempre dispara (em chat, quase sempre é pedido de
    // ligação; falso-positivo raro aceito, decreto pede imediato)
  });
});

describe('guardas de bucle (§5.1)', () => {
  it('TOOL_CALL: máx 5 iterações → depois obedece a saída final', async () => {
    const loop = JSON.stringify({ type: 'TOOL_CALL', tool: 'conversation.recent', args: {}, reason: 'r' });
    const final = JSON.stringify({ type: 'ANSWER', text: 'resposta final' });
    const replies = [loop, loop, loop, loop, loop, loop, final];
    const adapter = fakeAdapter(replies);
    const d = await runFastRoute(
      { pool: stubPool, adapter: adapter as never, log },
      { event: fakeEvent(), prompt: 'p', sessionKey: 'conv-1', allowLiveHandoff: true },
    );
    expect(d.output.type).toBe('ANSWER');
    expect(d.toolRounds).toBeLessThanOrEqual(TOOL_CALL_MAX_ITERATIONS);
  });

  it('HANDOFF_LIVE: resposta de espera ANTES de transferir (§6) + 1 só vez', async () => {
    const adapter = fakeAdapter([JSON.stringify({ type: 'HANDOFF_LIVE', objective: 'verificar deploy', context_summary: '' })]);
    const d = await runFastRoute(
      { pool: stubPool, adapter: adapter as never, log },
      { event: fakeEvent(), prompt: 'p', sessionKey: 'conv-1', allowLiveHandoff: true },
    );
    expect(d.handoff).toBe(true);
    expect(d.answerText.length).toBeGreaterThan(0); // cliente nunca fica em silêncio
    expect(d.answerText).not.toContain('verificar deploy'); // espera, não o resultado
  });

  it('ESCALATE_HUMAN do FAST vira decisão de escalación com prioridade', async () => {
    const adapter = fakeAdapter([JSON.stringify({ type: 'ESCALATE_HUMAN', reason: 'preço', priority: 'CRITICA', summary: 's' })]);
    const d = await runFastRoute(
      { pool: stubPool, adapter: adapter as never, log },
      { event: fakeEvent(), prompt: 'p', sessionKey: 'conv-1', allowLiveHandoff: true },
    );
    expect(d.escalate).toBe(true);
    expect(d.output.type).toBe('ESCALATE_HUMAN');
  });
});

describe('routes em config versionada (§4/§10)', () => {
  it('route conhecida + default determinístico sem route', () => {
    const cfg = loadRouterConfig();
    const known = routeFor(cfg, 'client.message.received');
    expect(known.defaulted).toBe(false);
    expect(known.route.destination).toBe('fast');
    expect(known.route.investigation_budget).toBe(3);
    const unknown = routeFor(cfg, 'evento.novo.tipo');
    expect(unknown.defaulted).toBe(true);
    expect(unknown.route.destination).toBe('fast');
  });
});

describe('usage ledger (§23/§28) — custo por modelo', () => {
  it('estimated_cost com preços versionados; billable separado', () => {
    const c = estimateCost('kimi-k2.6', { input_tokens: 1_000_000, output_tokens: 250_000 });
    expect(c!.estimated_cost).toBeCloseTo(0.95 + 1.0, 5); // 1M in + 0.25M out
    expect(c!.billable_units).toBeGreaterThanOrEqual(195);
    expect(estimateCost('modelo-desconhecido', { input_tokens: 1, output_tokens: 1 })).toBeNull();
  });
});
