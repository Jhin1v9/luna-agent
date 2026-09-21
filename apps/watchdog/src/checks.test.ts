import { describe, it, expect } from 'vitest';
import { evaluateServices, overallState } from './checks.js';

const base = {
  orchestrator: { ok: true },
  heartbeats: { orchestrator: 5, whatsplay: 5, worker: 5, __whatsplayPageAlive: true },
  dbOk: true,
};

describe('watchdog geral — decisão de estado (§20)', () => {
  it('tudo saudável → HEALTHY', () => {
    const checks = evaluateServices(base);
    expect(overallState(checks)).toBe('HEALTHY');
    expect(checks.map((c) => c.state)).not.toContain('DOWN');
  });

  it('orchestrator /health fora + heartbeat velho → DOWN + restartável', () => {
    const checks = evaluateServices({
      ...base,
      orchestrator: { ok: false, error: 'ECONNREFUSED' },
      heartbeats: { ...base.heartbeats, orchestrator: 300 },
    });
    const orch = checks.find((c) => c.name === 'orchestrator')!;
    expect(orch.state).toBe('DOWN');
    expect(orch.restartable).toBe(true);
    expect(overallState(checks)).toBe('DEGRADED');
  });

  it('whatsplay sem heartbeat → DOWN (watchdog deve restartar)', () => {
    const checks = evaluateServices({
      ...base,
      heartbeats: { ...base.heartbeats, whatsplay: null },
    });
    expect(checks.find((c) => c.name === 'whatsplay')!.state).toBe('DOWN');
    expect(overallState(checks)).toBe('DEGRADED');
  });

  it('DB fora → FAILED (não restartável — só alertar)', () => {
    const checks = evaluateServices({ ...base, dbOk: false });
    const db = checks.find((c) => c.name === 'db')!;
    expect(db.state).toBe('FAILED');
    expect(db.restartable).toBe(false);
    expect(overallState(checks)).toBe('FAILED');
  });

  it('Chrome morto (pageAlive=false) → DEGRADED; whatsplay segue HEALTHY', () => {
    const checks = evaluateServices({
      ...base,
      heartbeats: { ...base.heartbeats, __whatsplayPageAlive: false },
    });
    expect(checks.find((c) => c.name === 'chrome')!.state).toBe('DEGRADED');
    expect(checks.find((c) => c.name === 'whatsplay')!.state).toBe('HEALTHY');
  });

  it('/health fora mas heartbeat fresco → DEGRADED (processo vivo, HTTP ruim)', () => {
    const checks = evaluateServices({
      ...base,
      orchestrator: { ok: false, status: 503 },
    });
    expect(checks.find((c) => c.name === 'orchestrator')!.state).toBe('DEGRADED');
  });
});
