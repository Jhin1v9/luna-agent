/**
 * Luna Web Server — Standalone server for Luna Web chat
 * Runs on port 3458 locally. NOT deployed to Render.
 * 
 * v5.1 — Unificado: inclui todas as features do antigo config-server.cjs
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// v5.4-fix: log fatal errors but let the process die so PM2 can restart it cleanly.
// The previous keep-alive handlers were holding the port open and causing EADDRINUSE
// when PM2 tried to restart the server.
process.on('uncaughtException', (err) => {
  console.error('[LUNA-FATAL] Uncaught Exception:', err.message);
  console.error(err.stack);
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[LUNA-FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
// SIGTERM/SIGINT: exit cleanly so the port is released immediately.
process.on('SIGTERM', () => {
  console.log('[LUNA] SIGTERM received — shutting down cleanly');
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('[LUNA] SIGINT received — shutting down cleanly');
  process.exit(0);
});

const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const { execSync } = require('child_process');

// v5.2: Centralized config
const { LUNA_KERNEL_DIR } = require('./lib/resolve-luna.cjs');
const config = require(path.join(LUNA_KERNEL_DIR, 'config', 'luna-config'));

const app = express();
const PORT = config.PORTS.luna;
const LUNA_DIR = LUNA_KERNEL_DIR;
const MONOREPO_ROOT = path.resolve(LUNA_DIR, '..', '..');
const RUNTIME_PATH = path.join(LUNA_DIR, '.luna-runtime.json');

// ── Load Luna Kernel .env (same as old config-server.cjs) ──
const lunaEnvPath = path.join(LUNA_DIR, '.env');
if (fs.existsSync(lunaEnvPath)) {
  fs.readFileSync(lunaEnvPath, 'utf8').split('\n').forEach(line => {
    const eq = line.indexOf('=');
    if (eq > 0 && !line.startsWith('#')) {
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  });
}

// Write runtime config so frontend dev server can discover our port
const runtimeDir = path.dirname(RUNTIME_PATH);
if (!fs.existsSync(runtimeDir)) {
  fs.mkdirSync(runtimeDir, { recursive: true });
}
fs.writeFileSync(RUNTIME_PATH, JSON.stringify({ apiPort: PORT, apiUrl: `http://localhost:${PORT}` }));
const JWT_SECRET = config.AUTH.jwtSecret;
const JWT_EXPIRES_IN = config.AUTH.jwtExpiresIn;
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

// Ensure default users exist so login works out-of-the-box
const DEFAULT_PASSWORD_HASH = '$2b$10$KnJlQTb9opcUu2EVPkw56ez410v9.LNBFLNGV200EiXskvMjjnUla'; // hash de '7741'
(function ensureDefaultUsers() {
  try {
    let data = { users: {} };
    if (fs.existsSync(USERS_FILE)) {
      data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    }
    if (!data.users) data.users = {};
    let changed = false;
    for (const key of ['abner', 'nonoke', 'elias']) {
      if (!data.users[key]) {
        data.users[key] = {
          name: key.charAt(0).toUpperCase() + key.slice(1),
          role: 'Admin',
          color: '#3742fa',
          passwordHash: DEFAULT_PASSWORD_HASH,
        };
        changed = true;
      } else if (!data.users[key].passwordHash && !data.users[key].password) {
        data.users[key].passwordHash = DEFAULT_PASSWORD_HASH;
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
      console.log('[INIT] Default users ensured in', USERS_FILE);
    }
  } catch (e) {
    console.error('[INIT] Failed to ensure default users:', e.message);
  }
})();

// ── Auth helpers (copied from Dashboard server.js) ──
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Não autorizado' });
  }
  try {
    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    // Load full user data from users.json
    const usersData = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    const user = usersData.users?.[decoded.userId.toLowerCase()];
    if (!user) {
      return res.status(401).json({ success: false, error: 'Usuário não encontrado' });
    }
    req.user = { id: decoded.userId, name: user.name || decoded.userId, role: user.role || 'User', color: user.color };
    next();
  } catch (e) {
    return res.status(401).json({ success: false, error: 'Token inválido' });
  }
}

function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

async function validateCredentials(username, password) {
  try {
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    const user = data.users?.[username.toLowerCase()];
    if (!user) return null;
    const match = await bcrypt.compare(password, user.passwordHash || user.password);
    if (!match) return null;
    return { id: username.toLowerCase(), name: user.name || username, role: user.role || 'User', color: user.color };
  } catch (e) {
    console.error('Auth error:', e.message);
    return null;
  }
}

// ── Luna Chat Routes ──
const { router: lunaChatRouter, setupAuth: setupLunaAuth } = require('./luna-chat-routes');

// ── Dashboard Routes (shared with Luna Web tools) ──
const leadsRouter = require('./routes/leads');

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// CORS para desenvolvimento
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Auth setup
setupLunaAuth({ validateCredentials, generateToken, requireAuth });
app.use(lunaChatRouter);

// Dashboard tool routes (available to Luna Web)
app.use('/api/leads', leadsRouter);
const lunaToolsRouter = require('./routes/luna-tools');
app.use(lunaToolsRouter);

// Static files
const STATIC_DIR = path.join(LUNA_DIR, 'luna-web', 'dist');
console.log('[Luna Server] Serving static from:', STATIC_DIR, 'exists:', fs.existsSync(STATIC_DIR));
console.log('[Luna Server] Assets exists:', fs.existsSync(path.join(STATIC_DIR, 'assets')));
console.log('[Luna Server] __dirname:', __dirname);
app.use(express.static(STATIC_DIR));

// Health — MUST be before SPA fallback
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'luna-web', timestamp: new Date().toISOString() });
});

// ── Path Guard Config ──
const lunaConfig = require(path.join(__dirname, '..', '..', 'packages', 'kernel', 'config', 'luna-config'));

app.get('/api/path-guard', (req, res) => {
  try {
    const config = lunaConfig.PATH_GUARD.load();
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/path-guard', (req, res) => {
  try {
    const { enabled, allowHomeDir, customPaths } = req.body;
    const config = lunaConfig.PATH_GUARD.load();
    if (enabled !== undefined) config.enabled = !!enabled;
    if (allowHomeDir !== undefined) config.allowHomeDir = !!allowHomeDir;
    if (customPaths !== undefined) config.customPaths = Array.isArray(customPaths) ? customPaths : [];
    lunaConfig.PATH_GUARD.save(config);
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Legacy config panel fallback (from old config-server.cjs)
app.get('/config.html', (req, res) => {
  const configPath = path.join(LUNA_DIR, 'config.html');
  if (fs.existsSync(configPath)) {
    res.sendFile(configPath);
  } else {
    res.status(404).send('config.html not found');
  }
});

// v8.0: Create HTTP server so WebSocket can share the same port
const http = require('http');
const server = http.createServer(app);

// v8.1: Initialize Extension HTTP handler — MUST be before SPA fallback
const { LunaExtensionHandler } = require('./luna-extension-handler.cjs');
let extHandler = null;
try {
  extHandler = new LunaExtensionHandler(server, app);
  console.log('[Luna Server] Extension handler initialized');
} catch (e) {
  console.error('[Luna Server] Failed to initialize extension handler:', e.message);
}

// Export for other modules to use
app.locals.extensionHandler = extHandler;
global.__lunaApp = app;

// v8.2-fix: Auto-wire tool executor immediately so extension tools work
// even before any chat HTTP route is hit. getLunaSoul() is lazy but safe to call.
if (extHandler) {
  const lunaChatModule = require('./luna-chat-routes');
  if (lunaChatModule.getLunaSoul) {
    lunaChatModule.getLunaSoul().then(lunaSoul => {
      extHandler.setToolExecutor(async (tool, params, sessionId) => {
        const result = await lunaSoul._handleAction(
          { tool, params, mode: 'ACTION' },
          sessionId?.replace('web-', '') || sessionId,
          { userId: sessionId }
        );
        return result;
      });
      console.log('[LunaExt] Tool executor auto-wired from luna-server');
    }).catch(e => {
      console.warn('[LunaExt] Auto-wire failed (will retry on first chat request):', e.message);
    });
  }
}

// v10.18: Self-update endpoint — checks GitHub vs local, pulls if behind, rebuilds and restarts luna-vite
function requireSystemAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const internalToken = process.env.INTERNAL_API_TOKEN || '';
  if (internalToken && token === internalToken) return next();
  try {
    jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ success: false, error: 'Não autorizado' });
  }
}

function runCommand(command, cwd, timeout = 120000) {
  try {
    const output = execSync(command, {
      cwd,
      encoding: 'utf8',
      timeout,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });
    return { success: true, output: output.trim() };
  } catch (e) {
    return { success: false, output: (e.stdout || '').trim(), error: e.message, code: e.status };
  }
}

app.post('/api/system/update', requireSystemAuth, async (req, res) => {
  const result = {
    success: false,
    localCommit: null,
    remoteCommit: null,
    pulled: false,
    built: false,
    restarted: false,
    messages: []
  };

  try {
    // 1. Fetch latest from origin
    const fetchResult = runCommand('git fetch origin main', MONOREPO_ROOT);
    result.messages.push(fetchResult.success ? 'Fetch OK' : `Fetch: ${fetchResult.error}`);
    if (!fetchResult.success) {
      return res.status(500).json({ ...result, success: false, error: 'Falha ao buscar atualizações do GitHub' });
    }

    // 2. Compare local HEAD with origin/main
    const localCommit = runCommand('git rev-parse HEAD', MONOREPO_ROOT);
    const remoteCommit = runCommand('git rev-parse origin/main', MONOREPO_ROOT);
    result.localCommit = localCommit.success ? localCommit.output : null;
    result.remoteCommit = remoteCommit.success ? remoteCommit.output : null;

    if (!result.localCommit || !result.remoteCommit) {
      return res.status(500).json({ ...result, success: false, error: 'Não foi possível ler commits local/remoto' });
    }

    if (result.localCommit === result.remoteCommit) {
      result.success = true;
      result.messages.push('Já está na versão mais recente do GitHub');
      return res.json(result);
    }

    // 3. Check if remote is ahead (fast-forward)
    const mergeBase = runCommand('git merge-base HEAD origin/main', MONOREPO_ROOT);
    if (!mergeBase.success || mergeBase.output !== result.localCommit) {
      result.messages.push('Atenção: histórico local diverge do remoto (não é fast-forward)');
      return res.status(409).json({ ...result, success: false, error: 'Divergência detectada. Resolva manualmente antes de atualizar.' });
    }

    // 4. Pull updates
    const pullResult = runCommand('git pull origin main', MONOREPO_ROOT);
    result.pulled = pullResult.success;
    result.messages.push(pullResult.success ? `Pull OK: ${pullResult.output}` : `Pull falhou: ${pullResult.error}`);
    if (!pullResult.success) {
      return res.status(500).json({ ...result, success: false, error: 'Falha ao fazer pull' });
    }

    // 5. Build frontend via monorepo workspace filter
    const buildResult = runCommand('corepack pnpm --filter luna-web build', MONOREPO_ROOT, 300000);
    result.built = buildResult.success;
    result.messages.push(buildResult.success ? 'Build OK' : `Build falhou: ${buildResult.error}`);
    if (!buildResult.success) {
      return res.status(500).json({ ...result, success: false, error: 'Build falhou após pull' });
    }

    // 6. Restart luna-vite
    const restartResult = runCommand('pm2 restart luna-vite', MONOREPO_ROOT, 60000);
    result.restarted = restartResult.success;
    result.messages.push(restartResult.success ? 'luna-vite reiniciado' : `Reinício falhou: ${restartResult.error}`);

    result.success = result.pulled && result.built && result.restarted;
    return res.json(result);
  } catch (e) {
    result.messages.push(`Erro inesperado: ${e.message}`);
    return res.status(500).json({ ...result, success: false, error: e.message });
  }
});

app.get('/api/system/update/status', requireSystemAuth, async (req, res) => {
  const localCommit = runCommand('git rev-parse HEAD', MONOREPO_ROOT);
  const remoteCommit = runCommand('git rev-parse origin/main', MONOREPO_ROOT);
  const logResult = runCommand('git log --oneline -5', MONOREPO_ROOT);
  const statusResult = runCommand('git status --short', MONOREPO_ROOT);

  res.json({
    success: true,
    localCommit: localCommit.success ? localCommit.output : null,
    remoteCommit: remoteCommit.success ? remoteCommit.output : null,
    upToDate: localCommit.success && remoteCommit.success && localCommit.output === remoteCommit.output,
    recentLog: logResult.success ? logResult.output.split('\n') : [],
    workingTreeChanges: statusResult.success ? statusResult.output : null
  });
});

// SPA fallback — MUST be after all API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

server.listen(PORT, () => {
  console.log(`🌙 Luna Web rodando em http://localhost:${PORT}`);
  console.log(`   luna-dir: ${LUNA_DIR}`);
  console.log(`   runtime:  ${RUNTIME_PATH}`);
  console.log('');
  console.log('   Endpoints:');
  console.log('   - Chat:    POST /api/chat | GET /api/chat/stream (SSE)');
  console.log('   - Sessions: GET /api/chat/sessions | POST /api/chat/session');
  console.log('   - Config:  GET/POST /api/config');
  console.log('   - Tests:   GET /api/test/* | POST /api/system/*');
  console.log('   - Legacy:  GET /config.html');
  console.log('   - Ext WS:  ws://localhost:' + PORT + '/ext/ws');
  console.log('');
  console.log('   Frontend:');
  console.log('   - Serves luna-web/dist/ (SPA fallback)');
  console.log('');
});

module.exports = { app };
