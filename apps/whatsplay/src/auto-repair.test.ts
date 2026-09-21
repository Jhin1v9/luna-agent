import { describe, it, expect } from 'vitest';
import { parseAnalysis } from './auto-repair.js';

describe('parseAnalysis — resposta do FAST no auto-reparo (§14)', () => {
  it('JSON puro com seletor plausível', () => {
    const r = parseAnalysis('{"diagnosis":"campo de texto mudou","suggested_selector":"[data-testid=\\"conversation-compose-box-input\\"]"}');
    expect(r.diagnosis).toContain('campo');
    expect(r.suggested_selector).toContain('data-testid');
  });

  it('JSON embrulhado em prosa', () => {
    const r = parseAnalysis('Acho que o problema é X. {"diagnosis":"overlay cobrindo","suggested_selector":null} Espero ter ajudado!');
    expect(r.diagnosis).toContain('overlay');
    expect(r.suggested_selector).toBeNull();
  });

  it('seletor sem CSS válido vira null (não inventar estratégia)', () => {
    const r = parseAnalysis('{"diagnosis":"tente de novo","suggested_selector":"clica no campo de texto"}');
    expect(r.suggested_selector).toBeNull();
  });

  it('resposta inválida → diagnosis = recorte do texto', () => {
    const r = parseAnalysis('não consegui analisar a imagem');
    expect(r.suggested_selector).toBeNull();
    expect(r.diagnosis).toContain('não consegui');
  });
});
