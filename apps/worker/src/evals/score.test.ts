import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { scoreGolden, scoreRun, type Golden } from './score.js';

const fixture = JSON.parse(
  readFileSync('C:/Users/Abner/Documents/Luna cto/luna-agent/tests/evals/golden-conversations.json', 'utf8'),
) as { conversas: Golden[] };

describe('golden conversations no CI (§29) — scoring determinístico, zero token', () => {
  it('resposta REAL da fixture passa no scoring (harness íntegro)', () => {
    for (const g of fixture.conversas) {
      const s = scoreGolden(g, g.respostaReal);
      expect(s.nota).toBeGreaterThanOrEqual(75);
    }
  });

  it('resposta em inglês/estrangeiro falha idioma', () => {
    const g = fixture.conversas[0]!;
    const s = scoreGolden(g, 'Sure thing! Let me check that for you right away.');
    expect(s.falhas).toContain('idioma');
  });

  it('resposta que vaza identificador interno do WhatsApp falha', () => {
    const g = fixture.conversas[0]!;
    const s = scoreGolden(g, 'Beleza! O contato é 34685093192@s.whatsapp.net, viu?');
    expect(s.falhas).toContain('vazou identificador interno');
  });

  it('pergunta de dado + resposta com preço inventado e sem honestidade falha', () => {
    const g: Golden = {
      id: 't', input: { de: 'contato', pergunta: 'quanto custa o site?' },
      respostaReal: 'x', expect: { idioma: 'pt', mencionarAutorPeloNome: false, nuncaInventarDado: true },
    };
    const s = scoreGolden(g, 'Custa €900 e pronto, pode fechar.');
    expect(s.falhas).toContain('pode ter inventado dado');
  });

  it('scoreRun: média e contagem coerentes (mock mode = CI)', () => {
    const replies = fixture.conversas.map((g) => g.respostaReal);
    const run = scoreRun(fixture.conversas, replies);
    expect(run.media).toBeGreaterThanOrEqual(75);
    expect(run.passaram).toBe(run.total);
  });
});
