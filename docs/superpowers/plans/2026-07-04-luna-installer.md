:

# Luna Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a one-command installer (`install.sh` + `install.cjs`) that sets up the Luna monorepo on a fresh Linux/WSL machine, generates runtime config automatically, starts PM2 without the Telegram bot, and guides the user through Kimi login.

**Architecture:** A POSIX shell bootstrap checks and optionally installs Node.js, pnpm, PM2, and Chrome, then clones the repo and delegates to a Node.js installer script that handles prompts, `.env` generation, build, PM2 startup, terminal shortcuts, and a local HTML wizard for Kimi login.

**Tech Stack:** bash, Node.js 22+, pnpm, PM2, git, Chrome/Chromium.

---

## Task 1: Create `install.sh` bootstrap

**Files:**
- Create: `install.sh`

- [ ] **Step 1: Write the bootstrap script**

```bash
#!/bin/bash
set -e

REPO_URL="https://github.com/Jhin1v9/luna-kernel.git"
LUNA_DIR="${LUNA_DIR:-$HOME/.luna-kernel}"

echo "🌙 Luna Installer"
echo ""

# Detect OS
if [[ "$OSTYPE" != "linux-gnu"* ]] && [[ "$OSTYPE" != "linux"* ]]; then
  echo "⚠️  Este instalador suporta apenas Linux/WSL no momento."
  exit 1
fi

# Check Node.js
check_node() {
  if command -v node >/dev/null 2>&1; then
    NODE_VERSION=$(node -v | sed 's/v//')
    MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
    if [[ "$MAJOR" -ge 22 ]]; then
      echo "✅ Node.js v$NODE_VERSION encontrado"
      return 0
    fi
  fi
  return 1
}

install_node() {
  echo "📦 Instalando Node.js 24 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y nodejs
}

if ! check_node; then
  read -p "Node.js v22+ não encontrado. Instalar? [s/N]: " ans
  if [[ "$ans" =~ ^[Ss]$ ]]; then
    install_node
  else
    echo "❌ Node.js é obrigatório. Abortando."
    exit 1
  fi
fi

# Check pnpm
if ! command -v pnpm >/dev/null 2>&1; then
  echo "📦 Instalando pnpm via corepack..."
  corepack enable
  corepack prepare pnpm@11.9.0 --activate
else
  echo "✅ pnpm encontrado"
fi

# Check PM2
if ! command -v pm2 >/dev/null 2>&1; then
  read -p "PM2 não encontrado. Instalar globalmente? [s/N]: " ans
  if [[ "$ans" =~ ^[Ss]$ ]]; then
    npm install -g pm2
  else
    echo "❌ PM2 é obrigatório. Abortando."
    exit 1
  fi
else
  echo "✅ PM2 encontrado"
fi

# Check Chrome/Chromium
if ! command -v google-chrome >/dev/null 2>&1 && ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1; then
  read -p "Google Chrome não encontrado. Instalar? [s/N]: " ans
  if [[ "$ans" =~ ^[Ss]$ ]]; then
    sudo apt-get update
    sudo apt-get install -y wget gnupg
    wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
    sudo sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list'
    sudo apt-get update
    sudo apt-get install -y google-chrome-stable
  else
    echo "⚠️  Chrome é altamente recomendado. O login no Kimi pode não funcionar sem ele."
  fi
else
  echo "✅ Chrome/Chromium encontrado"
fi

# Clone or update repo
if [[ -d "$LUNA_DIR/.git" ]]; then
  echo "📁 Diretório $LUNA_DIR já existe."
  read -p "Atualizar repo existente? [s/N]: " ans
  if [[ "$ans" =~ ^[Ss]$ ]]; then
    cd "$LUNA_DIR"
    git pull origin main
  else
    echo "❌ Abortando para não sobrescrever $LUNA_DIR"
    exit 1
  fi
else
  if [[ -d "$LUNA_DIR" ]]; then
    echo "❌ $LUNA_DIR existe mas não é um repositório git."
    exit 1
  fi
  echo "📥 Clonando repositório em $LUNA_DIR..."
  git clone "$REPO_URL" "$LUNA_DIR"
fi

# Run Node installer
cd "$LUNA_DIR"
node install.cjs
```

- [ ] **Step 2: Make it executable**

Run:
```bash
chmod +x install.sh
```

- [ ] **Step 3: Commit**

```bash
git add install.sh
git commit -m "feat(installer): add bash bootstrap script"
```

---

## Task 2: Create `install.cjs` — utilities and environment checks

**Files:**
- Create: `install.cjs`

- [ ] **Step 1: Write utilities section**

```javascript
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const readline = require('readline');
const crypto = require('crypto');

const HOME = require('os').homedir();
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
```

- [ ] **Step 2: Commit**

```bash
git add install.cjs
git commit -m "feat(installer): add installer utilities"
```

---

## Task 3: Create `install.cjs` — prompts and `.env` generation

**Files:**
- Modify: `install.cjs`

- [ ] **Step 1: Add prompt and env generation logic**

Append to `install.cjs`:

```javascript
async function main() {
  console.log('🌙 Luna Installer (Node phase)');
  console.log('');

  ensureDir(LUNA_HOME);
  ensureDir(LUNA_DIR);

  const lunaPort = await ask('Porta do Luna Web', '3458');
  const dashboardPort = await ask('Porta do Dashboard', '3456');
  const includeVite = (await ask('Iniciar Vite dev server? [s/n]', 's')).toLowerCase() === 's';

  const env = {
    NODE_ENV: 'production',
    LUNA_HOME,
    LUNA_KERNEL_DIR: path.join(LUNA_DIR, 'packages', 'kernel'),
    LUNA_DIR: path.join(LUNA_DIR, 'packages', 'kernel'),
    NEXO_DIR: path.join(LUNA_DIR, 'apps', 'dashboard'),
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
    `LUNA_PORT=${env.LUNA_PORT}`,
    `DASHBOARD_PORT=${env.DASHBOARD_PORT}`,
    `JWT_SECRET=${env.JWT_SECRET}`,
    `INTERNAL_API_TOKEN=${env.INTERNAL_API_TOKEN}`,
    '',
    '# Optional: uncomment and fill to enable features',
    '# TELEGRAM_BOT_TOKEN=',
    '# GEMINI_API_KEY=',
    '# SMTP_HOST=',
    '# SMTP_USER=',
    '# SMTP_PASS=',
    '# GMAIL_CLIENT_ID=',
    '# GMAIL_CLIENT_SECRET=',
    '# DATABASE_URL=',
    '',
  ].join('\n');

  fs.writeFileSync(path.join(LUNA_DIR, 'apps', 'dashboard', '.env'), envLines);
  fs.writeFileSync(path.join(LUNA_DIR, 'packages', 'kernel', '.env'), envLines);

  console.log('✅ Arquivos .env criados');
  return { includeVite };
}

main().catch((err) => {
  console.error('❌ Erro no installer:', err.message);
  process.exit(1);
}).finally(() => {
  rl.close();
});
```

- [ ] **Step 2: Test syntax**

Run:
```bash
node --check install.cjs
```
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add install.cjs
git commit -m "feat(installer): add env prompt and generation"
```

---

## Task 4: Create `install.cjs` — install, build, PM2 startup

**Files:**
- Modify: `install.cjs`

- [ ] **Step 1: Update main flow to install/build/start**

Replace the `main` function in `install.cjs` with:

```javascript
async function main() {
  console.log('🌙 Luna Installer (Node phase)');
  console.log('');

  ensureDir(LUNA_HOME);
  ensureDir(LUNA_DIR);

  const lunaPort = await ask('Porta do Luna Web', '3458');
  const dashboardPort = await ask('Porta do Dashboard', '3456');
  const includeVite = (await ask('Iniciar Vite dev server? [s/n]', 's')).toLowerCase() === 's';

  const env = {
    NODE_ENV: 'production',
    LUNA_HOME,
    LUNA_KERNEL_DIR: path.join(LUNA_DIR, 'packages', 'kernel'),
    LUNA_DIR: path.join(LUNA_DIR, 'packages', 'kernel'),
    NEXO_DIR: path.join(LUNA_DIR, 'apps', 'dashboard'),
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
    `LUNA_PORT=${env.LUNA_PORT}`,
    `DASHBOARD_PORT=${env.DASHBOARD_PORT}`,
    `JWT_SECRET=${env.JWT_SECRET}`,
    `INTERNAL_API_TOKEN=${env.INTERNAL_API_TOKEN}`,
    '',
    '# Optional: uncomment and fill to enable features',
    '# TELEGRAM_BOT_TOKEN=',
    '# GEMINI_API_KEY=',
    '# SMTP_HOST=',
    '# SMTP_USER=',
    '# SMTP_PASS=',
    '# GMAIL_CLIENT_ID=',
    '# GMAIL_CLIENT_SECRET=',
    '# DATABASE_URL=',
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
}
```

- [ ] **Step 2: Add helper functions**

Append before `main()`:

```javascript
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
      run(`xdg-open "${wizardPath}"`, LUNA_DIR, 10000);
    } catch (e) {
      console.log('⚠️  Não foi possível abrir o navegador automaticamente.');
      console.log(`   Abra manualmente: ${wizardPath}`);
    }
    await ask('Pressione ENTER após fazer login no Kimi');
  }
}
```

- [ ] **Step 3: Test syntax**

Run:
```bash
node --check install.cjs
```

- [ ] **Step 4: Commit**

```bash
git add install.cjs
git commit -m "feat(installer): add install, build, pm2 and shortcuts logic"
```

---

## Task 5: Create `install-wizard.html`

**Files:**
- Create: `install-wizard.html`

- [ ] **Step 1: Write the wizard HTML**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Luna - Login no Kimi</title>
  <style>
    body {
      font-family: Inter, system-ui, sans-serif;
      background: #0f0f1a;
      color: #e0e0e0;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
    }
    .card {
      background: #1a1a2e;
      border-radius: 16px;
      padding: 32px;
      max-width: 520px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }
    h1 { color: #e94560; margin-top: 0; }
    a { color: #4ea8de; }
    code {
      background: #0f0f1a;
      padding: 4px 8px;
      border-radius: 4px;
      font-family: JetBrains Mono, monospace;
    }
    ol { line-height: 1.8; }
    .tip { color: #a0a0b0; font-size: 0.9em; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🌙 Quase lá!</h1>
    <p>A Luna já está rodando. Agora você só precisa fazer login no Kimi no Chrome isolado.</p>

    <ol>
      <li>Aguarde o Chrome do Luna abrir (ele pode já estar em segundo plano).</li>
      <li>Acesse a página de inspeção: <a href="http://localhost:9222/json" target="_blank"><code>http://localhost:9222/json</code></a></li>
      <li>Clique no link da aba do <strong>Kimi</strong>.</li>
      <li>Faça login manualmente no <strong>kimi.com</strong>.</li>
      <li>Volte aqui e feche esta janela.</li>
    </ol>

    <p class="tip">
      💡 Depois do login, acesse a Luna em <a href="http://localhost:3458" target="_blank"><code>http://localhost:3458</code></a>
    </p>

    <p class="tip">
      ⚠️ Não use <kbd>Ctrl+Shift+R</kbd> na aba do Kimi — isso pode descartar a sessão de login.
    </p>
  </div>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add install-wizard.html
git commit -m "feat(installer): add Kimi login wizard HTML"
```

---

## Task 6: Update root README with installer instructions

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add installer section near the top**

Replace the "## 🚀 Instalação" section in `README.md` with:

```markdown
## 🚀 Instalação Automática (recomendada)

Copie e cole no terminal:

\`\`\`bash
bash <(curl -fsSL https://raw.githubusercontent.com/Jhin1v9/luna-kernel/main/install.sh)
\`\`\`

O instalador vai:
1. Verificar Node.js, pnpm, PM2 e Chrome.
2. Perguntar se quer instalar o que estiver faltando.
3. Clonar o repo em `~/.luna-kernel`.
4. Gerar tokens e `.env` automaticamente.
5. Instalar dependências, buildar e subir tudo no PM2.
6. Abrir uma página guiando o login manual no Kimi.

Depois é só usar os atalhos:

\`\`\`bash
luna      # abre Luna Web + Vite Dev
dashboard # abre Nexo Dashboard
\`\`\`

## 🚀 Instalação Manual

Se preferir fazer passo a passo:

\`\`\`bash
cd ~/.luna-kernel
corepack pnpm install
corepack pnpm build
pm2 start pm2-ecosystem.config.js
pm2 save
\`\`\`
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): add one-command installer instructions"
```

---

## Task 7: Dry-run test the installer locally

**Files:**
- Test: `install.cjs`

- [ ] **Step 1: Syntax check**

Run:
```bash
node --check install.cjs
```
Expected: exit 0.

- [ ] **Step 2: Run install.cjs in the existing worktree**

Because `LUNA_DIR` already exists, the bootstrap is skipped. Run the Node installer to validate prompts and `.env` generation:

```bash
cd /home/jhin/.luna-kernel/.worktrees/monorepo-migration
LUNA_DIR=/tmp/luna-install-test node install.cjs
```

Provide inputs:
- Porta Luna Web: `3459`
- Porta Dashboard: `3460`
- Iniciar Vite: `s`

Expected:
- `/tmp/luna-install-test/apps/dashboard/.env` created.
- `/tmp/luna-install-test/packages/kernel/.env` created.
- `pm2-ecosystem.config.js` generated in `/tmp/luna-install-test`.
- Shortcuts created in `~/.local/bin` (but pointing to test dir; restore later).

- [ ] **Step 3: Restore shortcuts to production path**

After the test, re-run the real installer or manually update shortcuts to point to `/home/jhin/.luna-kernel/.worktrees/monorepo-migration`.

- [ ] **Step 4: Commit test fixes if any**

```bash
git add -A
git commit -m "fix(installer): address issues found in dry-run"
```

---

## Task 8: Merge PR to main

**Files:**
- GitHub PR: `https://github.com/Jhin1v9/luna-kernel/pull/2`

- [ ] **Step 1: Ensure all commits pushed**

Run:
```bash
cd /home/jhin/.luna-kernel/.worktrees/monorepo-migration
git push
```

- [ ] **Step 2: Merge via GitHub CLI**

Run:
```bash
gh pr merge 2 --squash --subject "chore(monorepo): merge dashboard into luna-kernel workspace with installer"
```

Expected: PR merged, `main` updated.

- [ ] **Step 3: Update local main checkout**

Run:
```bash
cd /home/jhin/.luna-kernel
git checkout main
git pull origin main
```

---

## Self-Review Checklist

1. **Spec coverage:**
   - Bootstrap checks system deps → Task 1.
   - Prompts and `.env` generation → Tasks 2-3.
   - Install/build/PM2 → Task 4.
   - No Telegram bot → ecosystem generated without it in Task 4.
   - Kimi login wizard → Task 5.
   - Terminal shortcuts → Task 4.
   - README update → Task 6.
   - Merge → Task 8.

2. **Placeholder scan:** No TBD/TODO.

3. **Type consistency:** `LUNA_DIR`, `LUNA_HOME`, paths consistent across tasks.
