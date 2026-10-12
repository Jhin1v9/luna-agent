/**
 * Computer Use Engine v2.0
 * Reescrita em Node.js puro — sem Python child_process
 *
 * Ambiente: Ubuntu + GNOME + Wayland (com Xwayland)
 *
 * Backends:
 *   Screenshot: grim (Wayland) → gnome-screenshot (GNOME fallback)
 *   OCR:        tesseract CLI
 *   Input:      xdotool (Xwayland apps) → ydotool (Wayland fallback)
 *   Shell:      spawn direto com shell-quote parser
 *   Windows:    xdotool (X11) → dbus-send (GNOME fallback)
 */

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const crypto = require('crypto');

// shell-quote para parsing seguro de comandos
let shellQuote = null;
try {
  shellQuote = require('shell-quote');
} catch (e) {
  console.warn('[CUEngine] shell-quote não instalado. Instale: npm install shell-quote');
}

const execPromise = util.promisify(exec);

// ============================================================
// CONFIG
// ============================================================
const ARTIFACTS_DIR = path.join(__dirname, '..', 'ARTIFACTS');
const SCREENSHOT_DIR = path.join(ARTIFACTS_DIR, 'computer-use-screenshots');
const MAX_ITERATIONS = 30;
const TASK_TIMEOUT_MS = 5 * 60 * 1000;
const ACTION_DELAY_MS = 800;
const MAX_SCREENSHOT_AGE_MS = 60 * 60 * 1000; // 1h
const MAX_SCREENSHOTS = 100;

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// ============================================================
// LOGGER
// ============================================================
class CULogger {
  constructor() {
    this.logFile = path.join(ARTIFACTS_DIR, 'computer-use.log');
  }

  _ts() {
    return new Date().toISOString();
  }

  _write(level, msg) {
    const line = `[${this._ts()}] [${level}] ${msg}`;
    console.log(`[CUEngine] ${line}`);
    try {
      fs.appendFileSync(this.logFile, line + '\n');
    } catch {}
  }

  info(m) { this._write('INFO', m); }
  warn(m) { this._write('WARN', m); }
  error(m) { this._write('ERROR', m); }
  success(m) { this._write('SUCCESS', m); }
}
const log = new CULogger();

// ============================================================
// UTILITIES
// ============================================================

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function hashUserId(userId) {
  return crypto.createHash('sha256').update(String(userId)).digest('hex').slice(0, 8);
}

/**
 * Spawn a command and capture stdout/stderr
 */
function spawnPromise(cmd, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      timeout: options.timeout || 30000,
      env: { ...process.env, DISPLAY: process.env.DISPLAY || ':1', ...options.env },
      ...options,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', d => stdout += d.toString());
    child.stderr?.on('data', d => stderr += d.toString());

    child.on('close', (code) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code,
        success: code === 0,
      });
    });

    child.on('error', (err) => {
      resolve({ stdout: '', stderr: err.message, exitCode: -1, success: false, error: err.message });
    });
  });
}

// ============================================================
// SCREENSHOT MODULE
// ============================================================

let _lastScreenshotPath = null;
let _lastScreenshotTime = 0;

async function takeScreenshot(options = {}) {
  const filename = `shot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);

  // Try grim first (Wayland native, fast)
  let result = await spawnPromise('grim', [filepath], { timeout: 5000 });

  // Fallback to gnome-screenshot
  if (!result.success) {
    log.warn(`grim failed (${result.stderr}), trying gnome-screenshot...`);
    result = await spawnPromise('gnome-screenshot', ['-f', filepath], { timeout: 5000 });
  }

  if (!result.success) {
    log.error(`Screenshot failed: grim=${result.stderr}`);
    return null;
  }

  _lastScreenshotPath = filepath;
  _lastScreenshotTime = Date.now();

  // Cleanup old screenshots
  cleanupOldScreenshots();

  log.info(`Screenshot saved: ${filepath}`);
  return filepath;
}

async function takeScreenshotArea(x, y, w, h) {
  const filename = `shot_area_${Date.now()}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);

  // grim with geometry
  let result = await spawnPromise('grim', ['-g', `${x},${y} ${w}x${h}`, filepath], { timeout: 5000 });

  if (!result.success) {
    result = await spawnPromise('gnome-screenshot', ['-a', '-f', filepath], { timeout: 5000 });
  }

  return result.success ? filepath : null;
}

function cleanupOldScreenshots() {
  try {
    const files = fs.readdirSync(SCREENSHOT_DIR)
      .filter(f => f.endsWith('.png'))
      .map(f => ({
        name: f,
        path: path.join(SCREENSHOT_DIR, f),
        time: fs.statSync(path.join(SCREENSHOT_DIR, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time);

    // Remove old files beyond MAX_SCREENSHOTS
    for (const file of files.slice(MAX_SCREENSHOTS)) {
      fs.unlinkSync(file.path);
    }

    // Remove files older than MAX_SCREENSHOT_AGE_MS
    const cutoff = Date.now() - MAX_SCREENSHOT_AGE_MS;
    for (const file of files) {
      if (file.time < cutoff) {
        try { fs.unlinkSync(file.path); } catch {}
      }
    }
  } catch (e) {
    log.warn(`Screenshot cleanup error: ${e.message}`);
  }
}

// ============================================================
// OCR MODULE
// ============================================================

let _ocrCache = new Map(); // filepath -> { text, time }
const OCR_CACHE_TTL_MS = 5000;

async function runOCR(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) {
    return null;
  }

  // Check cache
  const cached = _ocrCache.get(imagePath);
  if (cached && Date.now() - cached.time < OCR_CACHE_TTL_MS) {
    return cached.text;
  }

  const result = await spawnPromise('tesseract', [imagePath, 'stdout', '-l', 'por+eng'], { timeout: 15000 });

  if (!result.success) {
    log.warn(`OCR failed: ${result.stderr}`);
    return null;
  }

  const text = result.stdout.trim();
  _ocrCache.set(imagePath, { text, time: Date.now() });

  // Limit cache size
  if (_ocrCache.size > 50) {
    const firstKey = _ocrCache.keys().next().value;
    _ocrCache.delete(firstKey);
  }

  log.info(`OCR extracted ${text.length} chars`);
  return text;
}

// ============================================================
// INPUT MODULE (Mouse + Keyboard)
// ============================================================

async function isXdotoolAvailable() {
  const r = await spawnPromise('xdotool', ['--version'], { timeout: 2000 });
  return r.success;
}

async function isYdotoolAvailable() {
  const r = await spawnPromise('ydotool', ['--version'], { timeout: 2000 });
  return r.success;
}

async function sendMouseClick(x, y, button = 'left') {
  // Primary: xdotool (works on Xwayland apps)
  const xdoResult = await spawnPromise('xdotool', ['mousemove', '--sync', String(x), String(y), 'click', button === 'right' ? '3' : button === 'middle' ? '2' : '1'], { timeout: 5000 });
  if (xdoResult.success) {
    log.info(`Click at (${x}, ${y}) via xdotool`);
    return { success: true };
  }

  // Fallback: ydotool
  log.warn(`xdotool click failed, trying ydotool...`);
  const ydoResult = await spawnPromise('ydotool', ['mousemove', String(x), String(y), 'click', button === 'right' ? '2' : button === 'middle' ? '1' : '0'], { timeout: 5000 });
  if (ydoResult.success) {
    log.info(`Click at (${x}, ${y}) via ydotool`);
    return { success: true };
  }

  return { success: false, error: `Both xdotool and ydotool failed: ${xdoResult.stderr || ydoResult.stderr}` };
}

async function sendDoubleClick(x, y) {
  const result = await spawnPromise('xdotool', ['mousemove', '--sync', String(x), String(y), 'click', '--repeat', '2', '1'], { timeout: 5000 });
  if (result.success) return { success: true };

  // ydotool fallback — do two clicks
  const r1 = await spawnPromise('ydotool', ['mousemove', String(x), String(y), 'click', '0'], { timeout: 3000 });
  if (r1.success) {
    await sleep(100);
    const r2 = await spawnPromise('ydotool', ['click', '0'], { timeout: 3000 });
    if (r2.success) return { success: true };
  }

  return { success: false, error: 'Double-click failed on all backends' };
}

async function sendRightClick(x, y) {
  return await sendMouseClick(x, y, 'right');
}

async function sendType(text) {
  // Escape quotes for xdotool
  const escaped = text.replace(/'/g, "'\"'\"'");
  const result = await spawnPromise('xdotool', ['type', '--delay', '10', text], { timeout: 10000 });
  if (result.success) {
    log.info(`Typed ${text.length} chars via xdotool`);
    return { success: true };
  }

  log.warn(`xdotool type failed, trying ydotool...`);
  const ydoResult = await spawnPromise('ydotool', ['type', text], { timeout: 10000 });
  if (ydoResult.success) {
    log.info(`Typed ${text.length} chars via ydotool`);
    return { success: true };
  }

  return { success: false, error: `Type failed: ${result.stderr || ydoResult.stderr}` };
}

async function sendKey(key) {
  const result = await spawnPromise('xdotool', ['key', key], { timeout: 5000 });
  if (result.success) return { success: true };

  const ydoResult = await spawnPromise('ydotool', ['key', key], { timeout: 5000 });
  if (ydoResult.success) return { success: true };

  return { success: false, error: `Key failed: ${result.stderr || ydoResult.stderr}` };
}

async function sendHotkey(keys) {
  // keys = ['ctrl', 't']
  const keyStr = keys.join('+');
  const result = await spawnPromise('xdotool', ['key', keyStr], { timeout: 5000 });
  if (result.success) return { success: true };

  const ydoResult = await spawnPromise('ydotool', ['key', keyStr], { timeout: 5000 });
  if (ydoResult.success) return { success: true };

  return { success: false, error: `Hotkey failed: ${result.stderr || ydoResult.stderr}` };
}

async function sendScroll(amount) {
  const result = await spawnPromise('xdotool', ['click', '--repeat', String(Math.abs(amount)), amount > 0 ? '4' : '5'], { timeout: 5000 });
  if (result.success) return { success: true };
  return { success: false, error: `Scroll failed: ${result.stderr}` };
}

async function moveMouse(x, y) {
  const result = await spawnPromise('xdotool', ['mousemove', '--sync', String(x), String(y)], { timeout: 5000 });
  if (result.success) return { success: true };

  const ydoResult = await spawnPromise('ydotool', ['mousemove', String(x), String(y)], { timeout: 5000 });
  if (ydoResult.success) return { success: true };

  return { success: false, error: `Move failed: ${result.stderr || ydoResult.stderr}` };
}

async function getMousePosition() {
  const result = await spawnPromise('xdotool', ['getmouselocation'], { timeout: 3000 });
  if (result.success) {
    const match = result.stdout.match(/x:(\d+)\s+y:(\d+)/);
    if (match) {
      return { success: true, x: parseInt(match[1]), y: parseInt(match[2]) };
    }
  }
  return { success: false, error: result.stderr };
}

async function getScreenSize() {
  const result = await spawnPromise('xdotool', ['getdisplaygeometry'], { timeout: 3000 });
  if (result.success) {
    const [w, h] = result.stdout.split(' ').map(Number);
    return { success: true, width: w, height: h };
  }
  // Fallback: try xdpyinfo
  const xdpyResult = await spawnPromise('xdpyinfo', [], { timeout: 3000 });
  if (xdpyResult.success) {
    const match = xdpyResult.stdout.match(/dimensions:\s+(\d+)x(\d+) pixels/);
    if (match) {
      return { success: true, width: parseInt(match[1]), height: parseInt(match[2]) };
    }
  }
  return { success: false, error: 'Could not determine screen size' };
}

// ============================================================
// SHELL MODULE (com shell-quote parser)
// ============================================================

// Níveis de permissão — usuário permitiu shell livre, mas mantemos logging
const PERMISSION_LEVELS = {
  SAFE: 'SAFE',
  MODERATE: 'MODERATE',
  DESTRUCTIVE: 'DESTRUCTIVE',
};

function classifyCommand(cmd) {
  if (!shellQuote) {
    // Fallback: permissive mode if shell-quote not available
    return PERMISSION_LEVELS.SAFE;
  }

  try {
    const tokens = shellQuote.parse(cmd);
    if (!tokens.length) return PERMISSION_LEVELS.SAFE;

    const command = String(tokens[0]).toLowerCase();

    // Commands that are always safe (read-only)
    const safeCommands = new Set([
      'ls', 'pwd', 'cat', 'head', 'tail', 'echo', 'whoami', 'date', 'df', 'du',
      'ps', 'top', 'htop', 'find', 'grep', 'which', 'whereis', 'uname', 'hostname',
      'id', 'groups', 'env', 'printenv', 'history', 'free', 'uptime', 'lscpu',
    ]);

    // Commands that modify files but are generally safe
    const moderateCommands = new Set([
      'mkdir', 'touch', 'cp', 'mv', 'ln', 'chmod', 'chown', 'git', 'npm', 'npx',
      'pip', 'pip3', 'apt', 'apt-get', 'dpkg', 'snap', 'flatpak', 'code', 'cursor',
      'node', 'python', 'python3', 'docker', 'docker-compose', 'kubectl',
    ]);

    // Destructive commands
    const destructiveCommands = new Set([
      'rm', 'rmdir', 'dd', 'mkfs', 'fdisk', 'parted', 'shred', 'wipe', 'truncate',
      'format', 'del', 'erase',
    ]);

    if (safeCommands.has(command)) {
      // Even safe commands can be dangerous with certain args
      const cmdLower = cmd.toLowerCase();
      if (cmdLower.includes('/etc/shadow') || cmdLower.includes('/etc/passwd')) {
        return PERMISSION_LEVELS.DESTRUCTIVE;
      }
      return PERMISSION_LEVELS.SAFE;
    }

    if (moderateCommands.has(command)) return PERMISSION_LEVELS.MODERATE;
    if (destructiveCommands.has(command)) return PERMISSION_LEVELS.DESTRUCTIVE;

    // Unknown commands = MODERATE by default (log but allow)
    return PERMISSION_LEVELS.MODERATE;
  } catch (e) {
    // Parse error = MODERATE (log but allow)
    return PERMISSION_LEVELS.MODERATE;
  }
}

async function runShell(command, options = {}) {
  const permission = classifyCommand(command);
  log.info(`[SHELL ${permission}] ${command}`);

  const timeout = options.timeout || 30000;

  // Use spawn diretamente (sem shell=True no Python)
  // Para comandos complexos com pipes, usamos bash -c mas via array
  const useShell = command.includes('|') || command.includes('>') || command.includes('<') || command.includes(';') || command.includes('&&');

  let result;
  if (useShell) {
    result = await spawnPromise('bash', ['-c', command], { timeout, env: { ...process.env, ...options.env } });
  } else if (shellQuote) {
    const tokens = shellQuote.parse(command);
    result = await spawnPromise(tokens[0], tokens.slice(1), { timeout, env: { ...process.env, ...options.env } });
  } else {
    result = await spawnPromise('bash', ['-c', command], { timeout, env: { ...process.env, ...options.env } });
  }

  // Truncate long outputs
  const maxStdout = 4000;
  const maxStderr = 2000;
  const stdout = result.stdout.length > maxStdout ? result.stdout.slice(0, maxStdout) + '\n...[truncated]' : result.stdout;
  const stderr = result.stderr.length > maxStderr ? result.stderr.slice(0, maxStderr) + '\n...[truncated]' : result.stderr;

  return {
    success: result.success,
    exitCode: result.exitCode,
    stdout,
    stderr,
    permission,
  };
}

// ============================================================
// WINDOW MODULE (D-Bus GNOME Shell para Wayland)
// ============================================================

/**
 * Call org.gnome.Shell.Eval via gdbus
 * This allows us to execute JavaScript in the GNOME Shell context
 */
async function gnomeShellEval(jsCode) {
  const result = await spawnPromise('gdbus', [
    'call', '--session',
    '--dest', 'org.gnome.Shell',
    '--object-path', '/org/gnome/Shell',
    '--method', 'org.gnome.Shell.Eval',
    jsCode,
  ], { timeout: 5000 });

  if (!result.success) {
    // Fallback: try busctl
    const busctlResult = await spawnPromise('busctl', [
      '--user', 'call', 'org.gnome.Shell', '/org/gnome/Shell',
      'org.gnome.Shell', 'Eval', 's', jsCode,
    ], { timeout: 5000 });
    if (busctlResult.success) {
      return { success: true, output: busctlResult.stdout };
    }
    return { success: false, error: result.stderr };
  }

  // gdbus returns: (true, 'result') or (false, 'error')
  // Parse the tuple
  const match = result.stdout.match(/\(true,\s*'(.+)'\)/);
  if (match) {
    return { success: true, output: match[1] };
  }
  return { success: false, error: result.stdout };
}

async function getWindowList() {
  // Try D-Bus GNOME Shell first (Wayland-native)
  const jsCode = `global.display.get_tab_list(Meta.TabList.NORMAL, null).map(w => w.get_title()).join('\\n')`;
  const dbusResult = await gnomeShellEval(jsCode);

  if (dbusResult.success && dbusResult.output) {
    const titles = dbusResult.output.split('\n').filter(Boolean);
    return titles.map((title, i) => ({
      id: String(i),
      name: title,
      pid: null,
    }));
  }

  // Fallback: xdotool (only works for Xwayland apps)
  log.warn('D-Bus window list failed, trying xdotool fallback...');
  const result = await spawnPromise('xdotool', ['search', '--onlyvisible', '.'], { timeout: 5000 });
  if (!result.success) return [];

  const ids = result.stdout.split('\n').filter(Boolean);
  const windows = [];
  for (const id of ids.slice(0, 20)) {
    const nameResult = await spawnPromise('xdotool', ['getwindowname', id], { timeout: 2000 });
    windows.push({ id, name: nameResult.stdout || 'unknown', pid: null });
  }
  return windows;
}

async function getActiveWindow() {
  // Try D-Bus GNOME Shell first
  const jsCode = `global.display.focus_window ? global.display.focus_window.get_title() : ''`;
  const dbusResult = await gnomeShellEval(jsCode);

  if (dbusResult.success && dbusResult.output) {
    return {
      id: 'active',
      name: dbusResult.output,
      pid: null,
    };
  }

  // Fallback: xdotool
  const idResult = await spawnPromise('xdotool', ['getactivewindow'], { timeout: 3000 });
  if (!idResult.success) return null;

  const id = idResult.stdout.trim();
  const nameResult = await spawnPromise('xdotool', ['getwindowname', id], { timeout: 2000 });
  return { id, name: nameResult.stdout || 'unknown', pid: null };
}

async function activateWindow(name) {
  // Try D-Bus GNOME Shell
  const jsCode = `const wins = global.display.get_tab_list(Meta.TabList.NORMAL, null); const target = wins.find(w => w.get_title().toLowerCase().includes('${name.toLowerCase()}')); if (target) { target.activate(global.get_current_time()); 'OK' } else { 'NOT_FOUND' }`;
  const dbusResult = await gnomeShellEval(jsCode);

  if (dbusResult.success && dbusResult.output === 'OK') {
    return { success: true };
  }

  // Fallback: xdotool
  const result = await spawnPromise('xdotool', ['search', '--name', name, 'windowactivate'], { timeout: 5000 });
  return { success: result.success };
}

async function openApp(appName) {
  // Try gtk-launch first
  let result = await spawnPromise('gtk-launch', [appName], { timeout: 10000 });
  if (result.success) return { success: true };

  // Fallback: xdg-open
  result = await spawnPromise('xdg-open', [appName], { timeout: 10000 });
  if (result.success) return { success: true };

  // Fallback: try common desktop files
  const commonApps = {
    chrome: 'google-chrome',
    google: 'google-chrome',
    firefox: 'firefox',
    vscode: 'code',
    code: 'code',
    terminal: 'gnome-terminal',
    telegram: 'telegram-desktop',
    files: 'nautilus',
  };

  const desktopName = commonApps[appName.toLowerCase()];
  if (desktopName) {
    result = await spawnPromise('gtk-launch', [desktopName], { timeout: 10000 });
    if (result.success) return { success: true };
  }

  return { success: false, error: `Could not open app: ${appName}` };
}

// ============================================================
// VERIFIER MODULE
// ============================================================

async function verifyAction(action, beforeScreenshotPath) {
  // Wait for action to take effect
  const waitTime = action.type === 'open_app' ? 3000 : action.type === 'click' ? 1000 : 500;
  await sleep(waitTime);

  const afterPath = await takeScreenshot();
  if (!afterPath) {
    return { success: false, error: 'Screenshot failed during verification' };
  }

  // For open_app, check if window appeared
  if (action.type === 'open_app' || action.type === 'open') {
    const windows = await getWindowList();
    const appName = action.params?.app || action.params?.name || '';
    const found = windows.some(w => w.name.toLowerCase().includes(appName.toLowerCase()));
    return { success: found, screenshot: afterPath };
  }

  // For click, check if screen changed
  if (action.type === 'click' && beforeScreenshotPath && fs.existsSync(beforeScreenshotPath)) {
    const changed = await screenshotsDiffer(beforeScreenshotPath, afterPath);
    return { success: changed, screenshot: afterPath };
  }

  // Default: assume success if screenshot worked
  return { success: true, screenshot: afterPath };
}

async function screenshotsDiffer(path1, path2) {
  // Simple file size comparison as proxy for "screen changed"
  try {
    const s1 = fs.statSync(path1).size;
    const s2 = fs.statSync(path2).size;
    const diff = Math.abs(s1 - s2);
    return diff > 1024; // More than 1KB difference = changed
  } catch {
    return true; // Assume changed if can't compare
  }
}

// ============================================================
// ACTION ROUTER
// ============================================================

async function executeAction(action) {
  const { type, params = {} } = action;

  switch (type) {
    case 'screenshot':
      return { success: true, screenshot: await takeScreenshot() };

    case 'click':
      return await sendMouseClick(params.x, params.y);

    case 'doubleClick':
      return await sendDoubleClick(params.x, params.y);

    case 'rightClick':
      return await sendRightClick(params.x, params.y);

    case 'type':
      return await sendType(params.text);

    case 'key':
      return await sendKey(params.key);

    case 'hotkey':
      return await sendHotkey(params.keys);

    case 'scroll':
      return await sendScroll(params.amount);

    case 'moveTo':
      return await moveMouse(params.x, params.y);

    case 'wait':
      await sleep((params.seconds || 1) * 1000);
      return { success: true };

    case 'shell':
      return await runShell(params.command, { timeout: params.timeout });

    case 'open_app':
    case 'open':
      return await openApp(params.app || params.name);

    case 'getMousePos':
      return await getMousePosition();

    case 'getScreenSize':
      return await getScreenSize();

    case 'getWindows':
      return { success: true, windows: await getWindowList() };

    case 'getActiveWindow':
      return { success: true, window: await getActiveWindow() };

    case 'activateWindow':
      return await activateWindow(params.name);

    case 'ocr':
      return { success: true, text: await runOCR(params.imagePath) };

    default:
      return { success: false, error: `Unknown action: ${type}` };
  }
}

// ============================================================
// ERROR RECOVERY
// ============================================================

async function executeWithRetry(action, maxRetries = 3) {
  let lastError = null;

  for (let i = 0; i < maxRetries; i++) {
    if (i > 0) {
      log.warn(`Retry ${i}/${maxRetries} for ${action.type}...`);
      await sleep(1000 * i); // Exponential-ish backoff
    }

    const result = await executeAction(action);
    if (result.success) {
      return result;
    }

    lastError = result.error;

    // If xdotool failed and we haven't tried ydotool yet, force ydotool on next retry
    if (result.error?.includes('xdotool') && action.type !== 'shell') {
      log.info('Will try ydotool on next retry...');
    }
  }

  return { success: false, error: `Failed after ${maxRetries} retries: ${lastError}` };
}

// ============================================================
// MAIN ENGINE CLASS
// ============================================================

class ComputerUseEngine {
  constructor() {
    this.active = false;
    this.taskHistory = [];
  }

  async getDesktopState() {
    const [screenSize, mousePos, windows, activeWindow] = await Promise.all([
      getScreenSize(),
      getMousePosition(),
      getWindowList(),
      getActiveWindow(),
    ]);

    return {
      timestamp: new Date().toISOString(),
      screenSize: screenSize?.success ? { width: screenSize.width, height: screenSize.height } : null,
      mousePosition: mousePos?.success ? { x: mousePos.x, y: mousePos.y } : null,
      windows: windows?.success ? windows.windows : [],
      activeWindow: activeWindow?.success ? activeWindow.window : null,
    };
  }

  async runTask(actions) {
    if (this.active) {
      return { success: false, error: 'Engine is already running a task' };
    }

    this.active = true;
    const results = [];
    let beforeScreenshot = null;

    try {
      for (const action of actions) {
        log.info(`Executing: ${action.type}`);

        if (action.type === 'click' || action.type === 'open_app') {
          beforeScreenshot = await takeScreenshot();
        }

        const result = await executeWithRetry(action);
        results.push({ action, result });

        if (action.type === 'click' || action.type === 'open_app') {
          const verifyResult = await verifyAction(action, beforeScreenshot);
          result.verified = verifyResult.success;
        }

        if (!result.success) {
          log.error(`Action ${action.type} failed: ${result.error}`);
        }

        await sleep(ACTION_DELAY_MS);
      }

      return { success: true, results };
    } catch (err) {
      log.error(`Task error: ${err.message}`);
      return { success: false, error: err.message, results };
    } finally {
      this.active = false;
    }
  }

  async executeSingle(action) {
    return await executeWithRetry(action);
  }

  cancel() {
    this.active = false;
    return { success: true, message: 'Task cancelled' };
  }
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  ComputerUseEngine,
  // Low-level modules (for advanced use)
  takeScreenshot,
  takeScreenshotArea,
  runOCR,
  sendMouseClick,
  sendDoubleClick,
  sendRightClick,
  sendType,
  sendKey,
  sendHotkey,
  sendScroll,
  moveMouse,
  getMousePosition,
  getScreenSize,
  getWindowList,
  getActiveWindow,
  activateWindow,
  openApp,
  runShell,
  classifyCommand,
  verifyAction,
  executeAction,
  executeWithRetry,
};
