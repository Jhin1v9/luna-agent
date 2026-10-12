'use strict';

const crypto = require('crypto');

/**
 * W6-T6 / W10-T1: stable cross-source dedup key for phantom-prone DOM events
 * (action_detected / response_detected) in _enqueueDomEvent.
 *
 * The key must ONLY use fields that EVERY detection source provides. The
 * Chrome extension never sends `code` while the network interceptor does, so
 * hashing `code` made the SAME logical tool call produce different keys per
 * source — the second detection slipped past dedup and, if the first was
 * still running (the soul's action cache is only written at completion), the
 * tool executed TWICE.
 */

/**
 * Normalize params so the same logical action from different detection sources
 * produces the same dedup key. We keep only the identifying fields per tool
 * and sort keys deterministically.
 */
function normalizeParams(tool, params) {
  if (!params || typeof params !== 'object') return {};

  // Identity fields: the same logical call must share these across sources.
  const identityFields = {
    executeShell: ['command'],
    executeScript: ['code'],
    writeFile: ['path'],
    appendFile: ['path'],
    readFile: ['path'],
    deleteFile: ['path'],
    searchFiles: ['query', 'path'],
    searchWeb: ['query'],
    browser: ['url'],
    webSearch: ['query'],
    openUrl: ['url'],
    gitStatus: ['repo', 'path'],
    gitDiff: ['repo', 'path'],
    gitLog: ['repo', 'path'],
    gitCommit: ['repo', 'path'],
    replaceInFile: ['path'],
  };

  const fields = identityFields[tool];
  if (fields) {
    const out = {};
    for (const key of fields) {
      if (params[key] !== undefined) out[key] = params[key];
    }
    return sortKeys(out);
  }

  // Fallback: deterministic full params, but drop empty/null values.
  const cleaned = {};
  for (const key of Object.keys(params).sort()) {
    const val = params[key];
    if (val === null || val === undefined || val === '') continue;
    cleaned[key] = typeof val === 'string' ? val.trim() : val;
  }
  return sortKeys(cleaned);
}

function sortKeys(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  const out = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = sortKeys(obj[key]);
  }
  return out;
}

function makeDomEventDedupKey(event) {
  const normalizedAction = event.action
    ? { tool: event.action.tool || event.action.type, params: normalizeParams(event.action.tool || event.action.type, event.action.params || event.action) }
    : event.action;
  return event.type + ':' + crypto.createHash('sha256')
    .update(JSON.stringify({ t: event.type, a: normalizedAction, r: event.response }))
    .digest('hex').slice(0, 16);
}

module.exports = { makeDomEventDedupKey, normalizeParams };
