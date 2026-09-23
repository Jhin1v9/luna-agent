import { describe, expect, it } from 'vitest';
import { WhatsAppWebTransport } from './browser.js';

/**
 * 🆕 CITAÇÃO (mention.respond v2, PLANO-SKILLS): replyToMessage tem que
 * anexar o preview de citação ANTES de digitar — se o preview não anexar,
 * FALHA explícita e NADA é enviado (nunca resposta órfã sem citação).
 */

interface FakeState {
  composeText: string;
  sent: string[];
  msgInPanel: boolean;
  previewAttached: boolean;
  locatorLog: string[];
}

function fakeLocator(state: FakeState, log: (s: string) => void) {
  const self = {
    async count() {
      return 1; // todo seletor "existe" no fake
    },
    last() {
      return self;
    },
    first() {
      return self;
    },
    filter() {
      return self;
    },
    async hover() {
      log('hover');
    },
    async click() {
      log('click');
    },
  };
  return self;
}

function fakePage(state: FakeState) {
  const log = (s: string) => state.locatorLog.push(s);
  const keyboard = {
    async press(key: string) {
      if (key === 'Control+a') return;
      if (key === 'Backspace') {
        if (state.composeText) state.composeText = '';
        return;
      }
      if (key === 'Enter') {
        if (state.composeText.trim()) {
          state.sent.push(state.composeText);
          state.composeText = '';
        }
        return;
      }
      if (key === 'Escape') return;
    },
    async type(text: string) {
      state.composeText += text;
    },
  };
  const page = {
    keyboard,
    isClosed: () => false,
    locator: (sel: string) => fakeLocator(state, log),
    async click() {},
    async reload() {},
    async waitForSelector() {},
    async waitForTimeout() {},
    async screenshot() {},
    async evaluate(script: string) {
      if (script.includes('noscript')) return true; // página saudável
      if (script.includes("el.textContent = ''")) {
        state.composeText = '';
        return undefined;
      }
      // título do painel: ANTES de scrollIntoView (o script do título também
      // rola o header — sem essa ordem o fake devolve boolean pro título)
      if (script.includes('conversation-info-header')) return 'chat-x'; // painel aberto
      if (script.includes('scrollIntoView') && script.includes('msg-container')) return state.msgInPanel;
      if (script.includes("textContent || ''")) return state.composeText.trim().length;
      // verificação do preview de citação anexado
      if (script.includes('reply-preview') || script.includes('quoted')) return state.previewAttached;
      return undefined;
    },
  };
  return { state, page: page as never };
}

function makeTransport(state: FakeState) {
  const { page } = fakePage(state);
  const t = new WhatsAppWebTransport({
    chromePath: '',
    userDataDir: '',
    headless: true,
    evidenceDir: 'C:/Users/Abner/Documents/kimi/tasks/2026-09-23/13-59-43-685a4811/evidence-test',
  } as never);
  (t as never as { page: unknown }).page = page;
  return t;
}

describe('replyToMessage — citação visual (mention.respond v2)', () => {
  it('preview anexa → digita, envia e confirma esvaziamento do campo', async () => {
    const state: FakeState = { composeText: '', sent: [], msgInPanel: true, previewAttached: true, locatorLog: [] };
    const t = makeTransport(state);
    const id = await t.replyToMessage!('chat-x', 'temos uma tarefa nova', 'Superclim, anotado!');
    expect(id).toMatch(/^sent:chat-x:/);
    expect(state.sent).toEqual(['Superclim, anotado!']);
    expect(state.locatorLog).toContain('hover');
    expect(state.locatorLog).toContain('click');
  });

  it('preview NÃO anexa → FALHA explícita e NADA enviado (nunca órfã)', async () => {
    const state: FakeState = { composeText: '', sent: [], msgInPanel: true, previewAttached: false, locatorLog: [] };
    const t = makeTransport(state);
    await expect(t.replyToMessage!('chat-x', 'alguma coisa', 'resposta')).rejects.toThrow(/preview não anexou/);
    expect(state.sent).toEqual([]);
  });

  it('mensagem não achada nem no painel → FALHA explícita, nada enviado', async () => {
    const state: FakeState = { composeText: '', sent: [], msgInPanel: false, previewAttached: true, locatorLog: [] };
    const t = makeTransport(state);
    await expect(t.replyToMessage!('chat-x', 'inexistente', 'resposta')).rejects.toThrow(/NÃO achada/);
    expect(state.sent).toEqual([]);
  });
});
