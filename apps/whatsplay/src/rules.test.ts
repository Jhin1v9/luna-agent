import { describe, it, expect } from 'vitest';
import { shouldRespond, extractMention } from './rules.js';

describe('regras de grupo (§5 + decreto owner 2026-09-21)', () => {
  it('privado sempre responde — regra fixa, sem filtro', () => {
    expect(shouldRespond({ is_group: false, text: 'oi', mentioned_luna: false, reply_to_luna: false })).toBe(true);
    expect(shouldRespond({ is_group: false, text: 'qualquer coisa', mentioned_luna: false, reply_to_luna: false })).toBe(true);
  });

  it('grupo: silêncio absoluto sem menção nem reply', () => {
    expect(shouldRespond({ is_group: true, text: 'alguém aí?', mentioned_luna: false, reply_to_luna: false })).toBe(false);
  });

  it('grupo: "@luna" como TEXTO dispara — mesmo sem menção estruturada real', () => {
    expect(shouldRespond({ is_group: true, text: '@luna o site caiu?', mentioned_luna: true, reply_to_luna: false })).toBe(true);
  });

  it('grupo: reply/cita em mensagem da Luna continua valendo', () => {
    expect(shouldRespond({ is_group: true, text: 'e aí?', mentioned_luna: false, reply_to_luna: true })).toBe(true);
  });
});

describe('extractMention — substring "@luna" case-insensitive (decreto)', () => {
  it('dispara: "@luna", "@Luna", "@LUNA", no meio/fim do texto', () => {
    expect(extractMention('@luna oi')).toBe(true);
    expect(extractMention('ei @Luna!')).toBe(true);
    expect(extractMention('OLÁ @LUNA')).toBe(true);
    expect(extractMention('preciso de você, @luna')).toBe(true);
  });

  it('REGRESSÃO: "@luna" sem contato salvo dispara (é só texto, mesmo)', () => {
    expect(extractMention('cadê a @luna??')).toBe(true);
  });

  it('NÃO dispara: "oluna" (sem @)', () => {
    expect(extractMention('oluna chegou')).toBe(false);
  });

  it('NÃO dispara: "@ luna" com espaço (decisão registrada: mantém simples)', () => {
    expect(extractMention('@ luna teste')).toBe(false);
  });

  it('NÃO dispara: "luna:" sem @', () => {
    expect(extractMention('luna: oi')).toBe(false);
  });

  it('substring por decreto: "@lunar" contém "@luna" → dispara (simplicidade > precisão)', () => {
    expect(extractMention('chama a @lunaticos')).toBe(true);
  });
});
