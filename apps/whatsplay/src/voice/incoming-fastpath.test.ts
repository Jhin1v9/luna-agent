import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pino from 'pino';
import { fastAnswerIncoming, INBOUND_OPERATOR_PROMPT } from './incoming-fastpath.js';

const log = pino({ level: 'silent' });

// O override .luna-config/caller-prompt.md (v15.3) venceria o prompt embutido
// nos testes — desligamos via kill-switch pra testar o prompt padrão.
beforeAll(() => { process.env.LUNA_CALLER_PROMPT = 'off'; });
afterAll(() => { delete process.env.LUNA_CALLER_PROMPT; });

function makeDeps(over: Record<string, unknown> = {}) {
  const accepted: number[] = [];
  const panels: string[] = [];
  const deps = {
    log,
    live: { async sendTurn() { return { reply_text: '{"action":"hold"}', session_id: 'x', duration_ms: 1 }; } } as never,
    acceptCall: async () => { accepted.push(Date.now()); },
    observePanel: async () => ({ state: panels.shift() ?? 'encerrado' }),
    endPollMs: 20,
    conductorPollMs: 20,
    ...over,
  };
  return { deps, accepted };
}

function makeOperator(over: Record<string, unknown> = {}) {
  const sent: string[] = [];
  const op = {
    async connect() { return true; },
    async ensureChatGptTab() { return { evaluate: async () => [] }; },
    async ensureVoiceMode() { /* ok */ },
    async sendTextFast(_t: unknown, text: string) { sent.push(text); },
    async readVoiceCaptions() { return []; },
    ...over,
  };
  return { op: op as never, sent };
}

describe('fast path de chamada recebida (decreto owner 08:16)', () => {
  it('INBOUND_OPERATOR_PROMPT: regras duras + contexto buildado + lembrete de que a Luna executa tudo', () => {
    const p = INBOUND_OPERATOR_PROMPT('Pai', '- última conversa: teste de chamada');
    expect(p).toContain('Pai');
    expect(p).toContain('EU EXECUTO TUDO');
    expect(p).toContain('última conversa: teste de chamada');
    expect(p).toContain('NUNCA invente preço');
    const semCtx = INBOUND_OPERATOR_PROMPT('Desconhecido', null);
    expect(semCtx).toContain('sem contexto prévio');
  });

  it('caller FORA da allowlist → not-allowed, zero accepts (fail-closed)', async () => {
    const { deps, accepted } = makeDeps();
    const r = await fastAnswerIncoming(deps, ['Pai'], { caller: 'Estranho', contexto: null });
    expect(r).toBe('not-allowed');
    expect(accepted).toHaveLength(0);
  });

  it('busy → not-allowed (não atende segunda chamada simultânea)', async () => {
    const { deps, accepted } = makeDeps({ isBusy: () => true });
    const r = await fastAnswerIncoming(deps, ['Pai'], { caller: 'Pai', contexto: null });
    expect(r).toBe('not-allowed');
    expect(accepted).toHaveLength(0);
  });

  it('caller NA allowlist → atende E injeta prompt com contexto no ChatGPT (em paralelo)', async () => {
    const { deps, accepted } = makeDeps();
    const { op, sent } = makeOperator();
    const r = await fastAnswerIncoming({ ...deps, operator: op }, ['Pai'], {
      caller: 'Pai',
      contexto: '- Pai = Abner, dono da Nexo Digital',
    });
    expect(r).toBe('answered');
    expect(accepted).toHaveLength(1); // atendeu
    expect(sent).toHaveLength(1); // prompt injetado
    expect(sent[0]).toContain('Pai = Abner, dono da Nexo Digital');
    expect(sent[0]).toContain('EU EXECUTO TUDO');
  });

  it('preparo do Operador FALHA (chrome-voice offline) → chamada mesmo assim atendida, falha explícita, sem prompt', async () => {
    const { deps, accepted } = makeDeps();
    const { op, sent } = makeOperator({ async connect() { return false; } });
    const r = await fastAnswerIncoming({ ...deps, operator: op }, ['Pai'], { caller: 'Pai', contexto: null });
    expect(r).toBe('answered'); // a pessoa não fica esperando — atendeu
    expect(accepted).toHaveLength(1);
    expect(sent).toHaveLength(0); // mas o copiloto não finge estar pronto
  });

  it('REGRESSÃO (crash ao vivo 24/09): prep falha ENQUANTO acceptCall ainda não resolveu → chamada atendida, SEM unhandledRejection', async () => {
    // Cena real da pane: acceptCall demora (~1.5s de clique+espera) e o
    // chrome-voice (9340) responde ECONNREFUSED em ~40ms — o `prep` rejeitava
    // sem nenhum handler anexado (o await prep só vinha depois do await
    // answering) e o Node derrubava o PROCESSO INTEIRO a cada ligação.
    // Este teste reproduz a janela da corrida: accept lento + connect falha
    // rápido. Sem o prep.catch() imediato, o vitest captura a rejeição solta.
    const { deps, accepted } = makeDeps({
      acceptCall: () => new Promise<void>((r) => setTimeout(() => { accepted.push(Date.now()); r(); }, 120)),
    });
    const { op, sent } = makeOperator({ async connect() { return false; } });
    const r = await fastAnswerIncoming({ ...deps, operator: op }, ['Pai'], { caller: 'Pai', contexto: null });
    expect(r).toBe('answered');
    expect(accepted).toHaveLength(1);
    expect(sent).toHaveLength(0);
    // deixa o loop de eventos dar uma volta — rejeição solta apareceria agora
    await new Promise((r2) => setTimeout(r2, 50));
  });

  it('markBusy marca e desmarca ao redor da chamada', async () => {
    const { deps } = makeDeps();
    const { op } = makeOperator();
    const states: boolean[] = [];
    await fastAnswerIncoming(
      { ...deps, operator: op, markBusy: (b: boolean) => states.push(b) },
      ['Pai'],
      { caller: 'Pai', contexto: null },
    );
    expect(states).toEqual([true, false]);
  });
});
