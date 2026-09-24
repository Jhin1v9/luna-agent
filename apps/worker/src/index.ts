import { loadDotEnv, loadConfig } from '@luna/shared';
import { createLogger } from '@luna/logging';
import { getPool, closePool, checkConnection, reapStaleLocks, writeHeartbeat, readHeartbeats } from '@luna/database';
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
  // P2 — HANDOFF_LIVE real (ADR-034): investigação com o Cérebro Vivo
  // (kimi CLI headless, ADR-033). Autonomia configurável (LIVE_AUTONOMY).
  // ADR-039 — live brain tem RESERVA: LIVE_BRAIN_PROVIDER=pi troca pra
  // pi-coding-agent (MIT) quando o Kimi CLI está sem quota. Mesma interface
  // estável — quem programa contra `live` não sente a troca.
  const liveTimeoutMs = Math.min(config.INVESTIGATE_TIMEOUT_MS, 600_000);
  const liveAdapter =
    config.LIVE_BRAIN_PROVIDER === 'pi'
      ? new (await import('@luna/agent')).PiAdapter(
          { mode: 'pi' },
          { timeoutMs: liveTimeoutMs, entry: config.PI_ENTRY },
        )
      : config.LIVE_BRAIN_PROVIDER === 'kimiwork'
        ? // ADR-040 — live brain na Luna do Kimi Work: mesmo pool, timeout de
          // parede do live; a resposta vem da varredura/cron do Kimi Work.
          new (await import('@luna/agent')).KimiWorkAdapter(
            { mode: 'kimiwork' },
            { pool, timeoutMs: liveTimeoutMs, pollIntervalMs: config.KIMIWORK_LLM_POLL_MS },
          )
        : new (await import('@luna/agent')).KimiCliAdapter(
            { mode: 'kimi-cli' },
            {
              timeoutMs: liveTimeoutMs,
              autonomy: config.LIVE_AUTONOMY,
            },
          );
  log.info({ live_brain: config.LIVE_BRAIN_PROVIDER }, 'cérebro vivo selecionado (LIVE_BRAIN_PROVIDER)');
  const { createInvestigateHandler } = await import('./jobs/investigate.js');
  // Chamada de voz (decreto owner): o job só publica o evento — quem liga é o daemon do whatsplay.
  const { createVoiceCallHandler } = await import('./jobs/voice-call.js');
  runner.register('voice.call', createVoiceCallHandler({ pool, log }));
  const investigationTelegram = { botToken: config.TELEGRAM_BOT_TOKEN, teamChatId: config.TELEGRAM_TEAM_CHAT_ID ?? config.TELEGRAM_CHAT_ID };
  runner.register('investigate', createInvestigateHandler({ pool, live: liveAdapter, log, telegram: investigationTelegram }));
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
  // Ponte menções → Kimi Work (decreto owner 2026-09-24): só faz sentido com
  // o cérebro Kimi Work drenando o inbox (KIMI_ADAPTER_MODE=kimiwork); em
  // outros modos a Automation não roda e a fila apodreceria — F4 responde
  // tudo como antes. ATENÇÃO: o classifyAdapter do worker é SEMPRE 'kimi-api'
  // (classificação pós-conversa); a porta pro modo é a env, não esse adapter.
  const { createTelegramIngest } = await import('./telegram-ingest.js');
  const kimiWorkMode = config.KIMI_ADAPTER_MODE === 'kimiwork';
  const telegramIngest = kimiWorkMode ? createTelegramIngest({ pool, log }) : undefined;
  if (kimiWorkMode) {
    log.info('ingest telegram: modo kimiwork — menções @luna no grupo do time viram evento kimiwork_inbox');
  }
  const telegramAdmin = createTelegramAdmin({
    pool,
    adapter: classifyAdapter,
    log,
    botToken: config.TELEGRAM_BOT_TOKEN,
    allowedChatId: config.TELEGRAM_CHAT_ID ?? config.TELEGRAM_TEAM_CHAT_ID,
    // P3 (ADR-035): whitelist de admins por user_id + live brain p/ ordens
    allowedUserIds: config.ADMIN_TELEGRAM_IDS.split(',').map((s) => s.trim()).filter(Boolean),
    live: liveAdapter,
    confirmDestructive: config.ADMIN_CONFIRM_DESTRUCTIVE,
    orderTimeoutMs: Math.min(config.INVESTIGATE_TIMEOUT_MS, 300_000),
    buildAdminPack: () => buildAdminFullPack(pool),
    mentionIngest: telegramIngest,
  });
  await telegramAdmin.start();

  // F5 — escalação avançada: SLA timers (CRÍTICA 5min/ALTA 10min), follow-up
  // de degrau e retomada de cascata (ADR-025). Tick direto (manutenção
  // interna, como o reaper), a cada 60s.
  const { runEscalationTick } = await import('./jobs/escalation-tick.js');
  const escalationTelegram = { botToken: config.TELEGRAM_BOT_TOKEN, teamChatId: config.TELEGRAM_TEAM_CHAT_ID ?? config.TELEGRAM_CHAT_ID };
  // Auto-gatilho do heal (ADR-030): DOWN persistente em componente próprio com
  // plano registrado dispara runHeal. exec real: git via execFile, pm2 via cmd.
  const { autoHealTick, DownStreaks } = await import('./selfheal/trigger.js');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileP = promisify(execFile);
  const healExec = async (cmd: string, args: string[]) => {
    try {
      const { stdout } = await execFileP(cmd, args, { cwd: 'C:/Users/Abner/Documents/Luna cto/luna-agent', timeout: 180_000 });
      return { code: 0, stdout };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; message?: string };
      return { code: e.code ?? 1, stdout: `${e.stdout ?? ''}
${e.message ?? ''}` };
    }
  };
  const downStreaks = new DownStreaks();
  const escTick = async () => {
    try {
      await runEscalationTick({ pool, log, telegram: escalationTelegram });
      await autoHealTick(
        {
          pool, log, telegram: escalationTelegram, exec: healExec,
          restartService: async (s) => {
            await healExec('cmd.exe', ['/c', 'pm2', 'restart', `luna-${s}`]);
          },
          healthCheck: async (s) => {
            if (s === 'orchestrator') {
              try {
                const r = await fetch(`http://${config.HOST}:${config.PORT}/health`, { signal: AbortSignal.timeout(3_000) });
                return r.ok;
              } catch { return false; }
            }
            const hb = await readHeartbeats(pool).catch(() => [] as never as Awaited<ReturnType<typeof readHeartbeats>>);
            const row = hb.find((r) => r.service === s);
            return !!row && Date.now() - new Date(row.seen_at).getTime() < 45_000;
          },
        },
        downStreaks,
      );
    } catch (err) {
      log.error({ err }, 'escalation/autoheal tick falhou');
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
