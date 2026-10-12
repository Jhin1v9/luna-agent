// wave4-frontend.test.cjs — Wave 4 regression tests (frontend hygiene)
// T1: production debug logs removed from ChatArea.svelte
// T2: OrbBackground resize listener removed in onDestroy
// T3: processedEventIds eviction trims to 80% (lib/evictSet.js)
// T4: markdown render/highlight debounced (lib/debounce.js + AssistantMessage.svelte)
// T5: 401 handler shows login screen instead of page reload (lib/authGuard.js + api.js)
// T6: SSEManager — cancellable reconnect timer + lastMessageCount reset on session switch (api.js)
// T7: tool timer registry — 60s timeout marks stuck tools failed; clearAll on reconnect (lib/toolTimers.js)
// T8: /api/chat/ack caller + batcher (lib/ackBatcher.js + api.js + ChatArea.svelte)
// T9: action_progress chunk forwarded end-to-end (lib/progress-event.cjs + luna-soul.cjs + luna-chat-routes.js)
// Run: node --test packages/kernel/tests/wave4-frontend.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..', '..');
const CHAT_AREA = path.join(REPO, 'packages/kernel/luna-web/src/components/ChatArea.svelte');
const ORB_BG = path.join(REPO, 'packages/kernel/luna-web/src/components/OrbBackground.svelte');
const ASSISTANT_MSG = path.join(REPO, 'packages/kernel/luna-web/src/components/AssistantMessage.svelte');
const API_JS = path.join(REPO, 'packages/kernel/luna-web/src/api.js');
const SOUL = path.join(REPO, 'packages/kernel/luna-soul.cjs');
const CHAT_ROUTES = path.join(REPO, 'apps/dashboard/luna-chat-routes.js');

// ── T1: production debug logs removed ────────────────────────────────────────

test('T1: ChatArea has no per-send stack-trace or branch-dump logs', () => {
  const src = fs.readFileSync(CHAT_AREA, 'utf8');
  assert.ok(!src.includes('new Error().stack'), 'stack-trace debug log must be gone');
  assert.ok(!src.includes('[handleSend] START'), 'handleSend START dump must be gone');
  assert.ok(!src.includes('[handleSend] branches'), 'handleSend branches dump must be gone');
});

test('T1: ChatArea has no per-event [SSE] / [done] debug logs', () => {
  const src = fs.readFileSync(CHAT_AREA, 'utf8');
  assert.ok(!src.includes("'[SSE]', event.type"), 'per-event [SSE] log must be gone');
  assert.ok(!src.includes("'[SSE] Deduplicated:'"), 'dedup log must be gone');
  assert.ok(!src.includes("'[SSE] Delaying response event"), 'delayed-event log must be gone');
  assert.ok(!src.includes("'[SSE] Ignoring stale event"), 'stale-event log must be gone');
  assert.ok(!src.includes("'[done] finalResponse length:'"), 'done content dump must be gone');
  assert.ok(!src.includes('[DEBUG-LUNA]'), 'DEBUG-LUNA log must be gone');
});

// ── T2: OrbBackground resize listener cleanup ────────────────────────────────

test('T2: OrbBackground registers a NAMED resize handler and removes it in onDestroy', () => {
  const src = fs.readFileSync(ORB_BG, 'utf8');
  assert.ok(!src.includes("addEventListener('resize', () =>"), 'anonymous resize listener must be gone');
  assert.ok(src.includes("addEventListener('resize', handleResize)"), 'named handler must be registered');
  assert.ok(src.includes("removeEventListener('resize', handleResize)"), 'handler must be removed in onDestroy');
});

// ── T3: set eviction policy ──────────────────────────────────────────────────

const { evictOldestEntries } = require('../luna-web/src/lib/evictSet.js');

test('T3: eviction trims an over-cap set down to 80%, oldest first', () => {
  const s = new Set();
  for (let i = 0; i < 5001; i++) s.add('ev-' + i);
  const removed = evictOldestEntries(s, 5000);
  assert.strictEqual(s.size, 4000, 'must trim to 80% of the cap, not delete a single entry');
  assert.strictEqual(removed, 1001);
  assert.ok(!s.has('ev-0') && !s.has('ev-1000'), 'oldest entries must be evicted');
  assert.ok(s.has('ev-1001') && s.has('ev-5000'), 'newest entries must survive');
});

test('T3: eviction is a no-op at or below the cap', () => {
  const s = new Set(['a', 'b', 'c']);
  assert.strictEqual(evictOldestEntries(s, 5000), 0);
  assert.strictEqual(s.size, 3);
  const t = new Set();
  for (let i = 0; i < 5000; i++) t.add(i);
  assert.strictEqual(evictOldestEntries(t, 5000), 0, 'exactly at cap: no eviction');
  assert.strictEqual(t.size, 5000);
});

test('T3: ChatArea uses evictOldestEntries for processedEventIds', () => {
  const src = fs.readFileSync(CHAT_AREA, 'utf8');
  assert.ok(src.includes('evictOldestEntries(processedEventIds, 5000)'), 'component must call the shared helper');
});

// ── T4: debounced scheduler + marked config hygiene ──────────────────────────

const { createDebouncedScheduler } = require('../luna-web/src/lib/debounce.js');

function fakeTimer() {
  let seq = 0;
  const pending = new Map();
  return {
    setTimeoutFn: (cb, ms) => { const id = ++seq; pending.set(id, { cb, ms }); return id; },
    clearTimeoutFn: (id) => pending.delete(id),
    fireNext: () => { const [id, t] = pending.entries().next().value; pending.delete(id); t.cb(); },
    pendingCount: () => pending.size,
  };
}

test('T4: scheduler coalesces bursts into one trailing call', () => {
  const t = fakeTimer();
  let calls = 0;
  const s = createDebouncedScheduler(() => calls++, 120, t);
  s.schedule(); s.schedule(); s.schedule();
  assert.strictEqual(t.pendingCount(), 1, 'only one timer may be armed during a burst');
  assert.strictEqual(calls, 0);
  t.fireNext();
  assert.strictEqual(calls, 1, 'burst collapses into a single call');
});

test('T4: immediate schedule flushes pending work synchronously', () => {
  const t = fakeTimer();
  let calls = 0;
  const s = createDebouncedScheduler(() => calls++, 120, t);
  s.schedule();
  s.schedule(true);
  assert.strictEqual(calls, 1, 'immediate run executes now');
  assert.strictEqual(t.pendingCount(), 0, 'pending timer cancelled by the immediate run');
});

test('T4: cancel drops a pending run', () => {
  const t = fakeTimer();
  let calls = 0;
  const s = createDebouncedScheduler(() => calls++, 120, t);
  s.schedule();
  s.cancel();
  assert.strictEqual(t.pendingCount(), 0);
  assert.strictEqual(calls, 0);
});

test('T4: scheduler re-arms cleanly after a fired run', () => {
  const t = fakeTimer();
  let calls = 0;
  const s = createDebouncedScheduler(() => calls++, 120, t);
  s.schedule();
  t.fireNext();
  assert.strictEqual(calls, 1);
  s.schedule();
  assert.strictEqual(t.pendingCount(), 1, 'can arm again after firing');
  t.fireNext();
  assert.strictEqual(calls, 2);
});

test('T4: AssistantMessage uses a module-scope Marked instance, not per-instance marked.use', () => {
  const src = fs.readFileSync(ASSISTANT_MSG, 'utf8');
  assert.ok(!src.includes('marked.use('), 'per-instance global marked.use() must be gone');
  assert.ok(src.includes('<script context="module">'), 'renderer config must move to module scope');
  assert.ok(src.includes('createDebouncedScheduler'), 'render must go through the debounced scheduler');
});

// ── T5: 401 logout decision ──────────────────────────────────────────────────

const { shouldForceLogout } = require('../luna-web/src/lib/authGuard.js');

test('T5: 401 with a token on an authed endpoint forces logout', () => {
  assert.strictEqual(shouldForceLogout({ status: 401, url: '/api/chat/sessions', hasToken: true }), true);
});

test('T5: no token, login endpoint, or non-401 never force logout', () => {
  assert.strictEqual(shouldForceLogout({ status: 401, url: '/api/chat/sessions', hasToken: false }), false);
  assert.strictEqual(shouldForceLogout({ status: 401, url: '/api/auth/login', hasToken: true }), false);
  assert.strictEqual(shouldForceLogout({ status: 200, url: '/api/chat/sessions', hasToken: true }), false);
  assert.strictEqual(shouldForceLogout({ status: 403, url: '/api/chat/sessions', hasToken: true }), false);
  // review follow-up: unknown/undefined url on a 401+token must fail safe (force logout)
  assert.strictEqual(shouldForceLogout({ status: 401, url: undefined, hasToken: true }), true);
});

test('T5: api.js 401 handler clears the session reactively instead of reloading', () => {
  const src = fs.readFileSync(API_JS, 'utf8');
  assert.ok(!src.includes('window.location.reload'), 'page reload on 401 must be gone');
  assert.ok(!src.includes('__luna401handled'), 'reload debounce flag must be gone');
  assert.ok(src.includes('shouldForceLogout'), 'decision must go through the pure helper');
  assert.ok(src.includes('user.set(null)'), 'must show the login screen via the user store');
});

// ── T6: SSEManager reconnect timer + session-switch reset ────────────────────

globalThis.window = globalThis.window || { fetch: async () => ({ status: 200 }) };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };

let eventSourceCount = 0;
globalThis.EventSource = class FakeEventSource {
  constructor(url) { this.url = url; eventSourceCount++; this.closed = false; }
  close() { this.closed = true; }
};

const { SSEManager } = require('../luna-web/src/api.js');

function freshManager() {
  const m = new SSEManager();
  m.baseDelay = 1;  // keep backoff tests fast: delay = min(1*2^n + jitter, 5) <= 5ms
  m.maxDelay = 5;
  return m;
}

test('T6 (bug 5): lastMessageCount resets when connect() switches sessions', () => {
  const m = freshManager();
  try {
    m.currentSessionId = 's1';
    m.lastMessageCount = 42;
    m.connect('s2', () => {});
    assert.strictEqual(m.lastMessageCount, 0, 'new session must not slice history with the old count');
    m.connect('s2', () => {}); // same session reconnect path (guard returns early)
    m.lastMessageCount = 7;
    m.connect('s2', () => {});
    assert.strictEqual(m.lastMessageCount, 7, 'same-session reconnect must preserve the count');
  } finally {
    m.disconnect();
  }
});

test('T6 (bug 3): reconnect backoff timer is stored and disconnect() cancels it', () => {
  const m = freshManager();
  try {
    m.connect('s1', () => {});
    m.eventSource.onerror(); // arm the backoff timer
    assert.ok(m.reconnectTimer, 'backoff timer must be stored on the instance (pre-fix: property is undefined)');
    m.disconnect();
    assert.strictEqual(m.reconnectTimer, null, 'disconnect() must cancel the pending reconnect');
  } finally {
    m.disconnect();
  }
});

test('T6 (bug 3): a reconnect timer pending at disconnect() never resurrects the connection', async () => {
  const m = freshManager();
  try {
    m.connect('s1', () => {});
    const before = eventSourceCount;
    m.eventSource.onerror();        // timer armed (<=5ms with the test knobs)
    m.disconnect();                 // user/session switch happens before it fires
    await new Promise(r => setTimeout(r, 50));
    assert.strictEqual(eventSourceCount, before, 'no new EventSource may be created after disconnect');
  } finally {
    m.disconnect();
  }
});

test('T6 (bug 3): ChatArea reuses the SSEManager instead of discarding it per reconnect', () => {
  const src = fs.readFileSync(CHAT_AREA, 'utf8');
  const occurrences = src.split('new SSEManager()').length - 1;
  assert.strictEqual(occurrences, 1, 'only the declaration at :19 may instantiate SSEManager');
});

// Review follow-up: pins the single line (api.js connect()-entry timer clear)
// that prevents the most dangerous zombie case — a backoff timer for the OLD
// session firing after an external connect() switched to a NEW session.
test('T6 (bug 3): connect() for a new session cancels a pending backoff timer (no old-session resurrection)', async () => {
  const m = freshManager();
  try {
    m.connect('s1', () => {});
    m.eventSource.onerror();              // backoff timer armed for s1
    assert.ok(m.reconnectTimer, 'timer armed');
    m.connect('s2', () => {});            // external session switch before it fires
    assert.strictEqual(m.reconnectTimer, null, 'connect() must cancel the pending timer at entry');
    const afterSwitch = eventSourceCount;
    const s2Source = m.eventSource;
    await new Promise(r => setTimeout(r, 50));
    assert.strictEqual(eventSourceCount, afterSwitch, 'old timer must never fire a new EventSource');
    assert.strictEqual(m.eventSource, s2Source, 's2 connection must remain the live one');
    assert.ok(m.eventSource.url.includes('sessionId=s2'), 'live connection is for the new session');
  } finally {
    m.disconnect();
  }
});

// Review follow-up: the full same-session reconnect path (eventSource lost),
// not just the duplicate-connection early-return guard.
test('T6 (bug 5): same-session reconnect after connection loss preserves lastMessageCount', () => {
  const m = freshManager();
  try {
    m.connect('s1', () => {});
    m.lastMessageCount = 7;
    m.eventSource.close();
    m.eventSource = null;      // simulate lost connection (full reconnect path)
    m.connect('s1', () => {});
    assert.strictEqual(m.lastMessageCount, 7, 'same-session reconnect must preserve the count');
  } finally {
    m.disconnect();
  }
});

// ── T7: tool timer registry ──────────────────────────────────────────────────

const { createToolTimerRegistry } = require('../luna-web/src/lib/toolTimers.js');

function fakeClock() {
  let now = 0, seq = 0;
  const intervals = new Map();
  const timeouts = new Map();
  return {
    nowFn: () => now,
    setIntervalFn: (cb, ms) => { const id = ++seq; intervals.set(id, { cb, ms }); return id; },
    clearIntervalFn: (id) => intervals.delete(id),
    setTimeoutFn: (cb, ms) => { const id = ++seq; timeouts.set(id, { cb, ms, at: now + ms }); return id; },
    clearTimeoutFn: (id) => timeouts.delete(id),
    tick(ms) {
      // Deterministic by design: each armed interval fires ONCE per tick() call
      // (not once per simulated period); due timeouts fire when now passes them.
      now += ms;
      for (const { cb } of intervals.values()) cb();
      for (const [id, t] of [...timeouts]) {
        if (t.at <= now) { timeouts.delete(id); t.cb(); }
      }
    },
    pendingIntervals: () => intervals.size,
    pendingTimeouts: () => timeouts.size,
  };
}

test('T7 (bug 2): start arms one interval + one timeout; stop cancels both and returns elapsed', () => {
  const c = fakeClock();
  const reg = createToolTimerRegistry(c);
  const ticks = [];
  reg.start('tool-1', { onTick: (s) => ticks.push(s), onTimeout: () => {}, intervalMs: 100, timeoutMs: 60000 });
  assert.strictEqual(c.pendingIntervals(), 1);
  assert.strictEqual(c.pendingTimeouts(), 1);
  c.tick(100);
  assert.strictEqual(ticks.length, 1, 'interval fires onTick');
  const elapsed = reg.stop('tool-1');
  assert.ok(Math.abs(elapsed - 0.1) < 1e-9, 'stop returns elapsed seconds');
  assert.strictEqual(c.pendingIntervals(), 0, 'bug 2: interval must be cleared');
  assert.strictEqual(c.pendingTimeouts(), 0);
});

test('T7 (bug 1): timeout marks the tool once and kills its interval', () => {
  const c = fakeClock();
  const reg = createToolTimerRegistry(c);
  let timedOut = null, ticks = 0;
  reg.start('tool-9', { onTick: () => ticks++, onTimeout: (id) => { timedOut = id; }, intervalMs: 100, timeoutMs: 60000 });
  c.tick(60000); // fake clock: fires each armed interval once, then due timeouts
  assert.strictEqual(timedOut, 'tool-9', 'watchdog must fire at TOOL_TIMEOUT_MS');
  assert.strictEqual(c.pendingIntervals(), 0, 'bug 2: the UI interval dies with the timeout');
  const ticksAtTimeout = ticks;
  c.tick(60000);
  assert.strictEqual(ticks, ticksAtTimeout, 'no further ticks after the timeout');
  assert.strictEqual(reg.has('tool-9'), false);
});

test('T7 (bug 2): clearAll cancels every interval and timeout (reconnect path)', () => {
  const c = fakeClock();
  const reg = createToolTimerRegistry(c);
  reg.start('a', { onTick() {}, onTimeout() {} });
  reg.start('b', { onTick() {}, onTimeout() {} });
  reg.clearAll();
  assert.strictEqual(c.pendingIntervals(), 0);
  assert.strictEqual(c.pendingTimeouts(), 0);
  c.tick(60000); // nothing may fire afterwards
  assert.strictEqual(reg.size, 0);
});

test('T7: starting the same toolId twice never stacks timers', () => {
  const c = fakeClock();
  const reg = createToolTimerRegistry(c);
  reg.start('x', { onTick() {}, onTimeout() {} });
  reg.start('x', { onTick() {}, onTimeout() {} });
  assert.strictEqual(c.pendingIntervals(), 1);
  assert.strictEqual(c.pendingTimeouts(), 1);
});

test('T7: ChatArea wires the registry into action_start, action_end, reconnect and destroy', () => {
  const src = fs.readFileSync(CHAT_AREA, 'utf8');
  assert.ok(src.includes('createToolTimerRegistry'), 'registry must be imported and instantiated');
  assert.ok(!src.includes('runningToolTimers'), 'old interval map must be gone');
  assert.ok(!src.includes('toolTimeoutTimers = new Map'), 'old dead timeout map must be gone');
  assert.ok(src.includes('toolTimers.clearAll()'), 'reconnect/destroy must cancel all timers');
  assert.ok(src.includes('onTimeout'), 'bug 1: a timeout handler must mark the tool failed');
  // review follow-up: the double-decrement / late-action_end guard must stay wired
  assert.ok(src.includes('timedOutToolIds'), 'timedOutToolIds guard must exist');
  assert.ok(src.includes('timedOutToolIds.delete(lastTool.id)'), 'late action_end must consult the guard for card tools');
  // Wave 8 review: hidden tools (no card) consult the same guard via their timer key
  assert.ok(src.includes('timedOutToolIds.delete(hiddenTimerKey)'), 'late action_end must consult the guard for hidden tools');
});

// ── T8: ack batcher + ackEvents caller ───────────────────────────────────────

const { createAckBatcher } = require('../luna-web/src/lib/ackBatcher.js');

test('T8: batcher coalesces ids and flushes on the interval', () => {
  const t = fakeTimer();
  const batches = [];
  const b = createAckBatcher((ids) => batches.push(ids), { intervalMs: 1000, maxBatch: 100, ...t });
  b.push('ev-1'); b.push('ev-2'); b.push(null); b.push(undefined);
  assert.strictEqual(batches.length, 0, 'nothing sent before the interval');
  t.fireNext();
  assert.deepStrictEqual(batches, [['ev-1', 'ev-2']], 'one batch, falsy ids dropped');
  assert.strictEqual(b.size, 0);
});

test('T8: batcher flushes immediately at maxBatch and reset() drops pending', () => {
  const t = fakeTimer();
  const batches = [];
  const b = createAckBatcher((ids) => batches.push(ids), { intervalMs: 1000, maxBatch: 3, ...t });
  b.push('a'); b.push('b'); b.push('c');
  assert.deepStrictEqual(batches, [['a', 'b', 'c']], 'maxBatch triggers an immediate flush');
  assert.strictEqual(t.pendingCount(), 0, 'no dangling timer after the immediate flush');
  b.push('d'); b.reset();
  t.fireNext = () => { throw new Error('reset must cancel the armed timer'); };
  assert.strictEqual(b.size, 0);
});

test('T8: ackEvents POSTs {sessionId, eventIds} to /api/chat/ack and never throws', async () => {
  const api = require('../luna-web/src/api.js');
  let captured = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { captured = { url, opts }; return { status: 200, json: async () => ({ ok: true }) }; };
  try {
    await api.ackEvents('sess-1', ['ev-1', 'ev-2']);
    assert.strictEqual(captured.url, '/api/chat/ack');
    assert.strictEqual(captured.opts.method, 'POST');
    assert.deepStrictEqual(JSON.parse(captured.opts.body), { sessionId: 'sess-1', eventIds: ['ev-1', 'ev-2'] });
    globalThis.fetch = async () => { throw new Error('backend down'); };
    await api.ackEvents('sess-1', ['ev-3']); // must resolve, not reject
    await api.ackEvents(null, ['ev-3']);     // no session: no-op
    await api.ackEvents('sess-1', []);       // empty batch: no-op
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('T8: ChatArea acks backend-ledger event ids and resets the batcher on reconnect', () => {
  const src = fs.readFileSync(CHAT_AREA, 'utf8');
  assert.ok(src.includes('createAckBatcher'), 'batcher must be instantiated');
  assert.ok(src.includes('ackBatcher.push(event.id)'), 'received events must be acked');
  assert.ok(src.includes('ackBatcher.reset()'), 'session switch must drop pending ids from the old session');
});

// ── T9: action_progress chunk transport ──────────────────────────────────────

const { makeProgressEvent } = require('../lib/progress-event.cjs');

test('T9: makeProgressEvent normalizes positional tool progress into a chunk event', () => {
  const ev = makeProgressEvent({ toolInstanceId: 'inst-1', tool: 'executeShell', chunk: 'hello\n', stream: 'stdout', sessionId: 's1' });
  assert.deepStrictEqual(ev, { type: 'action_progress', toolInstanceId: 'inst-1', tool: 'executeShell', chunk: 'hello\n', stream: 'stdout', sessionId: 's1' });
  assert.strictEqual(makeProgressEvent({ chunk: null }).chunk, '', 'null chunk becomes empty string');
  assert.strictEqual(makeProgressEvent({ chunk: 42 }).chunk, '42', 'non-string chunk is stringified');
  assert.strictEqual(makeProgressEvent({}).stream, 'stdout', 'stream defaults to stdout');
});

test('T9: soul emitProgress uses makeProgressEvent (no string spread)', () => {
  const src = fs.readFileSync(SOUL, 'utf8');
  const emitLine = src.split('\n').find(l => l.includes('const emitProgress ='));
  assert.ok(emitLine && emitLine.includes('makeProgressEvent'), 'emitProgress must build the event via the helper');
  assert.ok(!emitLine.includes('...ev'), 'string spread into the event must be gone');
});

test('T9: chat-routes stores and forwards chunk, and does not dedup action_progress', () => {
  const src = fs.readFileSync(CHAT_ROUTES, 'utf8');
  assert.ok(src.includes("ev.type !== 'action_progress' && emittedEventHashes.has(dedupKey)"), 'progress chunks must bypass the per-instance dedup');
  assert.ok(src.includes('chunk: ev.chunk'), 'store picklist must persist chunk');
  const serializerHits = src.split('eventData.chunk').length - 1;
  assert.ok(serializerHits >= 2, `both SSE serializers (replay + live) must forward chunk (found ${serializerHits})`);
});

// Review follow-up: progress chunks stay in memory (live SSE + replay) but must
// not trigger a full-session sync JSON rewrite + PG UPDATE per chunk.
test('T9: action_progress rows skip per-event persistence (perf follow-up)', () => {
  const src = fs.readFileSync(CHAT_ROUTES, 'utf8');
  assert.ok(src.includes("persist: ev.type !== 'action_progress'"), 'progress chunks must skip per-chunk session persistence');
  assert.ok(src.includes('if (!persist) return;'), 'addMessageToSession must honor the persist flag');
});

// ── W6-T11: ToolCard renders result warnings ─────────────────────────────────
// Visible-mode fallbacks annotate the tool result with `warning` (W6e-b);
// the card must surface it next to the error block.

test('W6e-c: ToolCard renders result warnings', () => {
  const TOOL_CARD = path.join(REPO, 'packages/kernel/luna-web/src/components/ToolCard.svelte');
  const src = fs.readFileSync(TOOL_CARD, 'utf8');
  assert.ok(src.includes('result?.warning') || src.includes('result.warning'),
    'ToolCard must show warnings from the tool result');
  assert.ok(src.includes('tool-warning'), 'ToolCard must style the warning block');
});

// ── Wave 7 Task 2 review (f): plan-mode state machine hygiene ──────────────
// Review of 06c21fc found that planModeState had no transition out of
// 'processing' on failure paths (409 refusal, error event, dead plan stream),
// so the next user message hit the "already processing" guard and was
// silently dropped. These tests pin the release paths.

const PLAN_CARD = path.join(REPO, 'packages/kernel/luna-web/src/components/PlanCard.svelte');

test('W7-T2f: both startPlanMode call sites check the response and reset on refusal', () => {
  const src = fs.readFileSync(CHAT_AREA, 'utf8');
  const hits = src.split('await startPlanMode(');
  assert.strictEqual(hits.length, 3, 'expected exactly two startPlanMode call sites');
  for (let i = 1; i < hits.length; i++) {
    const window = hits[i].slice(0, 600);
    assert.ok(window.includes('planRes'), `call site ${i} must capture the startPlanMode response`);
    assert.ok(window.includes('!planRes.ok'), `call site ${i} must check planRes.ok (409 refusal)`);
    assert.ok(window.includes("status: 'idle'"), `call site ${i} must reset planModeState on refusal`);
    assert.ok(window.includes('isStreaming.set(false)'), `call site ${i} must unlock the input on refusal`);
  }
});

test('W7-T2f: error and plan_error events release a processing planModeState', () => {
  const src = fs.readFileSync(CHAT_AREA, 'utf8');
  // generic 'error' case
  const errIdx = src.indexOf("case 'error': {");
  assert.notStrictEqual(errIdx, -1, 'error case must exist');
  const errWindow = src.slice(errIdx, errIdx + 1200);
  assert.ok(errWindow.includes("$planModeState.status === 'processing'"),
    'error case must check for a processing planModeState');
  assert.ok(errWindow.includes("status: 'idle'"),
    'error case must reset planModeState to idle');
  // 'plan_error' case (server emits it when the plan stream dies silently)
  const peIdx = src.indexOf("case 'plan_error':");
  assert.notStrictEqual(peIdx, -1, 'plan_error case must exist');
  const peWindow = src.slice(peIdx, peIdx + 900);
  assert.ok(peWindow.includes("$planModeState.status === 'processing'"),
    'plan_error case must release a processing planModeState');
  assert.ok(peWindow.includes('event.text'),
    'plan_error case must display event.text (the serializer maps content→text)');
});

test('W7-T2f: session switch resets foreign planModeState (cross-session hijack)', () => {
  const src = fs.readFileSync(CHAT_AREA, 'utf8');
  const watcher = src.indexOf('sessionId !== lastConnectedSessionId');
  assert.notStrictEqual(watcher, -1, 'session-switch watcher must exist');
  const window = src.slice(watcher, watcher + 900);
  assert.ok(window.includes('$planModeState.active'),
    'watcher must inspect planModeState on session switch');
  assert.ok(window.includes('$planModeState.sessionId !== sessionId'),
    'watcher must only reset state owned by a different session');
  assert.ok(window.includes("status: 'idle'"),
    'watcher must reset the leaked plan-mode state');
});

test('W7-T2f: plan actions are re-entrancy guarded and unlock on send failure', () => {
  const src = fs.readFileSync(CHAT_AREA, 'utf8');
  assert.ok(src.includes('planActionPending'), 're-entrancy guard must exist');
  for (const handler of ['handleApprovePlan', 'handleRejectPlan', 'handleRevisePlan']) {
    const idx = src.indexOf(`async function ${handler}(`);
    assert.notStrictEqual(idx, -1, `${handler} must exist`);
    const window = src.slice(idx, idx + 400);
    assert.ok(window.includes('planActionPending'), `${handler} must be guarded against double submit`);
  }
  const finallyCount = (src.match(/planActionPending = false/g) || []).length;
  assert.ok(finallyCount >= 3, 'every guarded handler must release the guard (finally)');
  // sendPlanFollowUp: a failed kickoff must not leak isStreaming=true
  const sfIdx = src.indexOf('async function sendPlanFollowUp(');
  assert.notStrictEqual(sfIdx, -1, 'sendPlanFollowUp must exist');
  const sfWindow = src.slice(sfIdx, sfIdx + 1100);
  assert.ok(sfWindow.includes('catch'), 'sendPlanFollowUp must catch sendMessage failure');
  assert.ok(sfWindow.includes('isStreaming.set(false)'),
    'sendPlanFollowUp must unlock the input when the kickoff send fails');
});

test('W7-T2f: PlanCard renders action buttons only while awaiting approval', () => {
  const src = fs.readFileSync(PLAN_CARD, 'utf8');
  const actionsIdx = src.indexOf('plan-actions');
  assert.notStrictEqual(actionsIdx, -1, 'plan-actions block must exist');
  const before = src.slice(Math.max(0, actionsIdx - 200), actionsIdx);
  assert.ok(before.includes("{#if status === 'awaiting_approval'}"),
    'action buttons must be gated on awaiting_approval (decided plans keep no clickable buttons)');
});

// ── Wave 8 Task 3: hidden internal tools + chunk-replay dedup ────────────────

test('W8-T3: ChatArea skips card creation for registry-hidden tools on action_start', () => {
  const src = fs.readFileSync(CHAT_AREA, 'utf8');
  assert.ok(src.includes("from '../lib/toolMeta.generated.js'"), 'ChatArea must import the generated meta');
  assert.ok(src.includes('TOOL_HIDDEN'), 'ChatArea must read the generated hidden map (no hardcoded list)');
  const idx = src.indexOf("case 'action_start': {");
  assert.notStrictEqual(idx, -1, 'action_start case must exist');
  // Window covers the W10-T1 dedup guard/comment block added before the card push.
  const window = src.slice(idx, idx + 4000);
  const hiddenIdx = window.indexOf('TOOL_HIDDEN[event.tool]');
  const cardIdx = window.indexOf("type: 'tool'");
  assert.notStrictEqual(hiddenIdx, -1, 'action_start must check TOOL_HIDDEN before creating the card');
  assert.notStrictEqual(cardIdx, -1, 'action_start must still create cards for visible tools');
  assert.ok(hiddenIdx < cardIdx, 'hidden check must run before the card is appended');
});

test('W8-T3: action_progress chunks are deduped by backend event id (replay-safe)', () => {
  const src = fs.readFileSync(CHAT_AREA, 'utf8');
  assert.ok(src.includes('appliedChunkIds'), 'chunk-id dedup set must exist');
  const idx = src.indexOf("case 'action_progress': {");
  assert.notStrictEqual(idx, -1, 'action_progress case must exist');
  const window = src.slice(idx, idx + 800);
  assert.ok(window.includes('appliedChunkIds.has'), 'action_progress must check the dedup set');
  assert.ok(window.includes('appliedChunkIds.add'), 'action_progress must record applied chunk ids');
  assert.ok(!src.includes('appliedChunkIds.clear'), 'chunk dedup set must survive reconnects (never cleared)');
});

// Wave 8 review follow-ups: safety nets found missing during adversarial review.
test('W8-T3-review: hidden tools keep a watchdog so a dead stream cannot lock the input', () => {
  const src = fs.readFileSync(CHAT_AREA, 'utf8');
  assert.ok(src.includes("toolTimers.start('hidden:' + event.tool"),
    'hidden action_start must arm a watchdog-only timer (no card to time out)');
  const endIdx = src.indexOf("case 'action_end': {");
  assert.notStrictEqual(endIdx, -1, 'action_end case must exist');
  const endWindow = src.slice(endIdx, endIdx + 3000);
  assert.ok(endWindow.includes("toolTimers.stop(hiddenTimerKey)"),
    'action_end must cancel the hidden watchdog on normal completion');
  assert.ok(endWindow.includes('timedOutToolIds.delete(hiddenTimerKey)'),
    'a late action_end after a hidden watchdog timeout must not double-decrement');
});

test('W8-T3-review: history load never recreates cards for hidden tools', () => {
  const src = fs.readFileSync(CHAT_AREA, 'utf8');
  const idx = src.indexOf("} else if (msg.type === 'action_start' && msg.tool) {");
  assert.notStrictEqual(idx, -1, 'history action_start branch must exist');
  // Window covers the W10-T1 backendToolId field/comment added to history cards.
  const window = src.slice(idx, idx + 1400);
  assert.ok(window.includes('TOOL_HIDDEN[msg.tool]'),
    'history load must skip hidden action_start/action_end (reload must not resurrect hidden cards)');
  assert.strictEqual(window.split('TOOL_HIDDEN[msg.tool]').length - 1, 2,
    'both the action_start and the action_end history branches must skip hidden tools');
});

test('W8-T3-review: PlanCard has a badge for superseded (revised) plans', () => {
  const src = fs.readFileSync(PLAN_CARD, 'utf8');
  assert.ok(src.includes("status === 'revised'"),
    "PlanCard must render a badge for status 'revised' (Wave 8 downgrades old cards to it)");
});

test('W8-T3-review: ToolCard params fallback is capped like truncatedOutput', () => {
  const TOOL_CARD = path.join(REPO, 'packages/kernel/luna-web/src/components/ToolCard.svelte');
  const src = fs.readFileSync(TOOL_CARD, 'utf8');
  assert.ok(src.includes('paramsJsonDisplay'),
    'params fallback must render a capped copy (no unbounded JSON dump into the DOM)');
  assert.ok(/paramsJson\.slice\(0, 500\)/.test(src),
    'params fallback cap must match the existing 500-char truncatedOutput pattern');
});
