import { describe, it, expect, vi } from 'vitest';
import { Debouncer } from './debounce.js';

function makeTimers() {
  vi.useFakeTimers();
  return {
    advance: (ms: number) => vi.advanceTimersByTime(ms),
    restore: () => vi.useRealTimers(),
  };
}

describe('debounce por chat (§19)', () => {
  it('mensagens em rajada viram UMA pergunta só', () => {
    const t = makeTimers();
    try {
      const d = new Debouncer<string>({ flushMs: 4000 });
      const flushed: string[] = [];
      d.push('chat1', { text: 'oi', ctx: 'msg-1' }, (c) => flushed.push(c));
      t.advance(1000);
      d.push('chat1', { text: 'eu queria', ctx: 'msg-1' }, (c) => flushed.push(c));
      t.advance(1000);
      d.push('chat1', { text: 'saber se o site já ficou pronto', ctx: 'msg-1' }, (c) => flushed.push(c));
      t.advance(3999);
      expect(flushed).toEqual([]); // ainda no silêncio
      t.advance(1);
      expect(flushed).toEqual(['oi eu queria saber se o site já ficou pronto']);
      expect(d.pendingCount()).toBe(0);
    } finally {
      t.restore();
    }
  });

  it('chats diferentes debuncam independente', () => {
    const t = makeTimers();
    try {
      const d = new Debouncer<string>({ flushMs: 2000 });
      const flushed: string[] = [];
      d.push('a', { text: 'msg A1', ctx: 'a1' }, (c) => flushed.push(`A:${c}`));
      d.push('b', { text: 'msg B1', ctx: 'b1' }, (c) => flushed.push(`B:${c}`));
      expect(d.pendingCount()).toBe(2);
      t.advance(2000);
      expect(flushed).toEqual(['A:msg A1', 'B:msg B1']);
    } finally {
      t.restore();
    }
  });

  it('nova mensagem reseta o timer do chat', () => {
    const t = makeTimers();
    try {
      const d = new Debouncer<string>({ flushMs: 3000 });
      const flushed: string[] = [];
      d.push('c', { text: 'primeira', ctx: 'm1' }, (c) => flushed.push(c));
      t.advance(2900);
      d.push('c', { text: 'segunda', ctx: 'm1' }, (c) => flushed.push(c));
      t.advance(2900);
      expect(flushed).toEqual([]);
      t.advance(100);
      expect(flushed).toEqual(['primeira segunda']);
    } finally {
      t.restore();
    }
  });

  // REGRESSÃO 2026-10-08 — bug ao vivo no Production: duas mensagens DIFERENTES
  // do mesmo chat (owner "Oi Vênus..." + relatório do Enoque) caíram no mesmo
  // buffer; o flush cruzou external_id de uma com o texto da outra e a
  // mensagem do owner sumiu do pipeline (chave queimada → "duplicada" pra
  // sempre). Mensagens com ctx distinto DEVEM virar flushes separados.
  it('ctx diferentes no mesmo chat NUNCA cruzam texto/chave (regressão Production 2026-10-08)', () => {
    const t = makeTimers();
    try {
      const d = new Debouncer<{ id: string; autor: string }>({ flushMs: 2000 });
      const flushes: Array<{ combined: string; ctx: { id: string; autor: string } }> = [];
      const ownerMsg = { id: 'wa:X:owner-oi-venus', autor: 'Abner' };
      const enoqueMsg = { id: 'wa:X:enoque-relatorio', autor: 'Enoque' };
      d.push('chat', { text: 'Abner: Oi Vênus que que vc tá fazendo?', ctx: ownerMsg }, (combined, ctx) => flushes.push({ combined, ctx }));
      t.advance(500);
      d.push('chat', { text: 'Enoque: Ou seja: o SERVIDOR está 100% sano', ctx: enoqueMsg }, (combined, ctx) => flushes.push({ combined, ctx }));
      t.advance(2000);
      expect(flushes).toHaveLength(2);
      expect(flushes[0]).toEqual({ combined: 'Abner: Oi Vênus que que vc tá fazendo?', ctx: ownerMsg });
      expect(flushes[1]).toEqual({ combined: 'Enoque: Ou seja: o SERVIDOR está 100% sano', ctx: enoqueMsg });
    } finally {
      t.restore();
    }
  });
});
