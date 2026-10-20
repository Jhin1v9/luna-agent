import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { sendTeamMessage, type TelegramConfig } from '@luna/channels';
import { recordActivity, recordAudit, writeHeartbeat } from '@luna/database';
import { appendIncident, appendSynapse } from '@luna/brain';

/**
 * Auto-evolução (v3.1 §16, ADR-013) — pipeline de auto-reparo com rede de
 * segurança. Ciclo: detectar → (branch luna/fix-*) → aplicar fix → typecheck +
 * testes → commit (autor Luna) → merge pra main → restart do serviço → health
 * check → ok: activity + sinapse + LKG atualizado; FALHA: ROLLBACK automático
 * pro LKG (git reset --hard) → incident + alerta.
 *
 * LIMITES DUROS (§9 guardrails):
 *  - SÓ componentes próprios (whitelist OWN_COMPONENTS — luna-agent e módulos
 *    internos; projetos de cliente seguem VEDADOS, §4).
 *  - Máx 3 tentativas por incidente.
 *  - Nunca toca packages/database/migrations (append-only; destrutiva proibida).
 *  - Diagnóstico/patch por IA entra na fase seguinte (ADR-029); o pipeline já
 *    é real e testado com fix aplicado por função determinística.
 */

export const MAX_REPAIR_ATTEMPTS = 3;

/** Componentes próprios onde o auto-reparo pode atuar. */
export const OWN_COMPONENTS = ['orchestrator', 'worker', 'whatsplay', 'watchdog', 'pingline'] as const;

export type ExecFn = (cmd: string, args: string[]) => Promise<{ code: number; stdout: string }>;

export interface HealDeps {
  pool: Pool;
  log: Logger;
  telegram?: TelegramConfig;
  /** Executador de comandos (git/pnpm) — injetável pra testes. */
  exec: ExecFn;
  /** Restart do serviço (pm2 restart <name>) — injetável. */
  restartService: (service: string) => Promise<void>;
  /** Health check do serviço — true = verde. */
  healthCheck: (service: string) => Promise<boolean>;
  repoRoot?: string;
}

export interface HealInput {
  service: string;
  component: string;
  /** Sintoma detectado (do self-test/watchdog). */
  symptom: string;
  root_cause: string;
  learning: string;
  /** Aplica o fix no worktree (já na branch do fix). Deve editar só arquivos
   *  do componente próprio — fora da whitelist de paths, lança. */
  applyFix: () => Promise<void>;
  correlation_id?: string;
}

class HealBlocked extends Error {}

export function assertOwnComponent(service: string, paths: string[]): void {
  if (!(OWN_COMPONENTS as readonly string[]).includes(service)) {
    throw new HealBlocked(`auto-reparo recusado: '${service}' não é componente próprio (§4 — projetos de cliente VEDADOS)`);
  }
  for (const p of paths) {
    if (p.includes('migrations')) {
      throw new HealBlocked(`auto-reparo recusado: migrations são append-only, nunca editadas (§9)`);
    }
  }
}

export async function runHeal(deps: HealDeps, input: HealInput): Promise<{ healed: boolean; attempts: number; commit?: string }> {
  const { pool, log, exec } = deps;
  // 2026-10-21 (decreto owner): self-heal DESLIGADO por padrao. O rollback
  // git reset --hard destruia trabalho nao commitado do owner (incidentes
  // ao vivo 20-21/10). So roda com HEAL_ENABLED=1 explicito no ambiente.
  if (process.env.HEAL_ENABLED !== '1') {
    log.warn({ service: input.service }, 'selfheal DESLIGADO (decreto owner 21/10 — rollback destrutivo. HEAL_ENABLED=1 pra reativar)');
    return { healed: false, attempts: 0 };
  }
  const root = deps.repoRoot ?? 'C:/Users/Abner/Documents/Luna cto/luna-agent';
  assertOwnComponent(input.service, [input.component]);

  const lkgRow = await pool.query<{ meta: { lkg?: string } }>(
    `SELECT meta FROM service_heartbeats WHERE service = $1`,
    [input.service],
  );
  const lkg = lkgRow.rows[0]?.meta?.lkg ?? 'main';
  const baseCommit = (await exec('git', ['-C', root, 'rev-parse', '--short', 'HEAD'])).stdout.trim();

  let lastBranch = '';
  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    const branch = `luna/fix-${Date.now()}`;
    lastBranch = branch;
    try {
      await exec('git', ['-C', root, 'checkout', '-b', branch]);
      await input.applyFix();
      // typecheck + testes do componente (gate duro: sem verde, não sobe)
      // pnpm é .cmd no Windows: via cmd /c (spawn direto = ENOENT)
      const tc = await exec('cmd.exe', ['/c', 'pnpm', '--filter', input.service === 'pingline' ? '@luna/events' : input.service, 'exec', 'tsc', '--noEmit']);
      if (tc.code !== 0) throw new Error(`typecheck falhou:\n${tc.stdout.slice(0, 400)}`);
      const test = await exec('cmd.exe', ['/c', 'pnpm', '--filter', input.service === 'pingline' ? '@luna/events' : input.service, 'test']);
      if (test.code !== 0) throw new Error(`testes falharam:\n${test.stdout.slice(0, 400)}`);

      await exec('git', ['-C', root, 'add', '-A']);
      await exec('git', ['-C', root, '-c', 'user.name=Luna', '-c', 'user.email=luna@nexo-digital.local', 'commit', '-m',
        `auto-reparo (${input.service}): ${input.symptom.slice(0, 90)} — autor: Luna`]);
      const commit = (await exec('git', ['-C', root, 'rev-parse', '--short', 'HEAD'])).stdout.trim();
      await exec('git', ['-C', root, 'checkout', 'main']);
      await exec('git', ['-C', root, 'merge', '--ff-only', branch]);

      await deps.restartService(input.service);
      const healthy = await deps.healthCheck(input.service);
      if (!healthy) throw new Error('health check falhou após restart');

      // LKG atualizado + evidência (§16: commit + activity + audit + brain).
      await writeHeartbeat(pool, input.service, process.pid, { lkg: commit, healed_at: new Date().toISOString() });
      await recordActivity(pool, {
        kind: 'action',
        summary: `Auto-reparei sozinha (${input.service}): ${input.symptom} — fix commitado (${commit}), testes verdes, health ok.`,
        correlation_id: input.correlation_id ?? null,
      });
      await recordAudit(pool, {
        actor: 'worker', action: 'self_evolution.healed', tool: 'auto_repair',
        correlation_id: input.correlation_id ?? null, result: 'success',
        metadata: { service: input.service, component: input.component, attempts: attempt, commit, base: baseCommit },
      });
      appendIncident({
        component: input.service, root_cause: input.root_cause,
        fix: `${input.symptom} → fix aplicado e commitado`, learning: input.learning, commit,
        correlation_id: input.correlation_id ?? null,
      });
      appendSynapse({ commit, summary: `auto-reparo em ${input.service}: ${input.symptom}`.slice(0, 140), correlation_id: input.correlation_id ?? null });
      log.info({ service: input.service, attempts: attempt, commit }, 'auto-evolução: reparado com evidência (§16)');
      return { healed: true, attempts: attempt, commit };
    } catch (err) {
      log.error({ err, attempt }, 'auto-evolução: tentativa falhou');
      // ROLLBACK pro LKG antes de tentar de novo (rede de segurança).
      await exec('git', ['-C', root, 'checkout', 'main']).catch(() => {});
      await exec('git', ['-C', root, 'reset', '--hard', lkg]).catch(() => {});
      // 2026-10-21 (decreto owner): rollback destrutivo DESATIVADO — nunca
      // mais git reset --hard automatico. So alerta; worktree fica como
      // esta pra revisao humana.
      log.error({ service: input.service, lkg }, 'selfheal: rollback pro LKG NAO executado (decreto owner — revisao humana necessaria)');
      await exec('git', ['-C', root, 'branch', '-D', lastBranch]).catch(() => {});
      if (attempt < MAX_REPAIR_ATTEMPTS) continue;

      // Esgotou: incident + alerta (rollback já deixou o repo no LKG).
      await pool.query(
        `INSERT INTO incidents (severity, source, title, description, status)
         VALUES ('critical', 'auto_repair', $1, $2, 'open')`,
        [`Auto-reparo esgotado (${input.service})`, `Sintoma: ${input.symptom}. 3 tentativas, rollback pro LKG ${lkg}. Causa: ${input.root_cause}`],
      );
      await recordAudit(pool, {
        actor: 'worker', action: 'self_evolution.exhausted', tool: 'auto_repair',
        correlation_id: input.correlation_id ?? null, result: 'failed',
        metadata: { service: input.service, attempts: MAX_REPAIR_ATTEMPTS, lkg },
      });
      appendIncident({
        component: input.service, root_cause: input.root_cause,
        fix: `3 tentativas esgotadas — rollback automático pro LKG ${lkg}`,
        learning: `${input.learning} (auto-reparo esgotado: próximo passo é humano)`,
        correlation_id: input.correlation_id ?? null,
      });
      if (deps.telegram?.botToken && deps.telegram.teamChatId) {
        try {
          await sendTeamMessage(
            `🔧 Auto-reparo esgotado em ${input.service}: ${input.symptom}. Rollback pro LKG ${lkg} feito. Preciso de humano. — Luna`,
            deps.telegram,
          );
        } catch {}
      } else {
        log.error('auto-evolução: TELEGRAM não configurado — alerta NÃO enviado (falha explícita registrada)');
      }
      return { healed: false, attempts: MAX_REPAIR_ATTEMPTS };
    }
  }
  return { healed: false, attempts: MAX_REPAIR_ATTEMPTS };
}
