import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { preflightOperator, runVoiceCall, type CallBrief } from './operator-preflight.js';

/**
 * PRÉ-VIOO DO OPERADOR (decreto owner): NUNCA discar com operador frio.
 * Prompt composto pelo Kimi Code por chamada (nunca genérico).
 */

const log = pino({ level: 'silent' });

const brief: CallBrief = {
  destinatario: 'Pai',
  numero: '+34 672 95 30 62',
  autorizador: 'Abner',
  motivo: 'teste do circuito de voz',
  objetivo: 'validar o circuito a trés e se despedir bem',
};

function fakeOperator(replyAfterMs: number) {
  const sent: string[] = [];
  let t0 = 0;
  return {
    sent,
    async connect() {
      t0 = Date.now();
      return true;
    },
    async ensureChatGptTab() {
      return { id: 'tab-1' } as never;
    },
    async sendText(_page: unknown, text: string) {
      sent.push(text);
    },
    async readLatestReply() {
      return Date.now() - t0 >= replyAfterMs ? 'ok, entendi — estou pronto.' : '';
    },
  };
}

function fakeLive(replyText: string, fail = false) {
  const prompts: string[] = [];
  return {
    prompts,
    async sendTurn(req: { session_key: string; prompt: string }) {
      if (fail) throw new Error('kimi-cli: exit 1 (quota)');
      prompts.push(req.prompt);
      return { reply_text: replyText, session_id: 's', duration_ms: 1 };
    },
  };
}

describe('pré-voo do Operador (ordem invertida, decreto owner)', () => {
  it('caminho feliz: prompt COMPOSTO pelo Kimi (com o contexto real na REQUISIÇÃO), injetado, confirmação chega → autoriza discar', async () => {
    const op = fakeOperator(500);
    const live = fakeLive('PROMPT-COMPOSTO-PELO-KIMI com os fatos da chamada');
    const tab = await preflightOperator({ operator: op as never, live: live as never, log, timeoutMs: 5_000, pollMs: 200 }, brief);
    expect(tab).toBeTruthy();
    expect(live.prompts[0]).toContain('Destinatário: Pai (+34 672 95 30 62)');
    expect(live.prompts[0]).toContain('Motivo da chamada: teste do circuito de voz');
    expect(live.prompts[0]).toContain('O que o Operador deve fazer: validar o circuito a trés');
    expect(op.sent[0]).toBe('PROMPT-COMPOSTO-PELO-KIMI com os fatos da chamada'); // o TEXTO do Kimi foi injetado
  });

  it('confirmação NÃO chega no timeout → aborta com falha explícita; runVoiceCall NUNCA disca', async () => {
    const op = fakeOperator(99_000); // nunca confirma
    const live = fakeLive('prompt ok');
    let dialed = 0;
    await expect(
      runVoiceCall({ operator: op as never, live: live as never, log, timeoutMs: 800, pollMs: 200 }, brief, async () => {
        dialed++;
      }),
    ).rejects.toThrow(/não vou discar/);
    expect(dialed).toBe(0); // NUNCA discou
  });

  it('Kimi CLI fora → falha explícita, NADA injetado, NADA discado (melhor não ligar do que robótico)', async () => {
    const op = fakeOperator(0);
    const live = fakeLive('', true); // kimi cai
    let dialed = 0;
    await expect(
      runVoiceCall({ operator: op as never, live: live as never, log, timeoutMs: 800 }, brief, async () => {
        dialed++;
      }),
    ).rejects.toThrow(/robótico/);
    expect(dialed).toBe(0);
    expect(op.sent).toEqual([]); // nem prompt genérico foi injetado
  });
});
