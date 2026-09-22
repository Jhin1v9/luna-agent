import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { loadDotEnv, loadConfig } from '@luna/shared';
import { createLogger } from '@luna/logging';
import { getPool } from '@luna/database';
import { runHeal } from './selfheal/heal.js';

/**
 * PROVA CONTROLADA F7 (§16) — auto-diagnóstico → reparo → test → commit →
 * restart → health verde, com evidência. Bug pequeno, reversível, num
 * componente PRÓPRIO (pingline, zero blast radius).
 *
 * Uso: pnpm --filter worker exec tsx src/prova-f7.ts
 */

const execFileP = promisify(execFile);
const log = createLogger({ name: 'prova-f7' });
const ROOT = 'C:/Users/Abner/Documents/Luna cto/luna-agent';
const FILE = `${ROOT}/apps/pingline/src/index.ts`;

loadDotEnv();
const config = loadConfig();
const pool = getPool(config.DATABASE_URL);

const exec: import('./selfheal/heal.js').ExecFn = async (cmd, args) => {
  try {
    const { stdout } = await execFileP(cmd, args, { cwd: ROOT, timeout: 180_000 });
    return { code: 0, stdout };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; message?: string };
    return { code: e.code ?? 1, stdout: `${e.stdout ?? ''}\n${e.message ?? ''}` };
  }
};

async function git(args: string[]): Promise<string> {
  const r = await exec('git', ['-C', ROOT, ...args]);
  if (r.code !== 0) throw new Error(`git ${args.join(' ')}: ${r.stdout.slice(0, 200)}`);
  return r.stdout.trim();
}

async function healthStatus(): Promise<string | null> {
  try {
    const r = await fetch('http://localhost:3199/health', { signal: AbortSignal.timeout(3_000) });
    const body = (await r.json()) as { status?: string };
    return r.ok ? (body.status ?? null) : null;
  } catch {
    return null;
  }
}
async function waitStatus(want: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await healthStatus()) === want) return true;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  return false;
}
const healthPingline = async () => (await healthStatus()) === 'ok';

async function main(): Promise<void> {
  log.info('═══ PROVA F7: plantando bug reversível no pingline ═══');
  const fs = await import('node:fs');
  const current = readFileSync(FILE, 'utf8');
  const currentStatus = (await healthStatus()) ?? 'fora';

  if (current.includes("status: 'broken'") || currentStatus === 'broken') {
    log.info({ currentStatus }, 'bug já plantado em execuções anteriores — seguindo direto pro auto-reparo');
  } else {
    // 1. Planta o bug e COMMITA (simula deploy ruim; heal repara com commit próprio)
    const original = current;
    const broken = original.replace(`{ status: 'ok', service: 'pingline' }`, `{ status: 'broken', service: 'pingline' }`);
    if (broken === original) throw new Error('não consegui plantar o bug (padrão não encontrado)');
    fs.writeFileSync(FILE, broken);
    await git(['add', 'apps/pingline/src/index.ts']);
    await git(['-c', 'user.name=Luna', '-c', 'user.email=luna@nexo-digital.local', 'commit', '-m', 'prova F7: bug plantado (health quebrado) — reversível']);
    log.info('bug plantado e commitado no main');
  }
  const original = current.includes("status: 'ok'") ? current : current.replace(`{ status: 'broken', service: 'pingline' }`, `{ status: 'ok', service: 'pingline' }`);

  // 2. Reinicia o serviço: health deve FALHAR (auto-diagnóstico detecta)
  await exec('cmd.exe', ['/c', 'pm2', 'restart', 'luna-pingline']);
  const broke = await waitStatus('broken', 90_000);
  log.info({ broke }, 'auto-diagnóstico: health pós-bug (com retry)');
  if (!broke) throw new Error('health não quebrou — a prova não faz sentido');

  // 3. Auto-reparo: branch → fix → testes → commit → merge → restart → health
  const result = await runHeal(
    {
      pool,
      log,
      telegram: { botToken: config.TELEGRAM_BOT_TOKEN, teamChatId: config.TELEGRAM_TEAM_CHAT_ID ?? config.TELEGRAM_CHAT_ID },
      exec,
      restartService: async (s) => {
        await exec('cmd.exe', ['/c', 'pm2', 'restart', `luna-${s}`]);
      },
      healthCheck: async (s) => (s === 'pingline' ? waitStatus('ok', 90_000) : false),
    },
    {
      service: 'pingline',
      component: 'apps/pingline/src/index.ts',
      symptom: '/health do pingline retornando status "broken" (bug plantado, prova F7)',
      root_cause: 'regressão proposital na resposta do health endpoint',
      learning: 'pipeline de auto-evolução validado ponta a ponta: detect → fix → test → commit → restart → health → evidência (§16)',
      correlation_id: 'corr_prova_f7',
      applyFix: async () => {
        fs.writeFileSync(FILE, original);
      },
    },
  );

  // 4. Verificação final
  const healedHealth = await healthPingline();
  const head = await git(['log', '--oneline', '-3']);
  log.info({ result, healedHealth }, '═══ RESULTADO DA PROVA F7 ═══');
  console.log('\n' + head);
  if (!result.healed || !healedHealth) {
    console.log('PROVA F7: FALHOU (ver logs)');
    process.exit(1);
  }
  console.log('PROVA F7: PASSOU — detectei, reparei, commitei, reiniciei e o health está verde ✅');
  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  log.fatal({ err }, 'prova F7 falhou');
  process.exit(1);
});
