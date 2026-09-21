import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadDotEnv, loadConfig } from '@luna/shared';
import { createLogger } from '@luna/logging';
import { getPool, closePool, checkConnection, recordActivity } from '@luna/database';
import { migrate } from '@luna/database/migrate';
import { EventBus } from './events/bus.js';

loadDotEnv();
const config = loadConfig();
const log = createLogger({ name: 'orchestrator' });

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

  // 3. Event bus (outbox dispatcher — §7.8)
  const bus = new EventBus(pool, { dispatcherId: 'orchestrator' });
  bus.start();
  log.info({ interval_ms: 200 }, 'event bus dispatcher started');
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

  // 5. Graceful shutdown
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down');
    ready = false;
    bus.stop();
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
