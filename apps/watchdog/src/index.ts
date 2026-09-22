import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { loadDotEnv, loadConfig } from '@luna/shared';
import { createLogger } from '@luna/logging';
import { getPool, closePool, readHeartbeats, writeHeartbeat, checkConnection } from '@luna/database';
import { createAdapter } from '@luna/agent';
import { sendTeamMessage, type TelegramConfig } from '@luna/channels';
import { evaluateServices, overallState, type ServiceCheck } from './checks.js';
import { runSelfTest } from './selftest.js';

/**
 * Watchdog GERAL (v3.1 §20) — supervisor independente sobre orchestrator,
 * whatsplay, worker, Chrome e DB. Falha → restart automático (spawn detached
 * do pnpm) → persiste → Telegram vivo com contexto. Roda sob pm2 (ressobe).
 */

loadDotEnv();
const config = loadConfig();
const log = createLogger({ name: 'luna-watchdog' });

const ROOT = 'C:/Users/Abner/Documents/Luna cto/luna-agent';
const CHECK_INTERVAL_MS = 20_000;
const SELFTEST_INTERVAL_MS = 6 * 60 * 60_000; // 6h (§20: todo dia; 6h é mais útil em dev)
const RESTART_COOLDOWN_MS = 120_000;

const telegram: TelegramConfig = {
  botToken: config.TELEGRAM_BOT_TOKEN,
  teamChatId: config.TELEGRAM_TEAM_CHAT_ID ?? config.TELEGRAM_CHAT_ID,
};

const lastRestart = new Map<string, number>();
const restartCounts = new Map<string, number>();

async function checkOrchestratorHealth(): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const res = await fetch(`http://${config.HOST}:${config.PORT}/health`, {
      signal: AbortSignal.timeout(4_000),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function restartService(name: string, filter: string): void {
  const now = Date.now();
  const last = lastRestart.get(name) ?? 0;
  if (now - last < RESTART_COOLDOWN_MS) {
    log.warn({ service: name }, 'restart em cooldown — pulando');
    return;
  }
  const count = (restartCounts.get(name) ?? 0) + 1;
  restartCounts.set(name, count);
  lastRestart.set(name, now);
  log.error({ service: name, count }, 'watchdog: reiniciando serviço');
  const out = appendFileSync.bind(appendFileSync);
  const child = spawn('cmd.exe', ['/c', `pnpm --filter ${filter} start`], {
    cwd: ROOT,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d) => out(`${ROOT}/logs-${name}.out.log`, d));
  child.stderr?.on('data', (d) => out(`${ROOT}/logs-${name}.err.log`, d));
  child.unref();
}

async function alertTelegram(text: string): Promise<void> {
  if (!telegram.botToken || !telegram.teamChatId) {
    log.error('watchdog: TELEGRAM não configurado — alerta NÃO enviado (falha explícita registrada)');
    return;
  }
  try {
    await sendTeamMessage(text, telegram);
  } catch (err) {
    log.error({ err }, 'watchdog: alerta Telegram falhou');
  }
}

async function cycle(pool: Awaited<ReturnType<typeof getPool>>, adapter: ReturnType<typeof createAdapter>): Promise<void> {
  const [orch, hbRows, dbOk] = await Promise.all([
    checkOrchestratorHealth(),
    readHeartbeats(pool).catch(() => [] as Awaited<ReturnType<typeof readHeartbeats>>),
    checkConnection(pool),
  ]);

  const age = (name: string): number | null => {
    const row = hbRows.find((r) => r.service === name);
    if (!row) return null;
    return Math.round((Date.now() - new Date(row.seen_at).getTime()) / 1000);
  };
  const wpMeta = hbRows.find((r) => r.service === 'whatsplay')?.meta as { pageAlive?: boolean } | undefined;

  const checks = evaluateServices({
    orchestrator: orch,
    heartbeats: {
      orchestrator: age('orchestrator'),
      whatsplay: age('whatsplay'),
      worker: age('worker'),
      __whatsplayPageAlive: wpMeta?.pageAlive,
    },
    dbOk,
  });

  const overall = overallState(checks);
  log.info({ overall, checks: checks.map((c: ServiceCheck) => `${c.name}=${c.state}`) }, 'watchdog: ciclo');

  // Restart automático dos que caíram e são restartáveis (§20). Com pm2
  // gerenciando os daemons, o restart é do pm2 — o watchdog só alerta
  // (dois supervisores reiniciando = processos duplicados; decisão F1.5).
  const pm2Managed = process.env.LUNA_PM2_MANAGED === '1';
  for (const c of checks) {
    if ((c.state === 'DOWN') && c.restartable) {
      const count = restartCounts.get(c.name) ?? 0;
      if (count >= 3) {
        await alertTelegram(
          `🚨 WATCHDOG: ${c.name} caiu de novo (3 detecções sem recuperação). Estado ${c.state}: ${c.detail}. Estou segurando o resto.`,
        );
        restartCounts.set(c.name, count + 1); // alerta 1x por exaustão
        continue;
      }
      if (!pm2Managed) restartService(c.name, c.name === 'orchestrator' ? 'orchestrator' : c.name);
      await alertTelegram(
        `⚠️ WATCHDOG: ${c.name} caiu (${c.detail}) — ${pm2Managed ? 'pm2 reiniciando' : 'reiniciei'}. Próxima checagem em ${CHECK_INTERVAL_MS / 1000}s.`,
      );
    }
  }

  await writeHeartbeat(pool, 'watchdog', process.pid, { overall }).catch(() => {});
}

async function main(): Promise<void> {
  log.info('watchdog geral starting (§20)');
  const pool = getPool(config.DATABASE_URL);
  if (!(await checkConnection(pool))) {
    log.fatal('postgres unreachable at boot');
    process.exit(1);
  }
  const adapter = createAdapter({
    mode: 'kimi-api',
    apiKey: config.LLM_API_KEY,
    apiBaseUrl: config.LLM_BASE_URL,
    apiModel: config.LLM_MODEL,
  });

  // Self-test ao boot (§20) + agendado.
  const selfTest = async () => {
    try {
      const hb = await readHeartbeats(pool);
      const wp = hb.find((r) => r.service === 'whatsplay');
      await runSelfTest({
        pool,
        adapter,
        log,
        telegram,
        whatsplayState: (wp?.meta as { state?: string } | undefined)?.state ?? 'UNKNOWN',
        chromeAlive: (wp?.meta as { pageAlive?: boolean } | undefined)?.pageAlive,
      });
    } catch (err) {
      log.error({ err }, 'self-test falhou');
    }
  };
  await selfTest();
  const stTimer = setInterval(selfTest, SELFTEST_INTERVAL_MS);
  stTimer.unref();

  // Backup diário do Postgres (§30): roda o script validado; falha = log
  // explícito (nunca silêncio) + alerta no próximo self-test.
  const { execFile } = await import('node:child_process');
  const backup = () => {
    execFile('bash', ['scripts/backup-db.sh'], { cwd: ROOT, timeout: 300_000, env: { ...process.env, MSYS_NO_PATHCONV: '1' } }, (err, stdout) => {
      if (err) log.error({ err }, 'backup: FALHOU (falha explícita registrada)');
      else log.info({ out: stdout.trim().split('\n').pop() }, 'backup: ok (§30)');
    });
  };
  backup();
  const backupTimer = setInterval(backup, 24 * 60 * 60_000);
  backupTimer.unref();

  await cycle(pool, adapter);
  const timer = setInterval(() => {
    cycle(pool, adapter).catch((err) => log.error({ err }, 'ciclo do watchdog falhou'));
  }, CHECK_INTERVAL_MS);
  timer.unref();

  const shutdown = (signal: string) => {
    log.info({ signal }, 'shutting down');
    clearInterval(timer);
    clearInterval(stTimer);
    clearInterval(backupTimer);
    closePool()
      .catch(() => {})
      .finally(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  log.fatal({ err }, 'watchdog failed to start');
  process.exit(1);
});
