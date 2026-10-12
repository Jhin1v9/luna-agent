// selfheal.test.cjs — targeted service recovery tests
// Run: node --test apps/dashboard/tests/selfheal.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const selfheal = require('../lib/selfheal.cjs');

const CHAT_ROUTES = fs.readFileSync(path.join(__dirname, '..', 'luna-chat-routes.js'), 'utf8');

// ── resolveServiceNames ──

test('maps health-check keys to canonical pm2 names', () => {
  assert.deepStrictEqual(selfheal.resolveServiceNames(['luna-server']), ['luna-server']);
  assert.deepStrictEqual(selfheal.resolveServiceNames(['telegram-bot']), ['luna-telegram-adapter']);
  assert.deepStrictEqual(selfheal.resolveServiceNames(['luna-vite']), ['luna-vite']);
  assert.deepStrictEqual(selfheal.resolveServiceNames(['nexo-dashboard']), ['nexo-dashboard']);
});

test('dedups keys that map to the same pm2 process', () => {
  // bridge + soul problems both resolve to luna-server — one restart, not two
  const out = selfheal.resolveServiceNames(['luna-server', 'luna-server']);
  assert.deepStrictEqual(out, ['luna-server']);
});

test('drops unknown keys and non-strings silently', () => {
  assert.deepStrictEqual(selfheal.resolveServiceNames(['nginx', 'luna-vite', 42, null, 'postgres']), ['luna-vite']);
});

test('returns empty array for non-array input', () => {
  assert.deepStrictEqual(selfheal.resolveServiceNames(undefined), []);
  assert.deepStrictEqual(selfheal.resolveServiceNames('luna-server'), []);
  assert.deepStrictEqual(selfheal.resolveServiceNames(null), []);
});

// ── findPm2Binary ──

test('findPm2Binary prefers PM2_PATH when it exists', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'selfheal-'));
  const fake = path.join(tmp, 'pm2');
  fs.writeFileSync(fake, '#!/bin/sh\n');
  assert.strictEqual(selfheal.findPm2Binary({ PM2_PATH: fake }, '/nonexistent'), fake);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('findPm2Binary falls back to PATH name when nothing exists', () => {
  assert.strictEqual(selfheal.findPm2Binary({}, '/nonexistent-home'), 'pm2');
});

// ── contract with the router source ──

test('router exposes POST /api/system/selfheal', () => {
  assert.ok(CHAT_ROUTES.includes("router.post('/api/system/selfheal'"), 'selfheal route must exist');
});

test('pm2 restarts are never invoked with --update-env (Wave 6 incident)', () => {
  const selfhealSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'selfheal.cjs'), 'utf8');
  // strip comment lines — the incident is documented in the docblock; only
  // executable code must be free of the flag
  const code = selfhealSrc.split('\n')
    .filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
    .join('\n');
  assert.ok(!code.includes('--update-env'), 'selfheal must never pass --update-env to pm2');
});

test('restart/start/stop routes keep working when luna-nexo.sh is absent', () => {
  // Each route must have the fs.existsSync(LUNA_NEXO_SCRIPT) guard and a pm2 fallback
  const restartIdx = CHAT_ROUTES.indexOf("router.post('/api/system/restart'");
  const stopIdx = CHAT_ROUTES.indexOf("router.post('/api/system/stop'");
  const startIdx = CHAT_ROUTES.indexOf("router.post('/api/system/start'");
  for (const idx of [restartIdx, stopIdx, startIdx]) {
    assert.ok(idx > 0, 'route must exist');
    const block = CHAT_ROUTES.slice(idx, idx + 900);
    assert.ok(block.includes('fs.existsSync(LUNA_NEXO_SCRIPT)'), 'route must keep the legacy script path when present');
    assert.ok(block.includes('selfheal.'), 'route must fall back to pm2 selfheal when the script is missing');
  }
});
