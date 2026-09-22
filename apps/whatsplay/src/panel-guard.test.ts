import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { PanelGuard, PanelStuckError } from './panel-guard.js';

const log = pino({ level: 'silent' });
const warns: string[] = [];

function makeGuard(state: { open: string | null; closeWorks: boolean }, onStuck?: (t: string, c: string) => Promise<void>) {
  warns.length = 0;
  return new PanelGuard({
    peek: async () => state.open,
    close: async () => {
      if (!state.closeWorks) return false;
      state.open = null;
      return true;
    },
    log: {
      warn: (obj: { chat?: string }, msg: string) => {
        warns.push(`${msg} [${obj.chat}]`);
      },
      error: () => {},
      info: () => {},
      debug: () => {},
      fatal: () => {},
      silent: () => true,
      level: 'silent',
    } as never,
    onStuck,
    closeAttempts: 2,
  });
}

describe('PanelGuard — nunca mais de 1 chat aberto (decreto owner)', () => {
  it('painel na lista: ciclo começa limpo, sem fechamento', async () => {
    const g = makeGuard({ open: null, closeWorks: true });
    await g.beginCycle('sweep');
    expect(warns).toEqual([]);
  });

  it('chat aberto fora de ciclo (sobra/relaunch): detectado, WARN exato, fechado antes do trabalho', async () => {
    const state = { open: 'Meu Amorzinho 💖🌻', closeWorks: true };
    const g = makeGuard(state);
    await g.beginCycle('readConversation');
    expect(warns[0]).toContain("encontrado aberto fora de ciclo — fechando");
    expect(warns[0]).toContain('Meu Amorzinho');
    expect(state.open).toBeNull(); // fechou antes do trabalho
  });

  it('dois ciclos seguidos: cada um fecha o seu — nunca sobra aberto', async () => {
    const state: { open: string | null; closeWorks: boolean } = { open: null, closeWorks: true };
    const g = makeGuard(state);
    for (let i = 0; i < 2; i++) {
      await g.beginCycle(`ciclo-${i}`);
      state.open = `chat-${i}`; // simula o trabalho abrindo
      await g.endCycle(`ciclo-${i}`);
    }
    expect(state.open).toBeNull();
    expect(warns).toEqual([]); // nada fora de ciclo
  });

  it('fechamento impossível: onStuck chamado (log/audit/Telegram) + PanelStuckError', async () => {
    const stuck: Array<[string, string]> = [];
    const g = makeGuard({ open: 'chat-travado', closeWorks: false }, async (t, c) => {
      stuck.push([t, c]);
    });
    await expect(g.beginCycle('sendMessage')).rejects.toThrow(PanelStuckError);
    expect(stuck).toEqual([['chat-travado', 'sendMessage']]);
  });

  it('onStuck 1x por chat travado (não spamma alerta)', async () => {
    let calls = 0;
    const g = makeGuard({ open: 'x', closeWorks: false }, async () => {
      calls++;
    });
    await g.beginCycle('a').catch(() => {});
    await g.endCycle('b').catch(() => {});
    expect(calls).toBe(2); // guard é por-instância; 1x por evento de stuck
  });

  it('closeWithRetry: tenta N vezes antes de desistir', async () => {
    let tries = 0;
    const g = new PanelGuard({
      peek: async () => 'y',
      close: async () => {
        tries++;
        return false;
      },
      log: log as never,
      closeAttempts: 3,
    });
    expect(await g.closeWithRetry()).toBe(false);
    expect(tries).toBe(3);
  });

  it('REGRESSÃO (rascunho no chat errado ao vivo): ciclo concorrente ESPERA o ciclo ativo — nunca fecha o painel no meio do trabalho', async () => {
    const state: { open: string | null; closeWorks: boolean } = { open: null, closeWorks: true };
    const g = makeGuard(state);
    const ordem: string[] = [];
    const ciclo1 = (async () => {
      await g.beginCycle('sendMessage');
      state.open = '🏆Production - 2026🙏🏻';
      ordem.push('send:abriu');
      await new Promise((r) => setTimeout(r, 300));
      ordem.push('send:digitou');
      await g.endCycle('sendMessage');
      ordem.push('send:fechou');
    })();
    await new Promise((r) => setTimeout(r, 50));
    const ciclo2 = (async () => {
      await g.beginCycle('sweep');
      ordem.push('sweep:entrou');
      await g.endCycle('sweep');
    })();
    await Promise.all([ciclo1, ciclo2]);
    expect(ordem).toEqual(['send:abriu', 'send:digitou', 'send:fechou', 'sweep:entrou']);
    expect(state.open).toBeNull();
    expect(warns).toEqual([]); // sweep não tratou o painel legítimo como "fora de ciclo"
  });
});
