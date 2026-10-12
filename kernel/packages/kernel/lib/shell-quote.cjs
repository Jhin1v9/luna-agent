'use strict';
// POSIX single-quote escaping lives in exec-timeout.cjs (Fix D) — re-export it
// under this module's name so there is exactly ONE quoting implementation.
const { shQuote } = require('./exec-timeout.cjs');
const shellQuote = shQuote;

// Integer-or-default: context lines, log counts. Rejects 2;rm -rf / → default.
function toNonNegInt(value, def, max = 10000) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return def;
  return Math.min(n, max);
}

// Package/process names: npm/pip/cargo identifiers and pm2 process names only.
// ^ and ~ allowed (npm version ranges — an LLM's natural output); < > never
// (real shell metachars). Leading dash rejected: `npm install --prefix=/tmp x`
// is argument injection even without shell metacharacters.
const SAFE_NAME_RE = /^[a-zA-Z0-9@._/^~-]+$/;
function assertSafeName(value, what = 'name') {
  const s = String(value ?? '');
  if (!s || s.length > 200 || !SAFE_NAME_RE.test(s) || s.includes('..') || s.startsWith('-')) {
    throw new Error(`${what} inválido (caracteres proibidos): ${JSON.stringify(s).slice(0, 60)}`);
  }
  return s;
}

module.exports = { shellQuote, toNonNegInt, assertSafeName, SAFE_NAME_RE };
