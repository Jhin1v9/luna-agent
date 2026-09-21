import { loadDotEnv, loadConfig } from '@luna/shared';
import { createLogger } from '@luna/logging';
import { getPool, closePool, checkConnection, reapStaleLocks, writeHeartbeat } from '@luna/database';
import { JobRunner } from './jobs/poller.js';

// F1.2 — worker real: polla a tabela `jobs` (FOR UPDATE SKIP LOCKED) e executa
// handlers registrados. Falhas fazem backoff até virarem dead_letter_events.

loadDotEnv();
const config = loadConfig();
const log = createLogger({ name: 'worker' });

let shuttingDown = false;

async function main(): Promise<void> {
  log.info('worker starting');

  const pool = getPool(config.DATABASE_URL);
  const dbOk = await checkConnection(pool);
  if (!dbOk) {
    log.fatal('postgres unreachable at boot');
    process.exit(1);
  }
  log.info('postgres connected');

  const runner = new JobRunner(pool, { workerId: 'worker-1' });

  // Job de smoke/dev: prova o ciclo completo da cola. Handlers reais
  // (dispatch de eventos, notificações) chegam com seus módulos em F1.3+.
  runner.register('ping', async (job, ctx) => {
    log.info({ payload: job.payload }, 'ping job received');
    await ctx.recordActivity({ kind: 'info', summary: 'Worker respondeu um ping.' });
  });

  runner.start();
  log.info('job runner polling (batch=5, interval=1000ms)');

  // Heartbeat pro watchdog geral (§20)
  const hbTimer = setInterval(() => {
    writeHeartbeat(pool, 'worker', process.pid, {}).catch(() => {});
  }, 15_000);
  hbTimer.unref();
  writeHeartbeat(pool, 'worker', process.pid, {}).catch(() => {});

  // Reaper: locks 'running' travados por crash voltam para a fila.
  const reap = async () => {
    try {
      const r = await reapStaleLocks(pool, config.LOCK_REAPER_TIMEOUT_MS);
      if (r.outbox_requeued || r.jobs_requeued) {
        log.warn(r, 'locks travados reenfileirados pelo reaper');
      }
    } catch (err) {
      log.error({ err }, 'reaper falhou');
    }
  };
  await reap();
  const reaperTimer = setInterval(reap, 30_000);
  reaperTimer.unref();
  log.info({ timeout_ms: config.LOCK_REAPER_TIMEOUT_MS }, 'lock reaper armed');

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down');
    runner.stop();
    clearInterval(reaperTimer);
    clearInterval(hbTimer);
    closePool()
      .catch(() => {})
      .finally(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  log.fatal({ err }, 'worker failed to start');
  process.exit(1);
});
