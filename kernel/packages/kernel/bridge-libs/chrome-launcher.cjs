/**
 * ChromeLauncher — extracts Chrome launching/management logic from kimi-bridge.cjs.
 * Responsibilities:
 *   - Find Chrome binary (prioritize .deb paths, reject snap)
 *   - Scan CDP ports for existing Chrome instances
 *   - Kill headless Chrome or Chrome with /tmp/ profiles
 *   - Start Chrome with correct args and keep process alive
 *   - Probe ports to verify Chrome started
 *   - Track spawned PID for precise kill
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const { execSync, spawn } = require('child_process');
const lunaConfig = require('../config/luna-config');

class ChromeLauncher {
  constructor(config, logger) {
    this.config = config || {};
    this.logger = logger || { info: () => {}, warn: () => {}, error: () => {}, success: () => {} };
    this.cdpPorts = this.config.CDP_PORTS || [9222, 9223, 9224, 9225];
    this.profileDir = this.config.PROFILE_DIR || path.join(lunaConfig.LUNA_DIR || path.join(os.homedir(), '.luna'), 'chrome-profile');
    this.extensionDir = this.config.EXTENSION_DIR || path.join(__dirname, '..', 'luna-extension');
    this.chromePathPriority = this.config.CHROME_PATH_PRIORITY || [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      process.env.CHROME_EXECUTABLE_PATH,
      process.env.LUNA_CHROME_PATH,
    ].filter(Boolean);
    if (process.platform === 'win32') {
      this.chromePathPriority.push(
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
      );
    } else {
      this.chromePathPriority.push(
        '/opt/google/chrome/chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        path.join(os.homedir(), '.local', 'bin', 'google-chrome'),
        'google-chrome-stable',
        'google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        'chromium-browser',
        'chromium'
      );
    }
  }

  _makeCdpUrl(port) {
    return `http://127.0.0.1:${port}`;
  }

  _probePort(port) {
    return new Promise((resolve) => {
      const req = http.get(`${this._makeCdpUrl(port)}/json/version`, (res) => {
        resolve(res.statusCode === 200 ? port : 0);
      });
      req.on('error', () => resolve(0));
      req.setTimeout(2000, () => { req.destroy(); resolve(0); });
    });
  }

  _isPortOccupied(port) {
    return new Promise((resolve) => {
      const s = net.createServer();
      s.once('error', () => resolve(true));
      s.once('listening', () => { s.close(() => resolve(false)); });
      s.listen(port, '127.0.0.1');
    });
  }

  _ensureProfile() {
    const userDataDir = this.profileDir;
    const sourceProfile = path.join(os.homedir(), '.config', 'google-chrome');

    const localStorageDir = path.join(userDataDir, 'Default', 'Local Storage', 'leveldb');
    if (fs.existsSync(localStorageDir)) {
      const files = fs.readdirSync(localStorageDir).filter(f => f.endsWith('.ldb') || f.endsWith('.log'));
      if (files.length > 0) {
        this.logger.info(`Persistent profile already exists with data: ${userDataDir}`);
        return userDataDir;
      }
    }

    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    if (!fs.existsSync(sourceProfile)) {
      this.logger.warn(`Source Chrome profile not found at ${sourceProfile}. Starting with empty profile.`);
      return userDataDir;
    }

    this.logger.info(`Copying Chrome profile from ${sourceProfile} to ${userDataDir}...`);

    const itemsToCopy = [
      'Default/Cookies',
      'Default/Network/Cookies',
      'Default/Login Data',
      'Default/Web Data',
      'Default/Local Storage',
      'Default/Session Storage',
      'Default/IndexedDB',
      'Default/SharedStorage',
      'Default/QuotaManager',
      'Default/QuotaManager-journal',
      'Default/Preferences',
      'Default/Secure Preferences',
      'Local State',
    ];

    for (const item of itemsToCopy) {
      const src = path.join(sourceProfile, item);
      const dst = path.join(userDataDir, item);
      if (!fs.existsSync(src)) continue;
      try {
        const dstDir = path.dirname(dst);
        if (!fs.existsSync(dstDir)) {
          fs.mkdirSync(dstDir, { recursive: true });
        }
        const stat = fs.statSync(src);
        if (stat.isDirectory()) {
          execSync(`cp -r "${src}" "${dst}"`, { stdio: 'ignore' });
        } else {
          execSync(`cp "${src}" "${dst}"`, { stdio: 'ignore' });
        }
      } catch (e) {
        this.logger.warn(`Failed to copy ${item}: ${e.message}`);
      }
    }

    this.logger.success(`Chrome profile copied to ${userDataDir}`);
    return userDataDir;
  }

  _findChromeBinary() {
    for (const cmd of this.chromePathPriority) {
      try {
        let resolved = null;
        if (path.isAbsolute(cmd)) {
          if (fs.existsSync(cmd) && !fs.statSync(cmd).isDirectory()) {
            try { fs.accessSync(cmd, fs.constants.X_OK); resolved = cmd; } catch { resolved = cmd; }
          }
        } else if (process.platform === 'win32') {
          try {
            resolved = execSync(`where ${cmd}`, { stdio: 'ignore', encoding: 'utf8' }).trim().split(/\r?\n/)[0];
          } catch {}
        } else {
          resolved = execSync(`which ${cmd}`, { stdio: 'ignore', encoding: 'utf8' }).trim();
        }
        if (!resolved) continue;
        if (resolved.includes('/snap/')) {
          this.logger.warn(`Ignoring Chrome snap: ${resolved}`);
          continue;
        }
        return resolved;
      } catch {}
    }
    return null;
  }

  /**
   * Scan CDP ports for an existing Chrome instance.
   * Kills headless Chrome or Chrome using /tmp/ profiles.
   * Returns { port, cdpUrl } or null.
   */
  async findExistingPort() {
    for (const port of this.cdpPorts) {
      const ok = await this._probePort(port);
      if (!ok) continue;

      try {
        const psOutput = execSync(
          `ps aux | grep 'chrome.*remote-debugging-port=${port}' | grep -v grep`,
          { encoding: 'utf8' }
        );
        const dataDirMatch = psOutput.match(/--user-data-dir=([^\s]+)/);
        const existingProfileDir = dataDirMatch ? dataDirMatch[1] : null;

        if (psOutput.includes('--headless') || psOutput.includes('--ozone-platform=headless')) {
          this.logger.warn(`Headless Chrome detected on port ${port}. Killing...`);
          try {
            execSync(`pkill -f 'chrome.*remote-debugging-port=${port}'`);
          } catch {}
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        if (existingProfileDir && existingProfileDir.startsWith('/tmp/')) {
          this.logger.warn(
            `Chrome on port ${port} is using temporary profile ${existingProfileDir}. Killing to use persistent profile...`
          );
          try {
            execSync(`pkill -f 'chrome.*remote-debugging-port=${port}'`);
          } catch {}
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        return { port, cdpUrl: this._makeCdpUrl(port) };
      } catch {
        return { port, cdpUrl: this._makeCdpUrl(port) };
      }
    }
    return null;
  }

  /**
   * Start Chrome on the preferred port (or first free port).
   * Returns { pid, port, cdpUrl, error? }
   */
  async startChrome(preferredPort) {
    const profileDir = this._ensureProfile();

    let startPort = preferredPort || this.cdpPorts[0];
    if (!preferredPort) {
      for (const port of this.cdpPorts) {
        const occupied = await this._isPortOccupied(port);
        if (!occupied) { startPort = port; break; }
      }
      if (startPort === this.cdpPorts[0]) {
        const allOccupied = await Promise.all(this.cdpPorts.map(p => this._isPortOccupied(p)));
        if (allOccupied.every(o => o)) {
          this.logger.warn('All CDP ports occupied by other processes. Using first port anyway.');
        }
      }
    }

    const chromePath = this._findChromeBinary();
    if (!chromePath) {
      return {
        pid: null,
        port: startPort,
        cdpUrl: this._makeCdpUrl(startPort),
        error: 'Chrome .deb not found. Install: wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add - && sudo sh -c \'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list\' && sudo apt update && sudo apt install -y google-chrome-stable',
      };
    }
    this.logger.info(`Selected Chrome .deb: ${chromePath}`);
    this.logger.info(`Starting Chrome with persistent profile: ${profileDir}`);

    const extensionArgs = [];
    try {
      const manifestPath = path.join(this.extensionDir, 'manifest.json');
      if (fs.existsSync(this.extensionDir) && fs.existsSync(manifestPath)) {
        extensionArgs.push('--load-extension=' + this.extensionDir);
        this.logger.info(`Extension will be loaded from: ${this.extensionDir}`);
      }
    } catch (e) {
      this.logger.warn(`Could not load extension: ${e.message}`);
    }

    try {
      const proc = spawn(chromePath, [
        `--remote-debugging-port=${startPort}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--user-data-dir=' + profileDir,
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        ...extensionArgs,
        'https://www.kimi.ai/',
      ], {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          DISPLAY: process.env.DISPLAY || ':0',
          XAUTHORITY: process.env.XAUTHORITY || '',
        },
      });

      let chromeStderr = '';
      proc.stdout.on('data', () => {});
      proc.stderr.on('data', (d) => { chromeStderr += d; });
      proc.on('error', (e) => this.logger.warn(`Chrome spawn error: ${e.message}`));
      proc.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          this.logger.warn(`Chrome exited with code ${code}. stderr: ${chromeStderr.slice(0, 800)}`);
        }
      });

      await new Promise(r => setTimeout(r, 7000));

      const ok = await this._probePort(startPort);
      if (ok) {
        return { pid: proc.pid, port: startPort, cdpUrl: this._makeCdpUrl(startPort) };
      }
      return {
        pid: proc.pid,
        port: startPort,
        cdpUrl: this._makeCdpUrl(startPort),
        error: 'Chrome started but did not respond within 7s',
      };
    } catch (e) {
      return { pid: null, port: startPort, cdpUrl: this._makeCdpUrl(startPort), error: e.message };
    }
  }

  /**
   * Kill a specific Chrome PID with SIGTERM, then SIGKILL after timeout.
   */
  async killChrome(pid) {
    if (!pid) return;
    try {
      process.kill(pid, 'SIGTERM');
    } catch (e) {
      this.logger.warn(`SIGTERM failed for PID ${pid}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 3000));
    try {
      process.kill(pid, 0); // check if still alive
      process.kill(pid, 'SIGKILL');
    } catch {
      // process already gone
    }
  }
}

module.exports = { ChromeLauncher };
