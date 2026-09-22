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

  // Classifier pós-conversa (§27): ao RESOLVED, o orchestrator enfileira
  // 'conversation.classify' — o worker classifica com o FAST e alimenta o
  // Brain (OPINIONES do cliente + sinapse + memory_index).
  const { createAdapter } = await import('@luna/agent');
  const { createClassifyHandler } = await import('./jobs/classify.js');
  const classifyAdapter = createAdapter({
    mode: 'kimi-api',
    apiKey: config.LLM_API_KEY,
    apiBaseUrl: config.LLM_BASE_URL,
    apiModel: config.LLM_MODEL,
  });
  runner.register('conversation.classify', createClassifyHandler({ pool, adapter: classifyAdapter, log }));
  const { createSummarizeHandler } = await import('./jobs/summarize.js');
  runner.register('memory.summarize', createSummarizeHandler({ pool, adapter: classifyAdapter, log }));
  // Summaries periódicos: a cada 24h enfileira a rodada (idempotente por dia).
  const { enqueueJob } = await import('@luna/database');
  const day = new Date().toISOString().slice(0, 10);
  await enqueueJob(pool, { job_type: 'memory.summarize', payload: {}, idempotency_key: 'summarize:' + day });
  const summarizeTimer = setInterval(() => {
    const d = new Date().toISOString().slice(0, 10);
    enqueueJob(pool, { job_type: 'memory.summarize', payload: {}, idempotency_key: 'summarize:' + d }).catch(() => {});
  }, 24 * 60 * 60_000);
  summarizeTimer.unref();
  // Estrutura-base do Brain (§11) garantida no boot do worker.
  const { ensureBrainStructure } = await import('@luna/brain');
  ensureBrainStructure();

  // F4 mínimo — chat admin via Telegram (§25): o time pergunta, a Luna
  // responde com dados REAIS (ADMIN_FULL). Sem TELEGRAM_CHAT_ID o loop fica
  // IDLE explícito (fail-closed — nunca responde chat não autorizado).
  const { buildAdminFullPack } = await import('@luna/database');
  const { createTelegramAdmin } = await import('./admin/telegram-admin.js');
  const telegramAdmin = createTelegramAdmin({
    pool,
    adapter: classifyAdapter,
    log,
    botToken: config.TELEGRAM_BOT_TOKEN,
    allowedChatId: config.TELEGRAM_CHAT_ID ?? config.TELEGRAM_TEAM_CHAT_ID,
    buildAdminPack: () => buildAdminFullPack(pool),
  });
  await telegramAdmin.start();

  // F5 — escalação avançada: SLA timers (CRÍTICA 5min/ALTA 10min), follow-up
  // de degrau e retomada de cascata (ADR-025). Tick direto (manutenção
  // interna, como o reaper), a cada 60s.
  const { runEscalationTick } = await import('./jobs/escalation-tick.js');
  const escalationTelegram = { botToken: config.TELEGRAM_BOT_TOKEN, teamChatId: config.TELEGRAM_TEAM_CHAT_ID ?? config.TELEGRAM_CHAT_ID };
  const escTick = async () => {
    try {
      await runEscalationTick({ pool, log, telegram: escalationTelegram });
    } catch (err) {
      log.error({ err }, 'escalation tick falhou');
    }
  };
  await escTick();
  const escTimer = setInterval(escTick, 60_000);
  escTimer.unref();

  // DLQ redrive (§7.7): falhas transientes (quota, provedor fora) voltam pra
  // fila sozinhas quando a causa passa. Não-transientes ficam (precisam de fix).
  const { redriveTransientDeadLetters } = await import('@luna/database');
  const redrive = async () => {
    try {
      const r = await redriveTransientDeadLetters(pool);
      if (r.redriven.length) log.info({ redriven: r.redriven.length }, 'dlq: redrive de falhas transientes');
    } catch (err) {
      log.error({ err }, 'dlq redrive falhou');
    }
  };
  await redrive();
  const redriveTimer = setInterval(redrive, 10 * 60_000);
  redriveTimer.unref();

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
