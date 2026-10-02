import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { CallConductor, parseDecision } from './call-conductor.js';

/**
 * CALL CONDUCTOR (ADR-037): Kimi Live maestra — lê turnos, decide say/act/hold.
 */

const log = pino({ level: 'silent' });

function fakeTab(turnsQueue: Array<Array<{ role: string; text: string }>>) {
  const page: { calls: number; evaluate: () => Promise<unknown> } = {
    calls: 0,
    async evaluate() {
      page.calls++;
      return turnsQueue.shift() ?? [];
    },
  };
  return page as never;
}

function fakeOperator() {
  const sent: string[] = [];
  return {
    sent,
    async sendText(_p: unknown, t: string) {
      sent.push(t);
    },
  };
}

function fakeLive(replies: string[]) {
  const prompts: string[] = [];
  let n = 0;
  return {
    prompts,
    async sendTurn(req: { prompt: string }) {
      prompts.push(req.prompt);
      return { reply_text: replies[Math.min(n++, replies.length - 1)]!, session_id: 's', duration_ms: 1 };
    },
  };
}

const brief = {
  participantes: ['Pai', 'Abner (dono)'],
  objetivo: 'Pedir pro Abner retornar a ligação da Jess',
  poderes: ['escrever no chat do Operador', 'agir no WhatsApp', 'escalar'],
  tom: 'parceira de time, direta',
};

describe('parseDecision (tolerante)', () => {
  it('say/act/hold + fallback texto cru', () => {
    expect(parseDecision('{"action":"say","text":"fala isso"}')).toEqual({ kind: 'say', text: 'fala isso' });
    expect(parseDecision('{"action":"act","name":"wa_msg","detail":"manda msg"}')).toEqual({ kind: 'act', name: 'wa_msg', detail: 'manda msg' });
    expect(parseDecision('{"action":"hold"}')).toEqual({ kind: 'hold' });
    expect(parseDecision('texto sem json nenhum')).toEqual({ kind: 'say', text: 'texto sem json nenhum' });
  });
});

describe('CallConductor loop', () => {
  it('turno do participante → Kimi decide say → texto digitado no chat do Operador + audit', async () => {
    const tab = fakeTab([[], [{ role: 'user', text: 'quem é a cliente?' }]]); // 1º evaluate = snapshot do início da chamada
    const op = fakeOperator();
    const live = fakeLive(['Fale para o Abner que é a Jess — ela quer falar contigo direto.']);
    const audits: string[] = [];
    const c = new CallConductor({
      operator: op as never,
      live: live as never,
      log,
      pollMs: 50,
      pool: { query: async (sql: string, params?: unknown[]) => { audits.push(String(params?.[0])); return { rowCount: 1 }; } },
      correlationId: 'corr-teste',
    });
    const h = c.start(tab, brief);
    await new Promise((r) => setTimeout(r, 400));
    h.stop();
    expect(live.prompts[0]).toContain('quem é a cliente?');
    expect(live.prompts[0]).toContain('quem é a cliente?');
    expect(op.sent).toEqual(['📟 Luna → Operador: Fale para o Abner que é a Jess — ela quer falar contigo direto.']);
    expect(audits).toContain('conductor.relay');
  });

  it('ação → executeAction com evidência + audit; Kimi caindo degrada SEM derrubar o loop', async () => {
    const tab = fakeTab([
      [], // snapshot do início da chamada
      [{ role: 'user', text: 'manda msg pra Jess' }],
      [{ role: 'user', text: 'e aí?' }],
    ]);
    const op = fakeOperator();
    let n = 0;
    const live = {
      async sendTurn() {
        n++;
        if (n === 1) return { reply_text: 'Fale para o Abner que mensagem enviada para a Jess.', session_id: 's', duration_ms: 1 };
        throw new Error('kimi-cli: exit 1');
      },
    };
    const actions: string[] = [];
    const c = new CallConductor({
      operator: op as never,
      live: live as never,
      log,
      pollMs: 50,
      executeAction: async (name, detail) => {
        actions.push(name + ':' + detail);
        return 'msg enfileirada com sucesso';
      },
    });
    const h = c.start(tab, brief);
    await new Promise((r) => setTimeout(r, 500));
    h.stop();
    // (executor agora é a própria sessão Kimi Web — o relay só transmite a resposta)
    expect(op.sent.some(m => m.includes('mensagem enviada para a Jess'))).toBe(true); // resposta da sessão vai no barramento
    // Kimi caiu no 2º turno — o loop sobreviveu (sem exceção)
    expect(op.sent.length).toBeGreaterThanOrEqual(1);
  });

  it('cursor: turnos já lidos NÃO reprocessam', async () => {
    const tab = fakeTab([[], [{ role: 'user', text: 'oi' }]]); // 1º evaluate = snapshot do início da chamada
    const live = fakeLive(['{"action":"hold"}']);
    const op = fakeOperator();
    const c = new CallConductor({ operator: op as never, live: live as never, log, pollMs: 60 });
    const h = c.start(tab, brief);
    await new Promise((r) => setTimeout(r, 600));
    h.stop();
    expect(live.prompts.length).toBe(1); // 1 turno só, lido 1x
  });

  it('voice mode (decreto owner 08:16): captions viram turnos, dedupe por conteúdo — caption repetida NÃO reprocessa', async () => {
    const tab = fakeTab([]); // thread de texto MUDO (é o caso real do voice mode)
    const live = fakeLive(['', 'Pergunta se é sobre o painel.']);
    const op = fakeOperator();
    let reads = 0;
    const c = new CallConductor({
      operator: op as never,
      live: live as never,
      log,
      pollMs: 60,
      readVoiceTurns: async () => {
        reads++;
        return reads === 1 ? [{ speaker: 'participante (voz)', text: 'oi, é a Jess' }] : [{ speaker: 'participante (voz)', text: 'oi, é a Jess' }, { speaker: 'participante (voz)', text: 'queria falar do painel' }];
      },
    });
    const h = c.start(tab, brief);
    await new Promise((r) => setTimeout(r, 700));
    h.stop();
    expect(live.prompts.length).toBe(2); // 2 captions distintas (a repetida dedupou)
    expect(live.prompts[0]).toContain('oi, é a Jess');
    expect(live.prompts[1]).toContain('painel');
    expect(op.sent).toEqual(['📟 Luna → Operador: Pergunta se é sobre o painel.']); // 1 say só (do 2º turno)
  });

  it('BATCH (decreto owner 14:28 "ao vivo"): vários turnos no MESMO poll viram UM SÓ pedido à Luna', async () => {
    // Cenário real: a resposta anterior demorou e 3 falas acumularam. Antes do
    // batch eram 3 roundtrips seriais (3x a latência); agora é 1 só.
    const tab = fakeTab([[], [{ role: 'user', text: 'primeira' }, { role: 'user', text: 'segunda' }, { role: 'user', text: 'terceira' }]]); // 1º evaluate = snapshot
    const live = fakeLive(['Resposta ao estado atual.']);
    const op = fakeOperator();
    const c = new CallConductor({ operator: op as never, live: live as never, log, pollMs: 60 });
    const h = c.start(tab, brief);
    await new Promise((r) => setTimeout(r, 500));
    h.stop();
    expect(live.prompts.length).toBe(1); // 3 turnos, 1 pedido só
    expect(live.prompts[0]).toContain('primeira');
    expect(live.prompts[0]).toContain('segunda');
    expect(live.prompts[0]).toContain('terceira');
    expect(live.prompts[0]).toContain('novas falas na transcrição');
    expect(op.sent).toEqual(['📟 Luna → Operador: Resposta ao estado atual.']);
  });

  it('captureTranscript: SÓ o trecho desta chamada (decreto owner 27/09 — nunca o chat todo)', async () => {
    const HIST = { role: 'user', text: 'histórico antigo do chat' };
    const F1 = { role: 'user', text: 'fala 1 da chamada' };
    const R1 = { role: 'assistant', text: 'resposta do operador' };
    const final = [HIST, F1, R1];
    const tab = fakeTab([[HIST], [HIST, F1], final, final, final]); // 1º = snapshot
    const c = new CallConductor({ operator: fakeOperator() as never, live: fakeLive(['ok']) as never, log, pollMs: 80 });
    const h = c.start(tab, brief);
    await new Promise((r) => setTimeout(r, 250));
    h.stop();
    const seg = await c.captureTranscript(tab as never);
    expect(seg.map((t) => t.text)).toEqual(['fala 1 da chamada', 'resposta do operador']); // HIST ficou de fora
  });
});

describe('GUARDA DE ORDEM EXPLÍCITA (decreto owner: nd de agir sozinha)', () => {
  it('act COM ordem direta no turno → executa citando a ordem no resultado', async () => {
    const { guardAction } = await import('./call-conductor.js');
    const r = guardAction({ kind: 'act', name: 'wa_msg', detail: 'manda msg pra Jess' }, { speaker: 'Abner', text: 'manda uma mensagem pra Jess agora' });
    expect(r.decision.kind).toBe('act');
    expect(r.ordemCitada).toBe('manda');
  });

  it('act SEM ordem → vira pergunta ao owner via Operador (nunca ação)', async () => {
    const { guardAction } = await import('./call-conductor.js');
    const r = guardAction({ kind: 'act', name: 'wa_msg', detail: 'x' }, { speaker: 'participante', text: 'hmm interessante' });
    expect(r.decision.kind).toBe('say');
    expect((r.decision as { text: string }).text).toContain('Quer que eu');
    expect(r.ordemCitada).toBeUndefined();
  });

  it('say/hold passam direto pela guarda', async () => {
    const { guardAction } = await import('./call-conductor.js');
    expect(guardAction({ kind: 'hold' }, { speaker: 'x', text: 'y' }).decision.kind).toBe('hold');
    const s = guardAction({ kind: 'say', text: 'oi' }, { speaker: 'x', text: 'y' });
    expect(s.decision.kind).toBe('say');
    expect(s.ordemCitada).toBeUndefined();
  });
});
