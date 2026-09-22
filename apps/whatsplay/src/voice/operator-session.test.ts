import { describe, expect, it } from 'vitest';
import { OperatorSession, HOLD_TEXT } from './operator-session.js';
import { OPERADOR_VOICE_PROMPT } from './bridge.js';

/**
 * F6 v2 (decreto owner): sessão do Operador no chrome-voice — garante aba,
 * injeta prompt §26 + contexto, marca de espera. Tudo testável com page fake.
 */

function fakePage(opts: { composerWorks?: boolean; sendWorks?: boolean; replies?: string[] }) {
  const state = { typed: [] as string[], sent: [] as string[], enterPressed: 0, composerClicks: 0, sendClicks: 0 };
  const page = {
    async waitForTimeout() {},
    locator(sel: string) {
      return {
        first() {
          return {
            async click() {
              if (sel.includes('prompt-textarea') || sel.includes('Message') || sel.includes('contenteditable')) {
                state.composerClicks++;
                if (opts.composerWorks === false) throw new Error('sem composer');
                return;
              }
              state.sendClicks++;
              if (opts.sendWorks === false) throw new Error('sem send');
            },
          };
        },
      };
    },
    async evaluate(script: string) {
      if (script.includes('data-message-author-role')) {
        const r = opts.replies ?? [];
        return r.length ? r[r.length - 1] : null;
      }
      return null;
    },
  };
  // keyboard como método do page (usado como page.keyboard.type/press)
  (page as any).keyboard = {
    async type(text: string) {
      state.typed.push(text);
    },
    async press(key: string) {
      if (key === 'Enter') state.enterPressed++;
    },
  };
  return { page: page as never, state };
}

describe('OperatorSession (F6 v2)', () => {
  it('injectContext envia o prompt §26 completo + contexto da chamada', async () => {
    const { page, state } = fakePage({});
    const s = new OperatorSession({});
    await s.injectContext(page, { caller: 'Pai', motivo: 'teste de chamada ao vivo', extras: ['Pai está na allowlist'] });
    const text = state.typed[0]!;
    expect(text).toContain(OPERADOR_VOICE_PROMPT);
    expect(text).toContain('Quem está na linha: Pai');
    expect(text).toContain('Motivo: teste de chamada ao vivo');
    expect(text).toContain('Pai está na allowlist');
    expect(state.sendClicks).toBe(1);
  });

  it('send: botão de envio falha → fallback Enter', async () => {
    const { page, state } = fakePage({ sendWorks: false });
    const s = new OperatorSession({});
    await s.hold(page);
    expect(state.enterPressed).toBe(1);
    expect(state.typed[0]).toBe(HOLD_TEXT);
  });

  it('hold envia exatamente a marca de espera §26', async () => {
    const { page, state } = fakePage({});
    const s = new OperatorSession({});
    await s.hold(page);
    expect(state.typed[0]).toBe(HOLD_TEXT);
    expect(state.enterPressed).toBe(0);
  });

  it('readLatestReply devolve a última resposta do assistente', async () => {
    const { page } = fakePage({ replies: ['resposta A', 'resposta B'] });
    const s = new OperatorSession({});
    expect(await s.readLatestReply(page)).toBe('resposta B');
  });

  it('readLatestReply sem respostas → null explícito', async () => {
    const { page } = fakePage({ replies: [] });
    const s = new OperatorSession({});
    expect(await s.readLatestReply(page)).toBeNull();
  });
});
