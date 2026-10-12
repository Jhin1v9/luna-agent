/**
 * BridgeConfig — centralized configuration with env var overrides.
 * Eliminates hardcodes scattered through the codebase.
 */
const path = require('path');

const DEFAULT_CONFIG = {
  CDP_PORTS: [9222, 9223, 9224, 9225],
  DEFAULT_TIMEOUT: 180000, // 3 minutes (was 30min — too long)
  PAGE_GOTO_TIMEOUT: 30000,
  MAX_CONCURRENT_PAGES: parseInt(process.env.KIMI_MAX_PAGES, 10) || 5,
  IDLE_TIMEOUT_MS: parseInt(process.env.KIMI_IDLE_TIMEOUT, 10) || 10 * 60 * 1000,
  COOLDOWN_MS: parseInt(process.env.KIMI_COOLDOWN_MS, 10) || 5000,
  MAX_TEXT_TYPE_LENGTH: parseInt(process.env.KIMI_MAX_TYPE_LENGTH, 10) || 500,
  LOG_MAX_SIZE_MB: parseInt(process.env.KIMI_LOG_MAX_MB, 10) || 10,
  POLL_INTERVAL_MS: 500,
  MAX_POLL_WAIT_MS: 60000, // absolute timeout for all poll loops
  MAX_STREAM_WAIT_MS: 300000, // 5 minutes absolute for stream loops
  HEALTH_CHECK_TIMEOUT_MS: 5000,
  CIRCUIT_BREAKER: {
    failureThreshold: 5,
    recoveryTimeout: 30000,
    halfOpenMaxCalls: 1,
  },
  KIMI_PERSISTENT_MODE: false,
  ARTIFACTS_DIR: path.join(__dirname, '..', 'ARTIFACTS'),
  PROFILE_DIR: path.join(require('os').homedir(), '.luna', 'chrome-profile'),
  COOKIES_DIR: path.join(__dirname, '..', 'cookies'),
  EXTENSION_DIR: path.join(__dirname, '..', 'luna-extension'),
  CHROME_PATH_PRIORITY: [
    '/opt/google/chrome/chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    'google-chrome-stable',
    'google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    'chromium-browser',
    'chromium',
  ],
};

function loadBridgeConfig() {
  // Merge with optional external config
  let external = {};
  try {
    const ext = require('../config/luna-config');
    if (ext?.KIMI) external = ext.KIMI;
  } catch {}

  return {
    ...DEFAULT_CONFIG,
    ...external,
    // env vars always win
    CDP_PORTS: process.env.KIMI_CDP_PORTS?.split(',').map(Number) || DEFAULT_CONFIG.CDP_PORTS,
    DEFAULT_TIMEOUT: parseInt(process.env.KIMI_DEFAULT_TIMEOUT, 10) || DEFAULT_CONFIG.DEFAULT_TIMEOUT,
  };
}

module.exports = { BridgeConfig: loadBridgeConfig() };
