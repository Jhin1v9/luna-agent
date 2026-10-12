'use strict';
/**
 * terminal-resolver.cjs — W6-T10: system-default terminal resolution + session-env repair
 *
 * Why: luna-tools' visible mode hardcoded `gnome-terminal` and relied on the
 * env inherited from PM2 (a stale snapshot: Xauth rotates, D-Bus may be absent),
 * so the terminal never opened, no log was produced, and commands failed with a
 * bogus ENOENT. This module makes the kernel self-sufficient: resolve ANY system
 * terminal from PATH/$TERMINAL, and rebuild the session env (DISPLAY, D-Bus,
 * Xauthority…) from well-known runtime locations instead of trusting inherited values.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

// Ordered candidates — Debian alternatives first, then GNOME family, then others.
// style drives argv construction in _argvFor:
//   dashdash → bin --wait -- bash scriptFile  (gnome-terminal family, REAL binaries)
//   xterm    → bin -e "bash scriptFile"       (gnome-terminal.wrapper — see W7-T3 below)
//   e        → bin -e bash scriptFile         (xterm/konsole/alacritty family)
//   plain    → bin bash scriptFile            (kitty: no exec flag)
const TERMINAL_CANDIDATES = [
  { bin: 'x-terminal-emulator', style: 'e' },
  { bin: 'sensible-terminal', style: 'e' },
  { bin: 'gnome-terminal', style: 'dashdash' },
  { bin: 'kgx', style: 'dashdash' },
  { bin: 'gnome-console', style: 'dashdash' },
  { bin: 'kitty', style: 'plain' },
  { bin: 'alacritty', style: 'e' },
  { bin: 'konsole', style: 'e' },
  { bin: 'xterm', style: 'e' },
];

// W6-T10 review: the chosen bin is often a SYMLINK (Debian alternatives) whose
// real binary decides blocking semantics — and executeShellVisible detects
// completion via the terminal process' close event. gnome-terminal family
// forks without --wait (→ force dashdash style on REAL binaries), konsole
// forks without --nofork (→ inject it), otherwise `close` fires immediately
// and the command double-executes (visible terminal + invisible fallback) or
// fabricates success.
// W7-T3 (2026-07-12, verified live): the Debian perl gnome-terminal.wrapper
// SILENTLY DROPS `-- bash script` argv (its arg parser ignores unknown
// tokens) → empty --wait window that never closes, no log, invisible fallback
// double-executes. It honors the xterm convention instead: a SINGLE string
// after -e (`-e 'bash script'`; the wrapper adds --wait itself) → style xterm.
const REAL_BIN_OVERRIDES = {
  'gnome-terminal': { style: 'dashdash' },
  'gnome-terminal.real': { style: 'dashdash' },
  'gnome-terminal.wrapper': { style: 'xterm' },
  'kgx': { style: 'dashdash' },
  'gnome-console': { style: 'dashdash' },
  'konsole': { extra: ['--nofork'] },
};

function _realBinOverride(fullPath) {
  try {
    const real = path.basename(fs.realpathSync(fullPath));
    return REAL_BIN_OVERRIDES[real] || null;
  } catch {
    return null;
  }
}

// Per-process cache, keyed on $TERMINAL + '|' + $PATH — invalidated the moment
// either changes, so a caller mutating env between calls never sees stale results.
let _cacheKey = null;
let _cacheResult = null;

function _styleFor(bin) {
  const base = path.basename(bin);
  const hit = TERMINAL_CANDIDATES.find(c => c.bin === base);
  return hit ? hit.style : 'e';
}

function _findOnPath(bin, envPath) {
  for (const dir of (envPath || '').split(path.delimiter)) {
    if (!dir) continue;
    try {
      const full = path.join(dir, bin);
      if (fs.existsSync(full)) return full;
    } catch { /* keep probing */ }
  }
  return null;
}

/**
 * resolveTerminal(env) → { bin, style, extra? } | null
 * $TERMINAL wins (first whitespace token): accepted if it is an absolute path
 * that exists, or a name found on PATH (style guessed from the candidate table,
 * default 'e'). Otherwise probes TERMINAL_CANDIDATES in order. The resolved path
 * is realpath'd and REAL_BIN_OVERRIDES applied (see table above). Never throws.
 */
function resolveTerminal(env = process.env) {
  try {
    const key = (env.TERMINAL || '') + '|' + (env.PATH || '');
    if (key === _cacheKey) return _cacheResult;
    let result = null;

    const term = (env.TERMINAL || '').trim().split(/\s+/)[0] || '';
    if (term) {
      if (path.isAbsolute(term)) {
        if (fs.existsSync(term)) result = { bin: term, style: _styleFor(term), ..._realBinOverride(term) };
      } else {
        const full = _findOnPath(term, env.PATH);
        if (full) result = { bin: term, style: _styleFor(term), ..._realBinOverride(full) };
      }
    }

    if (!result) {
      for (const cand of TERMINAL_CANDIDATES) {
        const full = _findOnPath(cand.bin, env.PATH);
        if (full) {
          result = { bin: cand.bin, style: cand.style, ..._realBinOverride(full) };
          break;
        }
      }
    }

    _cacheKey = key;
    _cacheResult = result;
    return result;
  } catch {
    return null;
  }
}

/** argv templates per style (exported for tests + spawn sites). */
function _argvFor(style, bin, scriptFile, extra = []) {
  if (style === 'dashdash') return [bin, ...extra, '--wait', '--', 'bash', scriptFile];
  // xterm style: the command is ONE string arg after -e (xterm convention;
  // required by the Debian gnome-terminal.wrapper, which adds --wait itself).
  if (style === 'xterm') return [bin, ...extra, '-e', `bash ${scriptFile}`];
  if (style === 'plain') return [bin, ...extra, 'bash', scriptFile];
  return [bin, ...extra, '-e', 'bash', scriptFile];
}

function _uid() {
  try { return os.userInfo().uid; } catch { /* fall through */ }
  try { return process.getuid(); } catch { return null; }
}

/** Newest Xauthority candidate in the runtime dir (mutter Xwayland auth or .Xauthority). */
function _newestXauthority(runtimeDir) {
  let best = null;
  let bestMtime = -1;
  for (const entry of fs.readdirSync(runtimeDir)) {
    if (entry !== '.Xauthority' && !entry.startsWith('.mutter-Xwaylandauth.') && !entry.startsWith('mutter-Xwaylandauth.')) continue;
    const full = path.join(runtimeDir, entry);
    try {
      const st = fs.statSync(full);
      if (st.isFile() && st.mtimeMs > bestMtime) { bestMtime = st.mtimeMs; best = full; }
    } catch { /* skip unreadable entries */ }
  }
  return best;
}

/**
 * enrichSessionEnv(env) → NEW object (input never mutated).
 * Fills session keys ONLY when absent/empty AND the target actually exists, so
 * a stale PM2-inherited env gets repaired without ever clobbering live values:
 *   XDG_RUNTIME_DIR          /run/user/<uid>            (dir exists)
 *   DBUS_SESSION_BUS_ADDRESS unix:path=/run/user/<uid>/bus (socket exists)
 *   DISPLAY                  :0                          (/tmp/.X11-unix/X0 exists)
 *   WAYLAND_DISPLAY          wayland-0                   (/run/user/<uid>/wayland-0 exists)
 *   XAUTHORITY               newest *.mutter-Xwaylandauth.* / .Xauthority in runtime dir
 */
function enrichSessionEnv(env = process.env) {
  const out = { ...env };
  const absent = (k) => !out[k];
  const uid = _uid();

  if (uid != null) {
    const runtimeDir = `/run/user/${uid}`;
    try {
      if (absent('XDG_RUNTIME_DIR') && fs.statSync(runtimeDir).isDirectory()) {
        out.XDG_RUNTIME_DIR = runtimeDir;
      }
    } catch { /* no runtime dir */ }
    try {
      const bus = path.join(runtimeDir, 'bus');
      if (absent('DBUS_SESSION_BUS_ADDRESS') && fs.existsSync(bus)) {
        out.DBUS_SESSION_BUS_ADDRESS = `unix:path=${bus}`;
      }
    } catch { /* no bus socket */ }
    try {
      const wl = path.join(runtimeDir, 'wayland-0');
      if (absent('WAYLAND_DISPLAY') && fs.existsSync(wl)) {
        out.WAYLAND_DISPLAY = 'wayland-0';
      }
    } catch { /* no wayland socket */ }
    try {
      if (absent('XAUTHORITY')) {
        const xauth = _newestXauthority(runtimeDir);
        if (xauth) out.XAUTHORITY = xauth;
      }
    } catch { /* no xauthority */ }
  }

  try {
    if (absent('DISPLAY') && fs.existsSync('/tmp/.X11-unix/X0')) {
      out.DISPLAY = ':0';
    }
  } catch { /* no X socket */ }

  return out;
}

module.exports = { TERMINAL_CANDIDATES, resolveTerminal, _argvFor, enrichSessionEnv };
