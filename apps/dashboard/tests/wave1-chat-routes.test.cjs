// wave1-chat-routes.test.cjs — Wave 11 Fix: dedup by event identity, never by content
// Run: node --test apps/dashboard/tests/wave1-chat-routes.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { makeEventDedupKey } = require('../lib/chat-event-dedup.cjs');

const CHAT_ROUTES = path.join(__dirname, '..', 'luna-chat-routes.js');

// B1/B4: events with distinct ids must survive dedup, regardless of same tool/text.
test('B1: repeated action_start for the same tool survives dedup', () => {
  const emitted = new Set();
  const events = [
    { type: 'action_start', tool: 'readFile', toolInstanceId: 'inst-1', id: 'ev-1' },
    { type: 'action_start', tool: 'readFile', toolInstanceId: 'inst-2', id: 'ev-2' },
    { type: 'action_end', tool: 'readFile', toolInstanceId: 'inst-1', id: 'ev-3' },
    { type: 'action_end', tool: 'readFile', toolInstanceId: 'inst-2', id: 'ev-4' },
    { type: 'action_progress', tool: 'readFile', toolInstanceId: 'inst-1', id: 'ev-5' },
  ];

  const survivors = events.filter(ev => {
    const key = makeEventDedupKey(ev, '');
    if (emitted.has(key)) return false;
    emitted.add(key);
    return true;
  });

  assert.strictEqual(survivors.length, events.length, 'every distinct event id must survive dedup');
});

// B1: when the soul omits toolInstanceId, the key falls back to ev.id so
// repeated invocations still don't collapse into one another.
test('B1: action events fall back to ev.id when toolInstanceId is missing', () => {
  const k1 = makeEventDedupKey({ type: 'action_start', tool: 'readFile', id: 'ev-1' }, '');
  const k2 = makeEventDedupKey({ type: 'action_start', tool: 'readFile', id: 'ev-2' }, '');
  assert.notStrictEqual(k1, k2, 'fallback to ev.id must keep instances distinct');
});

// Wave 11: identical text events with distinct ids must NOT dedupe.
test('Wave11: identical text events with distinct ids do not dedupe', () => {
  const emitted = new Set();
  const ev1 = { type: 'response_delta', id: 'ev-1' };
  const ev2 = { type: 'response_delta', id: 'ev-2' };
  const content = 'Aqui está o resultado da sua busca.';

  const k1 = makeEventDedupKey(ev1, content);
  emitted.add(k1);
  const k2 = makeEventDedupKey(ev2, content);

  assert.notStrictEqual(k1, k2, 'distinct ids must produce distinct keys');
  assert.strictEqual(emitted.has(k2), false, 'second identical text event must NOT be deduped');
});

// Wave 11: events without id fall back to a unique timestamp+seq key.
test('Wave11: events without id get unique fallback keys', () => {
  const k1 = makeEventDedupKey({ type: 'response_delta' }, 'x');
  const k2 = makeEventDedupKey({ type: 'response_delta' }, 'x');
  assert.notStrictEqual(k1, k2, 'fallback keys must be unique per call');
});

// W6-T8: transport-side single-writer persistence + id-based dedup.
test('W6-T8b: persist loop skips response_detected and dedupes by event id', () => {
  const src = fs.readFileSync(CHAT_ROUTES, 'utf8');

  // (i) Anchor on the persist-loop addMessageToSession (the one storing
  // ev.type), then look 3000 chars back where the event whitelist sits.
  const anchor = 'addMessageToSession(session.id, {';
  let idx = -1;
  let from = 0;
  while ((from = src.indexOf(anchor, from)) !== -1) {
    if (src.slice(from, from + 400).includes('type: ev.type')) { idx = from; break; }
    from += anchor.length;
  }
  assert.notStrictEqual(idx, -1, 'persist-loop addMessageToSession anchor must exist');
  const before = src.slice(Math.max(0, idx - 3000), idx);
  assert.ok(before.includes('for await'), 'window must cover the persist loop — anchor drifted?');
  assert.ok(!before.includes("'response_detected'"),
    'persist loop must not persist response_detected separately');

  // (ii) dedup uses event id; action_progress stays exempt.
  const keyIdx = src.indexOf('const dedupKey = ev.id ||');
  assert.notStrictEqual(keyIdx, -1, 'id-based dedup call site must exist');
  const around = src.slice(Math.max(0, keyIdx - 400), keyIdx + 400);
  assert.ok(around.includes("ev.type !== 'action_progress'"), 'action_progress exemption must remain');

  // (iii) W6-T8 review follow-up: the finally block must only delete the stream
  // meta when it still owns it — otherwise POST#1's finally can delete POST#2's
  // meta and let a third POST run concurrently against the closed gate.
  const delIdx = src.indexOf('activeStreams.delete(finalSessionId)');
  assert.notStrictEqual(delIdx, -1, 'activeStreams.delete(finalSessionId) must exist');
  const delAround = src.slice(Math.max(0, delIdx - 300), delIdx);
  assert.ok(/activeStreams\.get\(finalSessionId\)\s*===\s*myStreamMeta/.test(delAround),
    'stream-meta delete must be ownership-guarded');
});

// ── Wave 7 Task 2 (b): SSE serializers must forward plan/planPath ───────────
test('W7-T2b: SSE serializers forward plan and planPath', () => {
  const src = fs.readFileSync(CHAT_ROUTES, 'utf8');
  // Both replay and live paths must copy msg.plan / msg.planPath into eventData.
  assert.ok(src.includes("if (msg.plan) eventData.plan = msg.plan"), 'live path forwards plan');
  assert.ok(src.includes("if (msg.planPath) eventData.planPath = msg.planPath"), 'live path forwards planPath');
});

// ── Wave 11: messageId must be propagated to the soul and back to frontend ──
test('Wave11: messageId is passed to processMessageStream', () => {
  const src = fs.readFileSync(CHAT_ROUTES, 'utf8');
  assert.ok(/processMessageStream\(finalMessage, \{[\s\S]*?messageId,[\s\S]*?\}\)/.test(src),
    'processMessageStream options must include messageId');
});
