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

  it('REGRESSÃO (bug ao vivo 2026-09-22): ANSWER com newline literal dentro do JSON → texto puro, sem envelope', () => {
    // O FAST emitiu o JSON com quebra de linha REAL dentro da string "text"
    // (JSON estrito inválido). Antes do fix, o envelope inteiro ia pro body.
    const broken = '{"type":"ANSWER","text":"Opa, segura aí 😄\n\nResposta direta: não 👊"}';
    const parsed = parseStructured(broken);
    expect(parsed.output.type).toBe('ANSWER');
    const text = parsed.output.type === 'ANSWER' ? parsed.output.text : '';
    expect(text).toBe('Opa, segura aí 😄\n\nResposta direta: não 👊');
    expect(text).not.toContain('{"type"'); // envelope não vaza no texto
  });

  it('REGRESSÃO: caminho completo runFastRoute com ANSWER quebrado → answerText puro', async () => {
    const broken = '{"type":"ANSWER","text":"Oi Jhin!\n\nTudo certo por aqui 🙌"}';
    const d = await runFastRoute(
      { pool: stubPool, adapter: fakeAdapter([broken]) as never, log },
      { event: fakeEvent(), prompt: 'p', sessionKey: 'conv-1', allowLiveHandoff: true },
    );
    expect(d.output.type).toBe('ANSWER');
    expect(d.answerText).toBe('Oi Jhin!\n\nTudo certo por aqui 🙌');
    expect(d.answerText).not.toContain('{"type"');
  });

  it('REGRESSÃO: HANDOFF_LIVE sem live-handoff disponível → cortesia §6, nunca JSON cru', async () => {
    const adapter = fakeAdapter([JSON.stringify({ type: 'HANDOFF_LIVE', objective: 'ver logs', context_summary: '' })]);
    const d = await runFastRoute(
      { pool: stubPool, adapter: adapter as never, log },
      { event: fakeEvent(), prompt: 'p', sessionKey: 'conv-1', allowLiveHandoff: false },
    );
    expect(d.handoff).toBe(false);
    expect(d.answerText.length).toBeGreaterThan(0);
    expect(d.answerText).not.toContain('{"type"');
    expect(d.answerText).not.toContain('ver logs');
  });

  it('REGRESSÃO: ESCALATE do FAST → mensagem de cortesia §8, sem JSON', async () => {
    const adapter = fakeAdapter([JSON.stringify({ type: 'ESCALATE_HUMAN', reason: 'preço', priority: 'ALTA', summary: 's' })]);
    const d = await runFastRoute(
      { pool: stubPool, adapter: adapter as never, log },
      { event: fakeEvent(), prompt: 'p', sessionKey: 'conv-1', allowLiveHandoff: false },
    );
    expect(d.escalate).toBe(true);
    expect(d.answerText).toContain('chamei o time');
    expect(d.answerText).not.toContain('{"type"');
  });

  it('pedido explícito de humano (§8.1): zero tentativas de IA', async () => {    const adapter = fakeAdapter([]); // se fosse chamado, replies vazio estouraria
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

describe('tools Nexo (leitura da VPS)', () => {
  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  it('login → Bearer em todas as chamadas; dados reais retornam', async () => {
    const { createNexoTools } = await import('./tools-nexo.js');
    const seen: Array<{ url: string; auth?: string }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      seen.push({ url, auth: (init?.headers as Record<string, string>)?.authorization });
      if (url.endsWith('/dashboard/api/auth/login')) {
        return jsonResponse({ success: true, token: 'tok-123', user: { id: 'luna' } });
      }
      return jsonResponse({ totalExpected: 100, activeClients: 2 });
    };
    const tools = createNexoTools({ baseUrl: 'https://vps.test', username: 'luna', password: 'x' }, fetchImpl);
    const r = await tools['nexo.finance.summary']!({} as never, { conversationId: 'c', clientId: null }, {});
    expect(r.ok).toBe(true);
    expect((r.data as { activeClients: number }).activeClients).toBe(2);
    // login chamado uma vez; chamada de dados com Bearer
    expect(seen[0]!.url).toContain('/dashboard/api/auth/login');
    expect(seen[1]!.auth).toBe('Bearer tok-123');
  });

  it('sem credencial: falha explícita por tool (fail-closed)', async () => {
    const { createNexoTools } = await import('./tools-nexo.js');
    const tools = createNexoTools({ baseUrl: 'https://vps.test' });
    const r = await tools['nexo.clients.list']!({} as never, { conversationId: 'c', clientId: null }, {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain('NEXO_API_USERNAME');
  });

  it('erro HTTP da VPS vira ToolResult ok=false (nunca exceção pro loop)', async () => {
    const { createNexoTools } = await import('./tools-nexo.js');
    const fetchImpl = async (url: string) =>
      url.endsWith('/login')
        ? jsonResponse({ success: true, token: 't' })
        : jsonResponse({ error: 'boom' }, 500);
    const tools = createNexoTools({ baseUrl: 'https://vps.test', username: 'u', password: 'p' }, fetchImpl);
    const r = await tools['nexo.tasks.list']!({} as never, { conversationId: 'c', clientId: null }, {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain('500');
  });
});
