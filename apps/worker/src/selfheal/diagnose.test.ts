import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { diagnoseAndHeal } from './diagnose.js';

const log = pino({ level: 'silent' });
const execOk = async () => ({ code: 0, stdout: 'deadbeef\n' });

function makeRootWithFile(relPath: string, content: string): string {
  const root = mkdtempSync(join(tmpdir(), 'heal-dx-'));
  const full = join(root, relPath.replace(/\//g, '/'));
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
  return root;
}

function adapterReplying(json: object) {
  return {
    mode: 'kimi-api' as const,
    async ensureSession(k: string) {
      return { session_id: `kimi-api:${k}`, busy: false };
    },
    async sendTurn() {
      return { reply_text: JSON.stringify(json), session_id: 'k', duration_ms: 1, model: 'kimi-k2.6' };
    },
    async readMessages() {
      return [];
    },
  };
}

function makeDeps(root: string, adapter: unknown, enabled = true) {
  return {
    pool: { async query() { return { rowCount: 1, rows: [{ service: "pingline", meta: {}, seen_at: new Date().toISOString() }] }; } } as never,
    log,
    adapter: adapter as never,
    exec: execOk as never,
    restartService: async () => {},
    healthCheck: async () => true,
    enabled,
    repoRoot: root,
  };
}

describe('self-heal com diagnóstico (BLOCO 4, ADR-031)', () => {
  it('flag OFF (default): recusa explícita — diagnóstico por IA não executa', async () => {
    const root = makeRootWithFile('apps/pingline/src/index.ts', 'ok');
    const r = await diagnoseAndHeal(makeDeps(root, adapterReplying({ patches: [] }), false), 'pingline');
    expect(r.healed).toBe(false);
    expect(r.reason).toContain('desligado');
  });

  it('FAST propõe patches:[] (sem certeza) → sem heal, sem palpite', async () => {
    const root = makeRootWithFile('apps/pingline/src/index.ts', 'ok');
    const r = await diagnoseAndHeal(makeDeps(root, adapterReplying({ analysis: 'incerto', patches: [] }), true), 'pingline');
    expect(r.healed).toBe(false);
    expect(r.reason).toContain('sem patch');
  });

  it('patch fora da whitelist (path de projeto de cliente) → RECUSADO', async () => {
    const root = makeRootWithFile('apps/pingline/src/index.ts', 'ok');
    const r = await diagnoseAndHeal(
      makeDeps(root, adapterReplying({ patches: [{ path: 'cliente-jess/site.js', search: 'a', replace: 'b' }] }), true),
      'pingline',
    );
    expect(r.healed).toBe(false);
    expect(r.reason).toContain('whitelist');
  });

  it('patch em migration → RECUSADO (append-only intocável)', async () => {
    const root = makeRootWithFile('packages/database/migrations/009_x.sql', 'SELECT 1;');
    const r = await diagnoseAndHeal(
      makeDeps(root, adapterReplying({ patches: [{ path: 'packages/database/migrations/009_x.sql', search: 'SELECT 1;', replace: 'DROP TABLE x;' }] }), true),
      'worker',
    );
    expect(r.healed).toBe(false);
    expect(r.reason).toMatch(/proibido|whitelist/);
  });

  it('patch válido aplica no arquivo (search/replace) e o heal completa', async () => {
    const root = makeRootWithFile('apps/pingline/src/index.ts', `const X = 'quebrado';`);
    // adapter propõe o fix; exec simula git ok; health verde
    const r = await diagnoseAndHeal(
      makeDeps(
        root,
        adapterReplying({
          analysis: 'constante errada',
          root_cause: 'regressão',
          learning: 'L',
          patches: [{ path: 'apps/pingline/src/index.ts', search: `const X = 'quebrado';`, replace: `const X = 'ok';` }],
        }),
        true,
      ),
      'pingline',
    );
    expect(r.healed).toBe(true);
    expect(readFileSync(join(root, 'apps/pingline/src/index.ts'), 'utf8')).toContain(`const X = 'ok';`);
  });
});
