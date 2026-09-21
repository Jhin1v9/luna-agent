import { loadDotEnv, loadConfig } from '@luna/shared';
import { createLogger } from '@luna/logging';
import { getPool, closePool, checkConnection } from '@luna/database';
import { WhatsAppWebTransport } from './browser.js';
import { SELECTORS } from './selectors.js';
import { parseAllowlist } from './allowlist.js';
import { Debouncer } from './debounce.js';
import { createIngest } from './ingest.js';
import { createOutboundListener } from './outbound.js';
import { IngestWatcher } from './watcher.js';
import { Watchdog } from './watchdog.js';
import { sendTeamMessage, TelegramNotConfigured } from './telegram.js';

/**
 * WhatsPlay (§13) — o corpo: Chrome dedicado + Playwright + WhatsApp Web.
 * Entrada por MUTAÇÃO de DOM (zero polling), regras de grupo (§5), debounce
 * (§19), watchdog com estados (§13), fallback Telegram (§15), fila de saída
 * por NOTIFY. O orchestrator nunca vê seletor CSS — só o transport.
 */

loadDotEnv();
const config = loadConfig();
const log = createLogger({ name: 'whatsplay' });

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

  // Fila de saída (respostas da Luna).
  const outbound = createOutboundListener({
    pool,
    transport,
    log,
    humanDelayMs: config.HUMAN_RESPONSE_DELAY_MS,
    // GUARDRAIL DE CÓDIGO (decreto do owner, ADR-020): fora de produção,
    // só a allowlist recebe mensagem. Lista vazia em dev = recusa tudo.
    allowlist: config.WHATSAPP_OUTBOUND_ALLOWLIST.split(',').map((s) => s.trim()),
    enforceAllowlist: config.NODE_ENV !== 'production',
  });
  const listenClient = await outbound.start();

  // Fallback Telegram (§15).
  const telegramConfig = { botToken: config.TELEGRAM_BOT_TOKEN, teamChatId: config.TELEGRAM_TEAM_CHAT_ID };
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
  const watchdogTimer = setInterval(() => watchdog.runOnce().catch(() => {}), 15_000);
  watchdogTimer.unref();
  await watchdog.runOnce();

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down');
    clearInterval(watchdogTimer);
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
