import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createLiveToolRunner, parseToolStep } from './live-tools.js';

const noopLog = { warn: () => undefined };

describe('live-tools (braços do live brain roda)', () => {
  let root: string;
  let runner: ReturnType<typeof createLiveToolRunner>;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'luna-live-tools-'));
    mkdirSync(join(root, 'sub'), { recursive: true });
    writeFileSync(join(root, 'nota.md'), '# Nota\nlinha alvo: trocar isso aqui\nfim\n', 'utf8');
    writeFileSync(join(root, 'sub', 'arq.txt'), 'hello grep-magico world\n', 'utf8');
    runner = createLiveToolRunner({ roots: [root], log: noopLog });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('listTools devolve o catálogo completo com args', async () => {
    const r = await runner.run('listTools', {});
    expect(r.ok).toBe(true);
    const catalog = r.data as Array<{ tool: string }>;
    const names = catalog.map((t) => t.tool);
    for (const expected of ['listTools', 'fs.read', 'fs.write', 'fs.edit', 'fs.list', 'fs.grep', 'shell.run']) {
      expect(names).toContain(expected);
    }
  });

  it('tool desconhecida aponta pro listTools', async () => {
    const r = await runner.run('tool_inventada', {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/listTools/);
  });

  it('fs.read lê arquivo dentro da raiz', async () => {
    const r = await runner.run('fs.read', { path: join(root, 'nota.md') });
    expect(r.ok).toBe(true);
    expect((r.data as { content: string }).content).toContain('linha alvo');
  });

  it('path traversal fora da raiz é recusado', async () => {
    const r = await runner.run('fs.read', { path: '/etc/passwd' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/raízes permitidas/);
  });

  it('fs.write cria arquivo novo (e diretório pai)', async () => {
    const target = join(root, 'novo', 'arquivo.txt');
    const r = await runner.run('fs.write', { path: target, content: 'conteudo novo' });
    expect(r.ok).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('conteudo novo');
  });

  it('fs.edit substitui old_string exato', async () => {
    const r = await runner.run('fs.edit', {
      path: join(root, 'nota.md'),
      old_string: 'trocar isso aqui',
      new_string: 'trocado',
    });
    expect(r.ok).toBe(true);
    expect(readFileSync(join(root, 'nota.md'), 'utf8')).toContain('linha alvo: trocado');
  });

  it('fs.edit com old_string errado falha com instrução clara', async () => {
    const r = await runner.run('fs.edit', { path: join(root, 'nota.md'), old_string: 'não existe', new_string: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/não encontrado/);
  });

  it('fs.list lista entradas com tipo', async () => {
    const r = await runner.run('fs.list', { path: root });
    expect(r.ok).toBe(true);
    const names = (r.data as { entries: Array<{ name: string; type: string }> }).entries.map((e) => e.name);
    expect(names).toContain('nota.md');
    expect(names).toContain('sub');
  });

  it('fs.grep acha ocorrência com arquivo e linha', async () => {
    const r = await runner.run('fs.grep', { pattern: 'grep-magico', path: root });
    expect(r.ok).toBe(true);
    const results = (r.data as { results: Array<{ file: string; line: number }> }).results;
    expect(results.length).toBe(1);
    expect(results[0]!.line).toBe(1);
  });

  it('shell.run executa comando e capta saída', async () => {
    const r = await runner.run('shell.run', { cmd: 'echo oi-live-tools' });
    expect(r.ok).toBe(true);
    expect((r.data as { output: string }).output).toContain('oi-live-tools');
  });

  it('shell.run recusa comando destrutivo', async () => {
    const r = await runner.run('shell.run', { cmd: 'rm -rf /' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/guard/);
  });
});

describe('parseToolStep', () => {
  it('parseia pedido de tool', () => {
    const step = parseToolStep('{"action":"tool","tool":"fs.read","args":{"path":"/x"}}');
    expect(step).toEqual({ action: 'tool', tool: 'fs.read', args: { path: '/x' } });
  });

  it('parseia final', () => {
    const step = parseToolStep('{"action":"final","text":"pronto"}');
    expect(step).toEqual({ action: 'final', text: 'pronto' });
  });

  it('JSON embrulhado em prosa vira final com o cru', () => {
    const step = parseToolStep('resposta sem json');
    expect(step.action).toBe('final');
  });
});
