import { describe, expect, it, vi } from 'vitest';
import { WhatsAppWebTransport } from './browser.js';

/**
 * REGRESSÃO (decreto owner 2026-09-22, "msg esquisita"): rascunho deixado
 * por um abort anterior concatenava com o texto novo no campo de composição.
 * sendMessage agora limpa o campo por TECLADO antes de digitar (warn quando
 * encontra resíduo) e confere/esvazia após o envio.
 */

interface FakeState {
  composeText: string;
  selectAll: boolean;
  sent: string[];
  failNextEnter: boolean;
  /** true = Enter não registra (campo não esvazia) — 2 tentativas e falha. */
  enterNoop: boolean;
}

function fakePage(initialCompose: string) {
  const state: FakeState = { composeText: initialCompose, selectAll: false, sent: [], failNextEnter: false, enterNoop: false };
  const keyboard = {
    async press(key: string) {
      if (key === 'Control+a') {
        state.selectAll = true;
        return;
      }
      if (key === 'Backspace') {
        if (state.selectAll) state.composeText = '';
        state.selectAll = false;
        return;
      }
      if (key === 'Enter') {
        if (state.failNextEnter) {
          state.failNextEnter = false;
          throw new Error('simulação: Enter falhou após digitar (abort anterior)');
        }
        if (state.enterNoop) return; // Enter não registra — campo não esvazia
        if (state.composeText.trim()) {
          state.sent.push(state.composeText);
          state.composeText = '';
        }
        state.selectAll = false;
        return;
      }
    },
    async type(text: string) {
      // digitar com seleção ativa substitui o conteúdo (comportamento real)
      if (state.selectAll) {
        state.composeText = '';
        state.selectAll = false;
      }
      state.composeText += text;
    },
  };
  const page = {
    keyboard,
    isClosed: () => false,
    async click() {},
    async reload() {},
    async waitForSelector() {},
    async waitForTimeout() {},
    async evaluate(script: string) {
      // saúde da página: fake sempre saudável
      if (script.includes('noscript')) return true;
      // fallback DOM de clearComposeBox
      if (script.includes("el.textContent = ''")) {
        state.composeText = '';
        return undefined;
      }
      // leitura de comprimento do campo (composeBoxTextLen)
      if (script.includes("textContent || ''")) return state.composeText.trim().length;
      // OPEN_CHAT_TITLE_SCRIPT → nenhum chat aberto (closeCurrentChat ok)
      if (script.includes('conversation-info-header')) return null;
      return undefined;
    },
  };
  return { state, page: page as never };
}

function makeTransport(page: unknown, warn: ReturnType<typeof vi.fn>) {
  const t = new WhatsAppWebTransport({
    chromePath: '',
    userDataDir: '',
    headless: true,
    evidenceDir: '',
    log: { warn } as never,
  });
  (t as unknown as { page: unknown }).page = page;
  // openChat é pesado (DOM do WA) — o foco do teste é o campo de composição
  (t as unknown as { openChat: () => Promise<boolean> }).openChat = async () => true;
  return t;
}

describe('sendMessage — limpeza do campo de composição (decreto owner)', () => {
  it('campo com resíduo de abort → entrega SÓ o texto novo + warn com nº de chars', async () => {
    const warn = vi.fn();
    const { state, page } = fakePage('rascunho velho de abort anterior');
    const t = makeTransport(page, warn);
    await t.sendMessage('chat-x', 'texto novo limpo');
    expect(state.sent).toEqual(['texto novo limpo']);
    expect(state.composeText).toBe(''); // campo esvaziado no fim
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ chars: 'rascunho velho de abort anterior'.length }),
      expect.stringContaining('resíduo'),
    );
  });

  it('campo limpo → comportamento inalterado, sem warn de resíduo', async () => {
    const warn = vi.fn();
    const { state, page } = fakePage('');
    const t = makeTransport(page, warn);
    await t.sendMessage('chat-x', 'oi!');
    expect(state.sent).toEqual(['oi!']);
    expect(warn).not.toHaveBeenCalledWith(expect.objectContaining({ chars: expect.any(Number) }), expect.stringContaining('resíduo'));
  });

  it('abort entre digitar e enviar → próximo send NÃO polui (limpa o rascunho)', async () => {
    const warn = vi.fn();
    const { state, page } = fakePage('');
    const t = makeTransport(page, warn);
    // 1º envio falha NO Enter — o texto digitado fica de rascunho no campo
    state.failNextEnter = true;
    await expect(t.sendMessage('chat-x', 'primeira tentativa')).rejects.toThrow('abort');
    expect(state.composeText).toBe('primeira tentativa'); // rascunho ficou
    // 2º envio: limpa o resíduo e entrega só o texto novo
    await t.sendMessage('chat-x', 'segunda tentativa');
    expect(state.sent).toEqual(['segunda tentativa']);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ chars: 'primeira tentativa'.length }),
      expect.stringContaining('resíduo'),
    );
  });

  it('REGRESSÃO (falso sent ao vivo): Enter não registra → FALHA explícita, rascunho limpo, nada enviado', async () => {
    const warn = vi.fn();
    const { state, page } = fakePage('');
    state.enterNoop = true; // ambos os Enters não pegam
    const t = makeTransport(page, warn);
    await expect(t.sendMessage('chat-x', 'mensagem que não vai')).rejects.toThrow('envio NÃO confirmado');
    expect(state.sent).toEqual([]); // nada enviado — nunca 'sent' falso
    expect(state.composeText).toBe(''); // rascunho limpo pra não poluir o próximo
  });
});
