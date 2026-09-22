import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { KimiLiveAdapter } from '@luna/agent';
import { runHeal, type ExecFn, type HealDeps } from './heal.js';

/**
 * Self-heal COM DIAGNÓSTICO (BLOCO 4, ADR-031): serviço próprio DOWN sem plano
 * registrado → o FAST diagnostica (heartbeats + logs + erro) e propõe um
 * patch estruturado (search/replace por arquivo) → aplica dentro do runHeal
 * (gate typecheck+testes, LKG, rollback, máx 3). Sem diagnóstico, NUNCA
 * palpite de código.
 *
 * FLAG: AUTOHEAL_LLM_PATCH=true no .env (OFF por default). Sem flag, recusa
 * explícita. Whitelist de paths: só apps/<serviço>/** e packages/**; migrations
 * e .env proibidos sempre.
 */

export interface DiagnoseDeps {
  pool: Pool;
  log: Logger;
  adapter: KimiLiveAdapter;
  exec: ExecFn;
  restartService: (service: string) => Promise<void>;
  healthCheck: (service: string) => Promise<boolean>;
  telegram?: HealDeps['telegram'];
  enabled: boolean;
  repoRoot?: string;
}

interface ProposedPatch {
  path: string;
  search: string;
  replace: string;
}

const ALLOWED_PREFIX = /^(apps\/(orchestrator|worker|whatsplay|watchdog|pingline)\/|packages\/)/;

function assertPatchAllowed(patch: ProposedPatch): void {
  const p = patch.path.replace(/\\/g, '/');
  if (!ALLOWED_PREFIX.test(p)) throw new Error(`patch fora da whitelist de componentes próprios: ${p}`);
  if (p.includes('migrations') || p.endsWith('.env')) throw new Error(`path proibido (append-only/secret): ${p}`);
  if (!patch.search || patch.search === patch.replace) throw new Error('patch vazio ou sem efeito');
  if (patch.search.length > 4_000 || patch.replace.length > 4_000) throw new Error('patch grande demais');
}

const DIAGNOSIS_PROMPT = (service: string, logs: string, health: string) =>
  [
    'Você é a Luna fazendo AUTO-DIAGNÓSTICO de um componente PRÓPRIO que está fora do ar.',
    `Serviço: ${service}. Regras: só ler, nunca executar nada; projetos de cliente são VEDADOS;`,
    'migrations nunca são editadas. Responda APENAS um JSON:',
    '{"analysis":"...", "root_cause":"...", "learning":"...",',
    '"patches":[{"path":"apps/<svc>/src/arquivo.ts","search":"trecho exato existente","replace":"trecho corrigido"}]}',
    'Se não tiver certeza do fix, retorne patches: [] (honestidade > palpite).',
    '',
    'Logs recentes (stderr/stdout):',
    logs.slice(0, 2500),
    '',
    'Saúde (heartbeats):',
    health.slice(0, 800),
  ].join('\n');

/** Diagnostica e executa o heal com o patch proposto. Só chamado com flag ON. */
export async function diagnoseAndHeal(deps: DiagnoseDeps, service: string): Promise<{ healed: boolean; reason?: string }> {
  if (!deps.enabled) {
    return { healed: false, reason: 'AUTOHEAL_LLM_PATCH desligado (default off, ADR-031) — diagnóstico por IA não executado' };
  }
  const root = deps.repoRoot ?? 'C:/Users/Abner/Documents/Luna cto/luna-agent';
  const logs = (() => {
    try {
      return readFileSync(`${root}/logs-${service}.err.log`, 'utf8').slice(-3_000);
    } catch {
      return '(sem logs)';
    }
  })();
  const health = await deps.pool
    .query(`SELECT service, seen_at, meta FROM service_heartbeats ORDER BY service`)
    .then((r) => r.rows.map((row) => JSON.stringify(row)).join('\n'))
    .catch(() => '(sem heartbeats)');

  const turn = await deps.adapter.sendTurn({
    session_key: `diagnose:${service}`,
    prompt: DIAGNOSIS_PROMPT(service, logs, health),
  });
  let proposal: { analysis?: string; root_cause?: string; learning?: string; patches?: ProposedPatch[] };
  try {
    proposal = JSON.parse(turn.reply_text.match(/\{[\s\S]*\}/)?.[0] ?? turn.reply_text) as typeof proposal;
  } catch {
    return { healed: false, reason: 'diagnóstico: resposta do FAST não foi JSON válido (sem palpite)' };
  }
  const patches = proposal.patches ?? [];
  if (patches.length === 0) {
    deps.log.warn({ service, analysis: proposal.analysis }, 'diagnóstico: FAST não propôs patch (honesto) — sem heal');
    return { healed: false, reason: `diagnóstico sem patch proposto: ${proposal.analysis ?? ''}` };
  }
  for (const p of patches) {
    try {
      assertPatchAllowed(p);
    } catch (err) {
      return { healed: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  deps.log.error({ service, patches: patches.length, analysis: proposal.analysis }, 'diagnóstico: patch proposto pelo FAST — executando dentro do runHeal (gate de testes)');
  const r = await runHeal(
    {
      pool: deps.pool,
      log: deps.log,
      telegram: deps.telegram,
      exec: deps.exec,
      restartService: deps.restartService,
      healthCheck: deps.healthCheck,
    },
    {
      service,
      component: patches.map((p) => p.path).join(', '),
      symptom: `auto-diagnóstico: ${(proposal.analysis ?? 'sem análise').slice(0, 120)}`,
      root_cause: proposal.root_cause ?? 'diagnosticado pelo FAST',
      learning: proposal.learning ?? 'auto-diagnóstico com patch proposto por IA (ADR-031)',
      correlation_id: `corr_diagnose_${service}_${Date.now()}`,
      applyFix: async () => {
        const fs = await import('node:fs');
        for (const p of patches) {
          const full = `${root}/${p.path}`;
          const content = fs.readFileSync(full, 'utf8');
          if (!content.includes(p.search)) {
            throw new Error(`patch não aplica: 'search' não encontrado em ${p.path}`);
          }
          fs.writeFileSync(full, content.replace(p.search, p.replace));
        }
      },
    },
  );
  return { healed: r.healed };
}
