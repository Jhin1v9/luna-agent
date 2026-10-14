import { loadDotEnv, loadConfig } from '@luna/shared';
import { createLogger } from '@luna/logging';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool, checkConnection, writeHeartbeat } from '@luna/database';
import { createAdapter } from '@luna/agent';
import { WhatsAppWebTransport } from './browser.js';
import { SELECTORS } from './selectors.js';
import { parseAllowlist, matchesAllowlist } from './allowlist.js';
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

// 2026-10-14: caminhos eram absolutos do PC — quebravam na VPS (e exigiam
// manter 2 arquivos). Agora: perfil do Chrome em <home>/.luna (mesma regra
// no PC e na VPS) e evidenceDir relativo ao repo (este arquivo está em
// apps/whatsplay/src/ → repo root = ../../../). Env continua ganhando.
const userDataDir =
  config.WHATSAPP_USER_DATA_DIR || join(homedir(), '.luna/chrome-whatsapp');
const evidenceDir = fileURLToPath(new URL('../../../.brain/luna/incidents', import.meta.url));

let shuttingDown = false;
let lastInboundAt: Date | null = null;

async function main(): Promise<void> {
  log.info('whatsplay starting');

  const pool = getPool(config.DATABASE_URL);
  if (!(await checkConnection(pool))) {
    log.fatal('postgres unreachable at boot');
    process.exit(1);
  }

  // Singleton (2026-09-24): quando DUAS instâncias do daemon rodavam juntas,
  // cada relaunch de uma fechava a aba da outra (ping-pong de abas a cada
  // 15s na tela do operador). Se existe heartbeat VIVO (<45s) de outro pid,
  // aborta. Heartbeat velho ou pid morto não bloqueia o boot.
  const hb = await pool.query(
    `SELECT pid, seen_at FROM service_heartbeats WHERE service = 'whatsplay' ORDER BY seen_at DESC LIMIT 1`,
  );
  if (hb.rows[0] && hb.rows[0].pid !== process.pid) {
    const seenAgoMs = Date.now() - new Date(hb.rows[0].seen_at as string).getTime();
    let outraViva = false;
    if (seenAgoMs < 45_000) {
      try {
        process.kill(hb.rows[0].pid as number, 0);
        outraViva = true;
      } catch {
        outraViva = false;
      }
    }
    if (outraViva) {
      log.fatal({ outraInstancia: hb.rows[0].pid }, 'outra instância do whatsplay está viva — abortando (singleton)');
      process.exit(1);
    }
  }

  const transport = new WhatsAppWebTransport({
    chromePath: config.WHATSAPP_CHROME_PATH,
    userDataDir,
    headless: config.WHATSAPP_HEADLESS,
    evidenceDir,
    log,
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
    {
      intervalMs: 4_000,
      // Decreto owner 2026-09-24: agente não age sozinho em loop — sweep
      // periódico (abre chats allowlisted a cada ~12s) só sob demanda.
      sweepEnabled: config.WHATSAPP_SWEEP_ENABLED === 'true',
      // Decreto owner 03/10/2026: a cada ciclo, não-lidas allowlisted viram
      // ingest (e a Geral dispara em ≤1min) — resposta garantida por badge,
      // não só por diff de preview.
      reconcileMs: config.WHATSAPP_RECONCILE_MS,
    },
  );
  await transport.ensureMainChatList();
  await watcher.tick(); // arma o baseline
  watcher.start();
  log.info('ingest watcher ativo (baseline + reconcile de não-lidas a cada ' + Math.round(config.WHATSAPP_RECONCILE_MS / 1000) + 's)');

  // Health loop da página (diagnóstico ao vivo 2026-09-22): a sessão caía
  // pro fallback noscript/splash intermitentemente e a automação ficava cega
  // (sweep detectava e a ingest falhava em silêncio) até restart. A cada 45s
  // confere; se caiu, reload + re-anexa o observer de mutação.
  const healthTimer = setInterval(() => {
    if (process.env.WHATSAPP_HEALTH_DISABLED === 'true') return; // modo configuração: QR estável pra scan
    transport.isPageHealthy().then((ok) => {
      if (!ok) {
        log.warn('health: página fora do estado saudável — recuperando');
        transport.ensurePageHealthy().then((recovered) => {
          if (recovered) log.info('health: página recuperada (reload + observer re-anexado)');
          else log.error('health: página NÃO recuperou — pm2/watchdog vão ressober o serviço');
        });
      }
    });
  }, 45_000);
  healthTimer.unref();

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

  // Chamadas de voz (decreto owner: a FAST Luna pode fazer ligações):
  // pg_notify('voice_call_requests') → pré-voo + placeVoiceCall + conductora.
  const { createCallExecutor } = await import('./voice/call-executor.js');
  const callExecutor = await createCallExecutor({ pool, transport, log });
  const callListen = await pool.connect();
  await callListen.query("LISTEN voice_call_requests");
  callListen.on('notification', (n) => {
    if (n.payload) callExecutor(n.payload).catch((err) => log.error({ err }, 'voice.call: executor falhou'));
  });
  log.info('ouvindo NOTIFY voice_call_requests (chamadas de voz)');
  // call.respond (arquitetura owner 14/10): a sessão Luna Web (conductor da
  // chamada) responde VIA TOOL → NOTIFY call_responses → o operador (ChatGPT)
  // fala na chamada. Mesmo caminho do "📟 Luna → Operador" que já funciona.
  {
    const { OperatorSession } = await import('./voice/operator-session.js');
    const callRespondOperator = new OperatorSession({ log });
    const callRespondListen = await pool.connect();
    await callRespondListen.query('LISTEN call_responses');
    callRespondListen.on('notification', (n) => {
      const rawPayload: string | undefined = n.payload;
      if (!rawPayload) return;
      void (async () => {
        try {
          const payload = JSON.parse(rawPayload) as { texto?: string; origem?: string };
          const texto = String(payload.texto ?? '').trim();
          if (!texto) return;
          if (!(await callRespondOperator.connect())) {
            log.warn('call.respond: chrome-voice fora do ar — resposta da Luna perdida (explícito)');
            return;
          }
          const tab = await callRespondOperator.ensureChatGptTab();
          if (!tab) {
            log.warn('call.respond: aba do ChatGPT não achada — resposta perdida (explícito)');
            return;
          }
          await callRespondOperator.sendText(tab, `📟 Luna → Operador: ${texto}`);
          log.info({ texto: texto.slice(0, 100), origem: payload.origem }, 'call.respond: resposta da Luna entregue ao operador');
        } catch (err) {
          log.error({ err: String(err).slice(0, 200) }, 'call.respond: entrega falhou (best-effort, não derruba nada)');
        }
      })();
    });
    log.info('ouvindo NOTIFY call_responses (respostas da Luna p/ chamada ativa)');
  }
  // ChatGPT (Operador) SEMPRE aberto (decreto owner 2026-09-25): o chrome-voice
  // sobe headed no boot com a aba do ChatGPT pronta — zero latência de abrir
  // na hora da chamada. Se já estiver no ar (CDP :9340), não faz nada.
  {
    const { spawn } = await import('node:child_process');
    const os = await import('node:os');
    const path = await import('node:path');
    const voiceDir = path.join(os.homedir(), '.luna', 'chrome-voice');
    const cdpCheck = await fetch('http://127.0.0.1:9340/json/version', { signal: AbortSignal.timeout(2500) }).then(() => true).catch(() => false);
    if (!cdpCheck) {
      const chromePath = process.env.WHATSAPP_CHROME_PATH?.trim() || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
      try {
        const chromeVoiceProc = spawn(chromePath, [
          `--remote-debugging-port=9340`,
          `--user-data-dir=${voiceDir}`,
          '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
          '--use-fake-ui-for-media-stream',
          // 2026-10-14: sem o flag de plataforma o Chrome morria no boot do VPS
          // (wayland) e o pré-voo das chamadas esgotava — 9340 nunca subia.
          ...(process.env.WHATSAPP_OZONE_PLATFORM ? [`--ozone-platform=${process.env.WHATSAPP_OZONE_PLATFORM}`] : []),
          '--no-sandbox', '--disable-session-crashed-bubble', '--hide-crash-restore-bubble',
          '--disable-restore-session-state', '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
          '--remote-allow-origins=*',
          'https://chatgpt.com/',
        ], { detached: true, stdio: 'ignore' });
      // 2026-10-14: 'error' assíncrono do spawn (path inexistente) era unhandled
      // e derrubava o processo no boot (353x ENOENT históricos 13/10). Agora loga e segue.
      chromeVoiceProc.on('error', (err) =>
        log.warn({ err: String(err).slice(0, 120) }, 'chrome-voice: spawn falhou (WHATSAPP_CHROME_PATH?) — boot segue, abre sob demanda'),
      );
      chromeVoiceProc.unref();
        log.info('chrome-voice: Operador (ChatGPT) abrindo no boot — aba pronta pra chamadas');
      } catch (err) {
        log.warn({ err: String(err).slice(0, 120) }, 'chrome-voice: falha ao abrir no boot (não bloqueia — abre sob demanda na chamada)');
      }
    } else {
      log.info('chrome-voice: já no ar (CDP :9340) — nada a fazer');
    }
  }

  // PONTE KIMI WORK (decreto owner 2026-09-24) — DUAS pontes:
  // 1) detector de chamada RECEBIDA → kimiwork_inbox (o Kimi Work decide:
  //    atender/recusar/deixar tocar — nunca mais chamada ignorada em silêncio);
  // 2) LISTEN whatsapp_actions → executa ordens do Kimi Work no Chrome
  //    (call.answer / call.decline hoje; texto segue pela fila messages +
  //    pg_notify('luna_outbound'), com send-safety e allowlist).
  //
  // 🆕 FAST PATH (decreto owner 08:16, 2026-09-24): "quando detectar chamada
  // JÁ abre o ChatGPT, JÁ manda o contexto buildado como prompt, JÁ abre a
  // chamada — dá pra fazer em 2 segundos."
  // ATUALIZAÇÃO (decreto owner 09:08, 2026-09-24): "é pra confirmar todas as
  // chamadas, não é pra recusar" — TODO caller é atendido no fast path,
  // allowlist ou não (answerAll). O fluxo inbox de decisão (answer/decline)
  // ficou legado: o whatsapp_actions ainda aceita call.answer/decline, mas
  // nenhum ramo novo enfileira chamada pra decisão. Poll 5s → 2s: a detecção
  // em si era a maior fatia da latência.
  const { insertKimiWorkEvent } = await import('@luna/database');
  const { fastAnswerIncoming } = await import('./voice/incoming-fastpath.js');
  const { createVoiceLiveAdapter } = await import('./voice/call-executor.js');
  const voiceLive = createVoiceLiveAdapter(pool, log);
  const callAllowlist = config.WHATSAPP_OUTBOUND_ALLOWLIST.split(',').map((s) => s.trim());
  let fastpathBusy = false;
  let diagCounter = 0;
  let lastDiagKey = "";
  let lastIncomingRingAt = 0;
  const incomingTimer = setInterval(async () => {
    try {
      const incoming = await transport.detectIncomingCall?.();
      if (!incoming) {
        // Diagnóstico periódico (a cada ~10s): se o matcher exato não casou
        // mas botões de chamada existem, loga os rótulos reais (calibração).
        diagCounter++;
        if (diagCounter % 5 === 0) {
          const diag = await (transport as never as { probeCallPopupDiag?: () => Promise<string[]> }).probeCallPopupDiag?.().catch(() => [] as string[]) ?? [];
          if (diag.length > 0) {
            const key = diag.join('|');
            if (key !== lastDiagKey) {
              lastDiagKey = key;
              log.warn({ botoes: diag }, 'fastpath: botões de chamada EXISTEM mas o matcher exato não casou — CALIBRAR (probeCallPopupDiag)');
            }
          }
        }
        return;
      }
      log.info({ caller: incoming.caller }, 'fastpath: RING DETECTADO no Chrome dedicado');
      const now = Date.now();
      if (now - lastIncomingRingAt < 15_000) return; // não spama a caixa enquanto toca
      lastIncomingRingAt = now;
      // Contexto de quem liga (decreto owner): identidade + última conversa +
      // histórico — o prompt do Operador já nasce com a pessoa contextualizada.
      let contexto: string | null = null;
      try {
        const { buildContactContext, formatContactContextText } = await import('@luna/database');
        const ctx = await buildContactContext(pool, { name: incoming.caller });
        contexto = formatContactContextText(ctx);
      } catch (err) {
        log.warn({ err: String(err).slice(0, 120) }, 'kimiwork inbox: context builder falhou (segue sem contexto)');
      }

      // FAST PATH para TODO caller (decreto owner 09:08: atender todas):
      // atende em ~2s; o evento vai pro inbox já resolvido (done) — o Kimi
      // Work fica ciente sem disparar segunda ação. answerAll pula o gate da
      // allowlist dentro do fastpath.
      {
        await insertKimiWorkEvent(pool, {
          kind: 'call.incoming',
          payload: { caller: incoming.caller, contexto, fastpath: true },
          idempotencyKey: `kimiwork:call:${incoming.caller}:${Math.floor(now / 60_000)}`,
        });
        await pool.query(
          `UPDATE kimiwork_inbox SET status='done', processed_at=now(), result=$1::jsonb
           WHERE idempotency_key=$2 AND status='pending'`,
          [JSON.stringify({ fastpath: 'answered', contexto_chars: contexto?.length ?? 0 }), `kimiwork:call:${incoming.caller}:${Math.floor(now / 60_000)}`],
        ).catch(() => {});
        log.info({ caller: incoming.caller, allowlisted: matchesAllowlist(callAllowlist, incoming.caller) }, 'fastpath: atendendo AGORA (Operador em paralelo)');
        fastAnswerIncoming(
          {
            log,
            live: voiceLive,
            acceptCall: () => transport.acceptCall?.() ?? Promise.resolve(),
            observePanel: () => (transport as never as { observePanel: () => Promise<{ state: string }> }).observePanel(),
            isBusy: () => fastpathBusy,
            markBusy: (b) => { fastpathBusy = b; },
            answerAll: true,
          },
          callAllowlist,
          { caller: incoming.caller, contexto },
        ).catch((err) => log.error({ err: String(err).slice(0, 200) }, 'fastpath: fluxo falhou (explícito)'));
        if (telegramConfig.botToken && telegramConfig.teamChatId) {
          await sendTeamMessage(`📞 Atendi ${incoming.caller} no fast path (~2s: ChatGPT aberto + contexto injetado + conductora na escuta).`, telegramConfig).catch(() => {});
        }
        return;
      }
    } catch (err) {
      log.warn({ err: String(err).slice(0, 140) }, 'kimiwork inbox: detector de chamada falhou (best-effort)');
    }
  }, 2_000);
  const actionListen = await pool.connect();
  await actionListen.query("LISTEN whatsapp_actions");
  actionListen.on('notification', (n) => {
    if (!n.payload) return;
    (async () => {
      const order = JSON.parse(n.payload as string) as { action?: string };
      log.info({ order }, 'whatsapp_actions: ordem do Kimi Work');
      if (order.action === 'call.answer') await transport.acceptCall?.();
      else if (order.action === 'call.decline') await transport.declineCall?.();
      else if (order.action === 'call.end') await (transport as never as { endCall?: () => Promise<void> }).endCall?.();
      else log.warn({ action: order.action }, 'whatsapp_actions: ação desconhecida — ignorada');
    })().catch((err) => log.error({ err }, 'whatsapp_actions: execução falhou'));
  });
  log.info('ouvindo NOTIFY whatsapp_actions (ordens do Kimi Work)');

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
      // keepBrowser=true: NÃO fechar o Chrome — o launch() reconecta e faz a
      // higiene de abas. Fechar aqui era o que piscava a janela do operador.
      await transport.close(true).catch(() => {});
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
    callListen.release();
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
