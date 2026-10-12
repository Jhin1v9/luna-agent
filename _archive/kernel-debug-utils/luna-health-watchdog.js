#!/usr/bin/env node
/**
 * Luna + NEXO Health Watchdog
 *
 * Monitors the critical ports every 30s and restarts the corresponding
 * PM2 process if a service becomes unreachable. This is a safety net on
 * top of PM2's built-in autorestart.
 *
 * Monitored services (local stack):
 *   - luna-server      : 3458
 *   - nexo-dashboard   : 3456
 *
 * luna-vite and other dev/optional processes were removed because they were
 * not started by the local stack and were causing the watchdog to spawn failing
 * `pm2 restart` calls every 30s (flashing CMD windows on Windows).
 */

const http = require('http');
const { execSync } = require('child_process');

const SERVICES = [
  { name: 'luna-server', port: parseInt(process.env.LUNA_PORT, 10) || 3458, protocol: 'http' },
  { name: 'nexo-dashboard', port: parseInt(process.env.DASHBOARD_PORT, 10) || 3456, protocol: 'http' },
];

const CHECK_INTERVAL_MS = 30000;
const REQUEST_TIMEOUT_MS = 10000;

function checkService(service) {
  return new Promise((resolve) => {
    const options = {
      hostname: '127.0.0.1',
      port: service.port,
      path: '/',
      method: 'GET',
      timeout: REQUEST_TIMEOUT_MS,
      rejectUnauthorized: true,
    };

    const lib = service.protocol === 'https' ? require('https') : http;
    const req = lib.request(options, (res) => {
      const ok = res.statusCode >= 100 && res.statusCode < 600; // any response means alive
      resolve(ok);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.on('error', () => {
      resolve(false);
    });

    req.end();
  });
}

async function runCheck() {
  const now = new Date().toISOString();
  for (const service of SERVICES) {
    const alive = await checkService(service);
    if (alive) {
      console.log(`[${now}] ✅ ${service.name}:${service.port} is reachable`);
    } else {
      console.error(`[${now}] ❌ ${service.name}:${service.port} is NOT reachable — restarting via PM2`);
      try {
        execSync(`pm2 restart ${service.name}`, {
          stdio: 'pipe',
          windowsHide: true,
        });
      } catch (err) {
        console.error(`[${now}] ⚠️ Failed to restart ${service.name}: ${err.message}`);
      }
    }
  }
}

async function main() {
  console.log(`[${new Date().toISOString()}] Luna/NEXO health watchdog started`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await runCheck();
    await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error('Watchdog crashed:', err);
  process.exit(1);
});
