/**
 * Watchdog GERAL (v3.1 §20) — supervisor independente: orchestrator,
 * whatsplay, worker, DB, Chrome. Falha → restart automático (spawn detached)
 * → persiste → Telegram vivo ("gente, X caiu, tô segurando Y"). Estados:
 * HEALTHY / DEGRADED / FAILED. O próprio watchdog roda sob pm2 (ressobe).
 */

export type ServiceState = 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'UNKNOWN' | 'DOWN';

export interface ServiceCheck {
  name: string;
  state: ServiceState;
  detail: string;
  restartable: boolean;
}

export interface CheckInput {
  /** /health do orchestrator. */
  orchestrator: { ok: boolean; status?: number; error?: string };
  /** Heartbeats do banco (service → idade em segundos; ausente/undefined = nunca). */
  heartbeats: {
    orchestrator?: number | null;
    whatsplay?: number | null;
    worker?: number | null;
    /** pageAlive do Chrome, via meta do heartbeat do whatsplay. */
    __whatsplayPageAlive?: boolean;
  };
  /** DB respondeu SELECT 1. */
  dbOk: boolean;
}

const HEARTBEAT_STALE_S = 45;

/** Função pura de decisão — testável sem rede nem processos. */
export function evaluateServices(input: CheckInput): ServiceCheck[] {
  const checks: ServiceCheck[] = [];

  checks.push({
    name: 'db',
    state: input.dbOk ? 'HEALTHY' : 'FAILED',
    detail: input.dbOk ? 'SELECT 1 ok' : 'Postgres não responde',
    restartable: false, // DB fora = nada volta sozinho; só alertar
  });

  checks.push({
    name: 'orchestrator',
    state: input.orchestrator.ok
      ? 'HEALTHY'
      : typeof input.heartbeats.orchestrator === 'number' && input.heartbeats.orchestrator < HEARTBEAT_STALE_S
        ? 'DEGRADED'
        : 'DOWN',
    detail: input.orchestrator.ok
      ? '/health ok'
      : `/health falhou (${input.orchestrator.error ?? `HTTP ${input.orchestrator.status}`})`,
    restartable: true,
  });

  for (const svc of ['whatsplay', 'worker'] as const) {
    const age = input.heartbeats[svc];
    if (age === null || age === undefined) {
      checks.push({ name: svc, state: 'DOWN', detail: 'sem heartbeat', restartable: true });
    } else if (age > HEARTBEAT_STALE_S) {
      checks.push({ name: svc, state: 'DOWN', detail: `heartbeat ${age}s velho`, restartable: true });
    } else {
      const meta = ''; // detalhes extras (pageAlive etc) ficam nos logs
      checks.push({ name: svc, state: 'HEALTHY', detail: `heartbeat ${age}s${meta}`, restartable: true });
    }
  }

  // Chrome dedicado: saúde via heartbeat do whatsplay (pageAlive no meta).
  const wp = input.heartbeats.__whatsplayPageAlive;
  if (wp === undefined) {
    checks.push({ name: 'chrome', state: 'UNKNOWN', detail: 'meta pageAlive ausente', restartable: false });
  } else {
    checks.push({
      name: 'chrome',
      state: wp ? 'HEALTHY' : 'DEGRADED',
      detail: wp ? 'vivo' : 'morto (whatsplay deve relançar)',
      restartable: false, // relanço é do próprio whatsplay (auto-reparo)
    });
  }

  return checks;
}

export function overallState(checks: ServiceCheck[]): ServiceState {
  if (checks.some((c) => c.state === 'FAILED')) return 'FAILED';
  if (checks.some((c) => c.state === 'DOWN' || c.state === 'DEGRADED')) return 'DEGRADED';
  if (checks.some((c) => c.state === 'UNKNOWN')) return 'DEGRADED';
  return 'HEALTHY';
}
