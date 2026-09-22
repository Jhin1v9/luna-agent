import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadDotEnv, loadConfig } from '@luna/shared';
import { createLogger } from '@luna/logging';
import { getPool, closePool, checkConnection, recordActivity, writeHeartbeat } from '@luna/database';
import { migrate } from '@luna/database/migrate';
import { createAdapter, assertProductionAdapter, probeVisionSupport, FallbackAdapter } from '@luna/agent';
import { EventBus } from './events/bus.js';
import { createMessageHandler } from './agent/handler.js';
import { createSimulateHandler } from './test/simulate.js';
import { createWorkspaceIngress } from './workspace/ingress.js';
import { createNotificationHandler, logChannelCapabilities } from './notifications/engine.js';

loadDotEnv();
const config = loadConfig();
// ADR-016: em produção, boot com adapter mock é recusado — resposta de
// cliente nunca sai do mock.
assertProductionAdapter(config.KIMI_ADAPTER_MODE, config.NODE_ENV);
const log = createLogger({ name: 'orchestrator' });

// Adapter do cérebro vivo (§7.3, ADR-010/015/016/018/019). Nunca expor à internet.
// Contrato Model Router §9: LLM_* no .env decide provider/modelo — trocar
// provider é só trocar o .env. Decreto: modelo mais barato, nunca 2.7/K3.
const isGeminiMode = config.KIMI_ADAPTER_MODE === 'gemini';
const llmIsGemini = config.LLM_PROVIDER === 'gemini';
// Fallback (fechamento): Kimi primária; quota 403/429 cai pro Gemini grátis
// (só com key válida — validação lazy). usage_entries registra provider REAL.
const adapter =
  config.KIMI_ADAPTER_MODE === 'kimi-api'
    ? new FallbackAdapter({
        mode: 'kimi-api',
        apiKey: config.LLM_API_KEY,
        apiBaseUrl: config.LLM_BASE_URL,
        apiModel: config.LLM_MODEL,
        fallbackApiKey: config.GEMINI_API_KEY,
        fallbackBaseUrl: config.GEMINI_BASE_URL,
        fallbackModel: config.GEMINI_MODEL,
      })
    : createAdapter({
        mode: config.KIMI_ADAPTER_MODE,
        webUrl: config.KIMI_WEB_URL,
        webToken: config.KIMI_WEB_TOKEN,
        apiKey: isGeminiMode && !llmIsGemini ? config.GEMINI_API_KEY : config.LLM_API_KEY,
        apiBaseUrl: isGeminiMode && !llmIsGemini ? config.GEMINI_BASE_URL : config.LLM_BASE_URL,
        apiModel: isGeminiMode && !llmIsGemini ? config.GEMINI_MODEL : config.LLM_MODEL,
      });
// Handler de simulação (só montado fora de produção; precisa do pool/bus do main).
let simulateHandler: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | null = null;
let workspaceHandler: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | null = null;

const startedAt = Date.now();
let ready = false;
let shuttingDown = false;

// ─── metrics mínimas (§17/§20) — formato Prometheus texto ───
const metrics = {
  httpRequestsTotal: 0,
  httpRequestsByRoute: new Map<string, number>(),
  uptimeSeconds: () => Math.floor((Date.now() - startedAt) / 1000),
};

function renderMetrics(): string {
  const lines = [
    '# HELP luna_http_requests_total Total de requisições HTTP',
    '# TYPE luna_http_requests_total counter',
    `luna_http_requests_total ${metrics.httpRequestsTotal}`,
    '# HELP luna_http_requests_by_route Requisições por rota',
    '# TYPE luna_http_requests_by_route counter',
  ];
  for (const [route, count] of metrics.httpRequestsByRoute) {
    lines.push(`luna_http_requests_by_route{route="${route}"} ${count}`);
  }
  lines.push(
    '# HELP luna_uptime_seconds Uptime do processo',
    '# TYPE luna_uptime_seconds gauge',
    `luna_uptime_seconds ${metrics.uptimeSeconds()}`,
    '# HELP luna_ready 1 se o serviço está pronto',
    '# TYPE luna_ready gauge',
    `luna_ready ${ready ? 1 : 0}`,
  );
  return lines.join('\n') + '\n';
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const route = (req.url ?? '/').split('?')[0];
  metrics.httpRequestsTotal++;
  metrics.httpRequestsByRoute.set(route, (metrics.httpRequestsByRoute.get(route) ?? 0) + 1);

  const respond = (status: number, body: unknown, contentType = 'application/json') => {
    res.writeHead(status, { 'content-type': contentType });
    res.end(contentType === 'application/json' ? JSON.stringify(body) : String(body));
  };

  try {
    switch (route) {
      case '/health':
        // Liveness: processo vivo. Não depende de nada externo.
        respond(200, { status: 'ok', service: 'orchestrator', uptime_s: metrics.uptimeSeconds() });
        break;

      case '/ready': {
        // Readiness: depende do Postgres.
        const dbOk = await checkConnection();
        if (ready && dbOk) {
          respond(200, { status: 'ready', db: 'up' });
        } else {
          respond(503, { status: 'not_ready', db: dbOk ? 'up' : 'down' });
        }
        break;
      }

      case '/metrics':
        respond(200, renderMetrics(), 'text/plain');
        break;

      case '/v1/events': {
        // Ingress do workspace (F2): autenticado por token de serviço.
        if (!workspaceHandler) {
          respond(503, { error: 'workspace_ingress_disabled' });
          break;
        }
        if (req.method !== 'POST') {
          respond(405, { error: 'method_not_allowed' });
          break;
        }
        await workspaceHandler(req, res);
        break;
      }

      case '/test/simulate-message': {
        // Simulação de ingress de cliente (dev/teste). WhatsPlay real = F1.4.
        if (!simulateHandler) {
          respond(404, { error: 'not_found' });
          break;
        }
        if (req.method !== 'POST') {
          respond(405, { error: 'method_not_allowed' });
          break;
        }
        await simulateHandler(req, res);
        break;
      }

      default:
        respond(404, { error: 'not_found' });
    }
  } catch (err) {
    log.error({ err, route }, 'request handler failed');
    respond(500, { error: 'internal_error' });
  }
}

async function main(): Promise<void> {
  log.info({ node: process.version, env: config.NODE_ENV }, 'orchestrator starting');

  // Contrato §9: validar capability de VISÃO do FAST no boot (auto-reparo §14).
  probeVisionSupport({
    mode: 'kimi-api',
    apiKey: config.LLM_API_KEY,
    apiBaseUrl: config.LLM_BASE_URL,
    apiModel: config.LLM_MODEL,
  })
    .then((r) => log.info({ vision: r.supported, detail: r.detail }, 'capability visão do FAST (probe)'))
    .catch((err) => log.error({ err }, 'probe de visão falhou'));

  // 1. Pool Postgres
  const pool = getPool(config.DATABASE_URL);
  const dbOk = await checkConnection(pool);
  if (!dbOk) {
    log.fatal('postgres unreachable at boot');
    process.exit(1);
  }
  log.info('postgres connected');

  // 2. Migrações
  if (config.RUN_MIGRATIONS_ON_BOOT) {
    const applied = await migrate(config.DATABASE_URL);
    log.info({ count: applied.length }, 'migrations checked/applied');
  }

  // 3. Event bus (outbox dispatcher — §7.8) + handler do cérebro vivo (§7.1 agent/)
  const bus = new EventBus(pool, { dispatcherId: 'orchestrator' });
  const messageHandler = createMessageHandler({
    pool,
    adapter,
    log,
    telegram: { botToken: config.TELEGRAM_BOT_TOKEN, teamChatId: config.TELEGRAM_TEAM_CHAT_ID ?? config.TELEGRAM_CHAT_ID },
  });
  // Tools da VPS Nexo (leitura, catálogo docs/tools/nexo-api-catalog.md) —
  // ligadas "igual um neurônio" no TOOL_CALL do Model Router. Sem
  // credencial: tool falha explicitamente (fail-closed), sem derrubar nada.
  const { registerFastTools } = await import('./agent/router/tools.js');
  const { createNexoTools } = await import('./agent/router/tools-nexo.js');
  registerFastTools(
    createNexoTools({
      baseUrl: config.NEXO_API_BASE_URL,
      username: config.NEXO_API_USERNAME,
      password: config.NEXO_API_PASSWORD,
    }),
  );
  log.info('tools Nexo registradas no FAST (leitura; ações = restritas)');

  bus.on('client.message.received', messageHandler);
  bus.on('whatsapp.message.received', messageHandler);
  bus.start();
  log.info({ interval_ms: 200, adapter: adapter.mode }, 'event bus dispatcher started');

  // Simulação de ingress (só fora de produção)
  if (config.NODE_ENV !== 'production') {
    simulateHandler = createSimulateHandler({ pool, bus, log });
    log.info('POST /test/simulate-message disponível (simulação de cliente)');
  }

  // Workspace ingress (F2) — sempre montado; 503 sem WORKSPACE_SERVICE_TOKEN.
  workspaceHandler = createWorkspaceIngress({
    bus,
    log,
    serviceToken: config.WORKSPACE_SERVICE_TOKEN,
  });

  // Notifications engine (§22) + capability logada no boot.
  bus.on('notification.requested', createNotificationHandler({
    pool,
    log,
    email: { smtpUrl: config.SMTP_URL, from: config.SMTP_FROM },
    push: { publicKey: config.VAPID_PUBLIC_KEY, privateKey: config.VAPID_PRIVATE_KEY, subject: config.VAPID_SUBJECT },
  }));
  logChannelCapabilities(
    log,
    { smtpUrl: config.SMTP_URL, from: config.SMTP_FROM },
    { publicKey: config.VAPID_PUBLIC_KEY, privateKey: config.VAPID_PRIVATE_KEY, subject: config.VAPID_SUBJECT },
  );
  await recordActivity(pool, {
    kind: 'info',
    summary: 'Orchestrator iniciou — event bus, outbox e health endpoints no ar.',
  });

  // 4. HTTP server
  const server: Server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      log.error({ err }, 'unhandled request error');
      if (!res.headersSent) res.writeHead(500).end();
    });
  });

  await new Promise<void>((resolve) => server.listen(config.PORT, config.HOST, resolve));
  ready = true;
  log.info({ host: config.HOST, port: config.PORT }, 'orchestrator ready — /health /ready /metrics up');

  // Heartbeat pro watchdog geral (§20)
  const hbTimer = setInterval(() => {
    writeHeartbeat(pool, 'orchestrator', process.pid, { ready, adapter: adapter.mode }).catch(() => {});
  }, 15_000);
  hbTimer.unref();
  await writeHeartbeat(pool, 'orchestrator', process.pid, { ready, adapter: adapter.mode }).catch(() => {});

  // 5. Graceful shutdown
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down');
    ready = false;
    bus.stop();
    clearInterval(hbTimer);
    server.close(async () => {
      await closePool().catch((err) => log.error({ err }, 'pool close failed'));
      log.info('bye');
      process.exit(0);
    });
    // Força saída se não fechar em 10s
    setTimeout(() => {
      log.error('forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  log.fatal({ err }, 'orchestrator failed to start');
  process.exit(1);
});
