// wave10-duplicates.test.cjs — Wave 10 T1 regression tests (duplicated tool cards)
// H1: kimi-bridge json_buffer yields bypassed action dedup AND the W6-T6 DOM
//     event dedup key included `code` (extension never sends it, network
//     intercept does) → same logical tool call could execute TWICE.
// H2: cached-result replay (W6-T5) emitted action_start with cached:true and
//     ChatArea created a duplicate card by design.
// H3: 'tool-' + Date.now() card ids collided in the same ms (keyed each).
// H4: no frontend dedup by backendToolId; history-loaded cards lacked it.
// Run: node --test packages/kernel/tests/wave10-duplicates.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const KERNEL = path.join(__dirname, '..');
const BRIDGE_PATH = path.join(KERNEL, 'kimi-bridge.cjs');
const CHAT_AREA_PATH = path.join(KERNEL, 'luna-web/src/components/ChatArea.svelte');

const { makeDomEventDedupKey } = require('../lib/tool-dedup-key.cjs');
const { shouldCreateToolCard, makeToolCardId } = require('../luna-web/src/lib/toolCardDedup.js');

const bridgeSrc = fs.readFileSync(BRIDGE_PATH, 'utf8');
const chatAreaSrc = fs.readFileSync(CHAT_AREA_PATH, 'utf8');

// ── (a) H1: cross-source dedup key ───────────────────────────────────────────

test('H1: dedup key is identical for extension and network_intercept detections of the same action', () => {
  const action = { tool: 'writeFile', params: { path: '/tmp/a.txt', content: 'hi' } };
  const fromExtension = { type: 'action_detected', action }; // extension: no `code`
  const fromNetwork = { type: 'action_detected', action, code: '```json\n{"tool":"writeFile"}\n```' };
  assert.strictEqual(makeDomEventDedupKey(fromExtension), makeDomEventDedupKey(fromNetwork));
});

test('H1: dedup key ignores `code` but distinguishes different actions/responses', () => {
  const a1 = { type: 'action_detected', action: { tool: 'readFile', params: { path: '/a' } }, code: 'X' };
  const a2 = { type: 'action_detected', action: { tool: 'readFile', params: { path: '/a' } }, code: 'Y' };
  const a3 = { type: 'action_detected', action: { tool: 'readFile', params: { path: '/b' } }, code: 'X' };
  assert.strictEqual(makeDomEventDedupKey(a1), makeDomEventDedupKey(a2), 'code must not affect the key');
  assert.notStrictEqual(makeDomEventDedupKey(a1), makeDomEventDedupKey(a3), 'different params must differ');
  const r1 = { type: 'response_detected', response: 'hello' };
  const r2 = { type: 'response_detected', response: 'world' };
  assert.notStrictEqual(makeDomEventDedupKey(r1), makeDomEventDedupKey(r2));
  assert.notStrictEqual(makeDomEventDedupKey(a1), makeDomEventDedupKey(r1), 'event type is part of the key');
});

test('H1: kimi-bridge imports the shared key builder and no longer hashes event.code', () => {
  assert.ok(bridgeSrc.includes("require('./lib/tool-dedup-key.cjs')"), 'bridge must import lib/tool-dedup-key.cjs');
  assert.ok(bridgeSrc.includes('makeDomEventDedupKey(event)'), '_enqueueDomEvent must use the shared builder');
  assert.ok(!bridgeSrc.includes('c: event.code'), 'W6-T6 key must not include event.code anymore');
});

test('H1: every json_buffer action yield is routed through buildJsonBufferAction dedup', () => {
  assert.ok(bridgeSrc.includes('const buildJsonBufferAction = (tool, params) => {'), 'dedup helper must exist');
  assert.ok(
    bridgeSrc.includes('this._dedupKeyForAction({ action: { tool, params } })') &&
    bridgeSrc.includes('emittedActionCodes.has(dedupKey)'),
    'helper must consult emittedActionCodes via _dedupKeyForAction'
  );
  // No raw json_buffer action_detected yield may remain outside the helper.
  const rawYields = bridgeSrc.match(/yield \{[^}]*source: 'json_buffer'/g) || [];
  assert.strictEqual(rawYields.length, 0, `raw json_buffer yields bypassing dedup: ${rawYields.length}`);
  // The helper itself is the only place that constructs a json_buffer event.
  const constructions = bridgeSrc.match(/source: 'json_buffer'/g) || [];
  assert.strictEqual(constructions.length, 1, 'json_buffer event must be constructed only inside buildJsonBufferAction');
  // All three former bypass sites (accumulator, small-JSON, DOM-shrink) now call it,
  // once for the 'tool' branch and once for the 'script' branch (the definition
  // itself does not match this pattern — it is followed by ` =`).
  const callSites = bridgeSrc.match(/buildJsonBufferAction\(/g) || [];
  assert.ok(callSites.length >= 6, `expected >=6 call sites (tool/script x3), got ${callSites.length}`);
});

// ── (b) H2: cached action_start must not create a second card ────────────────

test('H2: cached action_start never creates a card, even with empty history', () => {
  assert.strictEqual(shouldCreateToolCard([], { type: 'action_start', tool: 'readFile', toolInstanceId: 'ti-9', cached: true }), false);
  const existing = [{ id: 'tool-1', type: 'tool', tool: 'readFile', backendToolId: 'ti-1', result: { success: true } }];
  assert.strictEqual(shouldCreateToolCard(existing, { type: 'action_start', tool: 'readFile', toolInstanceId: 'ti-9', cached: true }), false);
});

test('H4: duplicate backendToolId does not create a second card', () => {
  const existing = [{ id: 'tool-1', type: 'tool', tool: 'readFile', backendToolId: 'ti-1' }];
  assert.strictEqual(shouldCreateToolCard(existing, { type: 'action_start', tool: 'readFile', toolInstanceId: 'ti-1' }), false);
  // event.id fallback is honored the same way
  assert.strictEqual(shouldCreateToolCard(existing, { type: 'action_start', tool: 'readFile', id: 'ti-1' }), false);
});

test('H4: live event is deduped against a history-loaded card carrying backendToolId', () => {
  // Mirrors the ChatArea history-load mapping: backendToolId = msg.toolInstanceId || msg.id
  const persisted = { id: 'ev-123', type: 'action_start', tool: 'exec', toolInstanceId: 'ti-7' };
  const historyCard = {
    id: persisted.id,
    type: 'tool',
    tool: persisted.tool,
    backendToolId: persisted.toolInstanceId || persisted.id,
  };
  assert.strictEqual(shouldCreateToolCard([historyCard], { type: 'action_start', tool: 'exec', toolInstanceId: 'ti-7' }), false);
});

test('H2/H4: genuinely new action_start still creates a card', () => {
  const existing = [{ id: 'tool-1', type: 'tool', tool: 'readFile', backendToolId: 'ti-1' }];
  assert.strictEqual(shouldCreateToolCard(existing, { type: 'action_start', tool: 'writeFile', toolInstanceId: 'ti-2' }), true);
  assert.strictEqual(shouldCreateToolCard([], { type: 'action_start', tool: 'writeFile', toolInstanceId: 'ti-2' }), true);
  // Events with no backend id at all (e.g. plan-mode tools) keep old behavior.
  assert.strictEqual(shouldCreateToolCard(existing, { type: 'action_start', tool: 'openDebugTerminal' }), true);
  assert.strictEqual(shouldCreateToolCard(existing, null), false, 'malformed event must not create a card');
});

// ── (c) H3: counter-based ids never collide in the same ms ───────────────────

test('H3: makeToolCardId ids are unique within the same millisecond', () => {
  const ids = new Set();
  for (let i = 1; i <= 1000; i++) ids.add(makeToolCardId(i));
  assert.strictEqual(ids.size, 1000);
  assert.match(makeToolCardId(42), /^tool-\d+-42$/);
});

// ── (d) ChatArea wiring ──────────────────────────────────────────────────────

test('H2/H3/H4: ChatArea action_start uses the dedup helper and counter ids', () => {
  assert.ok(chatAreaSrc.includes("import { shouldCreateToolCard, makeToolCardId } from '../lib/toolCardDedup.js';"), 'helper import missing');
  assert.ok(chatAreaSrc.includes('let toolCardSeq = 0;'), 'module counter missing');
  assert.ok(chatAreaSrc.includes('if (!shouldCreateToolCard(get(messages), event)) break;'), 'dedup guard missing in action_start');
  assert.ok(chatAreaSrc.includes('const toolId = makeToolCardId(++toolCardSeq);'), 'counter-based id missing');
  assert.ok(!chatAreaSrc.includes("const toolId = 'tool-' + Date.now();"), 'old Date.now-only id must be gone');
});

test('H2: cached action_end never steal-fills an unrelated running card', () => {
  assert.ok(chatAreaSrc.includes('if (!lastTool && event.cached !== true) {'), 'name-based fallback must be skipped for cached replays');
});

test('H4: history-loaded tool cards carry backendToolId', () => {
  assert.ok(chatAreaSrc.includes('backendToolId: msg.toolInstanceId || msg.id'), 'history load must set backendToolId from persisted fields');
});

test('W8-T3b intact: hidden tools still skip cards but keep their watchdog', () => {
  assert.ok(chatAreaSrc.includes('if (TOOL_HIDDEN[event.tool]) {'), 'hidden-tool branch must remain');
  assert.ok(chatAreaSrc.includes("toolTimers.start('hidden:' + event.tool"), 'hidden watchdog must remain');
  assert.ok(chatAreaSrc.includes("const hiddenTimerKey = 'hidden:' + event.tool;"), 'action_end hidden timer key must remain');
  assert.ok(chatAreaSrc.includes('if (TOOL_HIDDEN[msg.tool]) continue;'), 'history load must still skip hidden tools');
});
