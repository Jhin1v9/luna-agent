/**
 * Luna Tools v3.0 — Ferramentas nativas completas
 * Inspirado em: Kimi Code CLI, Claude Code, Gemini CLI, Codex CLI, Astra Agent, Qwen Agent
 *
 * Categorias:
 *   📖 File Ops     → readFile, writeFile, appendFile, replaceInFile, deleteFile, moveFile, copyFile, getFileInfo
 *   📂 Directory     → listFiles, viewDirectory, createDirectory, removeDirectory
 *   🔍 Search       → searchFiles, grep, glob, searchWeb, fetchURL
 *   🖥️ Shell         → executeShell, runTests, checkSyntax, installPackages
 *   🌿 Git           → gitStatus, gitDiff, gitLog, gitCommit
 *   🩹 Patch         → applyPatch
 *   🌐 Network       → downloadFile
 *   📋 Clipboard     → clipboardRead, clipboardWrite
 *   🖼️ Media         → readMediaFile
 *   🧠 Reasoning     → think
 *   ⚙️ System        → getCurrentDirectory
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');
const https = require('https');
const http = require('http');
const lunaConfig = require('./config/luna-config');
const { looksBinary } = require('./lib/text-file.cjs');
const { atomicWriteFileSync } = require('./lib/atomic-write.cjs');
const { clampExecTimeout, shQuote } = require('./lib/exec-timeout.cjs');
const { shellQuote, toNonNegInt, assertSafeName } = require('./lib/shell-quote.cjs');
const { checkUrlSafety, fetchAllowList } = require('./lib/url-safety.cjs');
const { resolveTerminal, enrichSessionEnv, _argvFor } = require('./lib/terminal-resolver.cjs');
const { resolveShellTimeout } = require('./lib/build-detect.cjs');
// ═══════════════════════════════════════════════════════════════════════════
// WINDOWS GIT BASH DETECTION (v3.1-fix)
// ═══════════════════════════════════════════════════════════════════════════

const IS_WINDOWS = process.platform === 'win32';

function findGitBash() {
  if (!IS_WINDOWS) return '/bin/bash';
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'C:\\Git\\bin\\bash.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs/Git/bin/bash.exe'),
    path.join(process.env.USERPROFILE || '', 'scoop/apps/git/current/bin/bash.exe'),
    'bash.exe',
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        execSync(`"${candidate}" -c "echo luna-bash-test"`, { 
          encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore']
        });
        return candidate;
      }
    } catch { continue; }
  }
  return null;
}

const GIT_BASH_PATH = findGitBash();
const HAS_GIT_BASH = !!GIT_BASH_PATH;
const DEFAULT_SHELL = IS_WINDOWS ? (HAS_GIT_BASH ? GIT_BASH_PATH : 'cmd.exe') : '/bin/bash';
const DEFAULT_SHELL_FLAG = (IS_WINDOWS && !HAS_GIT_BASH) ? '/c' : '-c';

console.log(`[LUNA] Platform: ${process.platform} | Git Bash: ${HAS_GIT_BASH ? GIT_BASH_PATH : 'NOT FOUND'} | Shell: ${DEFAULT_SHELL}`);


// Wave3-fix G: SSRF caps for the LLM-facing network tools (fetchURL,
// downloadFile, browser) — see lib/url-safety.cjs for the host policy.
const MAX_FETCH_REDIRECTS = 5;
const DEFAULT_FETCH_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024;

// Wave3-fix D: GNU `timeout` runs the command in its own process group and
// signals the whole group — execSync's native timeout only kills the direct
// /bin/sh child, orphaning grandchildren. Detect once at load.
const HAS_GNU_TIMEOUT = (() => {
  try {
    execSync('timeout --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

// v10.28-fix: Centralize runtime paths via LUNA_HOME. Auto-create dirs so the
// Luna never fails with ENOENT on temp files across different PCs/VPS.
const LUNA_TMP_DIR = lunaConfig.PATHS.tmp;
lunaConfig.ensureDir(LUNA_TMP_DIR);

// Load .env from dashboard (dynamic path)
const ENV_PATHS = [
  path.join(lunaConfig.NEXO_DIR, 'backend', '.env'),
  path.join(lunaConfig.NEXO_DIR, '.env'),
];
for (const ENV_PATH of ENV_PATHS) {
  if (fs.existsSync(ENV_PATH)) {
    fs.readFileSync(ENV_PATH, 'utf8').split('\n').forEach(line => {
      const eq = line.indexOf('=');
      if (eq > 0 && !line.startsWith('#')) {
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim();
        if (key && process.env[key] === undefined) process.env[key] = val;
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TELEGRAM NOTIFICATIONS (v8.5)
// ═══════════════════════════════════════════════════════════════════════════

const TELEGRAM_SERVICE_PATH = path.join(lunaConfig.NEXO_DIR, 'backend', 'services', 'telegram-notification.service.js');
let telegramNotify = null;
try {
  if (fs.existsSync(TELEGRAM_SERVICE_PATH)) {
    telegramNotify = require(TELEGRAM_SERVICE_PATH);
  }
} catch (e) {
  console.warn('[luna-tools] Telegram notify service not available:', e.message);
}

function detectUser() {
  // Detect who is calling the tool: Luna agent, Abner, Nonoke, Elias, etc.
  const envUser = process.env.LUNA_USER || process.env.USER || '';
  const lower = envUser.toLowerCase();
  if (lower.includes('luna')) return 'luna';
  if (lower.includes('abner')) return 'abner';
  if (lower.includes('nonoke')) return 'nonoke';
  if (lower.includes('elias')) return 'elias';
  return 'luna';
}

function notifyChange(type, data) {
  if (!telegramNotify || !telegramNotify.notifyDashboardChange) return;
  const user = detectUser();
  // Fire-and-forget: don't block the tool
  telegramNotify.notifyDashboardChange(type, data, user).catch(() => {});
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function detectHeadless() {
  // v10.29-fix: Auto-detect headless/VPS environments where no graphical terminal
  // is available. This prevents terminal spawn failures on servers/SSH.
  if (process.env.LUNA_HEADLESS === '1') return true;
  if (process.env.LUNA_HEADLESS === '0') return false;
  // SSH sessions are almost always headless
  if (process.env.SSH_CLIENT || process.env.SSH_TTY || process.env.SSH_CONNECTION) return true;
  // W6-T10: consult the self-repaired session env (not the stale PM2 snapshot)
  // and the system terminal resolver — no per-call execSync('which ...').
  const env = enrichSessionEnv(process.env);
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return true;
  // If no terminal emulator is resolvable, we cannot run visible mode anyway
  return resolveTerminal(env) === null;
}

function resolvePath(p) {
  if (!p) return process.cwd();
  if (p.startsWith('~/')) return path.join(require('os').homedir(), p.slice(2));
  return path.resolve(p);
}

function ok(result) {
  return { success: true, ...result };
}

function err(message, extra = {}) {
  return { success: false, error: message, ...extra };
}

function safeExec(cmd, opts = {}) {
  const timeoutMs = clampExecTimeout(opts.timeout); // seconds in, ms out; default 60s, cap 600s
  let finalCmd = cmd;
  let execTimeout = timeoutMs;
  if (HAS_GNU_TIMEOUT) {
    // execSync's own timeout only SIGTERMs the direct child (/bin/sh) — the
    // shell's children survive as orphans. GNU `timeout` runs the command in
    // its own process group and signals the WHOLE group (TERM, then KILL
    // after 10s), so a timed-out rg/git/npx actually dies. execSync's
    // timeout stays as a backstop slightly larger than the wrapper.
    const sec = Math.ceil(timeoutMs / 1000);
    finalCmd = `timeout -k 10 ${sec} sh -c ${shQuote(cmd)}`;
    execTimeout = timeoutMs + 15000;
  }
  try {
    const output = execSync(finalCmd, {
      shell: IS_WINDOWS ? GIT_BASH_PATH : undefined,
      encoding: 'utf8',
      cwd: opts.cwd || process.cwd(),
      timeout: execTimeout,
      maxBuffer: opts.maxBuffer || 1024 * 1024,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return { success: true, stdout: output, stderr: '', exitCode: 0 };
  } catch (e) {
    return {
      success: false,
      stdout: e.stdout || '',
      stderr: e.stderr || '',
      exitCode: e.status || 1,
      error: e.message,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. FILE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

// v13.0 (owner directive 2026-08-13): readFile returns the WHOLE file by default.
const READFILE_DEFAULT_MAX_BYTES = Number.POSITIVE_INFINITY;

function readFile(filePath, opts = {}) {
  const resolved = resolvePath(filePath);
  if (!fs.existsSync(resolved)) return err(`Arquivo não encontrado: ${filePath}`);
  try {
    const stat = fs.statSync(resolved);
    const maxBytes = opts.maxBytes || READFILE_DEFAULT_MAX_BYTES;
    let buffer;
    let truncatedBytes = false;
    if (stat.size > maxBytes) {
      // Read only the first maxBytes — do NOT load the whole file into memory.
      buffer = Buffer.alloc(maxBytes);
      const fd = fs.openSync(resolved, 'r');
      try {
        // Slice to the bytes actually read: if the file shrinks between
        // statSync and readSync, the zero-filled tail would trip looksBinary.
        const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0);
        buffer = buffer.subarray(0, bytesRead);
      } finally {
        fs.closeSync(fd);
      }
      truncatedBytes = true;
    } else {
      buffer = fs.readFileSync(resolved);
    }
    if (looksBinary(buffer)) {
      return err(`Arquivo binário (${stat.size} bytes): ${filePath}. Use readMediaFile para imagens/vídeo.`);
    }
    const content = buffer.toString('utf8');
    const lines = content.split('\n');
    // On truncated reads this is the CHUNK's line count, not the file's —
    // content beyond maxBytes is unreachable via this tool (see note below).
    const totalLines = lines.length;
    let offset = (opts.offset || opts.line_offset || 1) - 1;
    let limit = opts.limit || opts.n_lines || totalLines; // v13.0: all lines by default

    // Support negative offset (read from end)
    if (offset < 0) {
      offset = Math.max(0, totalLines + offset);
    }
    limit = Math.min(limit, totalLines - offset);

    const numbered = lines
      .slice(offset, offset + limit)
      .map((line, i) => `${(offset + i + 1).toString().padStart(4, ' ')} │ ${line}`)
      .join('\n');

    return ok({
      path: resolved,
      content: numbered,
      totalLines,
      linesRead: Math.max(0, limit),
      truncatedBytes: truncatedBytes || undefined,
      note: truncatedBytes
        ? `Arquivo tem ${stat.size} bytes; exibidos apenas os primeiros ${buffer.length} (~${totalLines} linhas). O restante NÃO é acessível via readFile — use executeShell (sed/tail) ou grep/searchFiles para o conteúdo além desse limite.`
        : undefined,
    });
  } catch (e) {
    return err(e.message);
  }
}

function writeFile(filePath, content, opts = {}) {
  const resolved = resolvePath(filePath);
  try {
    const dir = path.dirname(resolved);
    let createdDir = false;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      createdDir = true;
    }
    let finalContent = content;
    if (opts.encoding === 'base64' && typeof content === 'string') {
      finalContent = Buffer.from(content, 'base64');
    }
    atomicWriteFileSync(resolved, finalContent);
    return ok({
      path: resolved,
      operation: 'write',
      bytes: Buffer.byteLength(finalContent, finalContent instanceof Buffer ? undefined : 'utf8'),
      createdDir: createdDir || undefined,
      message: createdDir ? `PASTA AINDA NAO CRIADA. CRIEI PRIMEIRO: ${dir}` : undefined,
    });
  } catch (e) {
    return err(e.message);
  }
}

function appendFile(filePath, content, opts = {}) {
  const resolved = resolvePath(filePath);
  try {
    const dir = path.dirname(resolved);
    let createdDir = false;
    let createdFile = false;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      createdDir = true;
    }
    if (!fs.existsSync(resolved)) {
      fs.writeFileSync(resolved, '', 'utf8');
      createdFile = true;
    }
    fs.appendFileSync(resolved, content, 'utf8');
    return ok({
      path: resolved,
      operation: 'append',
      bytes: Buffer.byteLength(content, 'utf8'),
      createdDir: createdDir || undefined,
      createdFile: createdFile || undefined,
      message: createdDir
        ? `PASTA AINDA NAO CRIADA. CRIEI PRIMEIRO: ${dir}`
        : createdFile
          ? `ARQUIVO NAO CRIADO. CRIEI PRIMEIRO PRA DEPOIS ESCREVER: ${resolved}`
          : undefined,
    });
  } catch (e) {
    return err(e.message);
  }
}

function replaceInFile(filePath, oldStr, newStr, opts = {}) {
  const resolved = resolvePath(filePath);

  if (!fs.existsSync(resolved)) {
    return err(`Arquivo não encontrado: ${filePath}. Use writeFile para criar novos arquivos.`);
  }

  try {
    let content = fs.readFileSync(resolved, 'utf8');

    // Support array of edits
    const edits = opts.edit ? (Array.isArray(opts.edit) ? opts.edit : [opts.edit]) : [];
    if (edits.length > 0) {
      for (const edit of edits) {
        const oldS = edit.old || edit.oldStr;
        const newS = edit.new || edit.newStr;
        if (!oldS) continue;
        content = content.split(oldS).join(newS);
      }
      atomicWriteFileSync(resolved, content);
      return ok({
        path: resolved,
        editsApplied: edits.length,
      });
    }

    // Single edit
    const target = oldStr || opts.old || opts.oldStr;
    const replacement = newStr || opts.new || opts.newStr;
    if (!target) return err('oldStr é obrigatório');

    const occurrences = content.split(target).length - 1;
    if (occurrences === 0) return err(`String não encontrada em ${filePath}`);
    if (!opts.replaceAll && occurrences > 1) {
      return err(`Múltiplas ocorrências (${occurrences}). Use replaceAll=true.`, { occurrences });
    }
    content = content.split(target).join(replacement);
    atomicWriteFileSync(resolved, content);
    return ok({
      path: resolved,
      occurrences,
    });
  } catch (e) {
    return err(e.message);
  }
}

function toMsysPath(winPath) {
  if (!IS_WINDOWS || !winPath) return winPath;
  const normalized = winPath.replace(/\\/g, '/');
  const m = normalized.match(/^([A-Za-z]):\/(.+)$/);
  if (m) return `/${m[1].toLowerCase()}/${m[2]}`;
  return normalized;
}

function executeScript(code, opts = {}) {
  if (!code || typeof code !== 'string') return err('Código do script é obrigatório');

  const language = opts.language || opts.lang || 'bash';
  // v10.36-fix: Default to the user's workspace, not the luna-server directory.
  const cwd = opts.cwd ? resolvePath(opts.cwd) : (lunaConfig.PATHS.workspaceBase || process.cwd());
  const timeout = opts.timeout || 120000;
  const isBashLike = ['bash', 'sh', 'shell'].includes(language.toLowerCase());

  // Mapeia linguagem para extensão e executor
  const langMap = {
    bash: { ext: 'sh', executor: IS_WINDOWS && HAS_GIT_BASH ? toMsysPath(GIT_BASH_PATH) : 'bash', shell: true },
    sh: { ext: 'sh', executor: IS_WINDOWS && HAS_GIT_BASH ? toMsysPath(GIT_BASH_PATH) : 'bash', shell: true },
    shell: { ext: 'sh', executor: IS_WINDOWS && HAS_GIT_BASH ? toMsysPath(GIT_BASH_PATH) : 'bash', shell: true },
    powershell: { ext: 'ps1', executor: 'pwsh', shell: true },
    ps1: { ext: 'ps1', executor: 'pwsh', shell: true },
    python: { ext: 'py', executor: 'python3', shell: true },
    py: { ext: 'py', executor: 'python3', shell: true },
    node: { ext: 'js', executor: 'node', shell: true },
    js: { ext: 'js', executor: 'node', shell: true },
    javascript: { ext: 'js', executor: 'node', shell: true },
  };

  const config = langMap[language.toLowerCase()];
  if (!config) return err(`Linguagem não suportada: ${language}. Use: bash, python, node, powershell`);

  const scriptPath = path.join(LUNA_TMP_DIR, `luna-script-${Date.now()}.${config.ext}`);

  try {
    fs.writeFileSync(scriptPath, code, 'utf8');
    fs.chmodSync(scriptPath, 0o755);

    // Windows + Git Bash: pass MSYS-style paths so bash can resolve the script.
    const scriptArg = (IS_WINDOWS && HAS_GIT_BASH && isBashLike) ? toMsysPath(scriptPath) : scriptPath;

    // Executa o script
    const result = safeExec(`${shellQuote(config.executor)} ${shellQuote(scriptArg)}`, { cwd, timeout: timeout / 1000 });

    // Limpa arquivo temporário (não bloqueante)
    try { fs.unlinkSync(scriptPath); } catch {}

    if (result.exitCode !== 0) {
      return err(`Script ${language} falhou (exit ${result.exitCode})`, {
        language,
        scriptPath,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.exitCode,
      });
    }

    return ok({
      language,
      scriptPath,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      exitCode: result.exitCode || 0,
      message: `✅ Script ${language} executado com sucesso`,
    });
  } catch (e) {
    try { fs.unlinkSync(scriptPath); } catch {}
    return err(`Falha ao executar script: ${e.message}`);
  }
}

function deleteFile(filePath) {
  const resolved = resolvePath(filePath);
  if (!fs.existsSync(resolved)) return err(`Arquivo não encontrado: ${filePath}`);
  try {
    fs.unlinkSync(resolved);
    return ok({ path: resolved, operation: 'delete' });
  } catch (e) {
    return err(e.message);
  }
}

function moveFile(source, destination) {
  const src = resolvePath(source);
  const dst = resolvePath(destination);
  if (!fs.existsSync(src)) return err(`Origem não encontrada: ${source}`);
  try {
    const dir = path.dirname(dst);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.renameSync(src, dst);
    return ok({ source: src, destination: dst, operation: 'move' });
  } catch (e) {
    return err(e.message);
  }
}

function copyFile(source, destination) {
  const src = resolvePath(source);
  const dst = resolvePath(destination);
  if (!fs.existsSync(src)) return err(`Origem não encontrada: ${source}`);
  try {
    const dir = path.dirname(dst);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(src, dst);
    return ok({ source: src, destination: dst, operation: 'copy' });
  } catch (e) {
    return err(e.message);
  }
}

function getFileInfo(filePath) {
  const resolved = resolvePath(filePath);
  if (!fs.existsSync(resolved)) return err(`Arquivo não encontrado: ${filePath}`);
  try {
    const stat = fs.statSync(resolved);
    return ok({
      path: resolved,
      size: stat.size,
      isDirectory: stat.isDirectory(),
      isFile: stat.isFile(),
      modified: stat.mtime.toISOString(),
      created: stat.birthtime.toISOString(),
      permissions: stat.mode.toString(8).slice(-3),
    });
  } catch (e) {
    return err(e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. DIRECTORY OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

function listFiles(pattern, opts = {}) {
  try {
    let files;
    const cwd = opts.cwd || process.cwd();
    const resolvedPattern = resolvePath(pattern) || '*';

    if (resolvedPattern.includes('*')) {
      // Use glob if pattern has wildcards
      try {
        const { globSync } = require('glob');
        files = globSync(resolvedPattern, {
          cwd,
          dot: opts.dot || false,
          ignore: opts.ignore || ['node_modules/**', '.git/**', 'dist/**', 'build/**', '.next/**', 'out/**', 'coverage/**', '.cache/**', '.turbo/**', '.vercel/**', '.output/**', 'logs/**', 'tmp/**', 'temp/**', '*.log', '*.map', '*.min.js', '*.min.css'],
          absolute: opts.absolute !== false,
        });
      } catch {
        // Fallback to fs.readdir
        const baseDir = path.dirname(resolvedPattern);
        const all = fs.readdirSync(baseDir).map(f => path.join(baseDir, f));
        files = all;
      }
    } else {
      const dir = fs.existsSync(resolvedPattern) && fs.statSync(resolvedPattern).isDirectory()
        ? resolvedPattern
        : cwd;
      files = fs.readdirSync(dir).map(f => path.join(dir, f));
    }

    const withStats = files.slice(0, opts.limit || files.length).map(f => { // v13.0: no default cap
      try {
        const stat = fs.statSync(f);
        return { path: f, size: stat.size, isDir: stat.isDirectory(), modified: stat.mtime.toISOString() };
      } catch {
        return { path: f, error: 'Cannot stat' };
      }
    });

    return ok({ pattern: resolvedPattern, count: files.length, files: withStats, truncated: files.length > (opts.limit || 100) });
  } catch (e) {
    return err(e.message);
  }
}

// v6.2-fix: Ignore patterns to prevent flooding context with useless files
const DEFAULT_IGNORE_PATTERNS = [
  'node_modules', '.git', 'dist', 'build', '.next', 'out',
  'coverage', '.cache', '.turbo', '.vercel', '.output',
  '.npm', '.pnp', '.yarn', 'logs', 'tmp', 'temp',
  '.env', '.env.local', '.env.production', '.env.development',
  '.DS_Store', 'Thumbs.db',
];
const IGNORED_EXTENSIONS = ['.log', '.map', '.min.js', '.min.css', '.lock'];

function shouldIgnore(name) {
  // Check exact name matches
  if (DEFAULT_IGNORE_PATTERNS.includes(name)) return true;
  // Check extension matches
  const ext = path.extname(name).toLowerCase();
  if (IGNORED_EXTENSIONS.includes(ext)) return true;
  // Check wildcard patterns
  if (name.startsWith('.') && name !== '.' && name !== '..') {
    // Hidden files — only skip known noise, not all hidden files
    if (['.gitignore', '.env.example', '.env.template', '.eslintrc', '.prettierrc', '.babelrc', '.editorconfig'].includes(name)) {
      return false; // Keep these useful config files
    }
  }
  return false;
}

function viewDirectory(dirPath, opts = {}) {
  const resolved = resolvePath(dirPath || '.');
  if (!fs.existsSync(resolved)) return err(`Diretório não encontrado: ${dirPath}`);
  try {
    const maxDepth = opts.depth || 3;
    let itemsCount = 0;
    const MAX_ITEMS = opts.maxItems || Number.POSITIVE_INFINITY; // v13.0 (owner directive 2026-08-13): no item cap
    let truncated = false;

    function buildTree(dir, depth) {
      if (depth > maxDepth) return [];
      const items = fs.readdirSync(dir, { withFileTypes: true });
      const result = [];
      for (const item of items) {
        if (shouldIgnore(item.name)) continue;
        if (itemsCount >= MAX_ITEMS) {
          truncated = true;
          break;
        }
        itemsCount++;
        const fullPath = path.join(dir, item.name);
        const prefix = '  '.repeat(depth);
        if (item.isDirectory()) {
          const children = depth < maxDepth ? buildTree(fullPath, depth + 1) : [];
          result.push({ name: item.name, path: fullPath, type: 'dir', prefix: `${prefix}📁 `, children });
        } else {
          let size = 0;
          try {
            const stat = fs.statSync(fullPath);
            size = stat.size;
          } catch (statErr) {
            // File may be a broken symlink, socket, or otherwise inaccessible
            size = 0;
          }
          result.push({ name: item.name, path: fullPath, type: 'file', size, prefix: `${prefix}📄 ` });
        }
      }
      return result;
    }
    const tree = buildTree(resolved, 0);
    const output = { path: resolved, entries: tree, total: itemsCount, truncated };
    // v13.0 (F2.2): readable tree text — primary feedback channel (frontend and
    // model no longer need to know the entries structure).
    const renderLines = (items) => items.flatMap(it => it.type === 'dir'
      ? [`${it.prefix}${it.name}/`, ...renderLines(it.children || [])]
      : [`${it.prefix}${it.name}`]);
    output.text = itemsCount === 0
      ? `Diretório ${resolved} está vazio.`
      : `${resolved} (${itemsCount} itens):\n${renderLines(tree).join('\n')}`;
    if (truncated) {
      output.warning = `Diretório muito grande. Mostrando ${MAX_ITEMS} itens. Use grep ou searchFiles para encontrar arquivos específicos.`;
    }
    return ok(output);
  } catch (e) {
    return err(e.message);
  }
}

function createDirectory(dirPath) {
  const resolved = resolvePath(dirPath);
  try {
    fs.mkdirSync(resolved, { recursive: true });
    return ok({ path: resolved, operation: 'mkdir' });
  } catch (e) {
    return err(e.message);
  }
}

function removeDirectory(dirPath) {
  const resolved = resolvePath(dirPath);
  if (!fs.existsSync(resolved)) return err(`Diretório não encontrado: ${dirPath}`);
  try {
    fs.rmSync(resolved, { recursive: true, force: true });
    return ok({ path: resolved, operation: 'rmdir' });
  } catch (e) {
    return err(e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. SEARCH
// ═══════════════════════════════════════════════════════════════════════════

function searchFiles(pattern, opts = {}) {
  try {
    const cwd = resolvePath(opts.cwd || opts.path || '.');
    // v13.0 (F3.5): a pattern with glob metacharacters is a FILE-NAME search,
    // not a content regex — rg treats '*.txt' as a nonsense positional regex
    // and finds nothing. Route wildcard patterns to glob-by-name instead.
    if (/[*?\\[]/.test(pattern || '')) {
      const g = glob(pattern, { cwd, dot: opts.dot, ignore: opts.ignore, absolute: opts.absolute, limit: opts.limit || opts.head_limit });
      if (!g.success) return g;
      const files = g.files || [];
      return ok({
        pattern,
        matches: g.count ?? files.length,
        results: files,
        truncated: (g.count || 0) > files.length,
        text: files.length === 0
          ? `Nenhum arquivo correspondente a "${pattern}" em ${cwd}.`
          : `Encontrados ${g.count ?? files.length} arquivo(s) correspondentes a "${pattern}" em ${cwd}:\n${files.join('\n')}`,
      });
    }
    // Prefer ripgrep if available
    const hasRg = (() => { try { execSync('which rg', { stdio: 'ignore' }); return true; } catch { return false; } })();
    let cmd;
    if (hasRg) {
      cmd = `rg -n --color=never -C ${toNonNegInt(opts['-C'] ?? opts.context, 2, 100)} --glob '!{node_modules/*,.git/*,dist/*,build/*,coverage/*,*.lock,*.log,*.min.*}' ${shellQuote(pattern)} ${shellQuote(cwd)}`;
    } else {
      cmd = `grep -rn --color=never -C ${toNonNegInt(opts['-C'] ?? opts.context, 2, 100)} --exclude-dir={node_modules,.git,dist,build,coverage,venv,.venv,__pycache__} --exclude={*.lock,*.log,*.min.*} ${shellQuote(pattern)} ${shellQuote(cwd)}`;
    }
    const result = safeExec(cmd, { timeout: opts.timeout });
    if (!result.success) {
      if (result.exitCode === 1) return ok({ pattern, matches: 0, results: [], text: `Nenhum resultado para "${pattern}" em ${cwd}.` });
      return err(result.error || result.stderr);
    }
    const lines = result.stdout.trim().split('\n').filter(Boolean);
    const shown = lines.slice(0, opts.limit || opts.head_limit || lines.length); // v13.0: no default cap
    return ok({
      pattern,
      matches: lines.length,
      results: shown,
      truncated: lines.length > shown.length,
      // v13.0 (F2.2): unified readable text — primary feedback channel
      text: `Encontrados ${lines.length} resultado(s) para "${pattern}" em ${cwd}:\n${shown.join('\n')}${lines.length > shown.length ? `\n... +${lines.length - shown.length} (truncado)` : ''}`,
    });
  } catch (e) {
    return err(e.message);
  }
}

function grep(pattern, opts = {}) {
  try {
    const cwd = resolvePath(opts.cwd || opts.path || '.');
    const hasRg = (() => { try { execSync('which rg', { stdio: 'ignore' }); return true; } catch { return false; } })();
    let cmd;
    const outputMode = opts.output_mode || 'content';
    const headLimit = opts.head_limit || 0; // v13.0: 0 = no cap (resolved after exec)
    const includeGlob = opts.glob ? `--include=${shellQuote(opts.glob)}` : (opts.include ? `--include=${shellQuote(opts.include)}` : '');
    if (hasRg) {
      const rgGlob = opts.glob ? `-g ${shellQuote(opts.glob)}` : '';
      cmd = `rg -n --color=never ${rgGlob} -C ${toNonNegInt(opts['-C'] ?? opts.context, 2, 100)} ${shellQuote(pattern)} ${shellQuote(cwd)}`;
    } else {
      cmd = `grep -rn --color=never ${includeGlob} -C ${toNonNegInt(opts['-C'] ?? opts.context, 2, 100)} --exclude-dir={node_modules,.git,dist,build} ${shellQuote(pattern)} ${shellQuote(cwd)}`;
    }
    const result = safeExec(cmd, { timeout: opts.timeout });
    if (!result.success) {
      if (result.exitCode === 1) return ok({ pattern, matches: 0, results: [], text: `Nenhum resultado para "${pattern}" em ${cwd}.` });
      return err(result.error || result.stderr);
    }
    const lines = result.stdout.trim().split('\n').filter(Boolean);
    const shown = lines.slice(0, headLimit > 0 ? headLimit : lines.length); // v13.0: no default cap
    return ok({
      pattern,
      matches: lines.length,
      results: shown,
      truncated: lines.length > shown.length,
      // v13.0 (F2.2): unified readable text — primary feedback channel
      text: `Encontrados ${lines.length} resultado(s) para "${pattern}" em ${cwd}:\n${shown.join('\n')}${lines.length > shown.length ? `\n... +${lines.length - shown.length} (truncado)` : ''}`,
    });
  } catch (e) {
    return err(e.message);
  }
}

function glob(pattern, opts = {}) {
  try {
    const cwd = resolvePath(opts.cwd || '.');
    const { globSync } = require('glob');
    const files = globSync(pattern, {
      cwd,
      dot: opts.dot || false,
      ignore: opts.ignore || ['node_modules/**', '.git/**', 'dist/**', 'build/**'],
      absolute: opts.absolute !== false,
    });
    return ok({ pattern, count: files.length, files: files.slice(0, opts.limit || files.length) }); // v13.0: no default cap
  } catch (e) {
    return err(e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3b. WEB SEARCH (SerpAPI → Brave → DuckDuckGo fallback)
function _serializeSearchResults(query, engine, results, limit) {
  const content = results.length
    ? results.slice(0, limit).map((r, i) => `${i + 1}. ${r.title}\nURL: ${r.url}\n${r.snippet}`).join('\n\n')
    : 'Nenhum resultado encontrado.';
  return { query, engine, results: results.slice(0, limit), count: results.length, content, stdout: content };
}

async function searchWeb(query, opts = {}) {
  const limit = opts.limit || 10;

  // 1. Yahoo Search via real browser (currently works with residential IP)
  try {
    const yahooUrl = 'https://search.yahoo.com/search?p=' + encodeURIComponent(query);
    const yahooResult = await browser(yahooUrl, { waitUntil: 'networkidle', timeout: 30000, limit: 50000 });
    if (yahooResult.success && yahooResult.content) {
      const results = [];
      const itemRegex = new RegExp('<div[^>]*class="[^"]*(?:algo|web-res)[^"]*"[^>]*>[\\\\s\\\\S]*?<a[^>]*href="([^"]*)"[^>]*>[\\\\s\\\\S]*?</a>[\\\\s\\\\S]*?</div>', 'gi');
      let match;
      while ((match = itemRegex.exec(yahooResult.content)) !== null && results.length < limit) {
        const block = match[0];
        const urlMatch = block.match(new RegExp('href="([^"]*)"'));
        const titleMatch = block.match(new RegExp('<h3[^>]*>([\\\\s\\\\S]*?)<\\\\/h3>'));
        const snippetMatch = block.match(new RegExp('<p[^>]*class="[^"]*fc-falcon[^"]*"[^>]*>([\\\\s\\\\S]*?)<\\\\/p>')) ||
                             block.match(new RegExp('<span[^>]*class="[^"]*fc-falcon[^"]*"[^>]*>([\\\\s\\\\S]*?)<\\\\/span>'));
        if (urlMatch && titleMatch) {
          const url = urlMatch[1].replace(/&amp;/g, '&');
          const title = titleMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
          const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim() : '';
          if (title && url && !url.includes('search.yahoo.com/search;_ylt')) {
            results.push({ title, url, snippet });
          }
        }
      }
      if (results.length) return ok(_serializeSearchResults(query, 'yahoo', results, limit));
    }
  } catch (e) {
    console.log('[LUNA] Yahoo search failed:', e.message);
  }

  // 2. DuckDuckGo scraping fallback (often blocked; kept as last resort)
  try {
    const searchUrl = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
    const ddg = await new Promise((resolve, reject) => {
      const client = searchUrl.startsWith('https:') ? https : http;
      const req = client.get(searchUrl, {
        timeout: opts.timeout || 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let nextUrl;
          try { nextUrl = new URL(res.headers.location, searchUrl).href; } catch { return reject(new Error('Search redirect inválido')); }
          return fetchURL(nextUrl, opts).then(resolve).catch(reject);
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Search timeout')); });
    });

    const results = [];
    const resultRegex = new RegExp('<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\\\\s\\\\S]*?)<\\\\/a>[\\\\s\\\\S]*?<a[^>]*class="result__snippet"[^>]*>([\\\\s\\\\S]*?)<\\\\/a>', 'gi');
    let match;
    while ((match = resultRegex.exec(ddg)) !== null && results.length < limit) {
      const url = match[1].replace(/&amp;/g, '&');
      const title = match[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
      const snippet = match[3].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
      if (title && url) results.push({ title, url, snippet });
    }
    if (results.length) return ok(_serializeSearchResults(query, 'duckduckgo', results, limit));
  } catch (e) {
    console.log('[LUNA] DuckDuckGo fallback failed:', e.message);
  }

  // 3. All engines failed
  return err('Nenhum motor de busca gratuito conseguiu retornar resultados. Yahoo e DuckDuckGo estão bloqueando requisições automatizadas. Tente novamente em alguns minutos ou use fetchURL com uma URL específica.');
}
// 3c. BROWSER (Playwright navigation for JS-heavy pages)
// ═══════════════════════════════════════════════════════════════════════════

let browserInstance = null;
let browserContext = null;

async function getBrowserContext() {
  try {
    if (!browserInstance) {
      const { chromium } = require('playwright');
      browserInstance = await chromium.launch({ headless: true });
    }
    if (!browserContext) {
      browserContext = await browserInstance.newContext({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
    }
    return browserContext;
  } catch (e) {
    throw new Error('Browser not available: ' + e.message);
  }
}

async function browser(url, opts = {}) {
  // Wave3-fix G: SSRF guard — validate before page.goto (the fetchURL
  // fallback below re-checks anyway).
  const safety = checkUrlSafety(url, fetchAllowList());
  if (!safety.ok) return err(`browser bloqueado: ${safety.reason}`);
  try {
    const ctx = await getBrowserContext();
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: opts.waitUntil || 'domcontentloaded', timeout: opts.timeout || 20000 });
      // Wait for network idle if requested (for JS-heavy pages)
      if (opts.waitUntil === 'networkidle') {
        await page.waitForLoadState('networkidle', { timeout: opts.timeout || 20000 });
      }
      // Extract page content
      const title = await page.title().catch(() => '');
      const content = await page.evaluate(() => {
        // Remove script/style/nav/footer elements for cleaner text
        const clones = document.body.cloneNode(true);
        clones.querySelectorAll('script, style, nav, footer, aside, .advertisement, .ads').forEach(el => el.remove());
        return clones.innerText || '';
      });
      const screenshot = opts.screenshot ? await page.screenshot({ fullPage: opts.fullPage, type: 'png', encoding: 'base64' }) : null;
      return ok({
        url,
        title,
        content: opts.limit ? content.slice(0, opts.limit) : content, // v13.0: no default cap
        screenshot: screenshot ? `data:image/png;base64,${screenshot}` : null,
      });
    } finally {
      await page.close();
    }
  } catch (e) {
    // Fallback to fetchURL if browser fails
    if (opts.noFallback) return err(e.message);
    return fetchURL(url, opts);
  }
}

function fetchURL(url, opts = {}) {
  return new Promise((resolve) => {
    // Wave3-fix G: SSRF guard — default-deny private/loopback/metadata hosts,
    // re-validated on EVERY redirect (an allowed host must not bounce to
    // 169.254.169.254). Owner override: LUNA_FETCH_ALLOW_HOSTS.
    const safety = checkUrlSafety(url, fetchAllowList());
    if (!safety.ok) return resolve(err(`fetchURL bloqueado: ${safety.reason}`));
    const redirects = Math.max(0, opts._redirects | 0);
    const maxBytes = opts.maxBytes || DEFAULT_FETCH_MAX_BYTES;
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, {
      timeout: opts.timeout || 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirects >= MAX_FETCH_REDIRECTS) return resolve(err('fetchURL: excesso de redirects (max 5)'));
        let nextUrl;
        try { nextUrl = new URL(res.headers.location, url).href; } catch { return resolve(err('fetchURL: redirect Location inválida')); }
        return fetchURL(nextUrl, { ...opts, _redirects: redirects + 1 }).then(resolve);
      }
      let data = '';
      let received = 0;
      res.on('data', chunk => {
        received += chunk.length;
        if (received > maxBytes) { req.destroy(); return resolve(err('Resposta excede 5MB')); }
        data += chunk;
      });
      res.on('end', () => resolve(ok({ url, status: res.statusCode, content: opts.limit ? data.slice(0, opts.limit) : data }))); // v13.0: no default cap
    });
    req.on('error', (e) => resolve(err(e.message)));
    req.on('timeout', () => { req.destroy(); resolve(err('Timeout')); });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. SHELL
// ═══════════════════════════════════════════════════════════════════════════

// v10.2-fix: Open a visible terminal for long-running commands so user can see progress
function executeShellVisible(command, opts = {}, onProgress) {
  return new Promise((resolve) => {
    const cwd = opts.cwd ? resolvePath(opts.cwd) : process.cwd();
    const tmpFile = path.join(LUNA_TMP_DIR, `luna-shell-${Date.now()}.log`);
    const scriptFile = path.join(LUNA_TMP_DIR, `luna-script-${Date.now()}.sh`);

    // Script that runs the command, streams output to both terminal and tmpFile via tee
    const scriptContent = `#!/bin/bash
set -o pipefail
cd ${shellQuote(cwd)}
${command} 2>&1 | tee "${tmpFile}"
EXIT_CODE=$?
echo ""
echo "[LUNA_EXIT_CODE=\${EXIT_CODE}]"
`;

    fs.writeFileSync(scriptFile, scriptContent, 'utf8');
    fs.chmodSync(scriptFile, 0o755);

    // W6-T10: resolve ANY system terminal and repair the session env ourselves —
    // the PM2-inherited env is a stale snapshot (rotated Xauth, missing D-Bus).
    const env = enrichSessionEnv(process.env);
    const term = resolveTerminal(env);
    if (!term) {
      try { fs.unlinkSync(scriptFile); } catch {}
      try { fs.unlinkSync(tmpFile); } catch {}
      // W6-T10: resolver-null fallback; W6-T11: annotate so the user sees the degradation
      executeShell(command, { ...opts, visible: false }, onProgress).then((fallback) => {
        fallback.warning = '⚠️ Terminal visível não abriu — executado em modo invisível';
        fallback.visibleFallback = true;
        resolve(fallback);
      });
      return;
    }
    const child = spawn(term.bin, _argvFor(term.style, term.bin, scriptFile, term.extra).slice(1), {
      env,
      detached: true,
    });

    // Poll tmpFile for live progress
    let lastSize = 0;
    let output = '';
    const pollInterval = setInterval(() => {
      try {
        const stats = fs.statSync(tmpFile);
        if (stats.size > lastSize) {
          const fd = fs.openSync(tmpFile, 'r');
          const buffer = Buffer.alloc(stats.size - lastSize);
          fs.readSync(fd, buffer, 0, buffer.length, lastSize);
          fs.closeSync(fd);
          const newContent = buffer.toString('utf8');
          output += newContent;
          lastSize = stats.size;
          if (onProgress) onProgress(newContent, 'stdout');
        }
      } catch {}
    }, 500);

    child.on('error', async (err) => {
      clearInterval(pollInterval);
      try { fs.unlinkSync(scriptFile); } catch {}
      try { fs.unlinkSync(tmpFile); } catch {}
      // v10.29-fix: If graphical terminal cannot be spawned (headless/VPS),
      // fallback to invisible shell execution so the command still runs.
      console.warn(`[executeShellVisible] Terminal spawn failed: ${err.message}. Falling back to invisible shell.`);
      const fallback = await executeShell(command, { ...opts, visible: false }, onProgress);
      fallback.warning = '⚠️ Terminal visível não abriu — executado em modo invisível';
      fallback.visibleFallback = true;
      resolve(fallback);
    });

    child.on('close', () => {
      clearInterval(pollInterval);
      // Give tee a moment to flush
      setTimeout(async () => {
        try {
          const finalOutput = fs.readFileSync(tmpFile, 'utf8');
          const exitMatch = finalOutput.match(/\[LUNA_EXIT_CODE=(\d+)\]/);
          const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : 0;
          const cleanOutput = finalOutput.replace(/\[LUNA_EXIT_CODE=\d+\]\s*$/, '').trim();
          try { fs.unlinkSync(scriptFile); } catch {}
          try { fs.unlinkSync(tmpFile); } catch {}
          const { reason, suggestion } = _classifyShellError(command, cleanOutput, exitCode, false, opts.timeout || 60);
          resolve({
            success: exitCode === 0,
            command,
            stdout: cleanOutput,
            stderr: '',
            exitCode,
            reason: exitCode !== 0 ? reason : undefined,
            suggestion: exitCode !== 0 ? suggestion : undefined,
          });
        } catch (e) {
          try { fs.unlinkSync(scriptFile); } catch {}
          try { fs.unlinkSync(tmpFile); } catch {}
          // Wave 6 hotfix: ENOENT on the log means the graphical terminal never
          // ran the script (PM2 without D-Bus session, Wayland/X auth quirks) —
          // a log file that existed would be at least empty. The command almost
          // certainly never executed, so fall back to the invisible shell
          // instead of reporting a bogus "file not found" failure.
          if (e && e.code === 'ENOENT') {
            console.warn('[executeShellVisible] Terminal produced no log — falling back to invisible shell.');
            const fallback = await executeShell(command, { ...opts, visible: false }, onProgress);
            fallback.warning = '⚠️ Terminal visível não abriu — executado em modo invisível';
            fallback.visibleFallback = true;
            return resolve(fallback);
          }
          const { reason, suggestion } = _classifyShellError(command, e.message, 1, false, opts.timeout || 60);
          resolve({ success: false, command, stdout: output, stderr: e.message, exitCode: 1, error: e.message, reason, suggestion });
        }
      }, 500);
    });
  });
}

// v10.2-fix: Global visible mode toggle — when ON, every command opens a terminal
// v10.29-fix: Default to invisible on headless/VPS environments so commands
// still execute instead of failing when no terminal emulator is resolvable.
// W7-T3 (2026-07-12): default to INVISIBLE, always. Visible mode is opt-in
// via the setVisibleMode tool / UI toggle — W6-T10 made detectHeadless see
// the display under PM2, so `!detectHeadless()` opened an uninvited window
// for EVERY tool call. The visible path itself now works for real (xterm-style
// argv, lib/terminal-resolver.cjs) when the user explicitly turns it on.
let visibleMode = false;

function setVisibleMode(mode) { visibleMode = mode; }
function getVisibleMode() { return visibleMode; }

// v10.24-fix: Track running visible shells to prevent duplicate terminals
// for the exact same command/cwd. Key: `${cwd}\x00${command}`, Value: Promise.
const _runningShells = new Map();

function _makeShellKey(command, cwd) {
  return `${cwd || process.cwd()}\x00${command}`;
}

// v10.24-fix: Classifica erros de shell para dar contexto claro à Kimi.
function _classifyShellError(command, stderr, exitCode, killed, timeout) {
  const reason = (() => {
    if (killed) return `Timeout: comando excedeu ${timeout}s`;
    if (exitCode === 127 || /command not found|comando não encontrado|not found/i.test(stderr)) return 'Command not found';
    if (/permission denied|permissão negada|EACCES/i.test(stderr)) return 'Permission denied';
    if (/no such file or directory|arquivo ou diretório inexistente|ENOENT/i.test(stderr)) return 'File or directory not found';
    if (/cannot access|não é possível acessar/i.test(stderr)) return 'Path not accessible';
    if (/syntax error|erro de sintaxe/i.test(stderr)) return 'Shell syntax error';
    if (exitCode !== 0) return `Process exited with code ${exitCode}`;
    return 'Unknown error';
  })();

  const suggestion = (() => {
    if (killed) return 'O comando demorou demais. Tente aumentar o timeout ou executar em partes.';
    if (reason === 'Permission denied') return 'O comando precisa de permissões elevadas. Tente usar sudo ou verifique o dono do arquivo.';
    if (reason === 'Command not found') return 'O comando não está instalado ou não está no PATH. Verifique o nome ou instale o pacote.';
    if (reason === 'File or directory not found') return 'Verifique se o caminho está correto e se o arquivo/diretório existe.';
    if (reason === 'Path not accessible') return 'Verifique permissões e se o caminho existe.';
    if (reason === 'Shell syntax error') return 'Reveja a sintaxe do comando. Aspas, parênteses e heredocs devem estar balanceados.';
    return 'Analise o stderr acima e tente uma abordagem diferente.';
  })();

  return { reason, suggestion };
}

function executeShell(command, opts = {}, onProgress) {
  return new Promise((resolve) => {
    // v10.36-fix: Use the user's workspace as default cwd instead of the
    // luna-server process directory. Paths in commands remain absolute/relative
    // as written by the model.
    const cwd = opts.cwd ? resolvePath(opts.cwd) : (lunaConfig.PATHS.workspaceBase || process.cwd());
    // v10.2-fix: Open visible terminal for ALL commands when visibleMode is on
    const isVisibleCommand = opts.visible !== undefined ? opts.visible : visibleMode;
    if (isVisibleCommand && !detectHeadless()) {
      // v10.24-fix: Prevent duplicate visible terminals for the same command/cwd.
      const key = _makeShellKey(command, cwd);
      if (_runningShells.has(key)) {
        console.log(`[LUNA] Reusing running visible shell for: ${command}`);
        return _runningShells.get(key).then(resolve);
      }
      const promise = executeShellVisible(command, opts, onProgress).finally(() => {
        _runningShells.delete(key);
      });
      _runningShells.set(key, promise);
      return promise.then(resolve);
    }
    // v10.1-fix: Auto-detect build/install commands and use longer timeout
    const defaultTimeout = resolveShellTimeout(command, opts);
    const timeoutMs = defaultTimeout * 1000;
    let stdout = '';
    let stderr = '';
    let killed = false;

    // v10.27-fix: Always run via /bin/bash for consistent, surgical shell behavior.
    const child = spawn(DEFAULT_SHELL, [DEFAULT_SHELL_FLAG, command], { cwd, env: process.env });
    const timer = timeoutMs > 0 ? setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      // Force kill after 5s if still alive
      setTimeout(() => child.kill('SIGKILL'), 5000);
    }, timeoutMs) : null;

    child.stdout.on('data', (chunk) => {
      const str = chunk.toString('utf8');
      stdout += str;
      if (onProgress) onProgress(str, 'stdout');
    });

    child.stderr.on('data', (chunk) => {
      const str = chunk.toString('utf8');
      stderr += str;
      if (onProgress) onProgress(str, 'stderr');
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      const { reason, suggestion } = _classifyShellError(command, err.message, 1, false, opts.timeout || 60);
      resolve({
        success: false,
        command,
        stdout,
        stderr,
        exitCode: 1,
        error: err.message,
        reason,
        suggestion,
      });
    });

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      if (killed && signal === 'SIGTERM') {
        const { reason, suggestion } = _classifyShellError(command, stderr, null, true, defaultTimeout);
        resolve({
          success: false,
          command,
          stdout,
          stderr,
          exitCode: null,
          error: `Command timed out after ${defaultTimeout}s`,
          reason,
          suggestion,
        });
      } else {
        const { reason, suggestion } = _classifyShellError(command, stderr, code, false, opts.timeout || 60);
        resolve({
          success: code === 0,
          command,
          stdout,
          stderr,
          exitCode: code ?? (signal ? 1 : 0),
          error: code !== 0 && !killed ? `Process exited with code ${code}` : undefined,
          reason: code !== 0 && !killed ? reason : undefined,
          suggestion: code !== 0 && !killed ? suggestion : undefined,
        });
      }
    });
  });
}

function runTests(opts = {}) {
  const cwd = resolvePath(opts.cwd || '.');
  // User can override with explicit command
  if (opts.command) {
    const result = safeExec(opts.command, { cwd, timeout: opts.timeout || 120 });
    return ok({ framework: 'custom', command: opts.command, ...result });
  }
  // Detect test framework
  const hasPackageJson = fs.existsSync(path.join(cwd, 'package.json'));
  const hasPytest = fs.existsSync(path.join(cwd, 'pytest.ini')) || fs.existsSync(path.join(cwd, 'setup.py')) || fs.existsSync(path.join(cwd, 'pyproject.toml'));
  const hasCargo = fs.existsSync(path.join(cwd, 'Cargo.toml'));
  const hasGo = fs.existsSync(path.join(cwd, 'go.mod'));
  const hasMaven = fs.existsSync(path.join(cwd, 'pom.xml'));
  const hasGradle = fs.existsSync(path.join(cwd, 'build.gradle'));

  let cmd;
  if (hasPackageJson) {
    // Check for yarn/pnpm
    if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) cmd = 'pnpm test';
    else if (fs.existsSync(path.join(cwd, 'yarn.lock'))) cmd = 'yarn test';
    else cmd = 'npm test';
  }
  else if (hasPytest) cmd = 'pytest -v';
  else if (hasCargo) cmd = 'cargo test';
  else if (hasGo) cmd = 'go test ./...';
  else if (hasMaven) cmd = 'mvn test';
  else if (hasGradle) cmd = 'gradle test';
  else return err('Nenhum framework de teste detectado. Use opts.command para especificar um comando customizado.');

  const result = safeExec(cmd, { cwd, timeout: opts.timeout || 120 });
  return ok({
    framework: hasPackageJson ? (cmd.startsWith('pnpm') ? 'pnpm' : cmd.startsWith('yarn') ? 'yarn' : 'npm') : hasPytest ? 'pytest' : hasCargo ? 'cargo' : hasGo ? 'go' : hasMaven ? 'maven' : 'gradle',
    command: cmd,
    ...result,
  });
}

function checkSyntax(filePath, opts = {}) {
  const resolved = resolvePath(filePath);
  if (!fs.existsSync(resolved)) return err(`Arquivo não encontrado: ${filePath}`);

  const ext = path.extname(resolved);
  let cmd;
  switch (ext) {
    case '.js': case '.mjs': case '.cjs':
      cmd = `node --check ${shellQuote(resolved)}`;
      break;
    case '.ts': case '.tsx':
      cmd = `npx tsc --noEmit ${shellQuote(resolved)} 2>/dev/null || echo "TypeScript checker not available"`;
      break;
    case '.py':
      cmd = `python3 -m py_compile ${shellQuote(resolved)}`;
      break;
    case '.sh':
      cmd = `bash -n ${shellQuote(resolved)}`;
      break;
    case '.json':
      cmd = `node -e ${shellQuote("JSON.parse(require('fs').readFileSync(" + JSON.stringify(resolved) + "))")}`;
      break;
    default:
      return ok({ path: resolved, note: `Nenhum checker disponível para extensão ${ext}`, valid: true });
  }

  const result = safeExec(cmd, { timeout: 15 });
  return ok({
    path: resolved,
    language: ext.slice(1),
    valid: result.success && result.exitCode === 0,
    ...result,
  });
}

function installPackages(packages, opts = {}) {
  const cwd = resolvePath(opts.cwd || '.');
  const hasPackageJson = fs.existsSync(path.join(cwd, 'package.json'));
  const hasRequirements = fs.existsSync(path.join(cwd, 'requirements.txt')) || fs.existsSync(path.join(cwd, 'setup.py'));
  const hasCargo = fs.existsSync(path.join(cwd, 'Cargo.toml'));

  let cmd;
  let pkgList;
  try {
    pkgList = (Array.isArray(packages) ? packages : [packages]).map(p => assertSafeName(p, 'pacote')).join(' ');
  } catch (e) {
    return err(e.message);
  }

  if (hasPackageJson) cmd = `npm install ${pkgList}`;
  else if (hasRequirements) cmd = `pip install ${pkgList}`;
  else if (hasCargo) cmd = `cargo add ${pkgList}`;
  else return err('Nenhum gerenciador de pacotes detectado (npm, pip, cargo)');

  const result = safeExec(cmd, { cwd, timeout: opts.timeout || 300 });
  return ok({ manager: hasPackageJson ? 'npm' : hasRequirements ? 'pip' : 'cargo', packages: pkgList, ...result });
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. GIT
// ═══════════════════════════════════════════════════════════════════════════

function gitStatus(opts = {}) {
  const cwd = resolvePath(opts.cwd || '.');
  const result = safeExec('git status -s', { cwd });
  if (!result.success) return err(result.error || 'Não é um repositório git');
  const branchResult = safeExec('git branch --show-current', { cwd });
  const branch = branchResult.success ? branchResult.stdout.trim() : '';
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  const modified = lines.filter(l => l.startsWith(' M') || l.startsWith('M ')).length;
  const untracked = lines.filter(l => l.startsWith('??')).length;
  const added = lines.filter(l => l.startsWith('A ')).length;
  const deleted = lines.filter(l => l.startsWith(' D') || l.startsWith('D ')).length;
  return ok({
    cwd,
    branch,
    modified,
    untracked,
    added,
    deleted,
    files: lines,
    // v13.0 (F2.2): unified readable text — fixes the gitStatus black hole
    text: lines.length === 0
      ? `git status (${branch || 'sem branch'}) em ${cwd}: working tree limpa, nada a commitar.`
      : `git status (${branch || 'sem branch'}) em ${cwd}: ${modified} modificado(s), ${added} adicionado(s), ${deleted} deletado(s), ${untracked} não rastreado(s).\n${lines.join('\n')}`,
  });
}

function gitDiff(opts = {}) {
  const cwd = resolvePath(opts.cwd || '.');
  const cmd = opts.staged ? 'git diff --cached' : 'git diff';
  const result = safeExec(cmd, { cwd });
  if (!result.success) return err(result.error);
  return ok({ cwd, staged: !!opts.staged, diff: result.stdout });
}

function gitLog(opts = {}) {
  const cwd = resolvePath(opts.cwd || '.');
  const n = toNonNegInt(opts.n ?? opts.limit, 10, 1000);
  const result = safeExec(`git log --oneline -${n}`, { cwd });
  if (!result.success) return err(result.error);
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  return ok({ cwd, commits: lines.map(l => {
    const hash = l.split(' ')[0];
    const msg = l.slice(hash.length + 1);
    return { hash, message: msg };
  }) });
}

function gitCommit(message, opts = {}) {
  const cwd = resolvePath(opts.cwd || '.');
  const result = safeExec(`git add -A && git commit -m ${shellQuote(message)}`, { cwd });
  return ok({ cwd, message, ...result });
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. PATCH / DIFF
// ═══════════════════════════════════════════════════════════════════════════

function applyPatch(patchContent, opts = {}) {
  const cwd = resolvePath(opts.cwd || '.');
  const tmpFile = path.join(LUNA_TMP_DIR, `luna-patch-${Date.now()}.patch`);
  try {
    fs.writeFileSync(tmpFile, patchContent, 'utf8');

    // Try git apply first
    const gitResult = safeExec(`git apply --check ${JSON.stringify(tmpFile)}`, { cwd });
    if (gitResult.success) {
      const applyResult = safeExec(`git apply ${JSON.stringify(tmpFile)}`, { cwd });
      fs.unlinkSync(tmpFile);
      if (applyResult.success) return ok({ cwd, applied: true, method: 'git apply' });
      return err(applyResult.stderr || 'git apply falhou');
    }

    // Fallback to patch command
    const patchResult = safeExec(`patch -p1 < ${JSON.stringify(tmpFile)}`, { cwd });
    fs.unlinkSync(tmpFile);
    if (patchResult.success) return ok({ cwd, applied: true, method: 'patch' });

    return err(patchResult.stderr || gitResult.stderr || 'Falha ao aplicar patch — verifique se o patch é válido e se está no diretório correto');
  } catch (e) {
    try { fs.unlinkSync(tmpFile); } catch {}
    return err(e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. NETWORK
// ═══════════════════════════════════════════════════════════════════════════

function downloadFile(url, destination, opts = {}) {
  const dst = resolvePath(destination);
  return new Promise((resolve) => {
    // Wave3-fix G: SSRF guard — same policy as fetchURL, re-validated on every
    // redirect; 15s default timeout (was 0 = NO timeout); 100MB byte cap.
    const safety = checkUrlSafety(url, fetchAllowList());
    if (!safety.ok) return resolve(err(`downloadFile bloqueado: ${safety.reason}`));
    const redirects = Math.max(0, opts._redirects | 0);
    const maxBytes = opts.maxBytes || DEFAULT_DOWNLOAD_MAX_BYTES;
    const client = url.startsWith('https:') ? https : http;
    const file = fs.createWriteStream(dst);
    const cleanup = () => { try { file.close(); } catch {} try { fs.unlinkSync(dst); } catch {} };
    const req = client.get(url, { timeout: opts.timeout || 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        if (redirects >= MAX_FETCH_REDIRECTS) return resolve(err('downloadFile: excesso de redirects (max 5)'));
        let nextUrl;
        try { nextUrl = new URL(res.headers.location, url).href; } catch { return resolve(err('downloadFile: redirect Location inválida')); }
        return downloadFile(nextUrl, destination, { ...opts, _redirects: redirects + 1 }).then(resolve);
      }
      if (res.statusCode !== 200) {
        cleanup();
        return resolve(err(`HTTP ${res.statusCode}`));
      }
      let received = 0;
      let capped = false;
      file.on('error', () => {}); // writes racing a timeout/error abort — expected, swallow
      res.on('data', chunk => {
        if (capped) return;
        received += chunk.length;
        if (received > maxBytes) {
          capped = true;
          req.destroy();
          file.end(); // 'finish' below resolves + unlinks the partial file
          return;
        }
        file.write(chunk);
      });
      res.on('end', () => { if (!capped) file.end(); });
      file.on('finish', () => {
        file.close();
        if (capped) { try { fs.unlinkSync(dst); } catch {} return resolve(err('Download excede 100MB')); }
        let size;
        try { size = fs.statSync(dst).size; } catch { return; } // unlinked by the timeout/error path
        resolve(ok({ url, destination: dst, bytes: size }));
      });
    });
    req.on('error', (e) => { cleanup(); resolve(err(e.message)); });
    req.on('timeout', () => { req.destroy(); cleanup(); resolve(err('Timeout')); });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. CLIPBOARD
// ═══════════════════════════════════════════════════════════════════════════

function clipboardRead() {
  try {
    const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':0' };
    const text = execSync('xclip -o -selection clipboard 2>/dev/null || xsel -ob 2>/dev/null || wl-paste 2>/dev/null', {
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['pipe', 'pipe', 'ignore'],
      env,
    });
    return ok({ text: text.trim() });
  } catch (e) {
    return err(`Clipboard error: ${e.message} — Verifique se xclip/xsel/wl-clipboard está instalado e DISPLAY está configurado`);
  }
}

function clipboardWrite(text) {
  try {
    const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':0' };
    // Try each clipboard tool separately
    // v3.3-fix: xclip without -loops 1 + spawn detached so it persists in clipboard
    const tools = [
      () => {
        const { spawn } = require('child_process');
        const proc = spawn('xclip', ['-selection', 'clipboard'], { env, detached: true });
        proc.stdin.write(text);
        proc.stdin.end();
        proc.unref();
        // Give it a moment to register
        try { execSync('sleep 0.2', { timeout: 1000 }); } catch {}
        return true;
      },
      () => execSync(`printf '%s' ${shellQuote(text)} | xsel --clipboard --input`, { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'], env }),
      () => execSync(`printf '%s' ${shellQuote(text)} | wl-copy`, { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'], env }),
    ];
    for (const tool of tools) {
      try { tool(); return ok({ bytes: Buffer.byteLength(text, 'utf8') }); } catch { continue; }
    }
    return err('Falha ao escrever no clipboard (instale xclip/xsel/wl-clipboard e verifique DISPLAY)');
  } catch (e) {
    return err('Falha ao escrever no clipboard: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. MEDIA
// ═══════════════════════════════════════════════════════════════════════════

function readMediaFile(filePath) {
  const resolved = resolvePath(filePath);
  if (!fs.existsSync(resolved)) return err(`Arquivo não encontrado: ${filePath}`);
  try {
    const stat = fs.statSync(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'];
    const videoExts = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
    const type = imageExts.includes(ext) ? 'image' : videoExts.includes(ext) ? 'video' : 'unknown';
    return ok({
      path: resolved,
      type,
      size: stat.size,
      extension: ext,
      note: type === 'image' ? 'Use ReadFile para descrição textual ou ferramentas de visão' : 'Arquivo de mídia detectado',
    });
  } catch (e) {
    return err(e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

function getCurrentDirectory() {
  return ok({ cwd: process.cwd() });
}

function think(thought) {
  return ok({ thought, note: 'Reasoning recorded. Use this to think step-by-step before taking action.' });
}

// v10.18: Atualiza a Luna a partir do GitHub (fetch → pull → build → restart)
async function lunaSelfUpdate(params = {}) {
  const { dryRun = false } = params;
  const token = process.env.INTERNAL_API_TOKEN || '';
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    if (dryRun) {
      const res = await fetch('http://localhost:3458/api/system/update/status', { headers });
      const data = await res.json();
      return ok({
        upToDate: data.upToDate,
        localCommit: data.localCommit,
        remoteCommit: data.remoteCommit,
        recentLog: data.recentLog,
        workingTreeChanges: data.workingTreeChanges,
        note: dryRun ? 'Modo dry-run: não foram feitas alterações' : undefined
      });
    }

    const res = await fetch('http://localhost:3458/api/system/update', {
      method: 'POST',
      headers
    });
    const data = await res.json();
    if (!res.ok) {
      return err(`Luna self-update failed: ${data.error || res.statusText}`, { details: data });
    }
    return ok({
      updated: data.pulled,
      localCommit: data.localCommit,
      remoteCommit: data.remoteCommit,
      pulled: data.pulled,
      built: data.built,
      restarted: data.restarted,
      messages: data.messages
    });
  } catch (e) {
    return err(`Luna self-update error: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 12. DEBUG TOOLS
// ═══════════════════════════════════════════════════════════════════════════

function openDebugTerminal(params = {}) {
  const { process: targetProcess = 'luna-server', lines = 50, follow = true } = params;
  const { spawn } = require('child_process');
  const os = require('os');

  // LLM-controllable params: pm2 process name and --lines go into a shell command.
  let target, nLines;
  try {
    target = assertSafeName(targetProcess, 'processo pm2');
    nLines = toNonNegInt(lines, 50, 5000);
  } catch (e) {
    return { success: false, error: e.message };
  }

  // W6-T10: resolve the system-default terminal via the shared resolver
  // (replaces the hardcoded gnome-terminal-first list + per-call `which`).
  const env = enrichSessionEnv(process.env);
  const detected = resolveTerminal(env);

  if (!detected) {
    return { success: false, error: 'Nenhum terminal gráfico encontrado. Instale gnome-terminal, konsole, xterm, etc.' };
  }

  const followFlag = follow ? '--lines 100 --timestamp' : `--lines ${nLines}`;
  const command = `echo "🚀 Luna Debug Terminal — ${target}" && echo "========================================" && pm2 logs ${target} ${followFlag}; echo; echo "[Pressione ENTER para fechar]"; read`;

  // argv per terminal style for `bash -c command` (_argvFor is script-file only)
  const extra = detected.extra || [];
  const termArgs = detected.style === 'dashdash'
    ? [...extra, '--', 'bash', '-c', command]
    : detected.style === 'plain'
      ? [...extra, 'bash', '-c', command]
      : [...extra, '-e', 'bash', '-c', command];

  const child = spawn(detected.bin, termArgs, {
    env,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  return ok({
    terminal: detected.bin,
    target,
    message: `✅ Terminal de debug aberto: ${detected.bin}\n📋 Processo: ${target}\n💡 Comando: pm2 logs ${target} ${followFlag}\n🖥️  PID: ${child.pid}`,
    pid: child.pid,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 11. DASHBOARD TOOLS (API REST localhost:3456)
// ═══════════════════════════════════════════════════════════════════════════

const DASHBOARD_BASE = process.env.DASHBOARD_API_URL || 'https://vps.nexo-digital.app:3501/api';
function getInternalApiToken() {
  return process.env.DASHBOARD_INTERNAL_API_TOKEN || process.env.INTERNAL_API_TOKEN || '';
}

async function dashboardApi(path, method = 'GET', body = null) {
  try {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    const token = getInternalApiToken();
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${DASHBOARD_BASE}${path}`, { ...opts, signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      return err(`Dashboard API ${path}: ${res.status} ${res.statusText}${bodyText ? ' — ' + bodyText.slice(0, 200) : ''}`);
    }
    const data = await res.json();
    return ok({ data });
  } catch (e) {
    return err(`Dashboard API ${path}: ${e.message}`);
  }
}

async function dashboardCreateTask(params) {
  // v8.4-fix: Idempotency — check if a task with the same title was created in the last 2 minutes
  try {
    const result_result_recent = await dashboardApi('/tasks?limit=20&sort=createdAt:desc');
    if (!result_result_recent.success) return result_result_recent;
    const result_recent = result_result_recent.data;
    const recent = result_recent;
    const tasks = Array.isArray(recent) ? recent : (recent.tasks || []);
    const now = Date.now();
    const dup = tasks.find(t =>
      t.title === (params.title || 'Sem título') &&
      t.source === 'luna-agent' &&
      (now - new Date(t.createdAt).getTime()) < 2 * 60 * 1000
    );
    if (dup) {
      return ok({ stdout: `✅ Tarefa já existente: ${dup.title} (ID: ${dup.id})` });
    }
  } catch (e) {
    // Ignore pre-check errors and proceed with creation
  }
  const result_result_task = await dashboardApi('/tasks', 'POST', {
    title: params.title || 'Sem título',
    description: params.description || '',
    status: params.status || 'pending',
    priority: params.priority || 'medium',
    assignedTo: params.assignee || params.assignedTo || null,
    dueDate: params.dueDate || null,
    source: 'luna-agent'
  });
  if (!result_result_task.success) return result_result_task;
  const result_task = result_result_task.data;
  const task = result_task;
  notifyChange('task', { title: task.title, description: task.description, priority: task.priority, status: task.status, deadline: task.dueDate });
  return ok({ stdout: `✅ Tarefa criada: ${task.title} (ID: ${task.id})` });
}

async function dashboardListTasks(params) {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.assignee) query.set('assignedTo', params.assignee);
  if (params.priority) query.set('priority', params.priority);
  const result_data = await dashboardApi(`/tasks?${query.toString()}`);
  if (!result_data.success) return result_data;
  const data = result_data.data;
  const tasks = Array.isArray(data) ? data : (data.tasks || []);
  const lines = tasks.map(t => `- [${t.status}] ${t.title} (P: ${t.priority}) (ID: ${t.id})`).join('\n');
  return ok({ stdout: `📋 ${tasks.length} tarefa(s):\n${lines || 'Nenhuma tarefa encontrada.'}` });
}

async function dashboardUpdateTask(params) {
  // First find the task by title if taskId is not numeric
  let taskId = params.taskId;
  if (!taskId || isNaN(Number(taskId))) {
    const searchTitle = params.taskId || params.title;
    const result_result_all = await dashboardApi('/tasks?limit=100');
    if (!result_result_all.success) return result_result_all;
    const result_all = result_result_all.data;
    const all = result_all;
    const tasks = Array.isArray(all) ? all : (all.tasks || []);
    const match = tasks.find(t => t.title === searchTitle || t.title.includes(searchTitle));
    if (!match) return err('Task not found: ' + searchTitle);
    taskId = match.id;
  }
  const body = {};
  if (params.title !== undefined) body.title = params.title;
  if (params.description !== undefined) body.description = params.description;
  if (params.status !== undefined) body.status = params.status;
  if (params.priority !== undefined) body.priority = params.priority;
  if (params.projectId !== undefined) body.projectId = params.projectId;
  if (params.assignedTo !== undefined) body.assignedTo = params.assignedTo;
  if (params.dueDate !== undefined) body.dueDate = params.dueDate;
  const result_result_task = await dashboardApi('/tasks/' + taskId, 'PUT', body);
  if (!result_result_task.success) return result_result_task;
  const result_task = result_result_task.data;
  const task = result_task;
  return ok({ stdout: '✅ Tarefa atualizada: ' + task.title + ' (ID: ' + task.id + ')' });
}









async function dashboardCreateLead(params) {
  // v8.4-fix: Idempotency — check if a lead with the same name/email was created in the last 2 minutes
  try {
    const result_result_recent = await dashboardApi('/internal/leads?limit=20&sort=createdAt:desc');
    if (!result_result_recent.success) return result_result_recent;
    const result_recent = result_result_recent.data;
    const recent = result_recent;
    const leads = recent.leads || [];
    const now = Date.now();
    const dup = leads.find(l =>
      (l.displayName || l.name) === (params.name || params.displayName || 'Sem nome') &&
      l.source === 'luna-agent' &&
      (now - new Date(l.createdAt).getTime()) < 2 * 60 * 1000
    );
    if (dup) {
      return ok({ stdout: `✅ Lead já existente: ${dup.displayName || dup.name} (ID: ${dup.id})` });
    }
  } catch (e) {
    // Ignore pre-check errors and proceed with creation
  }
  const result_data = await dashboardApi('/internal/leads', 'POST', {
    displayName: params.name || params.displayName || 'Sem nome',
    email: params.email || '',
    phone: params.phone || '',
    source: params.source || 'luna-agent',
    estimatedValue: params.estimatedValue || 0,
    notes: params.notes || '',
    assignedTo: params.assignedTo || null,
    tags: params.tags || []
  });
  if (!result_data.success) return result_data;
  const data = result_data.data;
  const lead = data.lead || data;
  notifyChange('lead', { name: lead.displayName || lead.name, email: lead.email, phone: lead.phone, value: lead.estimatedValue, status: lead.pipelineStatus || 'new' });
  return ok({ stdout: `✅ Lead criado: ${lead.displayName || lead.name} (ID: ${lead.id})` });
}

async function dashboardListLeads(params) {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.assignedTo) query.set('assignedTo', params.assignedTo);
  if (params.search) query.set('search', params.search);
  const result_data = await dashboardApi(`/leads?${query.toString()}`);
  if (!result_data.success) return result_data;
  const data = result_data.data;
  const leads = data.leads || [];
  const lines = leads.map(l => `- [${l.pipelineStatus || 'new'}] ${l.displayName || l.name} (${l.email || 'sem email'})`).join('\n');
  return ok({ stdout: `📋 ${leads.length} lead(s):\n${lines || 'Nenhum lead encontrado.'}` });
}

async function dashboardGetFinanceSummary(params) {
  const result_result_data = await dashboardApi('/finance/summary');
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  return ok({ stdout: `💰 Finance Summary:\n- Expected: ${data.totalExpected || 0}\n- Received: ${data.totalReceived || 0}\n- Pending: ${data.totalPending || 0}\n- Overdue: ${data.overduePayments || 0}` });
}

async function dashboardCreateIdea(params) {
  const body = {
    title: params.title || 'Sem título',
    type: params.type || 'brainstorm',
    priority: params.priority || 'media',
    status: params.status || 'rascunho',
    tags: params.tags || [],
    createdBy: 'luna-web',
    createdByName: 'Luna Web'
  };
  if (params.description || params.content) {
    body.content = { blocks: [{ type: 'paragraph', content: params.description || params.content || '' }] };
  }
  const result_result_data = await dashboardApi('/ideas', 'POST', body);
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  const idea = data.data || data;
  notifyChange('idea', { title: idea.title || params.title, description: params.description || params.content, type: body.type, priority: body.priority });
  return ok({ stdout: `💡 Ideia criada: "${idea.title || params.title}" (ID: ${idea.id || 'n/a'})` });
}

async function dashboardListIdeas(params) {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.type) query.set('type', params.type);
  if (params.priority) query.set('priority', params.priority);
  if (params.search) query.set('search', params.search);
  if (params.limit) query.set('limit', String(params.limit));
  const result_data = await dashboardApi(`/ideas?${query.toString()}`);
  if (!result_data.success) return result_data;
  const data = result_data.data;
  const ideas = data.data?.ideas || data.ideas || [];
  const lines = ideas.map(i => `- [${i.status}] ${i.title} (tipo: ${i.type}, prio: ${i.priority})`).join('\n');
  return ok({ stdout: `💡 ${ideas.length} ideia(s):\n${lines || 'Nenhuma ideia encontrada.'}` });
}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD TOOLS EXPANSÃO v2.0
// ═══════════════════════════════════════════════════════════════════════════

// ── TAREFAS ──


async function dashboardDeleteTask(params) {
  let id = params.id || params.taskId;
  if (!id || isNaN(Number(id))) {
    const searchTitle = params.id || params.taskId || params.title;
    const result_result_all = await dashboardApi('/tasks?limit=100');
    if (!result_result_all.success) return result_result_all;
    const result_all = result_result_all.data;
    const all = result_all;
    const tasks = Array.isArray(all) ? all : (all.tasks || []);
    const match = tasks.find(t => t.title === searchTitle || t.title.includes(searchTitle));
    if (!match) return err('Task not found: ' + searchTitle);
    id = match.id;
  }
  if (!id) return err('ID da tarefa obrigatório');
  const result_result = await dashboardApi(`/tasks/${id}`, 'DELETE');
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  notifyChange('task', { id, _action: 'delete' });
  return ok({ stdout: `🗑️ Tarefa ${id} excluída.` });
}

async function dashboardCompleteTask(params) {
  let id = params.id || params.taskId;
  if (!id || isNaN(Number(id))) {
    const searchTitle = params.id || params.taskId || params.title;
    const result_result_all = await dashboardApi('/tasks?limit=100');
    if (!result_result_all.success) return result_result_all;
    const result_all = result_result_all.data;
    const all = result_all;
    const tasks = Array.isArray(all) ? all : (all.tasks || []);
    const match = tasks.find(t => t.title === searchTitle || t.title.includes(searchTitle));
    if (!match) return err('Task not found: ' + searchTitle);
    id = match.id;
  }
  if (!id) return err('ID da tarefa obrigatório');
  const result_result = await dashboardApi(`/tasks/${id}`, 'PUT', { status: 'completed' });
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  notifyChange('task', { id, status: 'completed', _action: 'complete' });
  return ok({ stdout: `✅ Tarefa ${id} marcada como concluída.` });
}

async function dashboardAddComment(params) {
  let id = params.id || params.taskId;
  if (!id || isNaN(Number(id))) {
    const searchTitle = params.id || params.taskId || params.title;
    const result_result_all = await dashboardApi('/tasks?limit=100');
    if (!result_result_all.success) return result_result_all;
    const result_all = result_result_all.data;
    const all = result_all;
    const tasks = Array.isArray(all) ? all : (all.tasks || []);
    const match = tasks.find(t => t.title === searchTitle || t.title.includes(searchTitle));
    if (!match) return err('Task not found: ' + searchTitle);
    id = match.id;
  }
  if (!id) return err('ID da tarefa obrigatório');
  if (!params.comment && !params.text) return err('Comentário obrigatório');
  const result_result = await dashboardApi(`/tasks/${id}/comments`, 'POST', { text: params.comment || params.text });
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  return ok({ stdout: `💬 Comentário adicionado à tarefa ${id}.` });
}

// ── LEADS ──

async function dashboardUpdateLead(params) {
  const id = params.id || params.leadId;
  if (!id) return err('ID do lead obrigatório');
  const body = {};
  if (params.name !== undefined) body.displayName = params.name;
  if (params.email !== undefined) body.email = params.email;
  if (params.phone !== undefined) body.phone = params.phone;
  if (params.status !== undefined) body.pipelineStatus = params.status;
  if (params.estimatedValue !== undefined) body.estimatedValue = params.estimatedValue;
  if (params.assignedTo !== undefined) body.assignedTo = params.assignedTo;
  if (params.notes !== undefined) body.notes = params.notes;
  const result_result = await dashboardApi(`/leads/${id}`, 'PUT', body);
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  notifyChange('lead', { ...body, _action: 'update' });
  return ok({ stdout: `✏️ Lead ${id} atualizado.` });
}

async function dashboardConvertLead(params) {
  const id = params.id || params.leadId;
  if (!id) return err('ID do lead obrigatório');
  const result_result = await dashboardApi(`/leads/${id}/convert`, 'POST', {});
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  notifyChange('lead', { id, _action: 'convert' });
  return ok({ stdout: `🔄 Lead ${id} convertido em cliente.` });
}

async function dashboardDeleteLead(params) {
  const id = params.id || params.leadId;
  if (!id) return err('ID do lead obrigatório');
  const result_result = await dashboardApi(`/leads/${id}`, 'DELETE');
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  notifyChange('lead', { id, _action: 'delete' });
  return ok({ stdout: `🗑️ Lead ${id} excluído.` });
}

// ── FINANCEIRO — RECEITAS / PAGAMENTOS ──

async function dashboardCreatePayment(params) {
  const body = {
    amount: parseFloat(params.amount || params.valor || 0),
    description: params.description || params.descricao || '',
    from: params.from || params.de || params.cliente || '',
    date: params.date || new Date().toISOString().split('T')[0],
    status: params.status || 'pending',
  };
  const result_result_data = await dashboardApi('/payments', 'POST', body);
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  notifyChange('payment', { amount: body.amount, description: body.description, clientName: body.from, dueDate: body.date, status: body.status });
  return ok({ stdout: `💰 Pagamento registrado: €${body.amount} — ${body.description}` });
}

async function dashboardListPayments(params) {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.from) query.set('from', params.from);
  const result_data = await dashboardApi(`/payments?${query.toString()}`);
  if (!result_data.success) return result_data;
  const data = result_data.data;
  const items = data.payments || data || [];
  const lines = items.map(p => `- ${p.status === 'received' ? '✅' : '⏳'} €${p.amount} — ${p.description} (${p.from || '?'})`).join('\n');
  return ok({ stdout: `💰 ${items.length} pagamento(s):\n${lines || 'Nenhum pagamento.'}` });
}

async function dashboardUpdatePayment(params) {
  const id = params.id || params.paymentId;
  if (!id) return err('ID do pagamento obrigatório');
  const body = {};
  if (params.amount !== undefined) body.amount = parseFloat(params.amount);
  if (params.description !== undefined) body.description = params.description;
  if (params.status !== undefined) body.status = params.status;
  const result_result = await dashboardApi(`/payments/${id}`, 'PUT', body);
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  notifyChange('payment', { id, ...body, _action: 'update' });
  return ok({ stdout: `✏️ Pagamento ${id} atualizado.` });
}

async function dashboardDeletePayment(params) {
  const id = params.id || params.paymentId;
  if (!id) return err('ID do pagamento obrigatório');
  const result_result = await dashboardApi(`/payments/${id}`, 'DELETE');
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  notifyChange('payment', { id, _action: 'delete' });
  return ok({ stdout: `🗑️ Pagamento ${id} excluído.` });
}

async function dashboardReceiveSplit(params) {
  const id = params.id || params.paymentId;
  const personId = params.personId || params.person;
  if (!id || !personId) return err('paymentId e personId obrigatórios');
  const result_result = await dashboardApi(`/payments/${id}/split/${personId}/receive`, 'POST', {});
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  return ok({ stdout: `💰 Split recebido para ${personId} no pagamento ${id}.` });
}

// ── FINANCEIRO — DESPESAS ──

async function dashboardCreateExpense(params) {
  const body = {
    amount: parseFloat(params.amount || params.valor || 0),
    description: params.description || params.descricao || '',
    category: params.category || params.categoria || 'other',
    to: params.to || params.para || '',
    date: params.date || new Date().toISOString().split('T')[0],
    status: params.status || 'pending',
  };
  if (params.splitAmong) body.splitAmong = params.splitAmong;
  const result_result_data = await dashboardApi('/expenses', 'POST', body);
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  notifyChange('expense', { amount: body.amount, description: body.description, category: body.category, dueDate: body.date, status: body.status });
  return ok({ stdout: `📤 Despesa registrada: €${body.amount} — ${body.description}` });
}

async function dashboardListExpenses(params) {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.category) query.set('category', params.category);
  const result_data = await dashboardApi(`/expenses?${query.toString()}`);
  if (!result_data.success) return result_data;
  const data = result_data.data;
  const items = data.expenses || data || [];
  const lines = items.map(e => `- ${e.status === 'paid' ? '✅' : '⏳'} €${e.amount} — ${e.description} (${e.category || '?'})`).join('\n');
  return ok({ stdout: `📤 ${items.length} despesa(s):\n${lines || 'Nenhuma despesa.'}` });
}

async function dashboardUpdateExpense(params) {
  const id = params.id || params.expenseId;
  if (!id) return err('ID da despesa obrigatório');
  const body = {};
  if (params.amount !== undefined) body.amount = parseFloat(params.amount);
  if (params.description !== undefined) body.description = params.description;
  if (params.status !== undefined) body.status = params.status;
  if (params.category !== undefined) body.category = params.category;
  const result_result = await dashboardApi(`/expenses/${id}`, 'PUT', body);
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  notifyChange('expense', { id, ...body, _action: 'update' });
  return ok({ stdout: `✏️ Despesa ${id} atualizada.` });
}

async function dashboardDeleteExpense(params) {
  const id = params.id || params.expenseId;
  if (!id) return err('ID da despesa obrigatório');
  const result_result = await dashboardApi(`/expenses/${id}`, 'DELETE');
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  notifyChange('expense', { id, _action: 'delete' });
  return ok({ stdout: `🗑️ Despesa ${id} excluída.` });
}

async function dashboardPayExpense(params) {
  const id = params.id || params.expenseId;
  if (!id) return err('ID da despesa obrigatório');
  const result_result = await dashboardApi(`/expenses/${id}/pay`, 'POST', {});
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  notifyChange('expense', { id, status: 'paid', _action: 'pay' });
  return ok({ stdout: `✅ Despesa ${id} marcada como paga.` });
}

async function dashboardCreateExpenseTemplate(params) {
  const body = {
    name: params.name || params.nome || 'Template',
    amount: parseFloat(params.amount || 0),
    description: params.description || '',
    category: params.category || 'other',
  };
  const result_result = await dashboardApi('/expenses/templates', 'POST', body);
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  return ok({ stdout: `📋 Template de despesa "${body.name}" criado.` });
}

async function dashboardQuickExpense(params) {
  const body = {
    amount: parseFloat(params.amount || params.valor || 0),
    description: params.description || params.descricao || '',
    category: params.category || 'other',
  };
  const result_result = await dashboardApi('/expenses/quick', 'POST', body);
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  return ok({ stdout: `⚡ Despesa rápida: €${body.amount} — ${body.description}` });
}

// ── FINANCEIRO — CAIXA ──

async function dashboardGetCashBox(params) {
  const result_result_data = await dashboardApi('/cash-box');
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  return ok({ stdout: `💵 Caixa: €${data.balance?.value || data.balance || 0}\nÚltima atualização: ${data.lastUpdate || 'N/A'}` });
}

async function dashboardAddCashEntry(params) {
  const body = {
    type: params.type || params.tipo || 'income',
    amount: parseFloat(params.amount || params.valor || 0),
    description: params.description || params.descricao || '',
    category: params.category || 'general',
    date: params.date || new Date().toISOString().split('T')[0],
  };
  const result_result = await dashboardApi('/cash-box/entries', 'POST', body);
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  return ok({ stdout: `💵 Entrada de caixa: €${body.amount} (${body.type}) — ${body.description}` });
}

async function dashboardListCashHistory(params) {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit));
  const result_data = await dashboardApi(`/cash-box/history?${query.toString()}`);
  if (!result_data.success) return result_data;
  const data = result_data.data;
  const items = data.history || data.entries || data || [];
  const lines = items.map(h => `- ${h.type === 'income' ? '📥' : '📤'} €${h.amount} — ${h.description}`).join('\n');
  return ok({ stdout: `💵 Histórico do caixa (${items.length} itens):\n${lines || 'Vazio.'}` });
}

async function dashboardReconcileCashBox(params) {
  const body = { actualBalance: parseFloat(params.actualBalance || params.balance || 0) };
  const result_result = await dashboardApi('/cash-box/reconcile', 'POST', body);
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  return ok({ stdout: `🔍 Caixa reconciliado com saldo real: €${body.actualBalance}` });
}

async function dashboardAdjustCashBox(params) {
  const body = {
    amount: parseFloat(params.amount || params.valor || 0),
    reason: params.reason || params.motivo || 'Ajuste manual',
  };
  const result_result = await dashboardApi('/cash-box/adjust', 'POST', body);
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  return ok({ stdout: `⚖️ Caixa ajustado em €${body.amount}: ${body.reason}` });
}

async function dashboardGetCashBoxProjection(params) {
  const result_result_data = await dashboardApi('/cash-box/projection');
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  return ok({ stdout: `📈 Projeção do caixa: €${data.projectedBalance || data.balance || 'N/A'}` });
}

async function dashboardCreateCashPayment(params) {
  const body = {
    amount: parseFloat(params.amount || params.valor || 0),
    description: params.description || params.descricao || '',
    from: params.from || params.de || '',
  };
  const result_result = await dashboardApi('/cash-box/payments', 'POST', body);
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  return ok({ stdout: `💰 Pagamento no caixa: €${body.amount} — ${body.description}` });
}

// ── ORÇAMENTOS ──

async function dashboardCreateQuote(params) {
  const body = {
    clientName: params.clientName || params.client || 'Cliente',
    projectName: params.projectName || params.project || 'Projeto',
    totalAmount: parseFloat(params.totalAmount || params.value || params.valor || 0),
    description: params.description || params.descricao || '',
    status: params.status || 'draft',
  };
  const result_result = await dashboardApi('/quotes', 'POST', body);
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  notifyChange('quote', { clientName: body.clientName, description: body.projectName, value: body.totalAmount, status: body.status });
  return ok({ stdout: `📄 Orçamento criado: "${body.projectName}" — €${body.totalAmount}` });
}

async function dashboardListQuotes(params) {
  const result_result_data = await dashboardApi('/quotes');
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  const items = data.quotes || data || [];
  const lines = items.map(q => `- [${q.status}] ${q.projectName || q.clientName} — €${q.totalAmount}`).join('\n');
  return ok({ stdout: `📄 ${items.length} orçamento(s):\n${lines || 'Nenhum orçamento.'}` });
}

async function dashboardUpdateQuote(params) {
  const id = params.id || params.quoteId;
  if (!id) return err('ID do orçamento obrigatório');
  const body = {};
  if (params.totalAmount !== undefined) body.totalAmount = parseFloat(params.totalAmount);
  if (params.status !== undefined) body.status = params.status;
  if (params.description !== undefined) body.description = params.description;
  const result_result = await dashboardApi(`/quotes/${id}`, 'PUT', body);
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  notifyChange('quote', { id, ...body, _action: 'update' });
  return ok({ stdout: `✏️ Orçamento ${id} atualizado.` });
}

async function dashboardDeleteQuote(params) {
  const id = params.id || params.quoteId;
  if (!id) return err('ID do orçamento obrigatório');
  const result_result = await dashboardApi(`/quotes/${id}`, 'DELETE');
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  notifyChange('quote', { id, _action: 'delete' });
  return ok({ stdout: `🗑️ Orçamento ${id} excluído.` });
}

// ── PROJETOS ──

async function dashboardListProjects(params) {
  const result_result_data = await dashboardApi('/projects');
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  const items = data.projects || data || [];
  const lines = items.map(p => `- ${p.name || p.title} (${p.status || '?'})`).join('\n');
  return ok({ stdout: `📁 ${items.length} projeto(s):\n${lines || 'Nenhum projeto.'}` });
}

// ── CLIENTES ──

async function dashboardListClients(params) {
  const result_result_data = await dashboardApi('/schema/clients');
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  const items = data.clients || data || [];
  const lines = items.map(c => `- ${c.displayName || c.name || c.id}`).join('\n');
  return ok({ stdout: `👥 ${items.length} cliente(s):\n${lines || 'Nenhum cliente.'}` });
}

// ── LINKS ──

async function dashboardAddLink(params) {
  const body = {
    url: params.url || params.link || '',
    title: params.title || '',
    description: params.description || params.contexto || '',
    tags: params.tags || [],
  };
  if (!body.url) return err('URL obrigatória');
  const result_result = await dashboardApi('/links', 'POST', body);
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  notifyChange('link', { title: body.title, url: body.url, description: body.description });
  return ok({ stdout: `🔗 Link adicionado: ${body.url}` });
}

async function dashboardListLinks(params) {
  const query = new URLSearchParams();
  if (params.platform) query.set('platform', params.platform);
  if (params.search) query.set('search', params.search);
  const result_data = await dashboardApi(`/links?${query.toString()}`);
  if (!result_data.success) return result_data;
  const data = result_data.data;
  const items = data.links || data || [];
  const lines = items.map(l => `- ${l.title || l.url} (${l.platform || 'link'})`).join('\n');
  return ok({ stdout: `🔗 ${items.length} link(s):\n${lines || 'Nenhum link.'}` });
}

async function dashboardDeleteLink(params) {
  const id = params.id || params.linkId;
  if (!id) return err('ID do link obrigatório');
  const result_result = await dashboardApi(`/links/${id}`, 'DELETE');
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  notifyChange('link', { id, _action: 'delete' });
  return ok({ stdout: `🗑️ Link ${id} excluído.` });
}

async function dashboardEnrichLink(params) {
  const id = params.id || params.linkId;
  if (!id) return err('ID do link obrigatório');
  const result_result = await dashboardApi('/links/enrich', 'POST', { id });
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  return ok({ stdout: `✨ Link ${id} enriquecido.` });
}

async function dashboardSyncLinks(params) {
  const result_result = await dashboardApi('/links/sync', 'POST', {});
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  return ok({ stdout: `🔄 Links sincronizados.` });
}

async function dashboardGetLinksStats(params) {
  const result_result_data = await dashboardApi('/links/stats');
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  return ok({ stdout: `🔗 Stats: ${data.total || 0} total, ${data.broken || 0} quebrados.` });
}

// ── EMAIL ──

async function dashboardSendEmail(params) {
  const body = {
    to: params.to || params.para || '',
    subject: params.subject || params.assunto || '',
    body: params.body || params.text || params.mensagem || '',
    cc: params.cc || '',
    bcc: params.bcc || '',
  };
  if (!body.to || !body.subject) return err('Destinatário e assunto obrigatórios');
  const result_result = await dashboardApi('/emails/send', 'POST', body);
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  return ok({ stdout: `📧 Email enviado para ${body.to}: "${body.subject}"` });
}

async function dashboardListEmails(params) {
  const query = new URLSearchParams();
  if (params.folder) query.set('folder', params.folder);
  if (params.limit) query.set('limit', String(params.limit));
  const result_data = await dashboardApi(`/emails?${query.toString()}`);
  if (!result_data.success) return result_data;
  const data = result_data.data;
  const items = data.emails || data.messages || data || [];
  const lines = items.map(e => `- ${e.read ? '✓' : '○'} ${e.subject} (${e.from || '?'})`).join('\n');
  return ok({ stdout: `📧 ${items.length} email(s):\n${lines || 'Nenhum email.'}` });
}

async function dashboardSyncEmails(params) {
  const result_result = await dashboardApi('/emails/sync', 'POST', {});
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  return ok({ stdout: `🔄 Emails sincronizados.` });
}

// ── WHATSAPP ──

async function dashboardSendWhatsApp(params) {
  const body = {
    phone: params.phone || params.number || params.numero || '',
    message: params.message || params.text || params.mensagem || '',
  };
  if (!body.phone || !body.message) return err('Número e mensagem obrigatórios');
  const result_result = await dashboardApi('/whatsapp/send', 'POST', body);
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  return ok({ stdout: `💬 WhatsApp enviado para ${body.phone}.` });
}

async function dashboardGetWhatsAppHistory(params) {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit || 10));
  if (params.chatId) query.set('chatId', params.chatId);
  const result_data = await dashboardApi(`/whatsapp/history?${query.toString()}`);
  if (!result_data.success) return result_data;
  const data = result_data.data;
  const items = data.history || data.messages || data || [];
  const lines = items.map(m => `- [${m.author || '?'}]: ${(m.body || m.text || '(mídia)')}`).join('\n'); // v13.0: no cap
  return ok({ stdout: `💬 ${items.length} mensagem(s):\n${lines || 'Vazio.'}` });
}

async function dashboardScanWhatsApp(params) {
  const result_result = await dashboardApi('/whatsapp-agent/refresh', 'POST', {});
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  return ok({ stdout: `🔍 Scan do WhatsApp iniciado.` });
}

async function dashboardGetWhatsAppStatus(params) {
  const result_result_data = await dashboardApi('/whatsapp-agent/status');
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  return ok({ stdout: `📱 WhatsApp: ${data.status || data.state || 'N/A'} | ${data.totalMessages || data.total || 0} msgs` });
}

async function dashboardGetWhatsAppClassifications(params) {
  const result_result_data = await dashboardApi('/classifications/stats');
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  return ok({ stdout: `🏷️ Classificações: ${JSON.stringify(data, null, 2)}` }); // v13.0: no cap
}

// ── SISTEMA ──

async function dashboardGetSystemStatus(params) {
  const result_result_data = await dashboardApi('/system/status');
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  return ok({ stdout: `🖥️ Sistema: ${data.status || 'OK'} | Backend: ${data.backend || '?'} | Frontend: ${data.frontend || '?'}` });
}

async function dashboardGetSystemLogs(params) {
  const query = new URLSearchParams();
  if (params.service) query.set('service', params.service);
  if (params.lines) query.set('lines', String(params.lines));
  const result_data = await dashboardApi(`/system/logs?${query.toString()}`);
  if (!result_data.success) return result_data;
  const data = result_data.data;
  const lines = (data.logs || data || []).slice(-20).join('\n');
  return ok({ stdout: `📝 Logs:\n${lines || 'Nenhum log.'}` });
}

async function dashboardControlService(params) {
  const body = {
    service: params.service || 'backend',
    action: params.action || params.command || 'status',
  };
  const result_result = await dashboardApi('/system/control', 'POST', body);
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  return ok({ stdout: `⚙️ ${body.service}: ${body.action}` });
}

// ── NOTIFICAÇÕES ──

async function dashboardListNotifications(params) {
  const result_result_data = await dashboardApi('/notifications');
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  const items = data.notifications || data || [];
  const lines = items.map(n => `- ${n.read ? '✓' : '○'} ${n.title || n.message || 'Notificação'}`).join('\n');
  return ok({ stdout: `🔔 ${items.length} notificação(ões):\n${lines || 'Nenhuma.'}` });
}

async function dashboardMarkNotificationRead(params) {
  const id = params.id || params.notificationId;
  if (!id) return err('ID obrigatório');
  const result_result = await dashboardApi(`/notifications/${id}/read`, 'POST', {});
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  return ok({ stdout: `✅ Notificação ${id} lida.` });
}

async function dashboardMarkAllNotificationsRead(params) {
  const result_result = await dashboardApi('/notifications/read-all', 'POST', {});
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  return ok({ stdout: `✅ Todas lidas.` });
}

// ── USUÁRIOS / MEMBROS ──

async function dashboardListUsers(params) {
  const result_result_data = await dashboardApi('/users');
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  const items = data.users || data || [];
  const lines = items.map(u => `- ${u.name || u.username || u.id} (${u.role || 'user'})`).join('\n');
  return ok({ stdout: `👤 ${items.length} usuário(s):\n${lines || 'Nenhum.'}` });
}

async function dashboardListMembers(params) {
  const result_result_data = await dashboardApi('/members');
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  const items = data.members || data || [];
  const lines = items.map(m => `- ${m.name || m.displayName || m.id} (${m.role || '?'})`).join('\n');
  return ok({ stdout: `👥 ${items.length} membro(s):\n${lines || 'Nenhum.'}` });
}

// ── BUG DETECTOR ──

async function dashboardListBugReports(params) {
  const result_result_data = await dashboardApi('/bugdetector/reports');
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  const items = data.reports || data || [];
  const lines = items.map(r => `- ${r.filename || r.id}: ${r.summary || r.title || 'Relatório'}`).join('\n');
  return ok({ stdout: `🐛 ${items.length} relatório(s):\n${lines || 'Nenhum.'}` });
}

async function dashboardDeleteBugReport(params) {
  const filename = params.filename || params.id;
  if (!filename) return err('Filename obrigatório');
  const result_result = await dashboardApi(`/bugdetector/reports/${filename}`, 'DELETE');
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  return ok({ stdout: `🗑️ Relatório ${filename} excluído.` });
}

// ── GITHUB / VERCEL ──

async function dashboardListGitHubRepos(params) {
  const result_result_data = await dashboardApi('/github-repos');
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  const items = data.repos || data || [];
  const lines = items.map(r => `- ${r.name || r.full_name || r.repo} (${r.language || '?'})`).join('\n');
  return ok({ stdout: `🐙 ${items.length} repo(s):\n${lines || 'Nenhum.'}` });
}

async function dashboardListVercelProjects(params) {
  const result_result_data = await dashboardApi('/vercel-projects');
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  const items = data.projects || data || [];
  const lines = items.map(p => `- ${p.name || p.project} (${p.framework || '?'})`).join('\n');
  return ok({ stdout: `▲ ${items.length} projeto(s):\n${lines || 'Nenhum.'}` });
}

// ── OPERAÇÕES ──

async function dashboardListOpsAlerts(params) {
  const result_result_data = await dashboardApi('/ops');
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  const items = data.alerts || data || [];
  const lines = items.map(a => `- [${a.severity || '?'}] ${a.title || a.message || 'Alerta'}`).join('\n');
  return ok({ stdout: `⚠️ ${items.length} alerta(s):\n${lines || 'Nenhum.'}` });
}

async function dashboardCreateOpsAlert(params) {
  const body = {
    title: params.title || 'Novo alerta',
    message: params.message || params.descricao || '',
    severity: params.severity || 'medium',
  };
  const result_result = await dashboardApi('/ops/alerts', 'POST', body);
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  return ok({ stdout: `⚠️ Alerta: "${body.title}"` });
}

async function dashboardDeleteOpsAlert(params) {
  const id = params.id || params.alertId;
  if (!id) return err('ID obrigatório');
  const result_result = await dashboardApi(`/ops/alerts/${id}`, 'DELETE');
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  return ok({ stdout: `🗑️ Alerta ${id} excluído.` });
}

// ── TRANSAÇÕES / CONFIG / NEXO STATE ──

async function dashboardListTransactions(params) {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit));
  const result_data = await dashboardApi(`/transactions?${query.toString()}`);
  if (!result_data.success) return result_data;
  const data = result_data.data;
  const items = data.transactions || data || [];
  const lines = items.map(t => `- ${t.type || '?'} €${t.amount} — ${t.description || ''}`).join('\n');
  return ok({ stdout: `💳 ${items.length} transação(ões):\n${lines || 'Nenhuma.'}` });
}

async function dashboardGetNexoState(params) {
  const result_result_data = await dashboardApi('/nexo-state');
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  return ok({ stdout: `🌐 NEXO State:\n${JSON.stringify(data, null, 2)}` }); // v13.0: no cap
}

async function dashboardGetConfig(params) {
  const result_result_data = await dashboardApi('/config/dashboard');
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  return ok({ stdout: `⚙️ Config:\n${JSON.stringify(data, null, 2)}` }); // v13.0: no cap
}

// ═══════════════════════════════════════════════════════════════════════════
// VOTING TOOLS
// ═══════════════════════════════════════════════════════════════════════════

async function dashboardListVotingSessions(params) {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  const result_data = await dashboardApi(`/voting/sessions?${query.toString()}`);
  if (!result_data.success) return result_data;
  const data = result_data.data;
  const sessions = data.sessions || [];
  const lines = sessions.map(s => `- [${s.status}] ${s.title} (tipo: ${s.type}, quorum: ${s.quorumRequired})`).join('\n');
  return ok({ stdout: `🗳️ ${data.pagination?.total || sessions.length} sessão(ões) de votação:\n${lines || 'Nenhuma sessão encontrada.'}` });
}

async function dashboardGetVotingSession(params) {
  const result_result_data = await dashboardApi(`/voting/sessions/${params.id}`);
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  const votes = data.votes || {};
  const voteLines = Object.entries(votes).map(([k, v]) => `  ${k}: ${v ? v.vote : 'não votou'}`).join('\n');
  return ok({ stdout: `🗳️ Sessão "${data.title}" [${data.status}]\n${data.description || ''}\nVotos:\n${voteLines}` });
}

async function dashboardCreateVotingSession(params) {
  const body = {
    title: params.title,
    description: params.description || '',
    type: params.type || 'generic',
    quorumRequired: params.quorumRequired || 3
  };
  if (params.type === 'tool_action') {
    body.toolName = params.toolName;
    body.toolParams = params.toolParams || {};
  }
  const result_result_data = await dashboardApi('/voting/sessions', 'POST', body);
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  return ok({ stdout: `🗳️ Sessão de votação criada: "${data.title}" (ID: ${data.id}, quorum: ${data.quorumRequired})` });
}

async function dashboardVoteInSession(params) {
  const result_data = await dashboardApi(`/voting/sessions/${params.id}/vote`, 'POST', {
    vote: params.vote,
    comment: params.comment || ''
  });
  if (!result_data.success) return result_data;
  const data = result_data.data;
  return ok({ stdout: `🗳️ Voto registrado em "${data.session?.title}": ${params.vote}\nContagem: ${data.tally?.yes || 0} sim, ${data.tally?.no || 0} não` });
}

async function dashboardDeleteVotingSession(params) {
  const result_result = await dashboardApi(`/voting/sessions/${params.id}`, 'DELETE');
  if (!result_result.success) return result_result;
  const result = result_result.data;
  if (!result.success) return result;
  return ok({ stdout: `🗑️ Sessão de votação deletada (ID: ${params.id})` });
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT LOG / LIXEIRA DO DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

async function dashboardListRecentChanges(params) {
  const query = new URLSearchParams();
  query.set('limit', String(params.limit || 20));
  if (params.entityType) query.set('entityType', params.entityType);
  if (params.action) query.set('action', params.action);
  const result_data = await dashboardApi(`/audit-log?${query.toString()}`);
  if (!result_data.success) return result_data;
  const data = result_data.data;
  const entries = data.data || [];
  if (entries.length === 0) return ok({ stdout: '📜 Nenhuma alteração recente no dashboard.' });
  const lines = entries.map(e => {
    const emoji = e.action === 'delete' ? '🗑️' : e.action === 'update' ? '✏️' : '🆕';
    const when = new Date(e.timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `${emoji} ${when} · ${e.description} (${e.entityType})`;
  }).join('\n');
  return ok({ stdout: `📜 Últimas alterações do dashboard:\n${lines}` });
}

async function dashboardListTrash(params) {
  const query = new URLSearchParams();
  query.set('limit', String(params.limit || 30));
  if (params.entityType) query.set('entityType', params.entityType);
  const result_data = await dashboardApi(`/audit-log/trash?${query.toString()}`);
  if (!result_data.success) return result_data;
  const data = result_data.data;
  const entries = data.data || [];
  if (entries.length === 0) return ok({ stdout: '🗑️ Lixeira vazia. Nada para restaurar.' });
  const lines = entries.map((e, i) => {
    const when = new Date(e.timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const title = e.beforeSnapshot?.title || e.beforeSnapshot?.displayName || e.beforeSnapshot?.name || e.entityId;
    return `${i + 1}. 🗑️ ${when} · ${e.entityType} "${title}" — ID histórico: \`${e.id}\``;
  }).join('\n');
  return ok({ stdout: `🗑️ Lixeira do dashboard (${entries.length} itens):\n${lines}\n\nPara restaurar, digite: *restaurar <número>* ou *restaurar <id do histórico>*` });
}

async function dashboardUndoLastChange(params) {
  const actor = params.actor || 'telegram';
  const result = await dashboardApi('/audit-log/undo-last', 'POST', { actor, actions: params.actions || ['delete', 'update'] });
  if (!result.success) return result;
  const data = result.data;
  if (!data.success) return { success: false, error: data.error };
  return ok({ stdout: `↩️ ${data.message}\nEntidade: ${data.entityType} · Ação desfeita: ${data.action}` });
}

async function dashboardRestoreItem(params) {
  const id = params.id || params.auditId || params.historicoId;
  if (!id) return err('ID do histórico é obrigatório. Use o ID mostrado na lixeira.');
  const result = await dashboardApi(`/audit-log/restore/${id}`, 'POST', { actor: params.actor || 'telegram' });
  if (!result.success) return result;
  const data = result.data;
  if (!data.success) return { success: false, error: data.error };
  return ok({ stdout: `♻️ ${data.message}\nEntidade: ${data.entityType} · ID restaurado: ${data.restoredId}` });
}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD TOOLS — ROADMAPS & METAS
// ═══════════════════════════════════════════════════════════════════════════

async function dashboardListRoadmaps(params) {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.client_id) query.set('client_id', params.client_id);
  if (params.project_type) query.set('project_type', params.project_type);
  const result_data = await dashboardApi(`/roadmaps?${query.toString()}`);
  if (!result_data.success) return result_data;
  const data = result_data.data;
  const roadmaps = data.roadmaps || [];
  const lines = roadmaps.map(r => {
    const phases = r.phases || [];
    const progress = phases.length ? Math.round((phases.filter(p => p.status === 'completed').length / phases.length) * 100) : 0;
    return `- [${r.status}] ${r.title} (${r.project_type}, ${progress}%) — €${r.total_value || 0}`;
  }).join('\n');
  return ok({ stdout: `🎯 ${roadmaps.length} projeto(s):\n${lines || 'Nenhum projeto encontrado.'}` });
}

async function dashboardGetRoadmap(params) {
  const result_result_data = await dashboardApi(`/roadmaps/${params.id}`);
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  const phases = data.phases || [];
  const current = data.current_phase_index || 0;
  const phaseLines = phases.map((p, i) => `  ${i + 1}. [${p.status}] ${p.title}${i === current ? ' ← ATUAL' : ''}`).join('\n');
  return ok({ stdout: `🎯 ${data.title} [${data.status}]\nTipo: ${data.project_type}\nValor: €${data.total_value || 0}\nFase atual: ${current + 1}/${phases.length}\n\nFases:\n${phaseLines}` });
}

async function dashboardCreateRoadmap(params) {
  const body = {
    title: params.title,
    client_id: params.clientId || params.client_id || null,
    lead_id: params.leadId || params.lead_id || null,
    project_type: params.projectType || params.project_type || 'website',
    total_value: params.totalValue || params.total_value || 0,
    currency: params.currency || 'EUR',
    start_date: params.startDate || params.start_date || new Date().toISOString().split('T')[0],
    github_repo: params.githubRepo || params.github_repo || null,
    subdomain: params.subdomain || null,
    onboarding_answers: params.onboardingAnswers || params.onboarding_answers || {}
  };
  const result_result_data = await dashboardApi('/roadmaps', 'POST', body);
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  return ok({ stdout: `🎯 Projeto criado: "${data.title}" (ID: ${data.id}, tipo: ${data.project_type})` });
}

async function dashboardAdvanceRoadmapPhase(params) {
  const result_result_data = await dashboardApi(`/roadmaps/${params.id}/advance`, 'POST', { reason: params.reason || 'Avanço de fase' });
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  return ok({ stdout: `➡️ Fase avançada! Agora na fase ${data.current_phase_index + 1}` });
}

async function dashboardListProjectTypes(params) {
  const result_result_data = await dashboardApi('/roadmaps/project-templates');
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  const templates = data.templates || [];
  const lines = templates.map(t => `- ${t.project_type}: ${t.name} (${(t.default_phases || []).length} fases padrão)`).join('\n');
  return ok({ stdout: `📋 ${templates.length} tipo(s) de projeto:\n${lines || 'Nenhum template encontrado.'}` });
}

async function dashboardJoinTimeline(params) {
  const result_result_data = await dashboardApi(`/roadmaps/timelines/${params.timelineId}/join`, 'POST');
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  return ok({ stdout: `👤 Entrou na timeline. Colaboradores ativos: ${data.collaborators?.length || 0}` });
}

async function dashboardAdvanceTimelineStep(params) {
  const result_result_data = await dashboardApi(`/roadmaps/timelines/${params.timelineId}/advance-step`, 'POST');
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  return ok({ stdout: `➡️ Step avançado! Timeline: ${data.timeline?.title || params.timelineId}` });
}

async function dashboardCreateReviewVote(params) {
  const body = {
    title: params.title || `Revisão: ${params.phaseTitle || 'Fase'}`,
    description: params.description || '',
    type: 'review',
    quorumRequired: params.quorumRequired || 3,
    linkedTimelineId: params.linkedTimelineId || null,
    linkedRoadmapId: params.linkedRoadmapId || null,
    reviewMeetingAt: params.reviewMeetingAt || null
  };
  const result_result_data = await dashboardApi('/voting/sessions', 'POST', body);
  if (!result_result_data.success) return result_result_data;
  const result_data = result_result_data.data;
  const data = result_data;
  return ok({ stdout: `🗳️ Votação de revisão criada: "${data.title}" (ID: ${data.id})` });
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  // Aliases for natively-named tools
  web_search: searchWeb,
  webSearch: searchWeb,
  // File Ops
  readFile,
  writeFile,
  appendFile,
  replaceInFile,
  deleteFile,
  moveFile,
  copyFile,
  getFileInfo,
  // Directory
  listFiles,
  viewDirectory,
  createDirectory,
  removeDirectory,
  // Search
  searchFiles,
  grep,
  glob,
  searchWeb,
  fetchURL,
  // Shell
  executeShell,
  executeScript,
  runTests,
  checkSyntax,
  installPackages,
  // Git
  gitStatus,
  gitDiff,
  gitLog,
  gitCommit,
  // Patch
  applyPatch,
  // Network
  downloadFile,
  browser,
  // Clipboard
  clipboardRead,
  clipboardWrite,
  // Media
  readMediaFile,
  // Reasoning
  think,
  // Dashboard — Tarefas
  dashboardCreateTask,
  dashboardListTasks,
  dashboardUpdateTask,
  dashboardDeleteTask,
  dashboardCompleteTask,
  dashboardAddComment,
  // Dashboard — Leads
  dashboardCreateLead,
  dashboardListLeads,
  dashboardUpdateLead,
  dashboardConvertLead,
  dashboardDeleteLead,
  // Dashboard — Financeiro Receitas
  dashboardCreatePayment,
  dashboardListPayments,
  dashboardUpdatePayment,
  dashboardDeletePayment,
  dashboardReceiveSplit,
  // Dashboard — Financeiro Despesas
  dashboardCreateExpense,
  dashboardListExpenses,
  dashboardUpdateExpense,
  dashboardDeleteExpense,
  dashboardPayExpense,
  dashboardCreateExpenseTemplate,
  dashboardQuickExpense,
  // Dashboard — Financeiro Caixa
  dashboardGetCashBox,
  dashboardAddCashEntry,
  dashboardListCashHistory,
  dashboardReconcileCashBox,
  dashboardAdjustCashBox,
  dashboardGetCashBoxProjection,
  dashboardCreateCashPayment,
  // Dashboard — Orçamentos
  dashboardCreateQuote,
  dashboardListQuotes,
  dashboardUpdateQuote,
  dashboardDeleteQuote,
  // Dashboard — Projetos
  dashboardListProjects,
  // Dashboard — Clientes
  dashboardListClients,
  // Dashboard — Ideias
  dashboardCreateIdea,
  dashboardListIdeas,
  // Dashboard — Links
  dashboardAddLink,
  dashboardListLinks,
  dashboardDeleteLink,
  dashboardEnrichLink,
  dashboardSyncLinks,
  dashboardGetLinksStats,
  // Dashboard — Email
  dashboardSendEmail,
  dashboardListEmails,
  dashboardSyncEmails,
  // Dashboard — WhatsApp
  dashboardSendWhatsApp,
  dashboardGetWhatsAppHistory,
  dashboardScanWhatsApp,
  dashboardGetWhatsAppStatus,
  dashboardGetWhatsAppClassifications,
  // Dashboard — Sistema
  dashboardGetSystemStatus,
  dashboardGetSystemLogs,
  dashboardControlService,
  // Dashboard — Notificações
  dashboardListNotifications,
  dashboardMarkNotificationRead,
  dashboardMarkAllNotificationsRead,
  // Dashboard — Usuários
  dashboardListUsers,
  dashboardListMembers,
  // Dashboard — BugDetector
  dashboardListBugReports,
  dashboardDeleteBugReport,
  // Dashboard — GitHub/Vercel
  dashboardListGitHubRepos,
  dashboardListVercelProjects,
  // Dashboard — Operações
  dashboardListOpsAlerts,
  dashboardCreateOpsAlert,
  dashboardDeleteOpsAlert,
  // Dashboard — Transações/Config
  dashboardListTransactions,
  dashboardGetNexoState,
  dashboardGetConfig,
  // Dashboard — Finance Summary
  dashboardGetFinanceSummary,
  // Dashboard — Voting
  dashboardListVotingSessions,
  dashboardGetVotingSession,
  dashboardCreateVotingSession,
  dashboardVoteInSession,
  dashboardDeleteVotingSession,
  // Dashboard — Audit Log / Lixeira
  dashboardListRecentChanges,
  dashboardListTrash,
  dashboardUndoLastChange,
  dashboardRestoreItem,
  // Dashboard — Roadmaps & Metas
  dashboardListRoadmaps,
  dashboardGetRoadmap,
  dashboardCreateRoadmap,
  dashboardAdvanceRoadmapPhase,
  dashboardListProjectTypes,
  dashboardJoinTimeline,
  dashboardAdvanceTimelineStep,
  dashboardCreateReviewVote,
  // System
  getCurrentDirectory,
  // v10.2: Visible mode control
  setVisibleMode,
  getVisibleMode,
  // v10.18: Self-update from GitHub
  lunaSelfUpdate,
  // Debug
  openDebugTerminal,
  // Project Validation
  validateProject: (projectPath) => {
    const { validateProject } = require('./luna-code-validator.cjs');
    return validateProject(projectPath);
  },
};
