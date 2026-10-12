#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');
const crypto = require('crypto');
const os = require('os');

const HOME = os.homedir();
const LUNA_DIR = process.env.LUNA_DIR || path.join(HOME, '.luna-kernel');
const LUNA_HOME = process.env.LUNA_HOME || path.join(HOME, '.luna');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question, defaultValue = '') {
  return new Promise((resolve) => {
    const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

function run(cmd, cwd = LUNA_DIR, timeout = 120000) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { cwd, stdio: 'inherit', timeout });
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function generateEcosystem(includeVite) {
  const apps = [
    {
      name: 'luna-server',
      script: path.join(LUNA_DIR, 'apps', 'dashboard', 'luna-server.js'),
      cwd: path.join(LUNA_DIR, 'apps', 'dashboard'),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        LUNA_HOME,
        LUNA_KERNEL_DIR: path.join(LUNA_DIR, 'packages', 'kernel'),
        LUNA_DIR: path.join(LUNA_DIR, 'packages', 'kernel'),
        NEXO_DIR: path.join(LUNA_DIR, 'apps', 'dashboard'),
      },
      max_restarts: 50,
      min_uptime: '10s',
      restart_delay: 3000,
      kill_timeout: 8000,
      listen_timeout: 15000,
      vizion: false,
      exp_backoff_restart_delay: 100,
    },
    {
      name: 'nexo-dashboard',
      script: path.join(LUNA_DIR, 'apps', 'dashboard', 'server.js'),
      cwd: path.join(LUNA_DIR, 'apps', 'dashboard'),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        LUNA_HOME,
        LUNA_KERNEL_DIR: path.join(LUNA_DIR, 'packages', 'kernel'),
        LUNA_DIR: path.join(LUNA_DIR, 'packages', 'kernel'),
        NEXO_DIR: path.join(LUNA_DIR, 'apps', 'dashboard'),
      },
      max_restarts: 50,
      min_uptime: '10s',
      restart_delay: 3000,
      kill_timeout: 8000,
      listen_timeout: 15000,
      vizion: false,
      exp_backoff_restart_delay: 100,
    },
  ];

  if (includeVite) {
    apps.push({
      name: 'luna-vite',
      script: path.join(LUNA_DIR, 'packages', 'kernel', 'luna-web', 'node_modules', 'vite', 'bin', 'vite.js'),
      args: '--host',
      cwd: path.join(LUNA_DIR, 'packages', 'kernel', 'luna-web'),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 5173,
      },
      max_restarts: 50,
      min_uptime: '15s',
      restart_delay: 5000,
      kill_timeout: 10000,
      listen_timeout: 20000,
      vizion: false,
      exp_backoff_restart_delay: 100,
      wait_ready: false,
    });
  }

  apps.push({
    name: 'luna-health-watchdog',
    script: path.join(LUNA_DIR, 'packages', 'kernel', 'luna-health-watchdog.js'),
    cwd: path.join(LUNA_DIR, 'packages', 'kernel'),
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    max_restarts: 50,
    min_uptime: '10s',
    restart_delay: 3000,
    kill_timeout: 5000,
    vizion: false,
    exp_backoff_restart_delay: 100,
  });

  const ecosystem = `const path = require('path');\nconst ROOT = __dirname;\n\nmodule.exports = {\n  apps: ${JSON.stringify(apps, null, 2).replace(/"([^"]+)":/g, '$1:')},\n};\n`;

  fs.writeFileSync(path.join(LUNA_DIR, 'pm2-ecosystem.config.js'), ecosystem);
  console.log('✅ PM2 ecosystem gerado (sem Telegram bot)');
}

function createShortcuts() {
  const binDir = path.join(HOME, '.local', 'bin');
  ensureDir(binDir);

  const lunaScript = `#!/bin/bash
set -e
ECO="${LUNA_DIR}/pm2-ecosystem.config.js"
if pm2 status | grep -qE "luna-server|nexo-dashboard"; then
  pm2 restart all
else
  pm2 start "$ECO"
fi
pm2 save
xdg-open "http://localhost:3458" 2>/dev/null || true
xdg-open "https://localhost:5173" 2>/dev/null || true
`;

  const dashboardScript = `#!/bin/bash
set -e
ECO="${LUNA_DIR}/pm2-ecosystem.config.js"
if pm2 status | grep -qE "luna-server|nexo-dashboard"; then
  pm2 restart all
else
  pm2 start "$ECO"
fi
pm2 save
xdg-open "http://localhost:3456" 2>/dev/null || true
`;

  fs.writeFileSync(path.join(binDir, 'luna'), lunaScript);
  fs.writeFileSync(path.join(binDir, 'dashboard'), dashboardScript);
  fs.chmodSync(path.join(binDir, 'luna'), 0o755);
  fs.chmodSync(path.join(binDir, 'dashboard'), 0o755);

  console.log('✅ Atalhos criados em ~/.local/bin: luna, dashboard');
}

async function runKimiWizard() {
  const wizardPath = path.join(LUNA_DIR, 'install-wizard.html');
  if (fs.existsSync(wizardPath)) {
    console.log('');
    console.log('🌐 Abrindo wizard de login no Kimi...');
    try {
      execSync(`xdg-open "${wizardPath}"`, { stdio: 'ignore', timeout: 10000 });
    } catch (e) {
      console.log('⚠️  Não foi possível abrir o navegador automaticamente.');
      console.log(`   Abra manualmente: ${wizardPath}`);
    }
    await ask('Pressione ENTER após fazer login no Kimi');
  }
}

async function main() {
  console.log('🌙 Luna Installer (Node phase)');
  console.log('');

  ensureDir(LUNA_HOME);
  ensureDir(LUNA_DIR);

  const lunaPort = await ask('Porta do Luna Web', '3458');
  const dashboardPort = await ask('Porta do Dashboard', '3456');
  const includeVite = (await ask('Iniciar Vite dev server? [s/n]', 's')).toLowerCase() === 's';

  // v10.39: Ask for the two variables the dashboard really needs to avoid
  // hardcoded paths and a dead PostgreSQL dependency.
  const defaultNexoBase = process.platform === 'win32'
    ? path.join(HOME, 'Documents', 'NEXO DIGITAL')
    : path.join(HOME, 'Documents', 'NEXO DIGITAL');
  const nexoBasePath = await ask('Caminho base da pasta NEXO DIGITAL', defaultNexoBase);
  const databaseUrl = await ask('DATABASE_URL do PostgreSQL (ex: postgres://user:pass@localhost:5432/nexodb)', '');

  const env = {
    NODE_ENV: 'production',
    LUNA_HOME,
    LUNA_KERNEL_DIR: path.join(LUNA_DIR, 'packages', 'kernel'),
    LUNA_DIR: path.join(LUNA_DIR, 'packages', 'kernel'),
    NEXO_DIR: path.join(LUNA_DIR, 'apps', 'dashboard'),
    NEXO_BASE_PATH: nexoBasePath,
    LUNA_PORT: lunaPort,
    DASHBOARD_PORT: dashboardPort,
    JWT_SECRET: generateToken(),
    INTERNAL_API_TOKEN: generateToken(),
  };

  const envLines = [
    '# Auto-generated by Luna Installer',
    `NODE_ENV=${env.NODE_ENV}`,
    `LUNA_HOME=${env.LUNA_HOME}`,
    `LUNA_KERNEL_DIR=${env.LUNA_KERNEL_DIR}`,
    `LUNA_DIR=${env.LUNA_DIR}`,
    `NEXO_DIR=${env.NEXO_DIR}`,
    `NEXO_BASE_PATH=${env.NEXO_BASE_PATH}`,
    `LUNA_PORT=${env.LUNA_PORT}`,
    `DASHBOARD_PORT=${env.DASHBOARD_PORT}`,
    `JWT_SECRET=${env.JWT_SECRET}`,
    `INTERNAL_API_TOKEN=${env.INTERNAL_API_TOKEN}`,
    databaseUrl ? `DATABASE_URL=${databaseUrl}` : '# DATABASE_URL=',
    '',
    '# Optional: uncomment and fill to enable features',
    '# TELEGRAM_BOT_TOKEN=',
    '# GEMINI_API_KEY=',
    '# SMTP_HOST=',
    '# SMTP_USER=',
    '# SMTP_PASS=',
    '# GMAIL_CLIENT_ID=',
    '# GMAIL_CLIENT_SECRET=',
    '',
  ].join('\n');

  fs.writeFileSync(path.join(LUNA_DIR, 'apps', 'dashboard', '.env'), envLines);
  fs.writeFileSync(path.join(LUNA_DIR, 'packages', 'kernel', '.env'), envLines);

  console.log('✅ Arquivos .env criados');

  // Install dependencies
  console.log('📦 Instalando dependências...');
  try {
    run('corepack pnpm install', LUNA_DIR, 600000);
  } catch (e) {
    console.log('⚠️  Primeira tentativa falhou. Limpando store e tentando novamente...');
    run('corepack pnpm store prune', LUNA_DIR, 120000);
    run('corepack pnpm install', LUNA_DIR, 600000);
  }

  // Build
  console.log('🔨 Buildando interface web...');
  run('corepack pnpm build', LUNA_DIR, 300000);

  // Generate PM2 ecosystem without telegram bot
  generateEcosystem(includeVite);

  // Create shortcuts
  createShortcuts();

  // Start PM2
  console.log('🚀 Iniciando serviços com PM2...');
  run('pm2 start pm2-ecosystem.config.js', LUNA_DIR, 60000);
  run('pm2 save', LUNA_DIR, 30000);

  console.log('');
  console.log('✅ Luna instalada e rodando!');
  console.log(`   Luna Web:  http://localhost:${lunaPort}`);
  console.log(`   Dashboard: http://localhost:${dashboardPort}`);
  if (includeVite) {
    console.log('   Vite Dev:  https://localhost:5173');
  }

  // Kimi login wizard
  await runKimiWizard();

  rl.close();
}

module.exports = {
  ask, run, generateToken, ensureDir,
  generateEcosystem, createShortcuts, runKimiWizard, main,
  LUNA_DIR, LUNA_HOME, HOME,
};

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Erro no installer:', err.message);
    rl.close();
    process.exit(1);
  });
}
