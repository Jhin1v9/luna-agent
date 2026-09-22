import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { readHeartbeats, type HeartbeatRow } from '@luna/database';
import { runHeal, OWN_COMPONENTS, type ExecFn, type HealDeps } from './heal.js';

/**
 * Auto-gatilho do heal (ADR-030): self-test/watchdog detectam degradação → o
 * worker dispara o runHeal automaticamente, com TODAS as proteções existentes
 * (whitelist próprios, gate typecheck+testes, LKG, rollback, máx 3).
 *
 * Hoje o diagnóstico-por-IA ainda não existe (ADR-029): o gatilho só dispara
 * heal para serviços com HEAL PLAN registrado (fix determinístico conhecido).
 * Serviço próprio DOWN sem plan → restart (pm2 já faz) + incidente pro
 * diagnóstico assistido — o heal de código sem plan seria palpite, e palpite
 * proibido é exatamente o que o gate de testes existe pra impedir.
 */

export interface HealPlan {
  component: string;
  symptom: string;
  root_cause: string;
  learning: string;
  applyFix: () => Promise<void>;
}

/** Planos registrados (fix determinístico). Registro = commit + code review. */
export const HEAL_PLANS: Record<string, HealPlan> = {
  // Exemplo real (prova F7): pingline com health quebrado → restaurar o fix.
  // Descomentar quando houver patch real registrado:
  // pingline: { component: 'apps/pingline/src/index.ts', symptom: '...', applyFix: async () => {...} },
};

/** Ciclos DOWN consecutivos antes de agir (evita cura em falso positivo). */
export const DOWN_CYCLES_BEFORE_HEAL = 3;

export interface AutoHealDeps {
  pool: Pool;
  log: Logger;
  exec: ExecFn;
  restartService: (service: string) => Promise<void>;
  healthCheck: (service: string) => Promise<boolean>;
  telegram?: HealDeps['telegram'];
  /** Diagnóstico por IA (ADR-031): adapter + flag, opcionais. */
  diagnoseAdapter?: import('@luna/agent').KimiLiveAdapter;
  llmPatchEnabled?: boolean;
}

/** Estado em memória: ciclos consecutivos DOWN por serviço. */
export class DownStreaks {
  private streaks = new Map<string, number>();
  count(service: string, isDown: boolean): number {
    const next = isDown ? (this.streaks.get(service) ?? 0) + 1 : 0;
    this.streaks.set(service, next);
    return next;
  }
}

function isDown(row: HeartbeatRow | undefined): boolean {
  if (!row) return true; // sem heartbeat = down
  const ageMs = Date.now() - new Date(row.seen_at).getTime();
  return ageMs > 45_000;
}

/** Um ciclo de auto-heal. Chamado pelo worker junto ao escalation tick. */
export async function autoHealTick(deps: AutoHealDeps, streaks: DownStreaks): Promise<{
  healed: string[];
  restarted: string[];
  pending: string[];
}> {
  const result = { healed: [] as string[], restarted: [] as string[], pending: [] as string[] };
  const hb = await readHeartbeats(deps.pool).catch(() => [] as HeartbeatRow[]);

  for (const service of OWN_COMPONENTS) {
    const row = hb.find((r) => r.service === service);
    const streak = streaks.count(service, isDown(row));
    if (streak < DOWN_CYCLES_BEFORE_HEAL) continue;

    const plan = HEAL_PLANS[service];
    if (plan) {
      deps.log.error({ service, streak }, 'auto-heal: serviço próprio DOWN com plano registrado — disparando heal');
      const r = await runHeal(
        {
          pool: deps.pool,
          log: deps.log,
          telegram: deps.telegram,
          exec: deps.exec,
          restartService: deps.restartService,
          healthCheck: deps.healthCheck,
        },
        { service, component: plan.component, symptom: plan.symptom, root_cause: plan.root_cause, learning: plan.learning, applyFix: plan.applyFix, correlation_id: `corr_autoheal_${service}` },
      );
      if (r.healed) {
        result.healed.push(service);
        streaks.count(service, false);
      }
    } else {
      // Sem plano: restart é do pm2/watchdog; aqui só marcamos "pendente de
      // diagnóstico" (incidente já é aberto pelo watchdog/self-test).
      if (streak === DOWN_CYCLES_BEFORE_HEAL) {
        deps.log.error({ service, streak }, 'auto-heal: DOWN sem plano de heal registrado — diagnóstico assistido pendente (ADR-029)');
        result.pending.push(service);
        if (deps.diagnoseAdapter && deps.llmPatchEnabled) {
          const { diagnoseAndHeal } = await import('./diagnose.js');
          const dx = await diagnoseAndHeal(
            {
              pool: deps.pool, log: deps.log, adapter: deps.diagnoseAdapter, exec: deps.exec,
              restartService: deps.restartService, healthCheck: deps.healthCheck,
              telegram: deps.telegram, enabled: true,
            },
            service,
          );
          if (dx.healed) {
            result.healed.push(service);
            result.pending = result.pending.filter((s) => s !== service);
            streaks.count(service, false);
          }
        }
      }
    }
  }
  return result;
}
