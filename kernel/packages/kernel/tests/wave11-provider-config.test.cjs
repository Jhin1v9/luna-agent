// wave11-provider-config.test.cjs — PDS Fase 0 regression tests
// Run: node --test packages/kernel/tests/wave11-provider-config.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  normalizeChain,
  resolveChain,
  providerDisplayName,
  firstMatchingLocator,
  waitForChain,
} = require('../lib/provider-selectors.cjs');

// ── normalizeChain ──
test('T1a: normalizeChain aceita string v1 com vírgulas', () => {
  assert.deepStrictEqual(
    normalizeChain('textarea, [contenteditable="true"]'),
    ['textarea', '[contenteditable="true"]']
  );
});

test('T1b: normalizeChain aceita array v2 e preserva ordem', () => {
  assert.deepStrictEqual(normalizeChain(['#a', '.b']), ['#a', '.b']);
});

test('T1c: normalizeChain vazio/undefined retorna []', () => {
  assert.deepStrictEqual(normalizeChain(undefined), []);
  assert.deepStrictEqual(normalizeChain(''), []);
  assert.deepStrictEqual(normalizeChain('  , ,'), []);
});

// ── resolveChain ──
test('T1d: resolveChain lê do config e anexa fallbacks sem duplicar', () => {
  const cfg = { selectors: { input: '#prompt-textarea, textarea' } };
  assert.deepStrictEqual(
    resolveChain(cfg, 'input', 'textarea, [contenteditable="true"]'),
    ['#prompt-textarea', 'textarea', '[contenteditable="true"]']
  );
});

test('T1e: resolveChain sem config usa só os fallbacks', () => {
  assert.deepStrictEqual(resolveChain({}, 'input', '.a, .b'), ['.a', '.b']);
  assert.deepStrictEqual(resolveChain(null, 'input', '.a'), ['.a']);
});

// ── providerDisplayName ──
test('T1f: providerDisplayName prefere displayName, depois name, depois fallback', () => {
  assert.strictEqual(providerDisplayName({ displayName: 'DeepSeek Chat', name: 'deepseek' }), 'DeepSeek Chat');
  assert.strictEqual(providerDisplayName({ name: 'deepseek' }), 'deepseek');
  assert.strictEqual(providerDisplayName(null, 'kimi'), 'kimi');
});

// ── fake page (Playwright mínimo) ──
function fakePage(visibleSelectors = [], appearAfterPolls = 0) {
  let polls = 0;
  const visible = (sel) => polls >= appearAfterPolls && visibleSelectors.includes(sel);
  const loc = (sel) => ({
    first: () => loc(sel),
    count: async () => (visible(sel) ? 1 : 0),
    isVisible: async () => visible(sel),
  });
  return {
    locator: (sel) => loc(sel),
    waitForTimeout: async () => { polls++; },
    _polls: () => polls,
  };
}

// ── firstMatchingLocator ──
test('T1g: firstMatchingLocator respeita a ordem da chain', async () => {
  const page = fakePage(['.b', '.c']);
  const { locator, selector } = await firstMatchingLocator(page, ['.a', '.b', '.c']);
  assert.strictEqual(selector, '.b');
  assert.strictEqual(await locator.count(), 1);
});

// ── waitForChain ──
test('T1h: waitForChain espera o seletor aparecer', async () => {
  const page = fakePage(['#late'], 3);
  const { locator, selector } = await waitForChain(page, ['#nope', '#late'], { timeout: 5000, pollMs: 1 });
  assert.strictEqual(selector, '#late');
  assert.strictEqual(await locator.count(), 1);
});

test('T1i: waitForChain retorna locator null no timeout', async () => {
  const page = fakePage([]);
  const { locator, selector } = await waitForChain(page, ['#never'], { timeout: 5, pollMs: 1 });
  assert.strictEqual(locator, null);
  assert.strictEqual(selector, null);
});

// ── config validation (Task 2) — DeepSeek only; kimi.json is untouched (owner directive) ──
const fs = require('node:fs');
const path = require('node:path');

const CONFIGS_DIR = path.join(__dirname, '..', 'provider-configs');
const REQUIRED_ROLES = ['input', 'sendButton', 'stopButton', 'newChat', 'generatingIndicator', 'loginIndicator', 'appContent'];

test('T2-deepseek: roles obrigatórios presentes e não-vazios', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(CONFIGS_DIR, 'deepseek.json'), 'utf8'));
  for (const role of REQUIRED_ROLES) {
    assert.ok(normalizeChain(cfg.selectors?.[role]).length > 0, `deepseek.selectors.${role} vazio/ausente`);
  }
});

test('T2-deepseek: apiEndpoints não-vazio, sem cdpPatterns (dead code)', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(CONFIGS_DIR, 'deepseek.json'), 'utf8'));
  assert.ok(Array.isArray(cfg.apiEndpoints) && cfg.apiEndpoints.length > 0);
  assert.strictEqual(cfg.cdpPatterns, undefined);
});

// ── ProviderNetworkInterceptor (Task 10) ──
const { ProviderNetworkInterceptor } = require('../kimi-bridge.cjs');

test('T10a: _isChatUrl casa todos os padrões legados mesmo com kimi.json intocada', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(CONFIGS_DIR, 'kimi.json'), 'utf8'));
  const interceptor = new ProviderNetworkInterceptor(null, cfg);
  for (const url of [
    'https://www.kimi.ai/api/chat/abc',
    'https://www.kimi.ai/kimi.gateway.chat/x',
    'https://www.kimi.ai/apiv2/kimi.chat/y',
    'https://www.kimi.ai/kimi.chat.v1.ChatService/ChatCompletion',
  ]) {
    assert.ok(interceptor._isChatUrl(url), `kimi deve casar ${url} (config ∪ defaults legados)`);
  }
  assert.strictEqual(interceptor._isChatUrl('https://www.kimi.ai/static/app.js'), false);
});

test('T10b: _isChatUrl usa apiEndpoints do config (deepseek)', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(CONFIGS_DIR, 'deepseek.json'), 'utf8'));
  const interceptor = new ProviderNetworkInterceptor(null, cfg);
  assert.ok(interceptor._isChatUrl('https://chat.deepseek.com/api/v0/chat/completion'));
  assert.strictEqual(interceptor._isChatUrl('https://chat.deepseek.com/static/app.js'), false);
});

test('T10c: start() não tenta CDP Fetch (ramo morto removido)', async () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(CONFIGS_DIR, 'kimi.json'), 'utf8'));
  let listenerRegistered = false;
  const fakePage = { on: () => { listenerRegistered = true; }, off: () => {} };
  const interceptor = new ProviderNetworkInterceptor(fakePage, cfg);
  await interceptor.start();
  assert.strictEqual(listenerRegistered, true);
  assert.strictEqual(interceptor._cdpSession, null);
  interceptor.stop();
});
