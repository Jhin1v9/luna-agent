import { createServer } from 'node:http';
import { loadDotEnv, loadConfig } from '@luna/shared';
import { createLogger } from '@luna/logging';
import { getPool, checkConnection, writeHeartbeat, closePool } from '@luna/database';

/**
 * Pingline — componente MÍNIMO e PRÓPRIO pra prova controlada de auto-evolução
 * (§16). Health endpoint que a prova F7 planta bug e o pipeline repara.
 * Zero blast radius: não fala com WhatsApp, não toca cliente.
 */

loadDotEnv();
const config = loadConfig();
const log = createLogger({ name: 'pingline' });
const PORT = 3199;

async function main(): Promise<void> {
  const pool = getPool(config.DATABASE_URL);
  if (!(await checkConnection(pool))) {
    log.fatal('postgres unreachable');
    process.exit(1);
  }
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'broken', service: 'pingline' }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(PORT, r));
  const hb = setInterval(() => {
    writeHeartbeat(pool, 'pingline', process.pid, {}).catch(() => {});
  }, 15_000);
  hb.unref();
  await writeHeartbeat(pool, 'pingline', process.pid, {}).catch(() => {});
  log.info({ port: PORT }, 'pingline up');
  const shutdown = () => {
    clearInterval(hb);
    closePool().finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  log.fatal({ err }, 'pingline failed');
  process.exit(1);
});
