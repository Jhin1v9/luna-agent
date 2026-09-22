import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { runHeal, assertOwnComponent, MAX_REPAIR_ATTEMPTS, type ExecFn } from './heal.js';

const log = pino({ level: 'silent' });

/** Pool stub: heartbeats (LKG) + writes no-op. */
function stubPool(lkg?: string) {
  return {
    async query(sql: string, params?: unknown[]) {
      if (sql.includes('SELECT meta FROM service_heartbeats')) {
        return { rowCount: 1, rows: [{ meta: { lkg } }] };
      }
      return { rowCount: 1, rows: [] };
    },
  } as never;
}

function execOk(over: Record<string, (args: string[]) => { code: number; stdout: string }> = {}): { exec: ExecFn; calls: string[] } {
  const calls: string[] = [];
  const exec: ExecFn = async (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    const key = args.join(' ');
    for (const [match, fn] of Object.entries(over)) {
      if (key.includes(match)) return fn(args);
    }
    if (cmd === 'git' && args[1] === 'rev-parse') return { code: 0, stdout: 'abc1234\n' };
    return { code: 0, stdout: '' };
  };
  return { exec, calls };
}

function makeDeps(exec: ExecFn, health: (s: string) => Promise<boolean>) {
  return {
    pool: stubPool('deadbeef'),
    log,
    exec,
    restartService: async () => {},
    healthCheck: health,
  };
}

describe('auto-evolução (§16, ADR-013) — pipeline com LKG e rollback', () => {
  it('fluxo feliz: fix aplica, testes verdes, commit, restart, health ok → healed + LKG', async () => {
    const { exec, calls } = execOk();
    let fixApplied = false;
    const restarted: string[] = [];
    const r = await runHeal(
      {
        ...makeDeps(exec, async () => true),
        restartService: async (s) => {
          restarted.push(s);
        },
        pool: (() => {
          const writes: Array<{ meta: Record<string, unknown> }> = [];
          return {
            async query(sql: string, params?: unknown[]) {
              if (sql.includes('SELECT meta')) return { rowCount: 1, rows: [{ meta: { lkg: 'deadbeef' } }] };
              if (sql.includes('INSERT INTO service_heartbeats') || sql.startsWith('INSERT INTO service_heartbeats')) {
                writes.push({ meta: params?.[2] as Record<string, unknown> });
              }
              return { rowCount: 1, rows: [] };
            },
            getWrites: () => writes,
          } as never;
        })(),
      },
      {
        service: 'pingline',
        component: 'apps/pingline/src/index.ts',
        symptom: 'health quebrado',
        root_cause: 'bug plantado',
        learning: 'pipeline validado',
        applyFix: async () => {
          fixApplied = true;
        },
      },
    );
    expect(r.healed).toBe(true);
    expect(r.attempts).toBe(1);
    expect(fixApplied).toBe(true);
    expect(restarted).toEqual(['pingline']);
    expect(calls.some((c) => c.includes('checkout -b luna/fix-'))).toBe(true);
    expect(calls.some((c) => c.includes('merge --ff-only'))).toBe(true);
    expect(calls.some((c) => c.includes('user.name=Luna'))).toBe(true);
  });

  it('rollback: applyFix falha → reset --hard pro LKG; 3 tentativas → exhausted + incident', async () => {
    const { exec, calls } = execOk();
    let attempts = 0;
    const r = await runHeal(makeDeps(exec, async () => true), {
      service: 'worker',
      component: 'apps/worker/src/x.ts',
      symptom: 'quebra',
      root_cause: 'fix ruim',
      learning: 'L',
      applyFix: async () => {
        attempts++;
        throw new Error('fix não aplica');
      },
    });
    expect(r.healed).toBe(false);
    expect(r.attempts).toBe(MAX_REPAIR_ATTEMPTS);
    expect(attempts).toBe(MAX_REPAIR_ATTEMPTS);
    expect(calls.filter((c) => c.includes('reset --hard deadbeef')).length).toBe(MAX_REPAIR_ATTEMPTS);
  });

  it('health falha após restart → rollback e nova tentativa', async () => {
    const { exec } = execOk();
    let restarts = 0;
    const r = await runHeal(
      {
        ...makeDeps(exec, async () => {
          restarts++;
          return restarts >= 2; // 1º restart continua quebrado, 2º ok
        }),
        restartService: async () => {},
      },
      {
        service: 'pingline',
        component: 'apps/pingline/src/index.ts',
        symptom: 'flaky',
        root_cause: 'c',
        learning: 'l',
        applyFix: async () => {},
      },
    );
    expect(r.healed).toBe(true);
    expect(r.attempts).toBe(2);
  });

  it('limites duros: componente de cliente/migration é RECUSADO', () => {
    expect(() => assertOwnComponent('cliente-site', ['x.ts'])).toThrow(/VEDADOS/);
    expect(() => assertOwnComponent('worker', ['packages/database/migrations/009_x.sql'])).toThrow(/append-only/);
    expect(() => assertOwnComponent('whatsplay', ['apps/whatsplay/src/x.ts'])).not.toThrow();
  });
});
