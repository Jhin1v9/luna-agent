import { loadDotEnv, loadConfig } from '@luna/shared';
import { createLogger } from '@luna/logging';
import { getPool, closePool, checkConnection, writeHeartbeat } from '@luna/database';
import { createAdapter } from '@luna/agent';
import { WhatsAppWebTransport } from './browser.js';
import { SELECTORS } from './selectors.js';
import { parseAllowlist } from './allowlist.js';
import { Debouncer } from './debounce.js';
import { createIngest } from './ingest.js';
import { createOutboundListener } from './outbound.js';
import { IngestWatcher } from './watcher.js';
import { Watchdog } from './watchdog.js';
import { sendTeamMessage, TelegramNotConfigured } from '@luna/channels';

/**
 * WhatsPlay (§13) — o corpo: Chrome dedicado + Playwright + WhatsApp Web.
 * Entrada por MUTAÇÃO de DOM (zero polling), regras de grupo (§5), debounce
 * (§19), watchdog com estados (§13), fallback Telegram (§15), fila de saída
 * por NOTIFY. O orchestrator nunca vê seletor CSS — só o transport.
 */

loadDotEnv();
const config = loadConfig();
const log = createLogger({ name: 'whatsplay' });

// Brain do auto-reparo (§14): mesmo provider do orchestrator (LLM_*).
const isGeminiMode = config.KIMI_ADAPTER_MODE === 'gemini';
const llmIsGemini = config.LLM_PROVIDER === 'gemini';
const repairAdapter = createAdapter({
  mode: config.KIMI_ADAPTER_MODE,
  apiKey: isGeminiMode && !llmIsGemini ? config.GEMINI_API_KEY : config.LLM_API_KEY,
  apiBaseUrl: isGeminiMode && !llmIsGemini ? config.GEMINI_BASE_URL : config.LLM_BASE_URL,
  apiModel: isGeminiMode && !llmIsGemini ? config.GEMINI_MODEL : config.LLM_MODEL,
});

const userDataDir =
  config.WHATSAPP_USER_DATA_DIR || 'C:/Users/Abner/.luna/chrome-whatsapp';
const evidenceDir = 'C:/Users/Abner/Documents/Luna cto/luna-agent/.brain/luna/incidents';

let shuttingDown = false;
let lastInboundAt: Date | null = null;

async function main(): Promise<void> {
  log.info('whatsplay starting');

  const pool = getPool(config.DATABASE_URL);
  if (!(await checkConnection(pool))) {
    log.fatal('postgres unreachable at boot');
    process.exit(1);
  }

  const transport = new WhatsAppWebTransport({
    chromePath: config.WHATSAPP_CHROME_PATH,
    userDataDir,
    headless: config.WHATSAPP_HEADLESS,
    evidenceDir,
    outgoingQueueCount: async () => {
      const r = await pool.query(
        `SELECT count(*)::int AS n FROM messages WHERE send_state = 'queued'`,
      );
      return r.rows[0]!.n;
    },
  });

  await transport.launch();

  // Guarda de painel (decreto owner): serialização dura — antes de qualquer
  // ciclo (ler/responder), painel DEVE estar na lista. Sobra de ciclo/
  // relaunch restaurado → fecha com warn. Travado → visibilidade total
  // (log + audit + Telegram) e reinício do serviço (pm2 ressobe; exit 1).
  const { PanelGuard, PanelStuckError } = await import('./panel-guard.js');
  const stuckAlerts = new Set<string>();
  transport.panelGuard = new PanelGuard({
    peek: () => transport.peekOpenChat(),
    close: () => transport.closeCurrentChat(),
    log,
    onStuck: async (chatTitle, context) => {
      const key = chatTitle;
      if (stuckAlerts.has(key)) return; // alerta 1x por chat travado
      stuckAlerts.add(key);
      log.error({ chat: chatTitle, context }, 'watchdog: estado de painel inconsistente — reiniciando whatsplay');
      const { recordAudit } = await import('@luna/database');
      await recordAudit(pool, {
        actor: 'whatsplay', action: 'panel.stuck_restart', tool: 'panel_guard',
        result: 'failed', metadata: { chat: chatTitle, context },
      }).catch(() => {});
      try {
        await sendTeamMessage(
          `🪟 Painel do WhatsPlay travado (chat '${chatTitle}' não fecha) — reiniciando o serviço. Aviso do decreto anti-notificação-perdida.`,
          telegramConfig,
        );
      } catch {
        log.error('panel guard: alerta Telegram falhou (falha explícita registrada)');
      }
      // Reinício do serviço (decreto): pm2 ressobe o processo limpo.
      setTimeout(() => process.exit(1), 1_500);
    },
  });
  void PanelStuckError;

  const initialState = await transport.detectSessionState();
  log.info({ session_state: initialState }, 'sessão WhatsApp detectada');
  if (initialState !== 'LOGGED_IN') {
    log.error('sessão não pareada — rode "pnpm --filter whatsplay login" primeiro. Seguindo em modo watchdog.');
  }

  const ingest = createIngest({ pool, transport, log });

  // Ingress: watcher de badges com baseline (ADR — ver watcher.ts): coleta
  // não-invasiva, seed do que já está não-lido (zero resposta em conversa
  // pessoal parada), abre só a conversa novidade pra extrair o texto real.
  const page = (
    transport as unknown as { requirePage(): import('playwright-core').Page }
  ).requirePage();
  const watcher = new IngestWatcher(
    {
      pool,
      transport,
      log,
      page,
      selectors: SELECTORS,
      debounceMs: config.WHATSAPP_DEBOUNCE_MS,
      // ESCOPO DE INGESTÃO (decreto do owner, ADR-020): só estas conversas
      // gastam tokens. Fora da lista = ignorado sem abrir chat, sem LLM.
      ingestAllowlist: parseAllowlist(config.WHATSAPP_INGEST_ALLOWLIST),
      enforceIngestAllowlist: config.NODE_ENV !== 'production',
    },
    { intervalMs: 4_000 },
  );
  await transport.ensureMainChatList();
  await watcher.tick(); // arma o baseline
  watcher.start();
  log.info('ingest watcher ativo (baseline armado, zero polling de conversas)');

  // Telegram fallback (§15) — configurado antes da fila de saída (auto-reparo alerta por ele).
  const telegramConfig = { botToken: config.TELEGRAM_BOT_TOKEN, teamChatId: config.TELEGRAM_TEAM_CHAT_ID ?? config.TELEGRAM_CHAT_ID };

  // Fila de saída (respostas da Luna).
  const outbound = createOutboundListener({
    pool,
    transport,
    log,
    humanDelayMs: config.HUMAN_RESPONSE_DELAY_MS,
    adapter: repairAdapter, // §14 auto-reparo visual no envio
    telegram: telegramConfig,
    // GUARDRAIL DE CÓDIGO (decreto do owner, ADR-020): fora de produção,
    // só a allowlist recebe mensagem. Lista vazia em dev = recusa tudo.
    allowlist: config.WHATSAPP_OUTBOUND_ALLOWLIST.split(',').map((s) => s.trim()),
    enforceAllowlist: config.NODE_ENV !== 'production',
  });
  const listenClient = await outbound.start();

  const telegram =
    telegramConfig.botToken && telegramConfig.teamChatId
      ? (text: string) => sendTeamMessage(text, telegramConfig)
      : undefined;
  if (!telegram) log.warn('Telegram fallback desligado (sem token/chat id) — §15 exige configurar');

  // Watchdog (§13) com captura de evidência na falha.
  const watchdog = new Watchdog({
    check: async () => {
      const status = await transport.getStatus();
      if (status.state === 'LOGGED_IN') return { status };
      const evidence = await transport.captureEvidence('watchdog');
      return { status, evidence };
    },
    lastInboundAt: () => lastInboundAt,
    telegram,
    log,
  });
  // Watchdog interno (§13) + heartbeat pro watchdog GERAL (§20) + auto-reparo
  // de página morta: Chrome dedicado relança sozinho (evidência E2E F1.5).
  const wdTimer = setInterval(async () => {
    await watchdog.runOnce().catch(() => {});
    const status = await transport.getStatus().catch(() => null);
    await writeHeartbeat(pool, 'whatsplay', process.pid, {
      state: watchdog.getState(),
      pageAlive: status?.pageAlive ?? false,
      session: status?.state ?? 'UNKNOWN',
    }).catch(() => {});
    const st = watchdog.getState();
    if ((st === 'DISCONNECTED' || st === 'FAILED') && status && !status.pageAlive) {
      log.warn('página WhatsApp morta — relançando Chrome dedicado (auto-reparo)');
      await transport.close().catch(() => {});
      await transport.launch().catch((err) => log.error({ err }, 'relaunch do Chrome falhou'));
    }
  }, 15_000);
  wdTimer.unref();
  await watchdog.runOnce();
  await writeHeartbeat(pool, 'whatsplay', process.pid, { state: watchdog.getState() }).catch(() => {});

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down');
    clearInterval(wdTimer);
    watcher.stop();
    listenClient.release();
    transport
      .close()
      .catch(() => {})
      .finally(() => {
        closePool()
          .catch(() => {})
          .finally(() => process.exit(0));
      });
    setTimeout(() => process.exit(1), 8_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  log.info('whatsplay pronto — captura por mutação de DOM ativa (zero polling)');
}

main().catch((err) => {
  if (err instanceof TelegramNotConfigured) {
    log.warn(err.message);
  }
  log.fatal({ err }, 'whatsplay failed to start');
  process.exit(1);
});
