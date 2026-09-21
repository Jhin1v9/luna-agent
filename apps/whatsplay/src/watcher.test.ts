import { describe, it, expect } from 'vitest';
import { diffBadges, type ChatBadge } from './watcher.js';

const chat = (id: string, unread: number, preview: string): ChatBadge => ({
  chat_id: id,
  chat_name: id,
  unread,
  preview,
  is_group: false,
});

describe('diffBadges — novidade só quando o preview muda (seed anti-disparo)', () => {
  it('mapa vazio (watcher ainda não fez seed): tudo é novidade — por isso o tick SEMPRE arma o baseline antes de difar', () => {
    const prev = new Map<string, string>();
    const curr = [chat('a', 5, 'oi'), chat('b', 168, 'figurinha')];
    expect(diffBadges(prev, curr)).toHaveLength(2);
  });

  it('seed armado + conversa NOVA com badge: DISPARA (mensagem de cliente novo)', () => {
    const prev = new Map([['a', 'oi']]);
    const curr = [chat('a', 5, 'oi'), chat('novo', 1, 'cheguei')];
    expect(diffBadges(prev, curr)).toHaveLength(1);
  });

  it('preview igual ao baseline: silêncio (msg antiga, sem novidade)', () => {
    const prev = new Map([['a', 'oi'], ['b', 'figurinha']]);
    const curr = [chat('a', 5, 'oi'), chat('b', 168, 'figurinha')];
    expect(diffBadges(prev, curr)).toEqual([]);
  });

  it('preview mudou com badge: dispara (mensagem nova)', () => {
    const prev = new Map([['a', 'oi']]);
    const curr = [chat('a', 2, 'oi tudo bem?')];
    expect(diffBadges(prev, curr)).toHaveLength(1);
  });

  it('badge zerou: não dispara mesmo com preview novo', () => {
    const prev = new Map([['a', 'oi']]);
    const curr = [{ ...chat('a', 0, 'oi tudo bem?') }];
    expect(diffBadges(prev, curr)).toEqual([]);
  });

});
