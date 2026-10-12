/**
 * selfheal.cjs — targeted service recovery via pm2.
 *
 * The legacy luna-nexo.sh control script is not always present (its
 * configured path drifts between machines) and its copy in
 * ~/NEXO_DASHBOARD_PRO targets an older layout (wrong paths, stale pm2
 * names like "telegram-bot" that would spawn a duplicate adapter).
 *
 * This module restarts ONLY the services the caller diagnosed as broken,
 * using the canonical pm2 names of the current monorepo layout:
 *
 *   pm2 ls → luna-server, nexo-dashboard, luna-vite, luna-telegram-adapter
 *
 * `pm2 restart <name>` also starts a stopped process, so the same call
 * covers the "service died" and "service degraded" cases. It is NEVER
 * invoked with --update-env (that re-injects stale shell env — Wave 6
 * incident).
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// health-check key (what /api/system/health reports) → real pm2 process name
const PM2_SERVICES = Object.freeze({
  'luna-server': 'luna-server',
  'nexo-dashboard': 'nexo-dashboard',
  'luna-vite': 'luna-vite',
  'telegram-bot': 'luna-telegram-adapter',
  'luna-health-watchdog': 'luna-health-watchdog',
});

/**
 * Map requested service keys to deduped canonical pm2 names.
 * Unknown keys are dropped silently — the allowlist is the contract.
 */
function resolveServiceNames(requested) {
  if (!Array.isArray(requested)) return [];
  const seen = new Set();
  const out = [];
  for (const key of requested) {
    if (typeof key !== 'string') continue;
    const pm2name = PM2_SERVICES[key.trim()] || null;
    if (pm2name && !seen.has(pm2name)) {
      seen.add(pm2name);
      out.push(pm2name);
    }
  }
  return out;
}

/** Locate the pm2 binary without assuming a fixed user home. */
function findPm2Binary(env = process.env, homeDir = os.homedir()) {
  const candidates = [
    env && env.PM2_PATH,
    path.join(homeDir, '.npm-global/bin/pm2'),
    '/usr/local/bin/pm2',
    '/usr/bin/pm2',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch { /* keep looking */ }
  }
  return 'pm2'; // last resort: let PATH resolve it
}

/**
 * Restart the given pm2 process names after a short delay, so the HTTP
 * response that triggered this can flush first (restarting luna-server
 * kills the very process that is answering).
 */
function restartServices(pm2Names, { delayMs = 600 } = {}) {
  if (!Array.isArray(pm2Names) || pm2Names.length === 0) return false;
  setTimeout(() => {
    try {
      const child = spawn(findPm2Binary(), ['restart', ...pm2Names], {
        stdio: 'ignore',
        detached: true,
      });
      child.on('error', (err) => {
        console.error('[selfheal] pm2 restart spawn failed:', err.message);
      });
      child.unref();
    } catch (err) {
      console.error('[selfheal] pm2 restart failed:', err.message);
    }
  }, delayMs);
  return true;
}

/**
 * Stop the given pm2 process names after a short delay (same flush-first
 * reasoning as restartServices).
 */
function stopServices(pm2Names, { delayMs = 600 } = {}) {
  if (!Array.isArray(pm2Names) || pm2Names.length === 0) return false;
  setTimeout(() => {
    try {
      const child = spawn(findPm2Binary(), ['stop', ...pm2Names], {
        stdio: 'ignore',
        detached: true,
      });
      child.on('error', (err) => {
        console.error('[selfheal] pm2 stop spawn failed:', err.message);
      });
      child.unref();
    } catch (err) {
      console.error('[selfheal] pm2 stop failed:', err.message);
    }
  }, delayMs);
  return true;
}

module.exports = { PM2_SERVICES, resolveServiceNames, findPm2Binary, restartServices, stopServices };
