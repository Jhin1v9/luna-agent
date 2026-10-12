'use strict';
// Seconds-or-ms tolerant clamp: null/0/negative/garbage → defaultSec; capped at maxSec.
function clampExecTimeout(value, defaultSec = 60, maxSec = 600) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return defaultSec * 1000;
  return Math.min(n * 1000, maxSec * 1000);
}
// POSIX-safe single-quote wrapping for embedding a shell string inside
// another `sh -c '...'` invocation (used by safeExec's timeout wrapper).
function shQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}
module.exports = { clampExecTimeout, shQuote };
