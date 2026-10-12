# Wave 2 — Bridge/Stream Correctness Implementation Plan

> **For agentic workers:** Execute fixes A → B → C → D → E sequentially, in this order (safest/most independent first, deepest last). A, B, C touch disjoint regions; D and E both touch `sendMessageStream` and MUST land in order. Each fix: implement → spec review → quality review → commit.

**Goal:** Fix the five bridge/stream bugs registered in `packages/kernel/.brain/bugs.md` (Wave 2): duplicated/triplicated streaming text, parent+child selector duplication, `session` ReferenceError (dead `empty-wait` branch), cross-user extension event theft, DOM poller never stopping (stale events feed the next turn).

**Architecture:** Localized surgical fixes only — no refactors. Where the bridge is untestable as-is, extract PURE helpers into new additive modules (precedent: `apps/dashboard/lib/chat-event-dedup.cjs` from Wave 1) and pin them with `node --test`. NEVER touch PM2 processes — verification is `node --test` only; runtime smoke is left to the owner.

**Tech Stack:** Node 22 (.cjs), Playwright-driven browser, native `node --test`.

**Source of truth for root causes:** `packages/kernel/.brain/bugs.md` (all file:line re-verified against code on 2026-07-12 — citations below are the corrected current line numbers).

**Line-number verification notes (drift corrections):**
- Bug 3: `session` declared at `kimi-bridge.cjs:6002` (inside `if (generic.response ...)` at `:5997`, inside `if (provider !== 'kimi')` at `:5995`); referenced outside scope at `:6044` and `:6046`. Citation was correct.
- Bug 1: shared cursor is `let lastResponse` at `:7399`, seeded in Phase 0 at `:7432`, diffed in `state_change` at `:7531-7600` and in the `response_delta` case at `:7657-7665`. The three producers enqueue at `:5316-5325` (chrome_extension `state_change`), `:5402-5410` (poll `state_change`), `:5507-5517` (dom_observer `response_delta`).
- Bug 5: queue created at `:7200-7201`; Phase 0 at `:7422-7451`; poller-kept-running comment at `:7827-7828`; `completion_candidate` case at `:7669-7682`; `_checkCompletionCandidate` enqueues at `:5696`.

---

## Fix A — `session` ReferenceError → dead `empty-wait` branch (`packages/kernel/kimi-bridge.cjs`)

**Files:**
- Modify: `packages/kernel/kimi-bridge.cjs` (2 spots, ~3 lines)
- Test: `packages/kernel/tests/wave2-bridge.test.cjs`

- [ ] **A1. Hoist the `session` declaration (`:5995-6049`)**

In `_pollThinkingAndResponse`'s `pollWithTimeout`, `const session = userId ? this.userSessions.get(userId) : null;` is declared at `:6002` inside the `if (provider !== 'kimi')` → `if (generic.response || ...)` block, but referenced at `:6044`/`_lastEmptyLayersLogAt` (`:6044-6046`) in the shared empty-extraction tail. For the Kimi provider (the common case), the reference throws `ReferenceError`, the `catch` at `:6050-6052` swallows it and returns `source: 'error'` — the `empty-wait` branch (`:6042-6049`) is dead code and the log throttle never works.

Fix: move the declaration to the TOP of the `try` block of `pollWithTimeout` (before the first extraction layer, ~`:5930` — find the `try {` that opens the body ending at the `:6050` catch), and DELETE the inner `const session` at `:6002` (the inner block then uses the hoisted one; behavior inside the block is unchanged).

**What NOT to touch:** the generic-provider stability heuristic (`:6003-6038`), the `_detectUiState` call at `:6048`, the catch fallback at `:6050-6052`.

- [ ] **A2. Test + commit**

Extract the empty-log throttle as a tiny additive pure helper and pin it: add to the new test file a test that (a) asserts via source inspection that `const session` in `_pollThinkingAndResponse` is declared BEFORE the `if (provider !== 'kimi')` block (read the file, locate the function body, compare offsets — same content-assertion style as wave1 A2), and (b) if a helper is extracted (optional), unit-tests the 5s throttle: first call logs, second within 5s doesn't, after 5s logs again. If no helper is extracted, (a) alone is acceptable — spec reviewer decides.

```bash
git add packages/kernel/kimi-bridge.cjs packages/kernel/tests/wave2-bridge.test.cjs
git commit -m "fix(bridge): hoist session declaration in _pollThinkingAndResponse - restore empty-wait branch"
```

---

## Fix B — Parent+child selector duplication (extension + DOM observer)

**Files:**
- Modify: `packages/kernel/luna-extension/injected.js:34`
- Modify: `packages/kernel/kimi-dom-observer.js:17`
- Test: `packages/kernel/tests/wave2-bridge.test.cjs`

- [ ] **B1. Remove the overlapping parent selector (`injected.js:34`, `kimi-dom-observer.js:17`)**

Both files define `SELECTORS.textContent` (Kimi branch) as:
`'.segment-text, .message-content, .markdown-container, [class*="segment-text"], [class*="message-content"]'`

On Kimi, `.markdown-container` is the PARENT of the text leaf nodes (`.segment-text` / `.message-content` live inside it). `querySelectorAll` matches BOTH, and the consumers concatenate all matched nodes' text — `injected.js:169-173` (`detectStreaming`) and the observer's equivalent — so every paragraph is emitted twice (parent text + child text) in every `stream_state`/observer event. This is one of the direct inputs to the bug-1 duplication (the extension producer's `response` is internally doubled while the poll producer's is not → divergent cursors).

Fix: in BOTH files, drop `.markdown-container` from `textContent`, keeping the leaf selectors:
`'.segment-text, .message-content, [class*="segment-text"], [class*="message-content"]'`

Also CHECK the DeepSeek branch (`injected.js:23`: `'.ds-markdown, .message-content'`): if `.ds-markdown` is nested inside `.message-content` on chat.deepseek.com (verify against the live DOM only if a session is available — otherwise leave a code comment noting the assumption), keep only the leaf. Do NOT change DeepSeek without verification; a comment is enough.

**What NOT to touch:** `assistantSegment`, `codeBlock`, `toolContainer`, `thinking`, button selectors; the `_lastStreamText`/`_lastSentResponse` caching logic in `detectStreaming` (`:154-187`); the observer's `MAX_*` constants.

- [ ] **B2. Test + commit**

Content-assertion test (wave1 A2 style): read both files, extract the `textContent` line, assert it does NOT contain `.markdown-container` and DOES still contain `.segment-text`. This pins the regression without a browser.

```bash
git add packages/kernel/luna-extension/injected.js packages/kernel/kimi-dom-observer.js packages/kernel/tests/wave2-bridge.test.cjs
git commit -m "fix(bridge): drop parent .markdown-container from textContent selectors - stop doubled paragraphs"
```

---

## Fix C — Cross-user extension event theft (`kimi-bridge.cjs` `_consumeExtensionEvents`)

**Files:**
- Modify: `packages/kernel/kimi-bridge.cjs:5172-5277` (function) and `:5301` (call site)
- Test: `packages/kernel/tests/wave2-bridge.test.cjs`

- [ ] **C1. Drain only the buffer that belongs to this poller's page (`:5172-5182`, `:5301`)**

`global.__lunaExtensionEventBuffers` is a `Map<extSessionId, events[]>` populated by `apps/dashboard/luna-extension-handler.cjs:27-34`. Every buffered event carries `url` and `tabUrl` (handler `:149`; extension `background.js:158-159` sets them from the real Chrome tab). The extension `sessionId` (`ext-<timestamp>`, `background.js:76`) has NO relation to the luna `userId`, so the current loop at `:5179-5182` drains ALL buffers for whichever poller runs first — user A's poller steals user B's streamed text/tool events (data leak + cross-session corruption).

Fix:
1. Change the signature to `_consumeExtensionEvents(expectedUrl)` and update the single call site at `:5301` to `this._consumeExtensionEvents(session.page.url())` (inside the existing try — `page.url()` is safe; wrap in its own try/catch defaulting to `''`).
2. Inside the `for (const [sessionId, buf] of buffers)` loop, filter per event: an event belongs to this poller iff `normalizeUrl(raw.tabUrl || raw.url)` equals `normalizeUrl(expectedUrl)` — where `normalizeUrl` strips query string, hash, and trailing slash (same chat thread, tolerant of tracking params).
3. Partition instead of wholesale clear: matching events are consumed and translated (existing switch, `:5183-5271`); non-matching events STAY in the buffer (`buffers.set(sessionId, remaining)`) for their own poller. Keep the 200-event cap behavior on the handler side untouched.
4. Events with NO url info (older extension build): do NOT consume them when more than one buffer exists; when exactly one buffer exists, consume (single-user dev scenario preserved). Log once at debug level.

**What NOT to touch:** the event translation switch (`:5183-5271`), the handler (`luna-extension-handler.cjs`), the extension itself. No new npm deps — implement `normalizeUrl` inline (~5 lines) or as a static method.

- [ ] **C2. Test + commit**

`_consumeExtensionEvents` reads only `global.__lunaExtensionEventBuffers` and `log` — unit-test it directly with `KimiBridge.prototype._consumeExtensionEvents.call({}, url)` after seeding `global.__lunaExtensionEventBuffers` in the test:
- Two buffers (user A tab URL, user B tab URL); consume for A's URL → A's events returned and A's buffer emptied, B's buffer UNTOUCHED.
- URL with tracking query (`?utm=...`) still matches.
- Events without URL + two buffers → none consumed; without URL + one buffer → consumed.
Clean up `global.__lunaExtensionEventBuffers` in `afterEach`.

```bash
git add packages/kernel/kimi-bridge.cjs packages/kernel/tests/wave2-bridge.test.cjs
git commit -m "fix(bridge): filter extension event buffers by tab URL - stop cross-user event theft"
```

---

## Fix D — DOM poller never stops; stale events feed the next turn (`kimi-bridge.cjs`)

**Files:**
- Modify: `packages/kernel/kimi-bridge.cjs` (3 spots: `:7819-7829` finally, `:7355-7356` post-Enter, `:7669-7682` completion case)
- Test: `packages/kernel/tests/wave2-bridge.test.cjs`

- [ ] **D1. Stop the poller when the stream ends (`:7827-7828`)**

The `finally` block deliberately keeps the poller running (v7.0 design, comment at `:7827-7828`). Between turns the poller keeps polling the still-visible PREVIOUS response: `_checkCompletionCandidate`'s state (`session._completionState`, `:5643-5652`) stays hot, so it keeps enqueueing `completion_candidate` (`:5696-5698`) and `state_change` events into an auto-created queue (`_enqueueDomEvent` `:5617-5623`). The next message replaces that queue at `:7201`, BUT the poller (restarted at `:7206`) then spends the whole send-prep window (verifySession → snapshot → fill → Enter, often several seconds) enqueueing events that describe the OLD turn — including a `completion_candidate` that Phase 1 consumes at `:7669` for an instant false completion, and stale `action_detected` from re-detected old JSON blocks.

Fix: in the `finally` block, call `await this._stopDomPoller(userId)` BEFORE clearing `session.processing` (order: stop poller → then `session.processing = false`). `_stopDomPoller` (`:5594-5612`) already exists, is idempotent, and waits ≤2s. Replace the v7.0 comment with one explaining the poller is now bounded to the active stream and restarted per message at `:7206` (`_startDomPoller` early-returns at `:5287` only while active — after stop it restarts cleanly).

**What NOT to touch:** `cancelStream` soft/hard logic, `_checkCompletionCandidate` internals, the queue auto-create fallback.

- [ ] **D2. Purge the queue + completion state right after Enter (`:7355-7356`)**

Belt-and-braces for the prep window (poller restarted at `:7206` runs during prep): immediately after `await this._pressEnterOnInput(inputLocator);` add:
```js
// Wave2-fix: discard everything the poller observed during send-prep —
// it describes the PREVIOUS turn's DOM, not this message.
queue.events.length = 0;
queue.lastReadIndex = 0;
if (session) session._completionState = null;
```
This makes Phase 0 (`:7422-7451`) start from a clean slate.

- [ ] **D3. Ignore premature `completion_candidate` (`:7669-7682`)**

Even with D1+D2, after Enter the OLD response is still on screen and stable; the poller can re-fire a completion candidate before Kimi's new text arrives. In the `case 'completion_candidate':` block, guard FIRST:
```js
if (!lastResponse && !lastThinking) {
  log.info(`[sendMessageStream] Ignoring completion candidate — nothing streamed yet this turn (stale)`);
  break;
}
```
Keep the existing non-Kimi incomplete-JSON guard (`:7675-7679`) after it, unchanged.

- [ ] **D4. Test + commit**

Extract the guard as an additive pure helper `isPrematureCompletion({ lastResponse, lastThinking })` in the new `packages/kernel/lib/stream-completion-guard.cjs` (mirroring `apps/dashboard/lib/chat-event-dedup.cjs`), use it at the D3 site, and unit-test: empty state → premature; any text seen → not premature. Also a content-assertion test that the `finally` block calls `_stopDomPoller`. Run: `node --test packages/kernel/tests/wave2-bridge.test.cjs` — must pass.

```bash
git add packages/kernel/kimi-bridge.cjs packages/kernel/lib/stream-completion-guard.cjs packages/kernel/tests/wave2-bridge.test.cjs
git commit -m "fix(bridge): stop DOM poller after stream, purge stale events on new message, ignore premature completion"
```

---

## Fix E — Duplicated/triplicated streaming text: per-source cursors (`kimi-bridge.cjs`)

**This is the deep fix. Do it last, after A–D have landed (B in particular removes one whole source of producer divergence).**

**Design decision (recommended approach — ONE of the two evaluated):**

The owner's original requirement was "the bridge should wait for the soul to say everything was parsed and is correct before sending to the frontend" (a soul→bridge handshake). Evaluated and REJECTED for Wave 2:

1. The soul already parses authoritatively: the turn ends with a `done` event carrying `finalResponse`, parsed and re-extracted by the bridge (`:7696-7806`) and re-parsed by the soul; the frontend's `done`/`response_detected` path REPLACES the streamed text with the parsed version (forceText replace path, fixed in Wave 1 C1). So the "soul confirms before the user sees the final text" guarantee ALREADY EXISTS at turn end — a handshake would add a second confirmation of the same parse.
2. The actual bug is MID-STREAM garbage: three producers (extension push `:5316`, DOM poll `:5402`, ultra-light observer `:5509`) each emit FULL cumulative text from DIFFERENT extractions (different whitespace, trimming — poll does `.trim()` at `:5960`, different latency), all diffed against ONE shared `lastResponse` cursor (`:7399`, `:7532`, `:7660`). When producer B's full text is not an extension of producer A's last text, `r.slice(lastResponse.length)` emits duplicated or corrupted chunks.
3. A handshake means buffering all deltas server-side + a new soul→bridge protocol + frontend changes, and would kill streaming UX (or double-buffer it) — high risk for zero additional turn-end correctness.

**Recommended fix: per-source cursors with a cross-source prefix-consistency guard**, extracted as a pure, fully unit-testable module. ~40 lines of new pure code + ~30 lines of integration edits. If user-visible duplication persists after this + Fix B ship, the handshake can be reconsidered in a later wave with real evidence.

**Files:**
- New: `packages/kernel/lib/stream-text-cursor.cjs` (pure, additive)
- Modify: `packages/kernel/kimi-bridge.cjs` (`:7399`, `:7515-7667`)
- Test: `packages/kernel/tests/wave2-bridge.test.cjs`

- [ ] **E1. Pure cursor module (`packages/kernel/lib/stream-text-cursor.cjs`)**

```js
'use strict';
// Per-source cumulative-text cursor with cross-source divergence guard.
// Each producer (chrome_extension, dom-structure poll, dom_observer) gets
// its own cursor; deltas are only emitted when the incoming full text is
// consistent with everything already committed to the frontend.
function createResponseCursor() {
  const bySource = new Map(); // source -> last full text seen from that source
  let committed = '';         // text already emitted downstream

  return {
    // Returns { emit: string|null, diverged: boolean }
    next(source, full) {
      if (!full) return { emit: null, diverged: false };
      const key = source || 'unknown';
      const prev = bySource.get(key) || '';
      if (full === prev) return { emit: null, diverged: false };
      // Source shrank/reset (DOM rebuild): move the cursor, emit nothing.
      if (!full.startsWith(prev)) {
        bySource.set(key, full);
        return { emit: null, diverged: false };
      }
      bySource.set(key, full);
      // Cross-source consistency: committed text (trimEnd-tolerant) must be
      // a prefix of this full text, otherwise the producers disagree and
      // emitting would duplicate/corrupt. Swallow and flag.
      const committedTrim = committed.replace(/\s+$/, '');
      if (committed && !full.startsWith(committed) && !full.startsWith(committedTrim)) {
        return { emit: null, diverged: true };
      }
      const base = full.startsWith(committed) ? committed : committedTrim;
      const delta = full.slice(base.length);
      if (!delta) return { emit: null, diverged: false };
      committed += delta;
      return { emit: delta, diverged: false };
    },
    get committed() { return committed; },
  };
}
module.exports = { createResponseCursor };
```
(Implementer may refine naming; keep the semantics exactly: monotonic per source, prefix-guarded across sources, no emit on shrink or divergence.)

- [ ] **E2. Wire into `sendMessageStream` (`:7397-7399`, `:7515-7667`)**

1. At `:7398-7399`, keep `let lastResponse = '';` (still used by completion/final-extraction fallbacks at `:7675`, `:7732-7763`) and ADD `const responseCursor = createResponseCursor();`.
2. In the `state_change` case (`:7530-7601`): replace the `r !== lastResponse` / `r.slice(lastResponse.length)` diff with `const { emit, diverged } = responseCursor.next(ev.source, r);` — if `diverged`, `log.warn` the source divergence once per source; if `emit`, feed `emit` (instead of the old `delta`) into the UNCHANGED JSON-accumulator pipeline (`:7534-7580`). Keep setting `lastResponse = r;` so fallbacks keep working. The shrink branch (`:7581-7599`) becomes mostly unreachable — keep it only for the `isAccumulatingJson` reset, or simplify per implementer's judgment with reviewer sign-off.
3. In the `response_delta` case (`:7657-7665`): same replacement using `ev.source` (present on observer events, `:5513`, and extension deltas, `:5342`).
4. Phase 0 seeding (`:7432`): ALSO seed the cursor — `responseCursor.next(ev.source || 'phase0', lastResponse)` result discarded — so the first Phase 1 delta from the same source doesn't re-emit the seed text.

**What NOT to touch:** `lastThinking` (thinking cursor — same class of bug, separate wave), the JSON accumulator functions (`looksLikeJsonStart`, `isJsonComplete`, `extractResponseFromCompleteJson`), `action_detected`/`response_detected` dedup, final extraction (`:7696-7806`), `anonymousConsult`'s separate `lastResponse` (`:8083+`).

- [ ] **E3. Test + commit**

Full unit tests for `createResponseCursor` in `wave2-bridge.test.cjs`:
- Same source monotonic growth → exact deltas, no repeats.
- Two sources, same text, different chunking → second source emits nothing duplicative; total committed == final text.
- Source A internally duplicated (pre-Fix-B shape "HelloHello") while source B says "Hello" → divergence flagged, no garbage emitted.
- Source shrink (DOM rebuild) → no emit, cursor reset, subsequent growth emits correctly.
- Trailing-whitespace trim difference between sources → tolerated (no permanent divergence lock).
- Divergence counter: `diverged: true` returned, committed unchanged.
Run: `node --test packages/kernel/tests/wave2-bridge.test.cjs` — must pass.

```bash
git add packages/kernel/lib/stream-text-cursor.cjs packages/kernel/kimi-bridge.cjs packages/kernel/tests/wave2-bridge.test.cjs
git commit -m "fix(bridge): per-source response cursors with prefix guard - stop triplicated streaming text"
```

---

## Out of scope (deferred — bridge bugs NOT in Wave 2)

- **Tools lost: `_extractJsonToolCalls` counts braces inside strings** (`:6846-6852`) — needs string-aware slicing; `extractFirstCompleteJsonObject` (`:2483-2521`) exists but swapping it in changes tool-detection semantics; Wave 3 with guard/tools work.
- **Extension fallback regex can't parse nested params** (`injected.js:92-93`) — needs a real JSON tolerant parser in the extension (jsonrepair); bundled with the parser-deduplication refactor.
- **DeepSeek tools may never be delivered** (`:6004-6036`, 5 stable cycles) — provider-specific completion heuristic redesign; risky without a live DeepSeek session to validate against.
- **JSON wrapper accumulator misses mid-text wrappers** (`:7556`) — 🟡 cosmetic leak (raw JSON in chat); partial mitigations land with Fix E's guarded deltas.
- **Infinite waits by design** (`:7384-7390`, `:7184-7190`) — owner explicitly mandated zero timeouts; any change is a product decision, not a bug fix.
- **Parser duplication** (3–5 divergent tool-JSON parsers) — refactor target for Wave 5 modularization, not a surgical fix.
- **Soul→bridge parse handshake** (owner's original framing of bug 1) — rejected for Wave 2; see Fix E design decision. Reconsider only with post-Wave-2 evidence.

---

## Self-Review

**Coverage:** Wave 2 of bugs.md = Fix E (🔴 triplicated text), Fix B (🟠 selectors), Fix A (🟠 session ReferenceError), Fix C (🔴 cross-user theft), Fix D (🟠 poller/stale events). ✅
**Ordering rationale:** A (3-line scope fix) → B (selector strings) → C (one function + call site) are mutually disjoint. D and E both touch `sendMessageStream`: D first because its stale-event purge shrinks the event stream E must reconcile, and B before E because the doubled-paragraph producer was the biggest cursor-divergence driver.
**Risk containment:** the only new runtime code paths are additive pure modules (`lib/stream-text-cursor.cjs`, `lib/stream-completion-guard.cjs`) pinned by `node --test`; all bridge edits are localized and flag-free (no config).
**Verification limits:** no PM2, no live browser — runtime validation (real Kimi stream, multi-user theft scenario) is delegated to the owner after merge; every fix ships with a regression test that fails on the pre-fix code.
**Consistency:** per-event `source` is already populated by all three producers (`:5322`, `:5408`, `:5513`) — Fix E consumes existing data, no producer changes needed. `url`/`tabUrl` are already buffered by the handler (`luna-extension-handler.cjs:149`) — Fix C consumes existing data, no extension changes needed.
