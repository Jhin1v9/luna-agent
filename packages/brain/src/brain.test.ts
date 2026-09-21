import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendSynapse, appendClientOpinion } from './index.js';

describe('Brain protocol — sinapses e opiniões (append-only, assinado)', () => {
  it('sinapse: commit vira linha estruturada no arquivo mensal, com correlation', () => {
    const root = mkdtempSync(join(tmpdir(), 'brain-'));
    const p1 = appendSynapse({ commit: 'abc1234', summary: 'fix roteamento sweep', correlation_id: 'corr_x', date: '2026-09-21' }, root);
    appendSynapse({ commit: 'def5678', summary: 'send-safety', date: '2026-09-21' }, root);
    const content = readFileSync(p1, 'utf8');
    expect(p1.replace(/\\/g, '/')).toContain('synapses/2026-09.md');
    expect(content).toContain('commit abc1234 · autor: Luna · corr_x — fix roteamento sweep');
    expect(content).toContain('commit def5678 · autor: Luna — send-safety');
  });

  it('opinião de cliente: append em OPINIONES.md com classificação JSON', () => {
    const root = mkdtempSync(join(tmpdir(), 'brain-'));
    const path = appendClientOpinion(
      'jess-onadance',
      { date: '2026-09-21', summary: 'Cliente feliz com o novo hero.', classification: { outcome: 'cliente_feliz', sentiment: 'positivo' } },
      root,
    );
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('## 2026-09-21 — Luna');
    expect(content).toContain('"outcome": "cliente_feliz"');
    // append de segunda opinião NÃO sobrescreve a primeira
    appendClientOpinion('jess-onadance', { date: '2026-09-22', summary: 'Segunda nota.', classification: {} }, root);
    const after = readFileSync(path, 'utf8');
    expect(after).toContain('Cliente feliz com o novo hero.');
    expect(after).toContain('Segunda nota.');
  });
});
