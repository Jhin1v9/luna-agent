import { describe, it, expect } from 'vitest';
import { shouldRespond, extractMention } from './rules.js';

describe('regras de grupo (§5)', () => {
  it('privado sempre responde — regra fixa, sem filtro', () => {
    expect(shouldRespond({ is_group: false, text: 'oi', mentioned_luna: false, reply_to_luna: false })).toBe(true);
    expect(shouldRespond({ is_group: false, text: 'qualquer coisa', mentioned_luna: false, reply_to_luna: false })).toBe(true);
  });

  it('grupo: silêncio absoluto sem menção nem reply', () => {
    expect(shouldRespond({ is_group: true, text: 'alguém aí?', mentioned_luna: false, reply_to_luna: false })).toBe(false);
  });

  it('grupo: responde se mencionam @luna', () => {
    expect(shouldRespond({ is_group: true, text: '@luna o site caiu?', mentioned_luna: true, reply_to_luna: false })).toBe(true);
  });

  it('grupo: responde se fazem reply em mensagem da Luna', () => {
    expect(shouldRespond({ is_group: true, text: 'e aí?', mentioned_luna: false, reply_to_luna: true })).toBe(true);
  });

  it('menção case-insensitive com word boundary', () => {
    expect(extractMention('ei @Luna!')).toBe(true);
    expect(extractMention('@lunar não conta')).toBe(false);
    expect(extractMention('luna sem arroba não conta')).toBe(false);
  });
});
