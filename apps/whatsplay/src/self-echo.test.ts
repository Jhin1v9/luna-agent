import { describe, expect, it } from 'vitest';
import { detectSelfEcho } from './self-echo.js';

/**
 * ECO PRÓPRIO (owner 27/09): relay/citação devolve as falas da Luna como
 * mensagem nova e ela comentava o próprio texto ("veio só com minhas falas
 * de volta kkk") — ruído em loop. A: assinatura "— Luna" + corpo ≈ outbound
 * recente (≥0,7). B: citação pura das palavras dela de volta (≥0,85).
 * Pergunta nova junto do quote → overlap cai → NÃO é eco (menção responde).
 */

const LUNA_MSG = 'Reunião confirmada com o Eduardo amanhã às 15h. Pauta anotada, time!';

describe('detectSelfEcho', () => {
  it('A: relay com assinatura "— Luna" e corpo idêntico → eco', () => {
    const v = detectSelfEcho(`${LUNA_MSG} — Luna`, false, [LUNA_MSG]);
    expect(v.echo).toBe(true);
    expect(v.relaySignature).toBe(true);
    expect(v.overlap).toBeGreaterThanOrEqual(0.7);
  });

  it('B: citação pura das palavras dela (quoted_from_luna, sem texto novo) → eco', () => {
    const v = detectSelfEcho(LUNA_MSG, true, [LUNA_MSG]);
    expect(v.echo).toBe(true);
  });

  it('quote da Luna + pergunta nova → NÃO é eco (responde normal)', () => {
    const v = detectSelfEcho('@luna e o link do dashboard fica onde? anota aí pf', true, [LUNA_MSG]);
    expect(v.echo).toBe(false);
  });

  it('relay com assinatura mas corpo é texto novo (overlap baixo) → NÃO é eco', () => {
    const v = detectSelfEcho('@luna cliente novo chegou, preciso de proposta até sexta — Luna', false, [LUNA_MSG]);
    expect(v.echo).toBe(false);
  });

  it('texto curto demais (<4 tokens) → nunca eco (sem evidência)', () => {
    const v = detectSelfEcho('ok!', true, [LUNA_MSG]);
    expect(v.echo).toBe(false);
  });

  it('eco via transcript "Luna: <falas>" (multi-linha do sweep) → eco', () => {
    const v = detectSelfEcho(`Luna: ${LUNA_MSG}`, true, [LUNA_MSG]);
    expect(v.echo).toBe(true);
  });
});
