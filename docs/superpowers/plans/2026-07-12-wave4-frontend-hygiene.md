# Wave 4 — Frontend Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` to execute this plan task-by-task. Execute Tasks 1 → 10 sequentially, in this order (safest/most independent first; the riskier SSE/timer state-machine changes and the scope-flagged transport fix go last). Each task: write failing test → run it (fail) → implement → run it (pass) → `corepack pnpm build` if a luna-web source was touched → run ALL regression suites → commit.

**Goal:** Fix the eleven frontend-hygiene bugs registered in `packages/kernel/.brain/bugs.md` (Frontend `luna-web` section): stuck tool cards + dead `TOOL_TIMEOUT_MS`, per-tool `setInterval` leak, zombie SSE reconnect, `/api/chat/ack` never called, `lastMessageCount` not reset on session switch, `action_progress.chunk` dropped in transport, `processedEventIds` one-entry eviction, markdown re-parse/highlight per delta, `window.fetch` 401 page reload, production debug logs, OrbBackground resize listener leak.

**Architecture:** Surgical fixes + additive PURE helpers extracted into standalone JS modules that both the Svelte component and the `node --test` suite import directly (project precedent: `packages/kernel/lib/stream-text-cursor.cjs`, `apps/dashboard/lib/chat-event-dedup.cjs`). New frontend logic modules live in `packages/kernel/luna-web/src/lib/*.js` (ESM, no svelte imports — Node 24 `require(ESM)` lets the `.cjs` test suite load them directly; verified working on this box, Node v24.15.0). New kernel-side logic for the transport fix lives in `packages/kernel/lib/*.cjs`. Svelte components can't run under `node --test`; tasks whose change is pure DOM/Svelte wiring (log removal, listener cleanup) verify via content-assertion tests + `corepack pnpm build` + full regression + a manual review checklist — no fake tests. NEVER touch PM2 processes — verification is `node --test` + `vite build` only; runtime smoke is left to the owner.

**Tech Stack:** Svelte 4, Vite 5, marked 18, Node 24 (.cjs tests, ESM frontend modules), native `node --test`, no new npm deps.

**Source of truth for root causes:** `packages/kernel/.brain/bugs.md` (Frontend section). All file:line citations below were RE-VERIFIED against code on 2026-07-12 at HEAD `31d6cbf` (three waves landed since the bug audit — drift corrections noted below; where the citation differed materially, this plan targets the CURRENT code).

**Line-number verification notes (drift corrections, all confirmed at `31d6cbf`):**
- File locations: `ChatArea.svelte` is at `packages/kernel/luna-web/src/components/` (not `src/lib/`); `api.js` is at `packages/kernel/luna-web/src/api.js`.
- Bug 1: `TOOL_TIMEOUT_MS = 60000` (`ChatArea.svelte:25`) and `toolTimeoutTimers` (`:24`) confirmed DEAD — only other reference is the map reset at `:950`. Never armed anywhere.
- Bug 2: per-tool `setInterval` at `ChatArea.svelte:519-531` (cited `:514-525` — drift +5); map reset without clearing at `:949-951` (cited `:945`). `onDestroy` (`:1455-1459`) clears intervals, but the reconnect path does not.
- Bug 3: `api.js:159` exact — backoff `setTimeout` not stored; `connect()` resets `isIntentionallyClosed = false` at `:109`; `new SSEManager()` per reconnect at `ChatArea.svelte:954-955` (cited `:948-949`).
- Bug 4: `/api/chat/ack` route EXISTS — `apps/dashboard/luna-chat-routes.js:714-745` (accepts `{sessionId, eventId|eventIds}`, prunes `eventLedger`, persists). The frontend simply never calls it (zero `ack` references in `luna-web/src`). Fix is frontend-only.
- Bug 5: `api.js:33` declares `lastMessageCount`; `_startFallbackPolling` uses it (`:50-87`); `connect()` (`:96-112`) sets `currentSessionId` but never resets the counter. Confirmed.
- Bug 6: **worse than cited, and the fix sites are not where the citation guessed.** The chunk pipeline is broken at FOUR points: (a) `luna-soul.cjs:4038` — `emitProgress = (ev) => eventBus.push({ type: 'action_progress', ..., ...ev, sessionId })` spreads a STRING (tools call `onProgress(chunkString, streamName)` positionally, e.g. `luna-tools.cjs:894,1025,1031`), producing numeric char keys and NO `chunk` field; (b) `apps/dashboard/luna-chat-routes.js:509` — `makeEventDedupKey` (`apps/dashboard/lib/chat-event-dedup.cjs:12-18`) keys `action_progress` by `toolInstanceId`, collapsing ALL chunks of one tool call into the first; (c) `luna-chat-routes.js:515-527` — the store picklist never stores `chunk`; (d) `luna-chat-routes.js:621-643` and `:667-690` — the SSE serializer (both replay and live paths) never forwards `chunk`. Site (a) is kernel-side (in scope); sites (b)-(d) are in `apps/dashboard` — see Task 9's ⚠️ scope gate. Frontend needs NO change: `ChatArea.svelte:534-541` already handles `event.chunk` and `ToolCard.svelte:112-115` renders `liveOutput`.
- Bug 7: eviction at `ChatArea.svelte:364-367` (cited `:358-361` — drift +6). Confirmed: deletes exactly 1 entry when size > 5000.
- Bug 8: `marked.use()` at `AssistantMessage.svelte:52-58` (exact cite) — per-instance global config mutation; `{@html renderMarkdown(content)}` at `:147` re-parses per delta; `highlightCode()` per content change at `:125-127` without debounce. `MessagesList.svelte:82` passes `isStreaming={$isStreaming}` — the debounce can key off it.
- Bug 9: `api.js:427-448` (cited `:429-448`) — `window.location.reload()` at `:442` on any 401 with a token. Confirmed.
- Bug 10: stack-trace log now at `ChatArea.svelte:1049` (cited `:1043`); `[handleSend] branches` log at `:1138` (cited `:1132` — note: no stack there, plain object dump); per-event `[SSE]` log at `:370` (cited `:364`). Related per-event logs also at `:328, :335, :359, :638, :659, :665, :686` (full removal list in Task 1).
- Bug 11: `OrbBackground.svelte:139` exact — anonymous `resize` arrow listener; `onDestroy` (`:142-144`) only cancels the animation frame.

**Task ↔ bug map (11 bugs → 9 fix tasks + bookkeeping):**
- Task 1 → bug 10 (debug logs) · Task 2 → bug 11 (resize listener) · Task 3 → bug 7 (eviction) · Task 4 → bug 8 (markdown debounce) · Task 5 → bug 9 (401 reload) · Task 6 → bugs 3+5 (api.js SSEManager — grouped, same class) · Task 7 → bugs 1+2 (tool-card timer code — grouped, same code site) · Task 8 → bug 4 (ack caller) · Task 9 → bug 6 (transport chunk — ⚠️ scope gate) · Task 10 → bugs.md bookkeeping.

**Tasks that touch luna-web sources (MUST rebuild `dist/` and include it in the commit):** Tasks 1, 2, 3, 4, 5, 6, 7, 8. Tasks 9 and 10 do NOT touch luna-web sources (no rebuild).

**Standard commands (used in every task below):**
```bash
# New wave tests only
node --test packages/kernel/tests/wave4-frontend.test.cjs
# FULL regression (run from repo root — verified green at 31d6cbf: 122 tests pass)
node --test packages/kernel/tests/wave1-soul.test.cjs packages/kernel/tests/wave2-bridge.test.cjs packages/kernel/tests/wave3-guard-tools.test.cjs packages/kernel/tests/url-landing.test.cjs apps/dashboard/tests/wave1-chat-routes.test.cjs packages/kernel/tests/wave4-frontend.test.cjs
# Frontend rebuild (required after ANY luna-web/src change; ~30s; dist/ is tracked — commit it)
cd /home/jhin/.luna-kernel/packages/kernel/luna-web && corepack pnpm build
```

---

## Task 1 — Bug 10: remove production debug logs from ChatArea

**Files:**
- Modify: `packages/kernel/luna-web/src/components/ChatArea.svelte` (lines 328, 335, 359, 370, 638, 659, 665, 686, 1049, 1138)
- Test: `packages/kernel/tests/wave4-frontend.test.cjs` (new file — this task creates it)

- [ ] **T1.1. Write the failing content-assertion test**

Create `packages/kernel/tests/wave4-frontend.test.cjs` with this header and the T1 block (match the existing wave-test style: `'use strict'`, `node:test`, `node:assert`):

```js
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
```

Run `node --test packages/kernel/tests/wave4-frontend.test.cjs` → FAILS (all six assertions trip on current code).

- [ ] **T1.2. Delete the ten debug log statements**

In `ChatArea.svelte`, delete EXACTLY these lines (current line numbers; each is a single self-contained `console.log(...)` statement):
1. `:328` — `console.log('[SSE] Ignoring stale event from previous message:', event.type, event.messageId);`
2. `:335` — `console.log('[SSE] Delaying response event until user message is added:', event.type);`
3. `:359` — `console.log('[SSE] Deduplicated:', event.type, event.tool || '', event.id || '');`
4. `:370` — `console.log('[SSE]', event.type, event.text ? event.text.substring(0, 80) : '', event.tool || '');` (the cited per-event dump; also delete its now-orphaned comment `:369` `// v4.0-debug: Log every SSE event for debugging`)
5. `:638` — `console.log('[done] finalResponse length:', finalResponse?.length, 'content:', finalResponse?.substring(0, 100));`
6. `:659` — `console.log('[DEBUG-LUNA] done event text already rendered — skipping duplicate message but releasing input');`
7. `:665` — `console.log('[done] Replaced leaked wrapper content with clean finalResponse');`
8. `:686` — `console.log('[done] Tools ainda em execução — mantendo isStreaming=true até action_end chegar');`
9. `:1049` — the entire `console.log('[handleSend] START', { ..., stack: new Error().stack?.split('\n').slice(2,5).join(' | ') });` line
10. `:1138` — the entire `console.log('[handleSend] branches', { ... });` line

**What NOT to touch:** every `console.error` and `console.warn` (they are genuine error/warning paths — e.g. `:341`, `:683`, `:700`), the low-frequency operational logs (`[connectSSE]` at `:928/:934`, `[flushResponseBuffer]` at `:81/:95`, `[action_start]` at `:495`, `[PLAN UI]` at `:381`), and `api.js` `startPlanMode` logs (out of the cited scope).

- [ ] **T1.3. Verify + build + regression + commit**

```bash
node --test packages/kernel/tests/wave4-frontend.test.cjs   # T1 green
cd /home/jhin/.luna-kernel/packages/kernel/luna-web && corepack pnpm build
# full regression (see header command) — all suites green
cd /home/jhin/.luna-kernel && git add packages/kernel/luna-web/src/components/ChatArea.svelte packages/kernel/luna-web/dist packages/kernel/tests/wave4-frontend.test.cjs
git commit -m "fix(frontend): remove production debug logs from ChatArea (stack traces on send, per-event SSE dumps)"
```

Manual review checklist (pure wiring task): (a) no `console.log` remains that fires per SSE event or per message send — `grep -n "console.log" packages/kernel/luna-web/src/components/ChatArea.svelte` shows only low-frequency operational logs; (b) no logic was deleted with the logs — the surrounding `if` blocks still return/break correctly (each deleted line was a standalone statement); (c) build succeeded with no new warnings.

---

## Task 2 — Bug 11: OrbBackground resize listener removed in onDestroy

**Files:**
- Modify: `packages/kernel/luna-web/src/components/OrbBackground.svelte` (`:133-144`)
- Test: `packages/kernel/tests/wave4-frontend.test.cjs` (append T2 block)

- [ ] **T2.1. Write the failing test**

```js
// ── T2: OrbBackground resize listener cleanup ────────────────────────────────

test('T2: OrbBackground registers a NAMED resize handler and removes it in onDestroy', () => {
  const src = fs.readFileSync(ORB_BG, 'utf8');
  assert.ok(!src.includes("addEventListener('resize', () =>"), 'anonymous resize listener must be gone');
  assert.ok(src.includes("addEventListener('resize', handleResize)"), 'named handler must be registered');
  assert.ok(src.includes("removeEventListener('resize', handleResize)"), 'handler must be removed in onDestroy');
});
```

Run → FAILS (current code has the anonymous arrow and no `removeEventListener`).

- [ ] **T2.2. Fix the listener lifecycle (`OrbBackground.svelte:133-144`)**

Replace the `onMount`/`onDestroy` block with:

```js
  function handleResize() {
    resize();
    initOrbs();
    initParticles();
  }

  onMount(() => {
    ctx = canvas.getContext('2d');
    resize();
    initOrbs();
    initParticles();
    animate();
    window.addEventListener('resize', handleResize);
  });

  onDestroy(() => {
    cancelAnimationFrame(animationId);
    window.removeEventListener('resize', handleResize);
  });
```

**What NOT to touch:** `resize`, `initOrbs`, `initParticles`, `animate`, the canvas markup and styles.

- [ ] **T2.3. Verify + build + regression + commit**

```bash
node --test packages/kernel/tests/wave4-frontend.test.cjs   # T1+T2 green
cd /home/jhin/.luna-kernel/packages/kernel/luna-web && corepack pnpm build
# full regression — all green
cd /home/jhin/.luna-kernel && git add packages/kernel/luna-web/src/components/OrbBackground.svelte packages/kernel/luna-web/dist packages/kernel/tests/wave4-frontend.test.cjs
git commit -m "fix(frontend): remove OrbBackground resize listener in onDestroy - no leak on session switches"
```

Manual review checklist: (a) `removeEventListener` references the SAME function reference that was added (named `handleResize` — anonymous arrows can never be removed); (b) `handleResize` body is identical to the old anonymous arrow body; (c) build clean.

---

## Task 3 — Bug 7: processedEventIds eviction trims to 80% instead of deleting one entry

**Files:**
- New: `packages/kernel/luna-web/src/lib/evictSet.js` (pure, additive)
- Modify: `packages/kernel/luna-web/src/components/ChatArea.svelte` (`:364-367`, import at `:6`)
- Test: `packages/kernel/tests/wave4-frontend.test.cjs` (append T3 block)

- [ ] **T3.1. Write the failing test**

```js
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
```

Run → FAILS (module doesn't exist yet; `require` throws).

- [ ] **T3.2. Create the pure helper (`packages/kernel/luna-web/src/lib/evictSet.js`)**

```js
// Wave 4 bug 7: bounded-set eviction policy.
// The old inline code deleted exactly ONE oldest entry when the set exceeded
// the cap, so a set at 5001 entries stayed ~5000 forever (one add, one delete
// per event — the cap never actually shrank the working set and every event
// paid a delete). Trim to 80% of the cap in one pass instead.
export function evictOldestEntries(set, maxSize, trimTo = Math.floor(maxSize * 0.8)) {
  if (set.size <= maxSize) return 0;
  const excess = set.size - trimTo;
  let removed = 0;
  const iter = set.values(); // insertion order — oldest first
  for (let i = 0; i < excess; i++) {
    const { value, done } = iter.next();
    if (done) break;
    set.delete(value);
    removed++;
  }
  return removed;
}
```

- [ ] **T3.3. Wire it into ChatArea (`:364-367`)**

1. Add the import next to the other lib import at `:6`:
   ```js
   import { evictOldestEntries } from '../lib/evictSet.js';
   ```
2. Replace the inline eviction block:
   ```js
   // Limit set size to prevent memory leaks — increased to 5000 for long sessions
   if (processedEventIds.size > 5000) {
     const iter = processedEventIds.values();
     processedEventIds.delete(iter.next().value);
   }
   ```
   with:
   ```js
   // Limit set size to prevent memory leaks — Wave 4: trim to 80% in one pass
   evictOldestEntries(processedEventIds, 5000);
   ```

**What NOT to touch:** the `flushedContentHashes` eviction at `:102-105` (same one-entry shape, but NOT one of the 11 cited bugs — leave for a future wave), the dedup logic itself.

- [ ] **T3.4. Verify + build + regression + commit**

```bash
node --test packages/kernel/tests/wave4-frontend.test.cjs   # T1-T3 green
cd /home/jhin/.luna-kernel/packages/kernel/luna-web && corepack pnpm build
# full regression — all green
cd /home/jhin/.luna-kernel && git add packages/kernel/luna-web/src/lib/evictSet.js packages/kernel/luna-web/src/components/ChatArea.svelte packages/kernel/luna-web/dist packages/kernel/tests/wave4-frontend.test.cjs
git commit -m "fix(frontend): processedEventIds eviction trims to 80% of cap instead of deleting a single entry"
```

---

## Task 4 — Bug 8: debounce markdown render/highlight + hoist marked config off the global instance

**Files:**
- New: `packages/kernel/luna-web/src/lib/debounce.js` (pure, additive)
- Modify: `packages/kernel/luna-web/src/components/AssistantMessage.svelte` (`:1-5` imports, new module script, `:52-58` marked.use removal, `:60-74` renderMarkdown, `:121-127` lifecycle/reactive blocks, `:147` markup)
- Test: `packages/kernel/tests/wave4-frontend.test.cjs` (append T4 block)

**Problem (verified):** `marked.use()` at `:52-58` runs per component INSTANCE and mutates the global `marked` config (N mounted messages → N mutations). `{@html renderMarkdown(content)}` at `:147` re-parses the FULL accumulated text on every streaming delta, and `:125-127` re-highlights every code block per delta — O(n²) work per message.

**Fix shape:** a single module-level `Marked` instance (Svelte `<script context="module">` runs once per module, not per instance), and a 120ms debounced render scheduler: while `isStreaming` is true, renders coalesce; when streaming ends (or the message is historical), render immediately so final content is never delayed.

- [ ] **T4.1. Write the failing test**

```js
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
  t.fireNext = () => { throw new Error('nothing may remain armed'); };
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

test('T4: AssistantMessage uses a module-scope Marked instance, not per-instance marked.use', () => {
  const src = fs.readFileSync(ASSISTANT_MSG, 'utf8');
  assert.ok(!src.includes('marked.use('), 'per-instance global marked.use() must be gone');
  assert.ok(src.includes('<script context="module">'), 'renderer config must move to module scope');
  assert.ok(src.includes('createDebouncedScheduler'), 'render must go through the debounced scheduler');
});
```

Run → FAILS (module missing).

- [ ] **T4.2. Create the scheduler (`packages/kernel/luna-web/src/lib/debounce.js`)**

```js
// Wave 4 bug 8: trailing-edge debounce with an immediate-flush escape hatch.
// Timer functions are injectable so the policy is testable under node --test.
export function createDebouncedScheduler(fn, waitMs, { setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
  let timer = null;
  return {
    schedule(immediate = false) {
      if (immediate) {
        if (timer) { clearTimeoutFn(timer); timer = null; }
        fn();
        return;
      }
      if (timer) return; // a run is already armed — it will pick up the latest state
      timer = setTimeoutFn(() => { timer = null; fn(); }, waitMs);
    },
    cancel() {
      if (timer) { clearTimeoutFn(timer); timer = null; }
    },
    get pending() { return timer !== null; },
  };
}
```

- [ ] **T4.3. Rewrite the AssistantMessage render pipeline**

1. Add a module script ABOVE the existing `<script>` (it becomes the first element in the file), moving the renderer config there:
   ```svelte
   <script context="module">
     import { Marked } from 'marked';

     // Wave 4 bug 8: ONE Marked instance per module — the old per-instance
     // marked.use() mutated global config once per mounted message.
     const lunaRenderer = {
       code(token) {
         const code = token.text;
         const language = token.lang || '';
         const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
         return `<div class="code-block-wrapper">
           <div class="code-header">
             <span class="code-lang">${language || 'text'}</span>
             <button class="copy-btn" data-code="${encodeURIComponent(code)}">Copiar</button>
           </div>
           <pre><code class="hljs ${language ? 'language-' + language : ''}">${escaped}</code></pre>
         </div>`;
       },
       codespan(token) {
         const code = token.text;
         const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
         return `<code class="inline-code">${escaped}</code>`;
       }
     };

     const lunaMarked = new Marked({
       renderer: lunaRenderer,
       gfm: true,
       breaks: false,
       headerIds: false,
       mangle: false
     });
   </script>
   ```
   (Options kept VERBATIM from the current `marked.use` call — zero behavior change.)
2. In the instance `<script>`: remove `import { marked } from 'marked';` (`:3`), add `import { createDebouncedScheduler } from '../lib/debounce.js';`, and DELETE the entire `const lunaRenderer = {...}` block (`:30-50`) and the `marked.use({...})` call (`:52-58`).
3. Change `renderMarkdown` (`:60-74`) to use the module instance: replace `let html = marked.parse(working, { async: false });` with `let html = lunaMarked.parse(working, { async: false });`.
4. Replace the reactive highlight block (`:125-127`) and add the scheduler + render state. After the `let contentEl; ...` declarations (`:26-28`) add:
   ```js
   let renderedHtml = content ? renderMarkdown(content) : '';

   // Wave 4 bug 8: coalesce render+highlight during streaming (one pass per
   // 120ms instead of one per delta); render immediately when not streaming
   // so final/historical content is never delayed.
   const renderScheduler = createDebouncedScheduler(() => {
     renderedHtml = renderMarkdown(content);
     highlightCode();
   }, 120);

   $: scheduleRender(content, isStreaming);

   function scheduleRender(_content, streaming) {
     renderScheduler.schedule(!streaming);
   }
   ```
   and DELETE the old block:
   ```js
   $: if (content) {
     highlightCode();
   }
   ```
   Keep `onMount(() => { highlightCode(); });` (`:121-123`) unchanged (initial highlight for the eager first render).
5. Markup (`:147`): replace `{@html renderMarkdown(content)}` with `{@html renderedHtml}`.

**Why this is safe:** historical messages mount with `isStreaming === false` → `scheduleRender` runs the immediate path on mount, and `renderedHtml` is also pre-filled at declaration — first paint identical to today. During streaming only the actively-growing message's `content` changes (per-instance reactivity), so only it debounces; when `isStreaming` flips false the immediate path renders the final text synchronously. `renderedHtml = ...` inside the scheduler closure is a compiled Svelte assignment — reactivity fires normally.

**What NOT to touch:** `highlightCode`, `handleCopy`, `copyMessage`, the personality-detection reactive block (`:14-24`), all styles.

- [ ] **T4.4. Verify + build + regression + commit**

```bash
node --test packages/kernel/tests/wave4-frontend.test.cjs   # T1-T4 green
cd /home/jhin/.luna-kernel/packages/kernel/luna-web && corepack pnpm build
# full regression — all green
cd /home/jhin/.luna-kernel && git add packages/kernel/luna-web/src/lib/debounce.js packages/kernel/luna-web/src/components/AssistantMessage.svelte packages/kernel/luna-web/dist packages/kernel/tests/wave4-frontend.test.cjs
git commit -m "fix(frontend): debounce markdown render/highlight during streaming, hoist marked config to module scope"
```

Manual review checklist: (a) streaming a long markdown response re-parses at most ~8×/s instead of per delta; (b) final render is synchronous when streaming ends (no stuck partial render); (c) code blocks still highlight (scheduler calls `highlightCode` after each render, `onMount` covers the initial paint); (d) two mounted messages no longer double-apply `marked.use`.

---

## Task 5 — Bug 9: 401 handler shows the login screen instead of reloading the page

**Files:**
- New: `packages/kernel/luna-web/src/lib/authGuard.js` (pure, additive)
- Modify: `packages/kernel/luna-web/src/api.js` (`:1` import, `:427-448` monkey-patch)
- Test: `packages/kernel/tests/wave4-frontend.test.cjs` (append T5 block)

**Problem (verified):** the `window.fetch` monkey-patch calls `window.location.reload()` (`:442`) on ANY 401 while a token exists — mid-stream this kills the SSE connection and wipes all client state with zero warning. `App.svelte:220/295` already renders `<LoginPage />` reactively whenever the `user` store is null — so clearing the token and setting `user` to null reaches the same end state WITHOUT a reload.

- [ ] **T5.1. Write the failing test**

```js
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
});

test('T5: api.js 401 handler clears the session reactively instead of reloading', () => {
  const src = fs.readFileSync(API_JS, 'utf8');
  assert.ok(!src.includes('window.location.reload'), 'page reload on 401 must be gone');
  assert.ok(!src.includes('__luna401handled'), 'reload debounce flag must be gone');
  assert.ok(src.includes('shouldForceLogout'), 'decision must go through the pure helper');
  assert.ok(src.includes('user.set(null)'), 'must show the login screen via the user store');
});
```

Run → FAILS (module missing).

- [ ] **T5.2. Create the decision helper (`packages/kernel/luna-web/src/lib/authGuard.js`)**

```js
// Wave 4 bug 9: pure 401 policy. A 401 only means "session expired" when we
// actually presented a token and the endpoint is not the login attempt itself.
export function shouldForceLogout({ status, url = '', hasToken }) {
  if (status !== 401 || !hasToken) return false;
  if (url && url.includes('/api/auth/login')) return false;
  return true;
}
```

- [ ] **T5.3. Rewire the monkey-patch (`api.js`)**

1. Extend the store import at `:1` and add the helper import:
   ```js
   import { connectionStatus, isStreaming, user } from './stores.js';
   import { shouldForceLogout } from './lib/authGuard.js';
   ```
2. Replace the whole global-401 block (`:427-448`) with:
   ```js
   // Global 401 handler: intercept fetch responses and clear expired tokens.
   // Wave 4 bug 9: NO window.location.reload() — a reload killed in-flight SSE
   // streams and wiped client state without warning. Clearing the user store
   // makes App.svelte show the login screen reactively; chat state in stores
   // survives for the next login.
   const originalFetch = window.fetch;
   window.fetch = async function(...args) {
     const res = await originalFetch.apply(this, args);
     const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
     if (shouldForceLogout({ status: res.status, url, hasToken: !!localStorage.getItem('luna_token') })) {
       localStorage.removeItem('luna_token');
       user.set(null);
       console.warn('[auth] Sessão expirada (401). Faça login novamente.');
     }
     return res;
   };
   ```

**What NOT to touch:** `fetchMe` (`:406-425` — already handles its own 401), every other export.

- [ ] **T5.4. Verify + build + regression + commit**

```bash
node --test packages/kernel/tests/wave4-frontend.test.cjs   # T1-T5 green
cd /home/jhin/.luna-kernel/packages/kernel/luna-web && corepack pnpm build
# full regression — all green
cd /home/jhin/.luna-kernel && git add packages/kernel/luna-web/src/lib/authGuard.js packages/kernel/luna-web/src/api.js packages/kernel/luna-web/dist packages/kernel/tests/wave4-frontend.test.cjs
git commit -m "fix(frontend): 401 handler shows login screen instead of reloading the page mid-stream"
```

Manual review checklist: (a) with an expired token, the next API call flips the UI to `<LoginPage />` without a reload (verify in DevTools: no navigation, `luna_token` removed from localStorage); (b) a failed login attempt (401 on `/api/auth/login`) does NOT log the user out — the login form shows its own error; (c) EventSource traffic is unaffected (it never used `window.fetch`).

---

## Task 6 — Bugs 3+5 (grouped, same class): SSEManager cancellable reconnect timer + lastMessageCount session reset

**Grouping rationale:** both bugs live in `SSEManager` in `api.js` (reconnect backoff at `:159`; session state at `:33/:50-87/:96-112`) and interact — the zombie timer is exactly what would resurrect a connection with stale session state. The `new SSEManager()`-per-reconnect half of bug 3 is the one-line `ChatArea.svelte:954-955` change included here.

**Files:**
- Modify: `packages/kernel/luna-web/src/api.js` (`:34` constructor, `:96-112` connect entry, `:159` reconnect timer, `:168-180` disconnect)
- Modify: `packages/kernel/luna-web/src/components/ChatArea.svelte` (`:954-955` — reuse the manager)
- Test: `packages/kernel/tests/wave4-frontend.test.cjs` (append T6 block)

- [ ] **T6.1. Write the failing tests**

These tests drive the REAL `SSEManager` under node with browser stubs (verified working: `require('../luna-web/src/api.js')` loads with `window`/`localStorage` stubs; the module only touches `window.fetch` at import time):

```js
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
```

Run → the bug-5 test, both bug-3 tests and the ChatArea assertion FAIL on current code. (Note: the third test passes vacuously pre-fix only if the timer already fired inside 50ms — it fires at ≤5ms and pre-fix DOES create a new EventSource, so it fails deterministically: pre-fix `connect()` re-arms and resurrects.)

- [ ] **T6.2. Store and cancel the reconnect timer (`api.js`)**

1. Constructor (`:19-34`): add `this.reconnectTimer = null;` after `this.fallbackTimer = null;`.
2. `connect()` entry — after the duplicate-connection guard (`:99-102`) and before `if (this.eventSource) { ... this.disconnect(); }`, add:
   ```js
   // Wave 4 bug 3: never let an older backoff timer fire into a new connection
   if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
   ```
3. Session-switch reset (bug 5) — replace `this.currentSessionId = sessionId;` (`:108`) with:
   ```js
   // Wave 4 bug 5: a new session must not slice its history with the previous
   // session's message count (fallback polling starts clean).
   if (this.currentSessionId !== sessionId) {
     this.lastMessageCount = 0;
   }
   this.currentSessionId = sessionId;
   ```
4. Reconnect timer (`:159`) — replace `setTimeout(() => this.connect(sessionId, onEvent), delay);` with:
   ```js
   this.reconnectTimer = setTimeout(() => {
     this.reconnectTimer = null;
     // Wave 4 bug 3: disconnect() may have run while this timer was pending —
     // never resurrect an intentionally closed connection.
     if (this.isIntentionallyClosed || this.gracefulClose) return;
     this.connect(sessionId, onEvent);
   }, delay);
   ```
5. `disconnect()` (`:168-180`) — add at the top, right after `this.onEventCallback = null;`:
   ```js
   if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
   ```

- [ ] **T6.3. Reuse the manager in ChatArea (`:954-955`)**

Replace:
```js
    sseManager.disconnect();
    sseManager = new SSEManager();
```
with:
```js
    // Wave 4 bug 3: reuse the manager — disconnect() now cancels every pending
    // timer, so discarding the instance (which orphaned its backoff timer) is
    // no longer needed and would reintroduce the zombie.
    sseManager.disconnect();
```

**What NOT to touch:** the backoff delay math (`:156`), the max-attempts error event (`:143-152`), `_startFallbackPolling`/`_stopFallbackPolling` logic, the PT-BR error string at `:149`.

- [ ] **T6.4. Verify + build + regression + commit**

```bash
node --test packages/kernel/tests/wave4-frontend.test.cjs   # T1-T6 green
cd /home/jhin/.luna-kernel/packages/kernel/luna-web && corepack pnpm build
# full regression — all green
cd /home/jhin/.luna-kernel && git add packages/kernel/luna-web/src/api.js packages/kernel/luna-web/src/components/ChatArea.svelte packages/kernel/luna-web/dist packages/kernel/tests/wave4-frontend.test.cjs
git commit -m "fix(frontend): cancellable SSE reconnect timer + lastMessageCount reset on session switch - no zombie reconnects"
```

Manual review checklist: (a) disconnecting during a backoff window can never reopen the stream (two independent guards: cancelled timer + flag check inside the callback); (b) rapid session switches (sidebar clicks) leave exactly one EventSource; (c) fallback polling on a switched session starts from the current history length, not the old session's count.

---

## Task 7 — Bugs 1+2 (grouped, same code site): tool timer registry — 60s timeout fails stuck tools, all timers cancelled on reconnect

**Grouping rationale:** bugs 1 (stuck "running" cards / dead `TOOL_TIMEOUT_MS`) and 2 (`setInterval` leak / map reset without clearing) live in the exact same tool-card timer code: `action_start` (`ChatArea.svelte:519-531`), `action_end` (`:557-568`), the reconnect reset (`:949-951`) and `onDestroy` (`:1455-1459`). One registry owns both the per-tool UI interval and the new watchdog timeout, so every lifecycle edge (end, timeout, reconnect, destroy) cancels everything.

**Files:**
- New: `packages/kernel/luna-web/src/lib/toolTimers.js` (pure, additive)
- Modify: `packages/kernel/luna-web/src/components/ChatArea.svelte` (`:6` import, `:23-25` + `:35` declarations, `:518-531` action_start timer, `:557-568` action_end stop, `:949-951` reconnect reset, `:1455-1459` onDestroy)
- Test: `packages/kernel/tests/wave4-frontend.test.cjs` (append T7 block)

- [ ] **T7.1. Write the failing tests**

```js
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
});
```

Run → FAILS (module missing).

- [ ] **T7.2. Create the registry (`packages/kernel/luna-web/src/lib/toolTimers.js`)**

```js
// Wave 4 bugs 1+2: one registry owns every per-tool UI interval (the 100ms
// duration ticker) and watchdog timeout (TOOL_TIMEOUT_MS). The old code kept
// bare interval ids in a Map that was REPLACED on reconnect without clearing —
// every reconnect leaked all running intervals — and TOOL_TIMEOUT_MS was dead
// code, so a tool whose action_end never arrived spun "running" forever.
export function createToolTimerRegistry({
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  nowFn = Date.now,
} = {}) {
  const intervals = new Map(); // toolId -> { intervalId, startTime }
  const timeouts = new Map();  // toolId -> timeoutId

  function stop(toolId) {
    const t = intervals.get(toolId);
    if (t) { clearIntervalFn(t.intervalId); intervals.delete(toolId); }
    const to = timeouts.get(toolId);
    if (to) { clearTimeoutFn(to); timeouts.delete(toolId); }
    return t ? (nowFn() - t.startTime) / 1000 : null;
  }

  function start(toolId, { onTick, onTimeout, intervalMs = 100, timeoutMs = 60000 } = {}) {
    stop(toolId); // never stack two lifecycles on the same card
    const startTime = nowFn();
    const intervalId = setIntervalFn(() => {
      if (onTick) onTick((nowFn() - startTime) / 1000);
    }, intervalMs);
    const timeoutId = setTimeoutFn(() => {
      // watchdog wins: kill the UI ticker, then report the stuck tool
      const t = intervals.get(toolId);
      if (t) { clearIntervalFn(t.intervalId); intervals.delete(toolId); }
      timeouts.delete(toolId);
      if (onTimeout) onTimeout(toolId);
    }, timeoutMs);
    intervals.set(toolId, { intervalId, startTime });
    timeouts.set(toolId, timeoutId);
    return startTime;
  }

  function clearAll() {
    for (const { intervalId } of intervals.values()) clearIntervalFn(intervalId);
    for (const timeoutId of timeouts.values()) clearTimeoutFn(timeoutId);
    intervals.clear();
    timeouts.clear();
  }

  return {
    start,
    stop,
    clearAll,
    has: (toolId) => intervals.has(toolId) || timeouts.has(toolId),
    get size() { return intervals.size; },
  };
}
```

- [ ] **T7.3. Rewire ChatArea**

1. Import (`:6` area): `import { createToolTimerRegistry } from '../lib/toolTimers.js';`
2. Declarations: delete `let toolTimeoutTimers = new Map(); // toolName -> timeout timer id` (`:24`) and `let runningToolTimers = new Map(); // v9.4-fix: toolId -> { intervalId, startTime } for real-time execution timer` (`:35`). Keep `const TOOL_TIMEOUT_MS = 60000; // 60s timeout for any tool` (`:25`) — it is now USED. Add after it:
   ```js
   const toolTimers = createToolTimerRegistry(); // Wave 4 bugs 1+2: UI tickers + stuck-tool watchdogs
   const timedOutToolIds = new Set(); // cards failed by the watchdog — action_end must not double-decrement
   ```
3. `action_start` (`:518-531`) — replace the whole `// v9.4-fix: Start real-time execution timer` block (the `timerStart`/`setInterval`/`runningToolTimers.set`) with:
   ```js
   // Wave 4 bugs 1+2: UI ticker + watchdog. If action_end never arrives the
   // card is marked failed instead of spinning "running" forever.
   toolTimers.start(toolId, {
     timeoutMs: TOOL_TIMEOUT_MS,
     onTick: (elapsedSec) => {
       const elapsed = elapsedSec.toFixed(1);
       mascotMessage.set(`${event.tool || 'Tool'}... ${elapsed}s`);
       messages.update(msgs => {
         const toolMsg = msgs.find(m => m.id === toolId);
         if (toolMsg && toolMsg.status === 'running') {
           return msgs.map(m => m.id === toolId ? { ...m, duration: parseFloat(elapsed) } : m);
         }
         return msgs;
       });
     },
     onTimeout: (timedOutToolId) => {
       timedOutToolIds.add(timedOutToolId);
       messages.update(msgs => msgs.map(m =>
         m.id === timedOutToolId && m.status === 'running'
           ? { ...m, status: 'failed', result: { success: false, error: `Tool expirou após ${TOOL_TIMEOUT_MS / 1000}s sem resposta do servidor.` } }
           : m
       ));
       pendingToolCount = Math.max(0, pendingToolCount - 1);
       if (pendingToolCount <= 0) {
         mascotState.set('idle');
         mascotMessage.set('O que mais posso fazer?');
         isStreaming.set(false);
       }
     },
   });
   ```
4. `action_end` (`:557-568`) — replace the `timerInfo` block:
   ```js
   let duration = 0;
   if (lastTool) {
     const timerInfo = runningToolTimers.get(lastTool.id);
     if (timerInfo) {
       clearInterval(timerInfo.intervalId);
       runningToolTimers.delete(lastTool.id);
       duration = ((Date.now() - timerInfo.startTime) / 1000).toFixed(1);
     } else {
       // Fallback to backend duration if available
       duration = event.result?._meta?.duration ? (event.result._meta.duration / 1000).toFixed(1) : 0;
     }
   }
   ```
   with:
   ```js
   let duration = 0;
   if (lastTool) {
     const elapsed = toolTimers.stop(lastTool.id); // cancels interval AND watchdog
     duration = elapsed !== null
       ? elapsed.toFixed(1)
       : (event.result?._meta?.duration ? (event.result._meta.duration / 1000).toFixed(1) : 0);
   }
   ```
   (If the watchdog already fired, `stop` returns null and the card keeps its `failed` status — `action_end` for an already-failed card is a no-op update because its `status` is no longer `running`; the existing map at `:574-585` still applies the result, which is correct: late truth beats the timeout guess.)

   Then fix the double-decrement: the watchdog already decremented `pendingToolCount` for a timed-out card, so `action_end` must not decrement it again (a second running tool would otherwise release the input early). Replace the existing decrement block (`:587-595`):
   ```js
   // v9.3-fix: Decrement and check ONLY current turn's tools
   pendingToolCount = Math.max(0, pendingToolCount - 1);
   if (pendingToolCount <= 0) {
   ```
   with:
   ```js
   // v9.3-fix: Decrement and check ONLY current turn's tools
   // Wave 4: a watchdog-timed-out card already decremented the count.
   const wasTimedOut = lastTool ? timedOutToolIds.delete(lastTool.id) : false;
   if (!wasTimedOut) {
     pendingToolCount = Math.max(0, pendingToolCount - 1);
   }
   if (pendingToolCount <= 0) {
   ```
5. Reconnect reset (`:949-951`) — replace:
   ```js
   toolStartTimes = new Map();
   toolTimeoutTimers = new Map();
   runningToolTimers = new Map();
   ```
   with:
   ```js
   toolStartTimes = new Map();
   toolTimers.clearAll(); // Wave 4 bug 2: cancel intervals AND watchdogs from the previous connection
   timedOutToolIds.clear();
   ```
6. `onDestroy` (`:1455-1459`) — replace the `runningToolTimers` loop:
   ```js
   onDestroy(() => {
     for (const { intervalId } of runningToolTimers.values()) {
       clearInterval(intervalId);
     }
     runningToolTimers.clear();
     sseManager.disconnect();
     stopHeartbeat();
     mascotState.set('sleep');
   });
   ```
   with:
   ```js
   onDestroy(() => {
     toolTimers.clearAll();
     sseManager.disconnect();
     stopHeartbeat();
     mascotState.set('sleep');
   });
   ```

**What NOT to touch:** `toolStartTimes` (plain timestamps, deleted on `action_end` at `:569`, reset on reconnect — no timer leak), the `done`-handler stuck-tool check at `:679-690` (uses `toolStartTimes` only), `progressBuffers` (rAF-based, self-draining), the tool-card markup in `ToolCard.svelte` (`status: 'failed'` already renders an error badge — `:49,84`).

- [ ] **T7.4. Verify + build + regression + commit**

```bash
node --test packages/kernel/tests/wave4-frontend.test.cjs   # T1-T7 green
cd /home/jhin/.luna-kernel/packages/kernel/luna-web && corepack pnpm build
# full regression — all green
cd /home/jhin/.luna-kernel && git add packages/kernel/luna-web/src/lib/toolTimers.js packages/kernel/luna-web/src/components/ChatArea.svelte packages/kernel/luna-web/dist packages/kernel/tests/wave4-frontend.test.cjs
git commit -m "fix(frontend): tool timer registry - 60s watchdog fails stuck tools, all timers cancelled on reconnect"
```

Manual review checklist: (a) a tool that never gets `action_end` flips to a red "failed" badge with the PT-BR timeout message after 60s and the input unlocks; (b) normal tools show the same live duration ticker as before (100ms cadence, `mascotMessage` elapsed seconds); (c) switching sessions mid-tool leaves zero running intervals (DevTools: no mascot timer updates after switch); (d) `TOOL_TIMEOUT_MS` is referenced by the wiring (no longer dead code).

---

## Task 8 — Bug 4: call `/api/chat/ack` so the backend ledger stops replaying old events

**Files:**
- New: `packages/kernel/luna-web/src/lib/ackBatcher.js` (pure, additive)
- Modify: `packages/kernel/luna-web/src/api.js` (new `ackEvents` export, after `cancelStream` at `:240`)
- Modify: `packages/kernel/luna-web/src/components/ChatArea.svelte` (`:5-6` imports, batcher declaration, `:316-319` ack push in handleEvent, `:941` reset on reconnect, `:1455-1463` flush on destroy)
- Test: `packages/kernel/tests/wave4-frontend.test.cjs` (append T8 block)

**Verified server contract (no backend change needed):** `POST /api/chat/ack` (`apps/dashboard/luna-chat-routes.js:714-745`) accepts `{ sessionId, eventIds: [...] }`, removes those ids from `session.eventLedger` and persists. Best-effort semantics are safe: if an ack is lost, the ledger's 200-entry cap + frontend `processedEventIds` dedup remains the safety net (today's behavior).

**Design:** ack every backend event the frontend RECEIVES (processed or deduped — both prove delivery), batched: one POST per second at most, or immediately at 100 ids. Only ids matching the backend ledger id shapes (`ev-*`, `done-*`, `err-*` — see `luna-chat-routes.js:516,535,554`) are acked, so local synthetic ids never poison `lastAckedEventId`.

- [ ] **T8.1. Write the failing tests**

```js
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
```

Run → FAILS (module + export missing). Note: `fakeTimer` is the helper already defined in the T4 block — reuse it. The T8 `...t` spread passes its `setTimeoutFn`/`clearTimeoutFn` into the batcher, which (per T8.2) uses the same one-shot-timer parameter names, so ONE fake drives both the T4 and T8 tests.

- [ ] **T8.2. Create the batcher (`packages/kernel/luna-web/src/lib/ackBatcher.js`)**

```js
// Wave 4 bug 4: batch event acknowledgements — at most one POST per interval,
// or an immediate flush when the batch fills. One-shot timer (re-armed per
// flush) so reset() has exactly one timer to cancel.
export function createAckBatcher(flushFn, {
  intervalMs = 1000,
  maxBatch = 100,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  let pending = [];
  let timer = null;

  function flush() {
    if (timer) { clearTimeoutFn(timer); timer = null; }
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    flushFn(batch);
  }

  return {
    push(id) {
      if (!id) return;
      pending.push(id);
      if (pending.length >= maxBatch) { flush(); return; }
      if (!timer) timer = setTimeoutFn(flush, intervalMs);
    },
    flush,
    reset() {
      pending = [];
      if (timer) { clearTimeoutFn(timer); timer = null; }
    },
    get size() { return pending.length; },
  };
}
```

- [ ] **T8.3. Add `ackEvents` to api.js (after `cancelStream`, `:240`)**

```js
// Wave 4 bug 4: acknowledge delivered SSE events so the backend event ledger
// (cap 200) is pruned instead of replaying every event on each reconnect.
// Best-effort: failures are swallowed — the ledger cap + frontend dedup is
// the safety net.
export async function ackEvents(sessionId, eventIds) {
  if (!sessionId || !Array.isArray(eventIds) || eventIds.length === 0) return;
  try {
    await fetch('/api/chat/ack', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ sessionId, eventIds })
    });
  } catch {
    // best-effort — the next reconnect's replay is handled by frontend dedup
  }
}
```

- [ ] **T8.4. Wire the batcher into ChatArea**

1. Imports: add `ackEvents` to the api.js import list (`:5`) and `import { createAckBatcher } from '../lib/ackBatcher.js';` (`:6` area).
2. Declaration (after `:37` `let toolInstanceMap = ...`):
   ```js
   // Wave 4 bug 4: batched acks for backend-ledger events
   const ackBatcher = createAckBatcher((ids) => { if (sessionId) ackEvents(sessionId, ids); });
   ```
3. `handleEvent` — right after the session guard (`:318` `if (event.sessionId && event.sessionId !== sessionId) return;`), before every dedup return path, add:
   ```js
   // Wave 4 bug 4: ack on RECEIPT (processed or deduped — both prove delivery).
   // Only backend ledger id shapes are acked; local synthetic ids are skipped.
   if (event.id && /^(ev|done|err)-\d/.test(event.id)) ackBatcher.push(event.id);
   ```
4. Reconnect (`connectSSE`, after `processedEventIds.clear();` at `:941`):
   ```js
   ackBatcher.reset(); // pending ids belong to the previous connection's session
   ```
5. `onDestroy` (`:1455-1463`): add `ackBatcher.flush();` before `sseManager.disconnect();` (last best-effort ack while `sessionId` is still set).

**What NOT to touch:** the dedup logic, `processedEventIds`, the fallback-polling event shape (its ids ARE ledger ids — acking them is correct), the `/api/chat/ack` route itself.

- [ ] **T8.5. Verify + build + regression + commit**

```bash
node --test packages/kernel/tests/wave4-frontend.test.cjs   # T1-T8 green
cd /home/jhin/.luna-kernel/packages/kernel/luna-web && corepack pnpm build
# full regression — all green
cd /home/jhin/.luna-kernel && git add packages/kernel/luna-web/src/lib/ackBatcher.js packages/kernel/luna-web/src/api.js packages/kernel/luna-web/src/components/ChatArea.svelte packages/kernel/luna-web/dist packages/kernel/tests/wave4-frontend.test.cjs
git commit -m "fix(frontend): call /api/chat/ack on event receipt - backend ledger stops replaying old events on reconnect"
```

Manual review checklist: (a) during a normal turn, DevTools Network shows batched `POST /api/chat/ack` calls (≤1/s); (b) after an ack, a forced reconnect (disable/enable network) does NOT replay the acked events — server logs show `replaying 0 missed events`; (c) ack failures are silent (backend down → no console errors, no UI impact).

---

## Task 9 — Bug 6: forward `action_progress.chunk` end-to-end (live tool output in ToolCard)

> **⚠️ SCOPE GATE — READ FIRST.** Three of the four break points are in `apps/dashboard/` (`luna-chat-routes.js`, `lib/chat-event-dedup.cjs`), which the owner declared OUT OF SCOPE for this wave. Bug 6 CANNOT be fixed anywhere else — verified: the chunk is malformed at the soul (`luna-soul.cjs:4038`, string spread), then collapsed/dropped exclusively in dashboard transport code; the frontend (`ChatArea.svelte:534-541`, `ToolCard.svelte:112-115`) is already correct. Precedent: Wave 1 DID modify `luna-chat-routes.js` (Fixes B1/B2/B3/B5 — comments still in the file) and its regression suite is part of this wave's mandatory runs. **Before executing this task, confirm with the owner that the `apps/dashboard` exclusion does not cover the Luna web transport files. If the owner declines: skip this task entirely, and in Task 10 mark bug 6 as deferred (owner-declined scope) instead of resolved.** All other tasks are independent of this one.

**Files:**
- New: `packages/kernel/lib/progress-event.cjs` (pure, additive — kernel-side, in scope)
- Modify: `packages/kernel/luna-soul.cjs` (`:4038` emitProgress; add the lib require next to the other lib requires at the top of the file — verify the exact require block at execution time)
- Modify (⚠️ scope gate): `apps/dashboard/luna-chat-routes.js` (`:509` dedup check, `:515-527` store picklist, `:621-643` replay serializer, `:667-690` live serializer)
- Test: `packages/kernel/tests/wave4-frontend.test.cjs` (append T9 block)

**Break points (verified at `31d6cbf`):**
1. `luna-soul.cjs:4038` — `emitProgress = (ev) => eventBus.push({ type: 'action_progress', toolInstanceId, tool: parsedAction.tool, ...ev, sessionId })`. Tools call `onProgress(chunkString, streamName)` POSITIONALLY (`luna-tools.cjs:894,1025,1031`), so `ev` is a string and `...ev` spreads it into numeric char keys — NO `chunk` field ever exists.
2. `luna-chat-routes.js:509` — dedup keys `action_progress` by `type:tool:toolInstanceId` (`apps/dashboard/lib/chat-event-dedup.cjs:12-18`), so every chunk after the first for a given tool call is dropped.
3. `luna-chat-routes.js:515-527` — `addMessageToSession` picklist doesn't store `chunk`.
4. `luna-chat-routes.js:621-643` and `:667-690` — SSE serializers (replay + live) don't forward `chunk`.

- [ ] **T9.1. Write the failing tests**

```js
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
```

Run → FAILS (helper missing; soul/routes unchanged).

- [ ] **T9.2. Create the normalizer (`packages/kernel/lib/progress-event.cjs`)**

```js
'use strict';
// Wave 4 bug 6: normalize tool progress payloads. Tools report progress
// positionally — onProgress(chunkString, streamName) — while the SSE pipeline
// needs a named `chunk` field on a plain action_progress event.
function makeProgressEvent({ toolInstanceId, tool, chunk, stream, sessionId } = {}) {
  return {
    type: 'action_progress',
    toolInstanceId,
    tool,
    chunk: typeof chunk === 'string' ? chunk : (chunk == null ? '' : String(chunk)),
    stream: stream || 'stdout',
    sessionId,
  };
}
module.exports = { makeProgressEvent };
```

- [ ] **T9.3. Fix the soul emission (`luna-soul.cjs:4038`)**

1. Add the require next to the other lib requires at the top of `luna-soul.cjs` (find the existing `require('./lib/...')` block — e.g. near the wave-2/3 helper requires):
   ```js
   const { makeProgressEvent } = require('./lib/progress-event.cjs');
   ```
2. Replace:
   ```js
   const emitProgress = (ev) => eventBus.push({ type: 'action_progress', toolInstanceId, tool: parsedAction.tool, ...ev, sessionId });
   ```
   with:
   ```js
   // Wave 4 bug 6: tools call onProgress(chunkString, streamName) positionally —
   // spreading the string produced garbage keys and no chunk field.
   const emitProgress = (chunk, stream) => eventBus.push(makeProgressEvent({ toolInstanceId, tool: parsedAction.tool, chunk, stream, sessionId }));
   ```
   (`emitProgress` is passed as the `onProgress` callback at `:4040` and forwarded to `executeShell` at `:4304` and `:4538` — all call it positionally, so the new two-parameter signature matches every call site. Grep `emitProgress` in the file at execution time and confirm no call site passes an object.)

- [ ] **T9.4. ⚠️ (scope gate) Forward chunk in the dashboard transport**

1. Dedup bypass (`luna-chat-routes.js:509`) — replace:
   ```js
   if (ev.type !== 'done' && emittedEventHashes.has(dedupKey)) {
   ```
   with:
   ```js
   // Wave 4 bug 6: action_progress chunks are an ordered stream — never dedup them
   if (ev.type !== 'done' && ev.type !== 'action_progress' && emittedEventHashes.has(dedupKey)) {
   ```
   (Rationale: the dedup exists for duplicated soul emissions of discrete events; progress chunks are emitted exactly once each by `onProgress`, and the per-`toolInstanceId` key would collapse all of them into the first. `makeEventDedupKey` itself is untouched — existing B1 tests keep passing.)
2. Store picklist (`:515-527`) — add to the `addMessageToSession` object, after `toolInstanceId: ev.toolInstanceId || undefined, // Wave 1 Fix B2`:
   ```js
   chunk: ev.chunk || undefined, // Wave 4 Fix: live tool output
   ```
3. SSE serializers — add in BOTH the replay loop (`:621-643`, after the `toolInstanceId` line `:636`) and the live poll (`:667-690`, after the `toolInstanceId` line `:682`):
   ```js
   if (msg.chunk) eventData.chunk = msg.chunk; // Wave 4 Fix: live tool output
   ```

**What NOT to touch:** `apps/dashboard/lib/chat-event-dedup.cjs` (unchanged — see rationale), the other two stream consumers (`:1190` plan mode, `:1949` compact — they never carry `action_progress`), the `content` computation at `:498-504` (progress events store an empty `content`; the chunk lives in its own field), anything else in `apps/dashboard`.

- [ ] **T9.5. Verify + regression + commit (NO dist rebuild — no luna-web source changed)**

```bash
node --test packages/kernel/tests/wave4-frontend.test.cjs   # T1-T9 green
# full regression — all green (includes apps/dashboard/tests/wave1-chat-routes.test.cjs)
cd /home/jhin/.luna-kernel && git add packages/kernel/lib/progress-event.cjs packages/kernel/luna-soul.cjs apps/dashboard/luna-chat-routes.js packages/kernel/tests/wave4-frontend.test.cjs
git commit -m "fix(transport): forward action_progress chunk end-to-end - live tool output reaches ToolCard"
```

Manual review checklist (owner, after restart): run a shell tool via chat and watch the ToolCard's live output area fill during execution (`ToolCard.svelte:112-115` renders `liveOutput` while `status === 'running'`).

---

## Task 10 — Close the wave in `.brain/bugs.md`

**Files:**
- Modify: `packages/kernel/.brain/bugs.md` (Frontend section `:28-40` → Resolved)

- [ ] **T10.1. Move the 11 items from Open → Resolved**

1. Remove all 11 frontend bullets from `## Open` → `### Frontend (\`luna-web\`)` (`:30-40`). If the section becomes empty, leave the heading with a single line `> (no open frontend bugs)`.
2. Under `## Resolved`, add a new section ABOVE `### Wave 1` (newest first — but note the existing order is Wave 1 → 3 top-down; follow the existing chronological order and append after `### Wave 3` if the file keeps that convention — match whatever ordering the file uses at execution time):
   ```markdown
   ### Wave 4 (2026-07-12) — frontend hygiene

   - [x] 🟡 **Debug logs in production** — removed per-event `[SSE]`/`[done]` dumps and per-send stack-trace/branch logs from ChatArea; warns/errors kept. (`<hash-task1>`; tests `wave4-frontend.test.cjs` T1)
   - [x] 🟡 **Resize listener never removed** — named `handleResize` + `removeEventListener` in `onDestroy` (OrbBackground). (`<hash-task2>`; test T2)
   - [x] 🟡 **`processedEventIds` eviction removed only 1 entry** — `lib/evictSet.js` `evictOldestEntries` trims to 80% of the cap in one pass. (`<hash-task3>`; test T3)
   - [x] 🟡 **Markdown re-parse + highlight per delta** — module-scope `Marked` instance (no more per-instance `marked.use()` global mutation) + 120ms debounced render/highlight during streaming, immediate render when idle (`lib/debounce.js`). (`<hash-task4>`; test T4)
   - [x] 🟡 **`window.fetch` monkey-patch reloaded page on 401** — `lib/authGuard.js` `shouldForceLogout`; token cleared + `user.set(null)` shows the login screen reactively, no reload. (`<hash-task5>`; test T5)
   - [x] 🟠 **Zombie SSE reconnect** — backoff timer stored on `SSEManager.reconnectTimer`, cancelled by `disconnect()`/`connect()`, callback re-checks the closed flags; ChatArea reuses the manager instead of `new SSEManager()` per reconnect. (`<hash-task6>`; test T6)
   - [x] 🟡 **`lastMessageCount` not reset on session switch** — `connect()` resets it when `sessionId` changes; same-session reconnects preserve it. (`<hash-task6>`; test T6)
   - [x] 🟠 **Tool cards stuck "running"** — `lib/toolTimers.js` registry arms a 60s watchdog per tool (`TOOL_TIMEOUT_MS` no longer dead code); on timeout the card is marked failed with a PT-BR message and the input unlocks. (`<hash-task7>`; test T7)
   - [x] 🟠 **`setInterval` leak per tool** — the same registry owns every UI ticker + watchdog; `clearAll()` on reconnect and `onDestroy`. (`<hash-task7>`; test T7)
   - [x] 🟡 **`/api/chat/ack` never called** — `lib/ackBatcher.js` batches acks (1s/100 ids); ChatArea acks every received ledger event id (`ev-*`/`done-*`/`err-*`); backend route already existed and prunes the ledger. (`<hash-task8>`; test T8)
   - [x] 🟡 **`action_progress.chunk` dropped in transport** — `lib/progress-event.cjs` normalizes the soul's positional progress callback (string spread produced garbage keys); chat-routes stores `chunk`, forwards it in both SSE serializers, and stops deduping `action_progress`. (`<hash-task9>`; test T9) — ⚠️ IF TASK 9 WAS SKIPPED (owner declined the dashboard scope), DO NOT add this line; instead leave the bug in Open with the note: `fix verified to require apps/dashboard/luna-chat-routes.js changes (out of scope per owner 2026-07-12); soul-side break point documented at luna-soul.cjs:4038`.
   ```
3. Replace every `<hash-taskN>` placeholder with the actual commit hash from the corresponding task (`git log --oneline -10`).

- [ ] **T10.2. Commit**

```bash
cd /home/jhin/.luna-kernel && git add packages/kernel/.brain/bugs.md
git commit -m "docs(brain): close Wave 4 - 11 frontend hygiene bugs resolved"
```

---

## Out of scope (explicitly NOT in Wave 4)

- **ChatArea decomposition / component registry** — that's Wave 5 modularization.
- **`flushedContentHashes` one-entry eviction** (`ChatArea.svelte:102-105`) — same shape as bug 7 but not one of the 11 cited bugs; trivial follow-up.
- **Other `console.log` sites outside the cited ones** (`api.js` `startPlanMode` `:455/461`, `App.svelte` `:8`, `[connectSSE]`/`[flushResponseBuffer]` operational logs) — low-frequency; not cited.
- **Plan-mode and compact stream consumers** (`luna-chat-routes.js:1190`, `:1949`) — never carry `action_progress`.
- **The remaining Soul/Bridge/Tools open bugs** in `.brain/bugs.md` (silent exits, auto-continue, brace counting, etc.) — other waves.
- **PM2 restarts / runtime smoke** — the owner restarts and validates live himself.

---

## Self-Review

**Coverage (11/11 bugs mapped):** bug 10 → Task 1; bug 11 → Task 2; bug 7 → Task 3; bug 8 → Task 4; bug 9 → Task 5; bugs 3+5 → Task 6 (grouped: same class, interacting state); bugs 1+2 → Task 7 (grouped: same timer code site); bug 4 → Task 8; bug 6 → Task 9 (⚠️ scope gate). No bug dropped; bug 6 is conditionally deferred ONLY if the owner enforces the dashboard exclusion, with the exact deferral instruction in Task 10. ✅

**Confirmed vs drifted:** all 11 bugs confirmed present at `31d6cbf`. Drift corrections applied: ChatArea lives in `src/components/`; eviction at `:364-367` (cited `:358-361`); interval at `:519-531` (cited `:514-525`); reconnect `new SSEManager()` at `:954-955` (cited `:948-949`); stack log at `:1049` (cited `:1043`); `[SSE]` per-event at `:370` (cited `:364`); branches log at `:1138` (cited `:1132`, and it has no stack). Material finding: bug 6's transport is NOT kernel-side as cited — it's `apps/dashboard/luna-chat-routes.js` + the soul emission is malformed upstream (string spread); flagged with a scope gate instead of guessed around. Bug 4's ack route EXISTS server-side (the citation implied uncertainty) — frontend-only fix.

**Ordering rationale:** Tasks 1-2 are pure deletions/wiring (zero logic risk). Tasks 3-5 each introduce one tiny pure module with a mechanical call-site swap. Task 6 changes SSEManager state handling (testable in node with stubs, real failure modes pinned). Task 7 rewires the tool-card hot path — after Task 6 since both touch ChatArea and the timer work is the riskiest frontend change. Task 8 adds a network call (behavior change: ledger pruning) on top of a green suite. Task 9 is last: it carries the scope gate and touches `luna-soul.cjs` (the orchestrator) — landing it last means a skip/revert costs nothing. Task 10 is bookkeeping.

**Risk containment:** six additive modules (`evictSet.js`, `debounce.js`, `authGuard.js`, `toolTimers.js`, `ackBatcher.js` in `luna-web/src/lib/`; `progress-event.cjs` in `packages/kernel/lib/`), all pinned by `node --test` with injected clocks/timers — no real-time sleeps except the T6 zombie test (≤55ms). `require(ESM)` for the frontend modules verified on this box (Node v24.15.0). No new npm deps, no config flags, no PM2 interaction. Every task ships a test that fails on pre-fix code (pure-function tests for the helpers; stub-driven integration for SSEManager/ackEvents; content-assertions for Svelte wiring that can't run under node).

**Verification limits:** no PM2, no live browser — runtime validation (stuck-tool card flipping to failed after 60s, ack batches in Network tab, live tool output streaming into ToolCard, 401 → login screen without reload) is delegated to the owner after he restarts. Behavior changes to flag in the handoff: (1) tools now visibly FAIL after 60s without `action_end` (previously spun forever) — long legitimate tools may show the timeout badge if the backend goes quiet; (2) reconnects stop replaying already-acked events — if a bug ever acks without rendering, events would be lost (mitigated: ack-on-receipt happens before dedup, and the frontend dedup set is cleared per reconnect anyway); (3) 401 no longer reloads — a user staring at an expired session sees the login screen instead of a full refresh.
