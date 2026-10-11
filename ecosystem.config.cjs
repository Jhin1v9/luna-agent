// pm2 ecosystem da Luna — 8 processos (coletado via `pm2 describe` em 2026-10-12)
// Uso:  pm2 delete all && pm2 start ecosystem.config.cjs && pm2 save
//       (rode na RAIZ do repo luna-agent)
const path = require('path');
const ROOT = __dirname;

module.exports = {
  apps: [
    // ── painel Next.js :3101 ──
    {
      name: 'painel-luna',
      script: path.join(ROOT, 'apps/painel/node_modules/next/dist/bin/next'),
      args: 'start -p 3101 -H 127.0.0.1',
      cwd: path.join(ROOT, 'apps/painel'),
      autorestart: true,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' },
    },
    // ── apps TS via tsx ──
    {
      name: 'luna-orchestrator',
      script: path.join(ROOT, 'node_modules/tsx/dist/cli.mjs'),
      args: 'src/index.ts',
      cwd: path.join(ROOT, 'apps/orchestrator'),
      autorestart: true,
      max_memory_restart: '512M',
    },
    {
      name: 'luna-worker',
      script: path.join(ROOT, 'node_modules/tsx/dist/cli.mjs'),
      args: 'src/index.ts',
      cwd: path.join(ROOT, 'apps/worker'),
      autorestart: true,
      max_memory_restart: '512M',
    },
    {
      name: 'luna-watchdog',
      script: path.join(ROOT, 'node_modules/tsx/dist/cli.mjs'),
      args: 'src/index.ts',
      cwd: path.join(ROOT, 'apps/watchdog'),
      autorestart: true,
      max_memory_restart: '512M',
    },
    {
      name: 'luna-whatsplay',
      script: path.join(ROOT, 'node_modules/tsx/dist/cli.mjs'),
      args: 'src/index.ts',
      cwd: path.join(ROOT, 'apps/whatsplay'),
      autorestart: true,
      max_memory_restart: '512M',
    },
    // ── kimi web (CLI @moonshot-ai, porta 58629) ──
    {
      name: 'luna-kimiweb',
      script: 'C:\\Users\\Abner\\AppData\\Roaming\\npm\\node_modules\\@moonshot-ai\\kimi-code\\dist\\main.mjs',
      args: 'web --port 58629',
      cwd: ROOT,
      autorestart: true,
      max_memory_restart: '512M',
    },
    // ── Vênus ──
    {
      name: 'venus-varredura',
      script: 'scripts/venus/venus.mjs',
      args: '--varredura',
      cwd: ROOT,
      autorestart: true,
      max_memory_restart: '512M',
    },
    {
      name: 'venus-watchdog',
      script: 'scripts/venus/watchdog.mjs',
      cwd: ROOT,
      autorestart: true,
      max_memory_restart: '256M',
    },
  ],
};
