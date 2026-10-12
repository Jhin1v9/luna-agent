'use strict';
const fs = require('fs');
const path = require('path');

// Kernel-faithful path resolution: the kernel follows a symlink BEFORE
// processing a following `..` (`ln -s / ws/root; ws/root/../etc` → `/etc`),
// while path.resolve/realpathSync collapse `..` lexically first. Tools that
// pass raw strings to fs would escape a lexical guard — so resolve component
// by component, realpathing each existing prefix as we walk.
function realpathKernel(p) {
  const abs = path.resolve(p);
  const parsed = path.parse(abs);
  const root = parsed.root; // e.g. '/' on Linux, 'C:\\' on Windows
  const parts = abs.slice(root.length).split(path.sep).filter(Boolean);
  let cur = root;
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      try { cur = fs.realpathSync(cur); } catch { /* nonexistent: keep lexical */ }
      cur = path.dirname(cur);
      continue;
    }
    cur = path.join(cur, part);
    try {
      if (fs.lstatSync(cur).isSymbolicLink()) cur = fs.realpathSync(cur);
    } catch { /* nonexistent tail: keep lexical */ }
  }
  return cur;
}

// realpath of the nearest existing ancestor + re-join the non-existing tail.
function realpathLoose(p) {
  return realpathKernel(p);
}

function isInside(child, root) {
  const rel = path.relative(root, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Returns { ok: true, resolved } or { ok: false, reason }.
// allowedRoots: pre-realpathed absolute dirs (workspace, LUNA_TMP_DIR, os.tmpdir()).
function checkPathWithinRoots(rawPath, allowedRoots) {
  if (!rawPath || typeof rawPath !== 'string') return { ok: false, reason: 'path vazio' };
  const expanded = rawPath.startsWith('~/') ? path.join(require('os').homedir(), rawPath.slice(2)) : rawPath;
  const real = realpathLoose(expanded);
  for (const root of allowedRoots) {
    if (isInside(real, root)) return { ok: true, resolved: real };
  }
  return { ok: false, reason: `"${rawPath}" (real: ${real}) está fora dos diretórios permitidos`, resolved: real };
}

// Path-carrying param keys of the FILE tools. NOTE: generic keys (to/from/
// source) are only checked for file tools — the soul scopes the guard via
// PATH_GUARD_TOOLS, since dashboard tools use the same keys for non-path data.
// `cwd` and listFiles/glob `pattern` are handled separately at the call site.
const PATH_PARAM_KEYS = ['path', 'filePath', 'file', 'source', 'from', 'destination', 'to', 'dirPath'];

module.exports = { realpathLoose, realpathKernel, isInside, checkPathWithinRoots, PATH_PARAM_KEYS };
