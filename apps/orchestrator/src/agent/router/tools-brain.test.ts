import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBrainTools } from './tools-brain.js';

/**
 * Tools do Brain pra FAST (P4) — root injetado num tmp dir; nada do brain
 * real nos testes.
 */

function makeBrain() {
  const root = mkdtempSync(join(tmpdir(), 'brain-tools-'));
  mkdirSync(join(root, 'luna', 'synapses'), { recursive: true });
  mkdirSync(join(root, 'clients', 'production-2026'), { recursive: true });
  writeFileSync(
    join(root, 'luna', 'synapses', '2026-09.md'),
    ['- 2026-09-22 · aprendi que o Nonoke é o Enoque', '- 2026-09-22 · a Jess pediu slider no hero'].join('\n'),
  );
  writeFileSync(
    join(root, 'clients', 'production-2026', 'OPINIONES.md'),
    ['# OPINIÕES', '- a Jess prefere vídeo vertical', '- o grupo gosta de humor'].join('\n'),
  );
  writeFileSync(join(root, 'clients', 'production-2026', 'FICHA.md'), '# FICHA\nCliente: Production - 2026');
  const db = {
    async query(_sql: string, params?: unknown[]) {
      return { rows: [{ name: 'Production - 2026', code: 'production-2026' }], rowCount: 1, params };
    },
  };
  return { tools: createBrainTools({ brainRoot: root }), db };
}

const CTX = { conversationId: 'c', clientId: 'cli-1' };

describe('brain.search (P4)', () => {
  it('encontra recortes por palavra-chave (case-insensitive) com arquivo + linha', async () => {
    const { tools, db } = makeBrain();
    const r = await tools['brain.search']!(db as never, CTX, { q: 'Nonoke' });
    expect(r.ok).toBe(true);
    const matches = (r.data as { matches: Array<{ text: string; line: number }> }).matches;
    expect(matches.length).toBe(1);
    expect(matches[0]!.text).toContain('Nonoke é o Enoque');
    expect(matches[0]!.line).toBe(1);
  });

  it('respeita o teto de matches e devolve note honesta quando não acha', async () => {
    const { tools, db } = makeBrain();
    const r = await tools['brain.search']!(db as never, CTX, { q: 'zzzz-nada' });
    expect(r.ok).toBe(true);
    expect((r.data as { matches: unknown[] }).matches).toEqual([]);
    const rShort = await tools['brain.search']!(db as never, CTX, { q: 'a' });
    expect(rShort.ok).toBe(false); // mín. 2 chars
  });
});

describe('brain.client_ficha (P4)', () => {
  it('resolve o dir do cliente por nome normalizado e lê FICHA + OPINIONES (tail)', async () => {
    const { tools, db } = makeBrain();
    const r = await tools['brain.client_ficha']!(db as never, CTX, {});
    expect(r.ok).toBe(true);
    const data = r.data as { client: string; ficha: string; opiniones_recentes: string; memory: string | null };
    expect(data.client).toBe('Production - 2026');
    expect(data.ficha).toContain('Cliente: Production - 2026');
    expect(data.opiniones_recentes).toContain('vídeo vertical');
    expect(data.memory).toBeNull(); // arquivo ausente → null explícito
  });

  it('cliente novo sem pasta → note amigável (não erro)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'brain-empty-'));
    mkdirSync(join(root, 'clients'), { recursive: true });
    const tools = createBrainTools({ brainRoot: root });
    const db = { async query() { return { rows: [{ name: 'Novo Cliente', code: null }], rowCount: 1 }; } };
    const r = await tools['brain.client_ficha']!(db as never, CTX, {});
    expect(r.ok).toBe(true);
    expect((r.data as { note: string }).note).toContain('cliente novo');
  });

  it('sem client_id no contexto → falha explícita', async () => {
    const { tools, db } = makeBrain();
    const r = await tools['brain.client_ficha']!(db as never, { conversationId: 'c', clientId: null }, {});
    expect(r.ok).toBe(false);
  });
});
