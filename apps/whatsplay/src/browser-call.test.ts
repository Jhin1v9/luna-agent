import { describe, expect, it } from 'vitest';
import { WhatsAppWebTransport } from './browser.js';

/**
 * REGRESSÃO (decreto owner): o fluxo de chamada ficou "sem consciência" —
 * o agente vagou entre chats e agiu cego. placeVoiceCall/endCall precisam
 * OBSERVAR antes de agir, NÃO sair do chat certo, e falhar explícito.
 */

interface FakeState {
  observations: Array<{ state: string; title: string | null; infoPanelOpen: boolean }>;
  obsIndex: number;
  clicks: string[];
  clickShouldFail: number; // quantos clicks falham no início
  openChatCalls: string[];
}

function makeTransport(state: FakeState) {
  const t = new WhatsAppWebTransport({
    chromePath: '',
    userDataDir: '',
    headless: true,
    evidenceDir: '',
  });
  // observePanel: consome a fila de observações
  (t as any).observePanel = async () => state.observations[state.obsIndex++] ?? state.observations[state.observations.length - 1]!;
  // openChat registrado (nunca navega de verdade nos testes)
  (t as any).openChat = async (contact: string) => {
    state.openChatCalls.push(contact);
    return true;
  };
  const page = {
    isClosed: () => false,
    async waitForTimeout() {},
    locator(sel: string) {
      return {
        first() {
          return {
            async click() {
              state.clicks.push(sel);
              if (state.clickShouldFail > 0) {
                state.clickShouldFail--;
                throw new Error('timeout click');
              }
            },
          };
        },
      };
    },
  };
  (t as any).page = page;
  (t as any).isPageHealthy = async () => true;
  return { t, state };
}

describe('placeVoiceCall consciente (decreto owner)', () => {
  it('JÁ está no chat do contato → NÃO navega (zero openChat) e clica no botão do header', async () => {
    const { t, state } = makeTransport({
      observations: [
        { state: 'chat', title: 'Pai', infoPanelOpen: false },
        { state: 'chamada', title: 'Pai', infoPanelOpen: false },
      ],
      obsIndex: 0,
      clicks: [],
      clickShouldFail: 0,
      openChatCalls: [],
    });
    await (t as any).placeVoiceCall('Pai');
    expect(state.openChatCalls).toEqual([]); // não vagou
    expect(state.clicks.length).toBeGreaterThan(0);
    expect(state.clicks[0]).toContain('#main header'); // botão do header
  });

  it('painel de INFO aberto → usa o botão Llamar DO PAINEL (não sai dele)', async () => {
    const { t, state } = makeTransport({
      observations: [
        { state: 'info-contato', title: 'Pai', infoPanelOpen: true },
        { state: 'chamada', title: 'Pai', infoPanelOpen: false },
      ],
      obsIndex: 0,
      clicks: [],
      clickShouldFail: 0,
      openChatCalls: [],
    });
    await (t as any).placeVoiceCall('Pai');
    expect(state.openChatCalls).toEqual([]);
    expect(state.clicks[0]).toContain('contact_info_panel');
  });

  it('está em OUTRO chat → navega pro contato ANTES de clicar', async () => {
    const { t, state } = makeTransport({
      observations: [
        { state: 'chat', title: 'Meu Amorzinho', infoPanelOpen: false },
        { state: 'chat', title: 'Pai', infoPanelOpen: false },
        { state: 'chamada', title: 'Pai', infoPanelOpen: false },
      ],
      obsIndex: 0,
      clicks: [],
      clickShouldFail: 0,
      openChatCalls: [],
    });
    await (t as any).placeVoiceCall('Pai');
    expect(state.openChatCalls).toEqual(['Pai']);
    expect(state.clicks.length).toBeGreaterThan(0);
  });

  it('painel aberto não bate com o contato → ABORTO explícito (não clica em nada)', async () => {
    const { t, state } = makeTransport({
      observations: [
        { state: 'chat', title: 'Outra pessoa', infoPanelOpen: false },
        { state: 'chat', title: 'Outra pessoa', infoPanelOpen: false }, // openChat "falhou" de ficar errado
      ],
      obsIndex: 0,
      clicks: [],
      clickShouldFail: 0,
      openChatCalls: [],
    });
    await expect((t as any).placeVoiceCall('Pai')).rejects.toThrow(/não bate/);
    expect(state.clicks).toEqual([]); // nunca clicou em ligar
  });

  it('UI de chamada nunca abre → falha explícita', async () => {
    const { t, state } = makeTransport({
      observations: [
        { state: 'chat', title: 'Pai', infoPanelOpen: false },
        { state: 'chat', title: 'Pai', infoPanelOpen: false },
        { state: 'chat', title: 'Pai', infoPanelOpen: false },
        { state: 'chat', title: 'Pai', infoPanelOpen: false },
      ],
      obsIndex: 0,
      clicks: [],
      clickShouldFail: 99, // todos os clicks falham
      openChatCalls: [],
    });
    await expect((t as any).placeVoiceCall('Pai')).rejects.toThrow();
  });
});

describe('endCall consciente', () => {
  it('UI de chamada visível → clica em encerrar e VERIFICA que saiu da chamada', async () => {
    const { t, state } = makeTransport({
      observations: [
        { state: 'chamada', title: 'Pai', infoPanelOpen: false },
        { state: 'chat', title: 'Pai', infoPanelOpen: false },
      ],
      obsIndex: 0,
      clicks: [],
      clickShouldFail: 0,
      openChatCalls: [],
    });
    await (t as any).endCall();
    expect(state.clicks.length).toBe(1);
  });

  it('sem chamada na tela → não age (zero clicks)', async () => {
    const { t, state } = makeTransport({
      observations: [{ state: 'lista', title: null, infoPanelOpen: false }],
      obsIndex: 0,
      clicks: [],
      clickShouldFail: 0,
      openChatCalls: [],
    });
    await (t as any).endCall();
    expect(state.clicks).toEqual([]);
  });

  it('clicou em encerrar mas a chamada continua → falha explícita', async () => {
    const { t } = makeTransport({
      observations: [
        { state: 'chamada', title: 'Pai', infoPanelOpen: false },
        { state: 'chamada', title: 'Pai', infoPanelOpen: false },
      ],
      obsIndex: 0,
      clicks: [],
      clickShouldFail: 0,
      openChatCalls: [],
    });
    await expect((t as any).endCall()).rejects.toThrow(/continua/);
  });
});
