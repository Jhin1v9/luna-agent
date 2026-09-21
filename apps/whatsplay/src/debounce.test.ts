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
      const d = new Debouncer({ flushMs: 4000 });
      const flushed: string[] = [];
      d.push('chat1', 'oi', (c) => flushed.push(c));
      t.advance(1000);
      d.push('chat1', 'eu queria', (c) => flushed.push(c));
      t.advance(1000);
      d.push('chat1', 'saber se o site já ficou pronto', (c) => flushed.push(c));
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
      const d = new Debouncer({ flushMs: 2000 });
      const flushed: string[] = [];
      d.push('a', 'msg A1', (c) => flushed.push(`A:${c}`));
      d.push('b', 'msg B1', (c) => flushed.push(`B:${c}`));
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
      const d = new Debouncer({ flushMs: 3000 });
      const flushed: string[] = [];
      d.push('c', 'primeira', (c) => flushed.push(c));
      t.advance(2900);
      d.push('c', 'segunda', (c) => flushed.push(c));
      t.advance(2900);
      expect(flushed).toEqual([]);
      t.advance(100);
      expect(flushed).toEqual(['primeira segunda']);
    } finally {
      t.restore();
    }
  });
});
