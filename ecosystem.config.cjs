/**
 * Ecosystem pm2 (§20 / §31 "Luna inicia automaticamente") — pm2 ressobe
 * qualquer daemon que cair e o watchdog geral supervisiona por cima.
 * Node direto via interpreter (sem cmd/pnpm no meio — shims CMD sumiam com
 * o stdout no Windows) e args como ARRAY (caminho tem espaço: "Luna cto").
 * Subir: `pm2 start ecosystem.config.cjs && pm2 save`.
 * Auto-start no boot: `pm2 startup` (terminal admin — pendência F1.5).
 */
const tsxCli = 'C:/Users/Abner/Documents/Luna cto/luna-agent/node_modules/tsx/dist/cli.mjs';
const root = 'C:/Users/Abner/Documents/Luna cto/luna-agent';

const app = (name, cwd) => ({
  name,
  script: tsxCli,
  interpreter: 'node',
  args: ['src/index.ts'],
  cwd,
  windowsHide: true,
  env: { LUNA_PM2_MANAGED: '1' }, // watchdog não restarta o que o pm2 já ressobe
  out_file: `${root}/logs-${name.replace('luna-', '')}.out.log`,
  error_file: `${root}/logs-${name.replace('luna-', '')}.err.log`,
  restart_delay: 4000,
  max_restarts: 10,
});

module.exports = {
  apps: [
    app('luna-orchestrator', `${root}/apps/orchestrator`),
    app('luna-whatsplay', `${root}/apps/whatsplay`),
    app('luna-worker', `${root}/apps/worker`),
    app('luna-watchdog', `${root}/apps/watchdog`),
    {
      name: 'venus-watchdog',
      script: `${root}/scripts/venus/watchdog.mjs`,
      cwd: root,
      interpreter: 'node',
      windowsHide: true,
      restart_delay: 4000,
      max_restarts: 10,
      out_file: `${root}/logs-venus-watchdog.out.log`,
      error_file: `${root}/logs-venus-watchdog.err.log`,
    },
  ],
};
