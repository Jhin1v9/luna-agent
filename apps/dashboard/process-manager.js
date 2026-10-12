/**
 * NEXO Process Manager v1.0
 * Gerencia servidores de desenvolvimento locais (start/stop/logs).
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');

const workspaceManager = require('./workspace-manager');
const DATA_DIR = path.join(__dirname, 'data');
const SERVERS_FILE = path.join(DATA_DIR, 'dev-servers.json');
const LOGS_DIR = path.join(DATA_DIR, 'dev-logs');

// ── Real-time log subscribers (SSE) ──
const logSubscribers = new Map(); // serverId -> Set<callback>

function subscribeToLogs(serverId, callback) {
  if (!logSubscribers.has(serverId)) logSubscribers.set(serverId, new Set());
  logSubscribers.get(serverId).add(callback);
}

function unsubscribeFromLogs(serverId, callback) {
  const subs = logSubscribers.get(serverId);
  if (subs) {
    subs.delete(callback);
    if (subs.size === 0) logSubscribers.delete(serverId);
  }
}

function broadcastLog(serverId, line, isError = false) {
  const subs = logSubscribers.get(serverId);
  if (subs) {
    subs.forEach(cb => {
      try { cb(line, isError); } catch { /* ignore closed connections */ }
    });
  }
}

const PROJECT_COMMANDS = {
  'react-vite':     { cmd: 'npm', args: ['run', 'dev'], port: 5173, needsNodeModules: true },
  'react-cra':      { cmd: 'npm', args: ['start'], port: 3000, needsNodeModules: true },
  'react':          { cmd: 'npm', args: ['start'], port: 3000, needsNodeModules: true },
  'nextjs':         { cmd: 'npm', args: ['run', 'dev'], port: 3000, needsNodeModules: true },
  'vue':            { cmd: 'npm', args: ['run', 'dev'], port: 5173, needsNodeModules: true },
  'svelte':         { cmd: 'npm', args: ['run', 'dev'], port: 5173, needsNodeModules: true },
  'angular':        { cmd: 'npm', args: ['start'], port: 4200, needsNodeModules: true },
  'electron':       { cmd: 'npm', args: ['run', 'electron:dev'], port: null, needsNodeModules: true },
  'node-generic':   { cmd: 'npm', args: ['start'], port: 3000, needsNodeModules: true },
  'static-html':    { cmd: 'npx', args: ['serve', '.'], port: 8080, needsNodeModules: false, portArg: '-l' },
  'php':            { cmd: 'php', args: ['-S'], port: 8000, needsNodeModules: false, portArg: true },
  'wordpress':      { cmd: 'php', args: ['-S'], port: 8000, needsNodeModules: false, portArg: true },
  'php-composer':   { cmd: 'php', args: ['-S'], port: 8000, needsNodeModules: false, portArg: true },
  'python':         { cmd: 'python', args: ['app.py'], port: 5000, needsNodeModules: false },
  'react-native':   { cmd: 'npx', args: ['react-native', 'start'], port: 8081, needsNodeModules: true },
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function nowISO() {
  return new Date().toISOString();
}

function readJSON(filePath, defaultValue = {}) {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { return defaultValue; }
}

function writeJSON(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function sanitizeClientId(id) {
  if (!id || typeof id !== 'string') return null;
  const s = id.trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(s)) return null;
  return s;
}

function sanitizeSubPath(subPath) {
  if (!subPath || typeof subPath !== 'string') return '';
  const normalized = path.normalize(subPath).replace(/\\/g, '/');
  if (normalized.startsWith('..') || normalized.includes('/../')) throw new Error('Invalid path');
  return normalized.replace(/^\//, '');
}

function generateServerId(clientId, demoPath) {
  const base = `${clientId}-${demoPath.replace(/\//g, '-').replace(/[^a-z0-9_-]/g, '')}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `srv-${base}-${rand}`;
}

// ── PORT UTILS ──

function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') resolve(true);
      else resolve(false);
    });
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(startPort, maxTries = 20) {
  let port = startPort;
  for (let i = 0; i < maxTries; i++) {
    if (!(await isPortInUse(port))) return port;
    port++;
  }
  throw new Error('Nenhuma porta disponível encontrada');
}

// ── STATE ──

function getServersState() {
  return readJSON(SERVERS_FILE, { versao: '1.0', ultimaAtualizacao: nowISO(), servidores: [] });
}

function saveServersState(state) {
  state.ultimaAtualizacao = nowISO();
  writeJSON(SERVERS_FILE, state);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}

// ── LOGS ──

function getLogPath(serverId) {
  return path.join(LOGS_DIR, `${serverId}.log`);
}

function getServerLogs(serverId, lines = 100) {
  const logFile = getLogPath(serverId);
  if (!fs.existsSync(logFile)) return '';
  const content = fs.readFileSync(logFile, 'utf8');
  const allLines = content.split('\n');
  return allLines.slice(-lines).join('\n');
}

// ── CLEANUP ──

function cleanupDeadServers() {
  const state = getServersState();
  let changed = false;
  state.servidores = state.servidores.filter(srv => {
    if (!isProcessAlive(srv.pid)) {
      changed = true;
      return false;
    }
    return true;
  });
  if (changed) saveServersState(state);
  return state;
}

// ── START ──

async function startServer(rawClientId, rawDemoPath, options = {}) {
  const clientId = sanitizeClientId(rawClientId);
  if (!clientId) throw new Error('Invalid client id');

  const demoPath = sanitizeSubPath(rawDemoPath);
  if (!demoPath) throw new Error('Invalid demo path');

  const projectDir = path.join(workspaceManager.WORKSPACE_DIR, clientId, demoPath);
  if (!fs.existsSync(projectDir)) throw new Error('Demo path não encontrado');

  const tipo = workspaceManager.detectProjectType(clientId, demoPath);
  const config = PROJECT_COMMANDS[tipo];
  if (!config) throw new Error(`Tipo de projeto não suportado para execução: ${tipo}`);

  // Verifica se já existe servidor rodando para este demo
  const state = getServersState();
  const existing = state.servidores.find(s => s.clienteId === clientId && s.demoPath === demoPath && isProcessAlive(s.pid));
  if (existing) {
    return { success: true, alreadyRunning: true, server: existing };
  }

  // Encontra porta disponível
  const porta = await findAvailablePort(config.port || 8080);

  // npm install se necessário
  if (config.needsNodeModules && !fs.existsSync(path.join(projectDir, 'node_modules'))) {
    const installResult = await runCommand('npm', ['install'], { cwd: projectDir, timeout: 120000 });
    if (!installResult.success) {
      throw new Error(`npm install falhou:\n${installResult.stderr}`);
    }
  }

  // Prepara args com porta se necessário
  const args = [...config.args];
  if (config.portArg === true) {
    args.push(`localhost:${porta}`);
  } else if (config.portArg) {
    args.push(config.portArg, String(porta));
  } else if (config.cmd === 'npx' && config.args[0] === 'serve') {
    // npx serve . -l PORT
    args.push('-l', String(porta));
  }

  const serverId = generateServerId(clientId, demoPath);
  const logFile = getLogPath(serverId);
  ensureDir(LOGS_DIR);
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  logStream.write(`[${nowISO()}] Iniciando ${config.cmd} ${args.join(' ')} em ${projectDir}\n`);

  const child = spawn(config.cmd, args, {
    cwd: projectDir,
    detached: false, // Matamos junto com o backend? Não, detached:true pode causar problemas de PID. Vamos usar false para simplificar.
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(porta), FORCE_COLOR: '1' }
  });

  child.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    lines.forEach(line => {
      logStream.write(`[OUT] ${line}\n`);
      broadcastLog(serverId, line, false);
    });
  });
  child.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    lines.forEach(line => {
      logStream.write(`[ERR] ${line}\n`);
      broadcastLog(serverId, line, true);
    });
  });
  child.on('close', (code) => {
    logStream.write(`[${nowISO()}] Processo encerrado com código ${code}\n`);
    logStream.end();
    cleanupDeadServers();
  });

  // Aguarda um instante para ver se o processo não morreu imediatamente
  await new Promise(r => setTimeout(r, 800));

  if (!isProcessAlive(child.pid)) {
    const logs = getServerLogs(serverId, 20);
    throw new Error(`Servidor morreu imediatamente. Logs:\n${logs}`);
  }

  const server = {
    id: serverId,
    clienteId: clientId,
    demoPath,
    tipo,
    porta,
    url: `http://localhost:${porta}`,
    pid: child.pid,
    comando: `${config.cmd} ${args.join(' ')}`,
    status: 'running',
    iniciadoEm: nowISO(),
    logFile: path.relative(DATA_DIR, logFile)
  };

  state.servidores.push(server);
  saveServersState(state);

  return { success: true, server };
}

// ── STOP ──

function stopServer(serverId) {
  const state = getServersState();
  const idx = state.servidores.findIndex(s => s.id === serverId);
  if (idx < 0) throw new Error('Servidor não encontrado');

  const srv = state.servidores[idx];

  // Tenta graceful kill
  if (isProcessAlive(srv.pid)) {
    try {
      process.kill(srv.pid, 'SIGTERM');
    } catch { /* ignore */ }
  }

  // Aguarda 2s e força kill se ainda vivo
  setTimeout(() => {
    if (isProcessAlive(srv.pid)) {
      try {
        process.kill(srv.pid, 'SIGKILL');
      } catch { /* ignore */ }
    }
  }, 2000);

  state.servidores.splice(idx, 1);
  saveServersState(state);

  return { success: true, stopped: serverId };
}

// ── HELPERS ──

function runCommand(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ success: false, stdout, stderr: stderr + '\n[timeout]' });
    }, options.timeout || 60000);

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ success: code === 0, stdout, stderr });
    });
  });
}

module.exports = {
  startServer,
  stopServer,
  getRunningServers: () => getServersState().servidores,
  getServerLogs,
  cleanupDeadServers,
  isPortInUse,
  findAvailablePort,
  subscribeToLogs,
  unsubscribeFromLogs,
  broadcastLog,
  SERVERS_FILE,
  LOGS_DIR
};
