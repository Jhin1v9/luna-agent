import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { preflightOperator, runVoiceCall, type CallBrief } from './operator-preflight.js';

/**
 * PRÉ-VIOO DO OPERADOR (decreto owner): NUNCA discar com operador frio.
 * ORDEM: aba → MODO DE VOZ → compõe prompt (Kimi) → injeta → confirma → disca.
 */

const log = pino({ level: 'silent' });

const brief: CallBrief = {
  destinatario: 'Pai',
  numero: '+34 672 95 30 62',
  autorizador: 'Abner',
  motivo: 'teste do circuito de voz',
  objetivo: 'validar o circuito a trés e se despedir bem',
};

interface FakeOpts {
  voiceActiveInitially: boolean;
  clickActivates: boolean;
  replyAfterMs: number;
}

function fakeOperator(o: FakeOpts) {
  const sent: string[] = [];
  const calls: string[] = [];
  let voiceActive = o.voiceActiveInitially;
  let t0 = 0;
  return {
    sent,
    calls,
    get voiceActive() {
      return voiceActive;
    },
    async connect() {
      t0 = Date.now();
      return true;
    },
    async ensureChatGptTab() {
      return { id: 'tab-1' } as never;
    },
    async ensureVoiceMode() {
      calls.push('ensureVoiceMode');
      if (voiceActive) return; // já ativo: não clica de novo
      if (!o.clickActivates) throw new Error('não consegui entrar em modo de voz');
      voiceActive = true;
    },
    async sendText(_page: unknown, text: string) {
      sent.push(text);
    },
    async readLatestReply() {
      return Date.now() - t0 >= o.replyAfterMs ? 'ok, entendi — estou pronto.' : '';
    },
  };
}

function fakeLive(replyText: string, fail = false) {
  const prompts: string[] = [];
  return {
    prompts,
    async sendTurn(req: { prompt: string }) {
      if (fail) throw new Error('kimi-cli: exit 1 (quota)');
      prompts.push(req.prompt);
      return { reply_text: replyText, session_id: 's', duration_ms: 1 };
    },
  };
}

describe('pré-voo do Operador (ordem final: aba → voz → compõe → injeta → confirma → disca)', () => {
  it('voice mode JÁ ativo → não clica de novo; prompt composto injetado; confirmação chega → autoriza', async () => {
    const op = fakeOperator({ voiceActiveInitially: true, clickActivates: true, replyAfterMs: 300 });
    const live = fakeLive('PROMPT-COMPOSTO com papéis');
    const tab = await preflightOperator({ operator: op as never, live: live as never, log, timeoutMs: 4_000, pollMs: 150 }, brief);
    expect(tab).toBeTruthy();
    expect(op.calls).toEqual(['ensureVoiceMode']);
    expect(op.sent[0]).toBe('PROMPT-COMPOSTO com papéis');
    // ordem: voz ANTES de injetar
    expect(live.prompts[0]).toContain('Destinatário: Pai');
    expect(live.prompts[0]).toContain('PAPÉIS');
  });

  it('voice mode INATIVO → entra (ensureVoiceMode) antes de compor/injetar', async () => {
    const op = fakeOperator({ voiceActiveInitially: false, clickActivates: true, replyAfterMs: 300 });
    const live = fakeLive('P');
    await preflightOperator({ operator: op as never, live: live as never, log, timeoutMs: 4_000, pollMs: 150 }, brief);
    expect(op.voiceActive).toBe(true);
    expect(op.sent.length).toBe(1);
  });

  it('clique NÃO ativa o modo voz → falha explícita e ZERO discagem', async () => {
    const op = fakeOperator({ voiceActiveInitially: false, clickActivates: false, replyAfterMs: 0 });
    const live = fakeLive('P');
    let dialed = 0;
    await expect(
      runVoiceCall({ operator: op as never, live: live as never, log, timeoutMs: 800 }, brief, async () => {
        dialed++;
      }),
    ).rejects.toThrow(/modo de voz/);
    expect(dialed).toBe(0);
    expect(op.sent).toEqual([]); // nem prompt foi injetado
  });

  it('confirmação NÃO chega no timeout → aborta; runVoiceCall NUNCA disca', async () => {
    const op = fakeOperator({ voiceActiveInitially: true, clickActivates: true, replyAfterMs: 99_000 });
    const live = fakeLive('prompt ok');
    let dialed = 0;
    await expect(
      runVoiceCall({ operator: op as never, live: live as never, log, timeoutMs: 700, pollMs: 150 }, brief, async () => {
        dialed++;
      }),
    ).rejects.toThrow(/não vou discar/);
    expect(dialed).toBe(0);
  });

  it('Kimi CLI fora → falha explícita, NADA injetado, NADA discado', async () => {
    const op = fakeOperator({ voiceActiveInitially: true, clickActivates: true, replyAfterMs: 0 });
    const live = fakeLive('', true);
    let dialed = 0;
    await expect(
      runVoiceCall({ operator: op as never, live: live as never, log, timeoutMs: 800 }, brief, async () => {
        dialed++;
      }),
    ).rejects.toThrow(/robótico/);
    expect(dialed).toBe(0);
    expect(op.sent).toEqual([]);
  });
});
