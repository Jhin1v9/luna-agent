import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { autoHealTick, DownStreaks, DOWN_CYCLES_BEFORE_HEAL, HEAL_PLANS, type AutoHealDeps } from './trigger.js';

const log = pino({ level: 'silent' });

const execOk = async () => ({ code: 0, stdout: '' });

function makeDeps(over: Partial<AutoHealDeps> = {}): AutoHealDeps & { healedCalls: string[] } {
  const healedCalls: string[] = [];
  return {
    pool: {
      async query() {
        return { rowCount: 0, rows: [] };
      },
    } as never,
    log,
    exec: execOk as never,
    restartService: async () => {},
    healthCheck: async () => true,
    telegram: {},
    ...over,
    healedCalls,
  };
}

describe('auto-gatilho do heal (ADR-030)', () => {
  it('DOWN por 3 ciclos com plano registrado → dispara runHeal e cura', async () => {
    HEAL_PLANS.pingline = {
      component: 'apps/pingline/src/index.ts',
      symptom: 'health quebrado',
      root_cause: 'r',
      learning: 'l',
      applyFix: async () => {},
    };
    const deps = makeDeps({ healthCheck: async () => true });
    const streaks = new DownStreaks();
    const stale = new Date(Date.now() - 120_000).toISOString();
    deps.pool = {
      async query() {
        return { rowCount: 1, rows: [{ service: 'pingline', pid: 1, meta: {}, seen_at: stale }] };
      },
    } as never;
    // ciclos 1 e 2: ainda não age
    await autoHealTick(deps, streaks);
    const r2 = await autoHealTick(deps, streaks);
    expect(r2.healed).toEqual([]);
    // ciclo 3: heal
    const r3 = await autoHealTick(deps, streaks);
    expect(r3.healed).toEqual(['pingline']);
    delete HEAL_PLANS.pingline;
  });

  it('DOWN sem plano → pendente de diagnóstico (nunca palpite de código)', async () => {
    const deps = makeDeps();
    const streaks = new DownStreaks();
    const stale = new Date(Date.now() - 120_000).toISOString();
    const fresh = new Date().toISOString();
    deps.pool = {
      async query() {
        return { rowCount: 5, rows: [
          { service: 'orchestrator', pid: 1, meta: {}, seen_at: fresh },
          { service: 'worker', pid: 1, meta: {}, seen_at: stale },
          { service: 'whatsplay', pid: 1, meta: {}, seen_at: fresh },
          { service: 'watchdog', pid: 1, meta: {}, seen_at: fresh },
          { service: 'pingline', pid: 1, meta: {}, seen_at: fresh },
        ] };
      },
    } as never;
    await autoHealTick(deps, streaks);
    await autoHealTick(deps, streaks);
    const r3 = await autoHealTick(deps, streaks);
    expect(r3.pending).toEqual(['worker']);
    expect(r3.healed).toEqual([]);
  });

  it('heartbeat fresco zera o streak (não cura em falso positivo)', async () => {
    const deps = makeDeps();
    const streaks = new DownStreaks();
    const fresh = new Date().toISOString();
    const stale = new Date(Date.now() - 120_000).toISOString();
    let rows = [
      { service: 'orchestrator', pid: 1, meta: {}, seen_at: fresh },
      { service: 'worker', pid: 1, meta: {}, seen_at: fresh },
      { service: 'whatsplay', pid: 1, meta: {}, seen_at: fresh },
      { service: 'watchdog', pid: 1, meta: {}, seen_at: fresh },
      { service: 'pingline', pid: 1, meta: {}, seen_at: fresh },
    ];
    deps.pool = {
      async query() {
        return { rowCount: 1, rows };
      },
    } as never;
    await autoHealTick(deps, streaks);
    rows = rows.map((r) => (r.service === 'worker' ? { ...r, seen_at: stale } : r));
    await autoHealTick(deps, streaks); // streak 1
    rows = rows.map((r) => (r.service === 'worker' ? { ...r, seen_at: fresh } : r));
    const r = await autoHealTick(deps, streaks); // zera
    expect(r.pending).toEqual([]);
  });

  it('constante de ciclos é 3', () => {
    expect(DOWN_CYCLES_BEFORE_HEAL).toBe(3);
  });
});
