import { describe, expect, it } from 'vitest';
import { WhatsAppWebTransport } from './browser.js';

/**
 * REGRESSÃO (decreto owner 2026-09-22): busca por número/jid digitava o termo
 * certo mas NÃO clicava no 1º resultado — clique único com catch silencioso,
 * e qualquer falha caía na limpeza ("simplesmente apagou").
 */

interface LocatorConfig {
  visibleAfterMs: number; // quanto tempo até o resultado ficar visível
  clickFailures: number; // quantos clicks jogam erro antes de funcionar
}

function fakePage(cfg: LocatorConfig) {
  const state = {
    waitForCalls: 0,
    clickCalls: 0,
    now: Date.now(),
  };
  const page = {
    async waitForTimeout() {},
    locator() {
      return {
        first() {
          return {
            async waitFor(opts: { timeout: number }) {
              state.waitForCalls++;
              const delay = Math.max(0, cfg.visibleAfterMs);
              const budget = opts.timeout;
              if (delay > budget) throw new Error(`Timeout ${opts.timeout}ms exceeded`);
              cfg.visibleAfterMs = 0; // ficou visível
            },
            async click() {
              state.clickCalls++;
              if (state.clickCalls <= cfg.clickFailures) throw new Error('click falhou');
            },
          };
        },
      };
    },
  };
  return { page: page as never, state };
}

function makeTransport() {
  return new WhatsAppWebTransport({
    chromePath: '',
    userDataDir: '',
    headless: true,
    evidenceDir: '',
  });
}

describe('clickJidSearchResult (1º resultado da busca por número)', () => {
  it('resultado demora 1s p/ aparecer → ainda clica certo na 1ª tentativa', async () => {
    const { page, state } = fakePage({ visibleAfterMs: 1_000, clickFailures: 0 });
    const t = makeTransport();
    const ok = await (t as any).clickJidSearchResult(page, async () => true);
    expect(ok).toBe(true);
    expect(state.clickCalls).toBe(1);
  });

  it('clique falha 1× → retry na 2ª tentativa com espera maior', async () => {
    const { page, state } = fakePage({ visibleAfterMs: 0, clickFailures: 1 });
    const t = makeTransport();
    const ok = await (t as any).clickJidSearchResult(page, async () => true);
    expect(ok).toBe(true);
    expect(state.clickCalls).toBe(2);
  });

  it('painel aberto NÃO bate com o número → nunca aceita; esgota as tentativas e falha explícita', async () => {
    const { page, state } = fakePage({ visibleAfterMs: 0, clickFailures: 0 });
    const t = makeTransport();
    const ok = await (t as any).clickJidSearchResult(page, async () => false);
    expect(ok).toBe(false);
    expect(state.clickCalls).toBe(3); // 3 tentativas, todas verificadas
  });

  it('resultado nunca aparece (timeout em todas) → falha explícita sem click', async () => {
    const { page, state } = fakePage({ visibleAfterMs: 99_000, clickFailures: 0 });
    const t = makeTransport();
    const ok = await (t as any).clickJidSearchResult(page, async () => true);
    expect(ok).toBe(false);
    expect(state.clickCalls).toBe(0); // nunca chegou a clicar
    expect(state.waitForCalls).toBe(3);
  });
});
