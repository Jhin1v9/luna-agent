import { describe, it, expect } from 'vitest';
import { parseAllowlist, matchesAllowlist, normalizeName } from './allowlist.js';

describe('allowlist matcher (guardrails outbound/ingest, ADR-020)', () => {
  const LISTA = parseAllowlist('Pai,🏆Production - 2026🙏🏻,Meu Amorzinho 💖🌻');

  it('parse: separa por vírgula e ignora vazios', () => {
    expect(LISTA).toHaveLength(3);
    expect(parseAllowlist('')).toEqual([]);
    expect(parseAllowlist(' Pai , ,x')).toEqual(['Pai', 'x']);
  });

  it('nome com EMOJI casa exato (decreto: namorada no escopo)', () => {
    expect(matchesAllowlist(LISTA, 'Meu Amorzinho 💖🌻')).toBe(true);
  });

  it('REGRESSÃO: título com marcas invisíveis de bidi também casa', () => {
    const comMarcas = '‪Meu Amorzinho 💖🌻‬'; // LRM...RLM como o WhatsApp às vezes manda
    expect(normalizeName(comMarcas)).toBe('Meu Amorzinho 💖🌻');
    expect(matchesAllowlist(LISTA, comMarcas)).toBe(true);
  });

  it('substring NÃO vale: "Pai" não libera "Papai"', () => {
    expect(matchesAllowlist(['Pai'], 'Papai')).toBe(false);
  });

  it('nome diferente não casa, emoji errado não casa', () => {
    expect(matchesAllowlist(LISTA, 'Meu Amorzinho 💖')).toBe(false);
    expect(matchesAllowlist(LISTA, 'meu amorzinho 💖🌻')).toBe(false); // case-sensitive
  });

  it('jid casa por sufixo', () => {
    expect(matchesAllowlist(['5511999990000@g.us'], 'grupo-5511999990000@g.us')).toBe(true);
    expect(matchesAllowlist(['5511999990000@g.us'], '5511999990001@g.us')).toBe(false);
  });
});
