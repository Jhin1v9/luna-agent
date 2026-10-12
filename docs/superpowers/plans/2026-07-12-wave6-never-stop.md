# Wave 6 — "A Luna não pode parar nunca" (turn-termination guarantee + loop fixes + system terminal)

> **Goal:** every failure path ends in a visible `done`/`error`/`system` event; no replay loops; `{"script"}` never silently dropped; visible shell uses the system-default terminal with session-env self-sufficiency.
>
> **Evidence base:** three read-only investigations (2026-07-12) — A: auto-continue + script dispatch; B: silent exits; C: terminal strategy. All line refs below were re-verified by content against the live tree.
>
> **Conventions (unchanged):** TDD per task (failing test first), implementer → adversarial reviewer, small review follow-ups applied directly, full 7-suite regression after every task (`node --test` the 7 files, baseline **177/177**), no PM2 restarts until the end (owner restarts; a final luna-server restart is part of the wave close), commits in English, runtime errors in PT-BR, `dist/` rebuild only when `luna-web/src` changes.
>
> **Product rule for timeouts (owner previously demanded "zero limits"):** caps are LARGE (minutes, not seconds) and every cap expiry emits a visible `system`/`error`/`done` — never silent truncation.

---

## Task 1 — Bridge: bound the new-assistant detection loop + cancel check

**Files:** `packages/kernel/kimi-bridge.cjs` (`while (true)` at `:7416-7439` inside `sendMessageStream`); test `packages/kernel/tests/wave2-bridge.test.cjs`.

**Why:** if `.segment-assistant` is renamed by a Kimi deploy or Enter silently fails to submit, this loop never exits, never yields, ignores `stopConsuming`, and `session.processing` stays true — bricking every future message from that user (drain wait at `:7229-7235`). The #1 candidate for "ela para do nada".

- [x] **T1.1. Failing test (source-slice pattern, cf. `extractPollWithTimeoutBody` at wave2 `:31-52`)**

```js
test('W6-T1: new-assistant wait loop is bounded and cancellable', () => {
  const src = fs.readFileSync(BRIDGE, 'utf8');
  const idx = src.indexOf('NO TIMEOUT');
  // find the new-assistant while(true) loop by its poll marker
  const loopIdx = src.indexOf('segment-assistant', src.indexOf('sendMessageStream'));
  const window = src.slice(loopIdx - 200, loopIdx + 2500);
  assert.ok(window.includes('NEW_ASSISTANT_TIMEOUT_MS'), 'loop must have a timeout constant');
  assert.ok(window.includes('stopConsuming'), 'loop must check the cancel flag');
  assert.ok(/NO_ASSISTANT_DETECTED|STREAM_CANCELLED/.test(window), 'loop must throw a visible error on expiry/cancel');
});
```

- [x] **T1.2. Implement**

Add near the other send constants: `const NEW_ASSISTANT_TIMEOUT_MS = 120_000;` (2 min — a real Kimi response starts in seconds). Inside the `while (true)` loop at `:7416-7439`:
  - start: `const newAssistantDeadline = Date.now() + NEW_ASSISTANT_TIMEOUT_MS;` (before the loop)
  - in-loop: `if (stopConsuming) throw new Error('STREAM_CANCELLED');`
  - in-loop: `if (Date.now() > newAssistantDeadline) throw new Error('NO_ASSISTANT_DETECTED: selector broke or send failed (no .segment-assistant in 120s)');`

The throw lands in the soul catch (`luna-soul.cjs:2565`); non-bridge errors yield `error` at `:2665` — visible, correct, no new plumbing. Keep the existing `newAssistantWaitCount > 100` log.

- [x] **T1.3. Verify + commit** — wave2 suite + full regression (177→178). `fix(bridge): bound new-assistant detection loop (120s) + cancel check - one broken selector no longer bricks the user forever`.

---

## Task 2 — Soul: `_waitPromisesWithDrain` bounded + force-resolves hung tools

**Files:** `packages/kernel/luna-soul.cjs` (`_waitPromisesWithDrain` at `:4013-4032`; call sites `:2557-2563`, `:2748-2752`); test `packages/kernel/tests/wave1-soul.test.cjs`.

**Why:** a tool promise that never settles (stuck CDP call, blocking computer-use) hangs the turn forever with zero events; cancel can't reach it. The Wave 4 frontend watchdog unlocks the UI but the backend turn leaks.

- [x] **T2.1. Failing test (direct unit — LunaSoul constructs with plain defaults)**

```js
test('W6-T2: _waitPromisesWithDrain force-resolves hung tools after DRAIN_TIMEOUT_MS', async () => {
  const { LunaSoul } = require('../luna-soul.cjs');
  const soul = new LunaSoul({});
  soul._drainTimeoutMs = 300; // test override
  const eventBus = { queue: [] };
  let settled = false;
  const pending = new Map([['tool-x', { promise: new Promise(() => { settled = true; }), domResult: {} }]]);
  const gen = soul._waitPromisesWithDrain(pending, eventBus, 'sess-t2');
  const events = [];
  for await (const ev of gen) events.push(ev);
  assert.ok(events.some(e => e.type === 'action_end' && /timeout|timed out|expirou/i.test(JSON.stringify(e))),
    'a hung tool must end with a visible action_end failure, got: ' + JSON.stringify(events));
});
```

(Adapt the pending-map entry shape to the real one at `:4013-4032` — read the function first; if entries are plain promises, adjust. The test must drive the REAL generator.)

- [x] **T2.2. Implement**

In `_waitPromisesWithDrain`: `const DRAIN_TIMEOUT_MS = this._drainTimeoutMs || 10 * 60 * 1000;` + `const deadline = Date.now() + DRAIN_TIMEOUT_MS;`. In the 100ms tick: on expiry, for each pending entry push `{ type: 'action_end', tool: <name>, result: { success: false, error: 'Tool expirou após 10 min sem resposta (drain timeout).' } }` into `eventBus.queue`, set `domResult.result` to the same failure, then drain the queue one final time and `return`. Also check `this._cancelled`/session cancel flag if one exists at the call sites (verify; if none, timeout-only).

- [x] **T2.3. Verify + commit** — wave1 suite + full regression (178→179). `fix(soul): bound _waitPromisesWithDrain (10min) - hung tools force-resolve with a visible action_end instead of hanging the turn forever`.

---

## Task 3 — Bridge: bound the drain-wait, Phase 0, and re-enable the Phase 1 safety net

**Files:** `packages/kernel/kimi-bridge.cjs` (drain wait `:7229-7235`; Phase 0 `:7478-7513`; Phase 1 safety constants commented at `:7518, :7568-7570`); test wave2 (source-slice).

**Why:** (a) drain-wait inherits any prior wedge — infinite pre-send hang with no event; (b) Phase 0 has cancel check but no timeout (silent send failure = wait forever); (c) Phase 1's 24h safety is commented out.

- [x] **T3.1. Failing tests**

```js
test('W6-T3: pre-send processing drain is bounded and self-healing', () => {
  const window = sliceAround(src, 'already processing — waiting for drain', 1500);
  assert.ok(window.includes('PROCESSING_DRAIN_TIMEOUT_MS'), 'drain wait must be bounded');
  assert.ok(/processing = false/.test(window), 'expired drain must force-clear the dead processing flag');
});
test('W6-T3: Phase 0 has a generation-start timeout', () => {
  const window = sliceAround(src, 'textHasChanged', 2500);
  assert.ok(window.includes('GENERATION_START_TIMEOUT_MS'), 'Phase 0 must be bounded');
  assert.ok(/GENERATION_NEVER_STARTED/.test(window), 'Phase 0 expiry must throw a visible error');
});
test('W6-T3: Phase 1 safety timeout is re-enabled (large but real)', () => {
  assert.ok(/MESSAGE_SAFETY_TIMEOUT_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/.test(src), 'safety timeout constant must exist at 60min');
  assert.ok(!src.includes('Safety timeout disabled'), 'the disabled comment must be gone');
});
```

(`sliceAround` helper: add if missing — `const sliceAround = (s, needle, span) => { const i = s.indexOf(needle); return i === -1 ? '' : s.slice(Math.max(0, i - span/2), i + span/2); };`)

- [x] **T3.2. Implement**

- Drain wait (`:7229-7235`): cap 60s (`PROCESSING_DRAIN_TIMEOUT_MS = 60_000`); on expiry log warn + `session.processing = false` (the previous stream is provably dead past the cap) and continue.
- Phase 0 (`:7478-7513`): `GENERATION_START_TIMEOUT_MS = 5 * 60_000`; on expiry `throw new Error('GENERATION_NEVER_STARTED: Kimi did not start generating in 5 minutes')`.
- Phase 1: re-enable as `MESSAGE_SAFETY_TIMEOUT_MS = 60 * 60 * 1000` (60 min — large-file generations survive); on expiry run the existing final-extraction tail (`:7789-7900`) and yield what exists plus a `system` warning event; do NOT silently truncate.

- [x] **T3.3. Verify + commit** — wave2 + full regression (179→182). `fix(bridge): bound the three infinite send waits - drain 60s self-heal, Phase 0 5min start timeout, Phase 1 60min safety net re-enabled`.

---

## Task 4 — Soul: real `MAX_LOOPS` ceiling + guaranteed `done` on every exhaustion path

**Files:** `packages/kernel/luna-soul.cjs` (`MAX_LOOPS` `:2384`; exhaustion tail `:2857-2859`; retry-exhaustion error `:2661-2667`; `_buildContext` calls inside catch `:2656, :2604, :2732, :2839, :2853`); test wave1 (source-assertion + generator-oracle).

**Why:** `MAX_LOOPS = Number.MAX_SAFE_INTEGER` makes the ceiling dead; the exhaustion tail emits only `warning` and returns WITHOUT `done` (latent — goes live the moment the ceiling is real); the error path at `:2665` has no trailing `done` (some consumers key turn-end off `done` only); `_buildContext` throws inside the catch escape the generator.

- [x] **T4.1. Failing tests**

```js
test('W6-T4: MAX_LOOPS is a finite literal and exhaustion emits done', () => {
  const src = fs.readFileSync(SOUL, 'utf8');
  assert.ok(/MAX_LOOPS\s*=\s*50\b/.test(src), 'MAX_LOOPS must be a real ceiling (50)');
  assert.ok(!src.includes('MAX_LOOPS = Number.MAX_SAFE_INTEGER'), 'unbounded ceiling must be gone');
  const tail = sliceAround(src, 'Limite de iterações atingido', 800);
  assert.ok(tail.includes("type: 'done'"), 'loop exhaustion must yield done');
});
test('W6-T4: retry-exhaustion error is followed by done', () => {
  const window = sliceAround(src, 'login_required', 1200);
  const errIdx = window.indexOf("type: 'error'");
  assert.ok(errIdx !== -1 && window.slice(errIdx).includes("type: 'done'"), 'error emission must be followed by done');
});
test('W6-T4: _buildContext calls inside the stream catch are guarded', () => {
  const window = sliceAround(src, 'Stream error:', 2500);
  const bcIdx = window.indexOf('_buildContext');
  if (bcIdx !== -1) assert.ok(/try\s*\{/.test(window.slice(Math.max(0, bcIdx - 300), bcIdx)), '_buildContext in catch must be try-guarded');
});
```

- [x] **T4.2. Implement**

1. `const MAX_LOOPS = 50;` at `:2384`.
2. At `:2857-2859`, after the warning yield: `yield { type: 'done', result: { success: false, response: 'Limite de iterações atingido — encerrando para evitar loop.', sessionId }, sessionId }; return;` (Wave 1 A4 pattern).
3. After the `error` yield at `:2665`: yield a matching `done` (success:false) before `return`.
4. Wrap the `_buildContext` calls reachable from the catch (`:2656`, and `:2604/:2732/:2839/:2853` if inside the same catch scope — verify per site) in try/catch yielding `error` + `done` on failure.

- [x] **T4.3. Verify + commit** — wave1 + full regression (182→185). `fix(soul): real MAX_LOOPS ceiling (50) + done on every exhaustion/error path - no more generator returns without a terminal event`.

---

## Task 5 — Soul: `_executedActionCache` single-feedback + no failure replay + bounded size

**Files:** `packages/kernel/luna-soul.cjs` (cache `:1639-1669`; replay `:2497-2506`; mark-executed `:4062-4075`); test wave1.

**Why (investigation A-Q1, the live repro mechanism):** the cache stores failures too and replays them with no "already fed back" flag → every loop turn re-detects the same tool JSON, replays the SAME stale result (identical log timestamp), and `hasOutput` is always true → infinite auto-continue. Also folds the 🟡 "cache grows unbounded" item.

- [x] **T5.1. Failing tests**

```js
test('W6-T5: cached action results are fed back at most once', () => {
  // unit-level: seed the cache, replay twice, second replay must be skipped
  const { LunaSoul } = require('../luna-soul.cjs');
  const soul = new LunaSoul({});
  soul._markActionExecuted('sess', 'writeFile', { path: '/x', content: 'c' }, { success: true }, 'hash-1');
  const first = soul._getRecentActionResult('sess', 'hash-1');
  assert.ok(first && first.cached === true, 'first read replays the cache');
  const second = soul._getRecentActionResult('sess', 'hash-1');
  assert.strictEqual(second, null, 'second read of the same hash must NOT replay (already fed back)');
});
test('W6-T5: hard failures are not cached for replay', () => {
  const soul = new (require('../luna-soul.cjs').LunaSoul)({});
  soul._markActionExecuted('sess', 'executeShell', { command: 'x' }, { success: false, error: 'boom' }, 'hash-f');
  assert.strictEqual(soul._getRecentActionResult('sess', 'hash-f'), null, 'failures must not be replayed');
});
test('W6-T5: action cache is size-bounded', () => {
  const src = fs.readFileSync(SOUL, 'utf8');
  assert.ok(/ACTION_CACHE_MAX|_ACTION_CACHE_CAP|MAX_ACTION_CACHE/.test(src), 'cache must have a size cap constant');
});
```

(Adapt to the real signatures at `:1639-1669`/`:4062-4075` — read them first; `_getRecentActionResult` may take different args. The semantics are the contract, not the exact call shape.)

- [x] **T5.2. Implement**

1. Cache entry gains `fedBack: false`; `_getRecentActionResult` returns the entry only if `!fedBack`, then sets `fedBack = true`; a second lookup returns `null` (treated as "already answered — skip", do NOT push to `domActionResults`).
2. `_markActionExecuted`: skip caching when `result.success === false` (failures re-execute next time — correct, since the tool never ran to a real result; the live ENOENT case would have re-run instead of replaying garbage).
3. Cap: `const ACTION_CACHE_MAX = 200;` — on insert beyond cap, evict oldest (Map insertion order) in one pass.

- [x] **T5.3. Verify + commit** — wave1 + full regression (185→188). `fix(soul): action cache single-feedback + no failure replay + 200-entry cap - kills the stale tool-result replay loop at the root`.

---

## Task 6 — Bridge: turn-scoped phantom-action detection

**Files:** `packages/kernel/kimi-bridge.cjs` (per-stream dedup sets `:7469-7471`; queue purge `:7403-7404`; dom-structure poll `:5855, :6015-6026`; `_extractJsonBlocksFromDOM` `:5587-5593, :6508-6551`; extension flush `:5272-5293`; `_enqueueDomEvent` `:5657`); test wave2.

**Why (A-Q2):** every loop turn creates fresh dedup sets, but the DOM still shows the PREVIOUS turn's last assistant segment — four detectors scan it and re-emit its tool JSON as new actions. Wave 2's `initialText`/Phase 0 guards protect only the state_change text channel; `action_detected`/`response_detected` have no turn-scoping.

- [x] **T6.1. Failing tests**

```js
test('W6-T6: dom-event enqueue dedups across turns per user', () => {
  const window = sliceAround(src, '_enqueueDomEvent', 2000);
  assert.ok(/_domEventSeen|seenDomEvents/.test(window), 'enqueue must consult a cross-turn seen-set');
});
test('W6-T6: sendMessageStream records the pre-send assistant marker', () => {
  const window = sliceAround(src, 'sendMessageStream', 4000);
  assert.ok(/_turnAssistant(Marker|Index|Count)|preSendAssistant/.test(window), 'a pre-send assistant marker must be captured');
  assert.ok(/_turnAssistant(Marker|Index|Count)|preSendAssistant/.test(sliceAround(src, 'dom-structure', 3000) + sliceAround(src, '_extractJsonBlocksFromDOM', 3000)),
    'dom detectors must use the marker to skip pre-turn segments');
});
```

- [x] **T6.2. Implement**

1. At send start (after the queue purge `:7403-7404`), capture `session._turnAssistantMarker` = current count (or last-segment identity hash) of `.segment-assistant` nodes, evaluated once.
2. In the dom-structure poll and `_extractJsonBlocksFromDOM`: only scan assistant segments at index >= marker (or strictly newer than the marker hash).
3. At `_enqueueDomEvent` (`:5657`): maintain `session._domEventSeen` (keyed by event type + content hash); drop duplicates; clear the set when a real user message is sent (same place the marker is captured). Cap the set (e.g. 500) with FIFO eviction.

- [x] **T6.3. Verify + commit** — wave2 + full regression (188→190). `fix(bridge): turn-scoped phantom detection - pre-send assistant marker + cross-turn dom-event dedup kill the re-detected-previous-turn loop`.

---

## Task 7 — Soul backstop: all-cached domActionResults on a CHAT turn ⇒ stop as pure chat

**Files:** `packages/kernel/luna-soul.cjs` (oracle `:2714-2722`; stop condition `:2764-2767`; `hasOutput` `:2771`); test wave1 (extend A3 oracle replication).

**Why (A-Q2 fix 3):** even if bridge-side scoping misses something, a CHAT/DONE turn whose `domActionResults` are ALL cache replays (`cached: true`) must be treated as pure chat: stop. This extends the Wave 1 phantom oracle beyond parseable wrappers.

- [x] **T7.1. Failing test** — replicate the oracle in wave1 (A3 pattern): CHAT turn + `domActionResults = [{ tool, result, cached: true }]` → assert stop-decision true; same with one non-cached result → false.

- [x] **T7.2. Implement** — at `:2714-2722` (or the stop gate `:2764-2767`): compute `allCached = domActionResults.length > 0 && domActionResults.every(r => r.cached === true)`; when `(CHAT || DONE) && (domActionResults.length === 0 || allCached)` → yield `done` + return. Ensure `_getRecentActionResult` replays carry `cached: true` (Task 5 shape).

- [x] **T7.3. Verify + commit** — wave1 + full regression (190→191). `fix(soul): all-cached action results on a CHAT turn stop as pure chat - defense in depth behind turn-scoped detection`.

---

## Task 8 — Single-writer persistence + transport hardening

**Files:** `packages/kernel/luna-soul.cjs` (`response_detected` appendEvent `:2460-2464`; `_handleChat` appendEvent `:3998-4003`); `apps/dashboard/luna-chat-routes.js` (persist loop `:488-537`, dedup `:514-519`, finally synthetic done `:557-569`); tests: wave1 soul + `apps/dashboard/tests/wave1-chat-routes.test.cjs`.

**Why (A-Q4/Q5):** every response is persisted twice (response_detected + _handleChat) → duplicated `assistant:` history lines; routes persist `response_detected` separately from `assistant` → same text twice in UI; `done` exempt from dedup; straggler events after final done keep landing.

- [x] **T8.1. Failing tests**

```js
test('W6-T8: response text has a single persistence writer', () => {
  const soul = fs.readFileSync(SOUL, 'utf8');
  const rd = sliceAround(soul, "case 'response_detected'", 800);
  assert.ok(!rd.includes('appendEvent'), 'response_detected must not persist (handleChat is the sole writer)');
  const routes = fs.readFileSync(CHAT_ROUTES, 'utf8');
  const persist = sliceAround(routes, 'addMessageToSession', 3000);
  assert.ok(!persist.includes("ev.type === 'response_detected'") && !persist.includes("'response_detected'"),
    'routes must not persist response_detected separately');
});
test('W6-T8: done events are content-deduped in the transport loop', () => {
  const routes = fs.readFileSync(CHAT_ROUTES, 'utf8');
  const dedup = sliceAround(routes, 'eventLedger', 4000);
  assert.ok(/done.*hash|hash.*done|dedup.*done/i.test(dedup), 'done must be deduped by content');
});
```

- [x] **T8.2. Implement**

1. Delete the `appendEvent` in the soul's `response_detected` case (`:2460-2464`) — `_handleChat` is the sole persister.
2. Routes: stop persisting `response_detected` (the `assistant`/`done` events carry the text).
3. Routes: dedup `done` by content hash (remove the `ev.type !== 'done'` exemption at `:516`; hash on mode+response).
4. Routes: once a final `done` is persisted, set `session._streamClosed = true`; the persist loop drops straggler events for a closed stream (except a new user POST, which already cancels + reopens at `:452-465`).

- [x] **T8.3. Verify + commit** — wave1 + chat-routes + full regression (191→193). `fix(soul,transport): single-writer response persistence + done dedup + stream-closed gate - no more duplicated replies in history or UI`.

---

## Task 9 — `{"script"}` never silently dropped

**Files:** `packages/kernel/kimi-bridge.cjs` (`extractResponseFromCompleteJson` `:291-308`; literal-newline walker `:6664-6699`; `_extractJsonToolCalls` Strategy 2 `:6887`); `packages/kernel/luna-soul.cjs` (CHAT fall-through `:829`, parse site `:2693-2696`); tests wave2 + wave1.

**Why (A-Q3):** Kimi's DOM renders script JSON with literal newlines inside strings → strict `JSON.parse` fails → regex fallback covers only `response`/`message` → null → nothing yielded, buffer discarded → soul treats raw script JSON as CHAT text and persists it (or hits empty-response). `_extractJsonToolCalls` Strategy 2 requires the `"tool"` key.

- [x] **T9.1. Failing tests (unit, real functions)**

```js
test('W6-T9: extractResponseFromCompleteJson recovers script with literal newlines', () => {
  const raw = '{"script": "#!/bin/bash\nset -e\nmkdir -p /tmp/x", "language": "bash"}'; // literal \n inside string
  const { extractResponseFromCompleteJson } = require('../kimi-bridge.cjs');
  const r = extractResponseFromCompleteJson(raw);
  assert.ok(r && r.script && r.script.includes('mkdir -p'), 'script must be recovered, got ' + JSON.stringify(r));
});
test('W6-T9: _extractJsonToolCalls Strategy 2 matches the script key', () => {
  const { _extractJsonToolCalls } = require('../kimi-bridge.cjs');
  const tools = _extractJsonToolCalls('text before {"script": "echo oi", "language": "bash"} text after');
  assert.ok(tools.length === 1 && tools[0].script, 'script JSON must be detected');
});
test('W6-T9: soul never persists raw script JSON as a chat reply', () => {
  const src = fs.readFileSync(SOUL, 'utf8');
  const chat = sliceAround(src, '_handleChat', 3000);
  assert.ok(/re.?dispatch|_isRawToolJson|script.*tool/i.test(chat), 'handleChat must re-dispatch raw tool JSON instead of persisting it');
});
```

(If the two bridge functions aren't exported, add them to `module.exports` — wave2 tests already import internals this way; verify.)

- [x] **T9.2. Implement**

1. `extractResponseFromCompleteJson`: before strict parse, pre-escape literal newlines/tabs inside JSON strings using the existing walker (`:6664-6699` — factor it out if needed); extend the regex fallback (`:301-308`) to cover `"script"` (and `"language"`).
2. `_extractJsonToolCalls` Strategy 2 (`:6887`): accept `"script"` as a tool-object key alongside `"tool"`.
3. Soul `_handleChat` (`:829` area): if the CHAT fallback's `response` text parses as a `{"script"}`/`{"tool"}` object, dispatch it as an action instead of persisting raw JSON; only persist if dispatch fails validation (then persist a friendly PT-BR error, never raw JSON).

- [x] **T9.3. Verify + commit** — wave2 + wave1 + full regression (193→196). `fix(bridge,soul): script JSON recovered from mangled DOM text - newline walker, script regex fallback, Strategy 2 key, soul re-dispatch backstop`.

---

## Task 10 — System-default terminal: `lib/terminal-resolver.cjs` + session-env self-sufficiency

**Files:** new `packages/kernel/lib/terminal-resolver.cjs`; `packages/kernel/luna-tools.cjs` (`detectHeadless` `:109-125`; spawn `:874-878`; gate `:1002`; `openDebugTerminal` list `:1464-1483`); test `packages/kernel/tests/wave3-guard-tools.test.cjs` (W6c/W6d).

**Why (investigation C):** hardcoded `gnome-terminal` + inherited-env dependence = the live ENOENT bug class. PM2 env is a snapshot (Xauth rotates, D-Bus may be absent). Code must be self-sufficient.

- [x] **T10.1. Failing tests**

```js
test('W6c: resolveTerminal honors $TERMINAL first, then the system default', () => {
  const { resolveTerminal } = require('../lib/terminal-resolver.cjs');
  const r1 = resolveTerminal({ TERMINAL: process.env.TERMINAL || 'gnome-terminal', PATH: process.env.PATH });
  assert.ok(r1 && r1.bin, 'must resolve on this host');
  const r2 = resolveTerminal({ PATH: '/nonexistent' });
  assert.strictEqual(r2, null, 'empty PATH resolves null');
});
test('W6c: argv templates per style', () => {
  const { _argvFor } = require('../lib/terminal-resolver.cjs');
  assert.deepStrictEqual(_argvFor('dashdash', 'gnome-terminal', '/s.sh'), ['gnome-terminal', '--wait', '--', 'bash', '/s.sh']);
  assert.deepStrictEqual(_argvFor('e', 'xterm', '/s.sh'), ['xterm', '-e', 'bash', '/s.sh']);
  assert.deepStrictEqual(_argvFor('plain', 'kitty', '/s.sh'), ['kitty', 'bash', '/s.sh']);
});
test('W6d: enrichSessionEnv fills D-Bus/runtime only when absent and existing', () => {
  const { enrichSessionEnv } = require('../lib/terminal-resolver.cjs');
  const env = enrichSessionEnv({});
  const uid = require('os').userInfo().uid;
  if (fs.existsSync(`/run/user/${uid}/bus`)) {
    assert.strictEqual(env.DBUS_SESSION_BUS_ADDRESS, `unix:path=/run/user/${uid}/bus`);
  }
  const kept = enrichSessionEnv({ DBUS_SESSION_BUS_ADDRESS: 'unix:path=/custom' });
  assert.strictEqual(kept.DBUS_SESSION_BUS_ADDRESS, 'unix:path=/custom', 'existing values are never overwritten');
});
test('W6d: luna-tools consumes the resolver (no hardcoded gnome-terminal spawn)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'luna-tools.cjs'), 'utf8');
  assert.ok(src.includes("require('./lib/terminal-resolver.cjs')"), 'must use the resolver');
  assert.ok(!src.includes("spawn('gnome-terminal'"), 'hardcoded gnome-terminal spawn must be gone');
  assert.ok(!src.includes("execSync('which gnome-terminal')"), 'per-call which must be gone');
});
```

- [x] **T10.2. Implement**

New module per investigation C: `TERMINAL_CANDIDATES` (x-terminal-emulator[e] → sensible-terminal[e] → gnome-terminal[dashdash] → kgx/gnome-console[dashdash] → kitty[plain] → alacritty/konsole/xterm[e]); `resolveTerminal(env)` probes `PATH` dirs with `fs.existsSync` (cached per process, invalidated on `$TERMINAL`/`$PATH` change); `$TERMINAL` honored first (whitespace-split, first token); `_argvFor(style, bin, scriptFile)` exported for tests; `enrichSessionEnv(env)` fills XDG_RUNTIME_DIR/DBUS_SESSION_BUS_ADDRESS/DISPLAY/WAYLAND_DISPLAY/XAUTHORITY (newest `.mutter-Xwaylandauth.*`) only when absent and the target exists. Consume at the four luna-tools sites; `detectHeadless` consults enriched env + `resolveTerminal() !== null` (drop per-call execSync); resolver-null → direct invisible fallback with warning annotation (Task 11 field).

- [x] **T10.3. Verify + commit** — wave3 + full regression (196→200). `feat(tools): system-default terminal resolver + session-env self-sufficiency - visible mode no longer depends on inherited env or gnome-terminal`. (verified 200/200 2026-07-12; commit deferred — adversarial review follows)

---

## Task 11 — Visible-mode toggle wiring + fallback warning UX

**Files:** `packages/kernel/luna-soul.cjs` (dispatch switch, add cases near `case 'think':` `:4323`); `packages/kernel/lib/tool-registry.cjs` (2 entries); `packages/kernel/luna-tools.cjs` (annotate both fallback sites + resolver-null path with `warning`/`visibleFallback`); `packages/kernel/luna-web/src/components/ToolCard.svelte` (`:108` area); `packages/kernel/luna-web/dist/**` (rebuild); tests: wave1 soul (dispatch), wave5 registry (coverage list), wave4 frontend, W6e in wave3.

**Why (C-Q3/Q4):** `setVisibleMode`/`getVisibleMode` are exported but fall into "ferramenta desconhecida" in the soul switch; the user never learns when visible mode degrades.

- [x] **T11.1. Failing tests**

```js
test('W6e: soul dispatches setVisibleMode/getVisibleMode', async () => {
  const src = fs.readFileSync(SOUL, 'utf8');
  assert.ok(src.includes("case 'setVisibleMode'") && src.includes("case 'getVisibleMode'"), 'dispatch cases must exist');
});
test('W6e: fallback results carry a visible warning', () => {
  const src = fs.readFileSync(TOOLS, 'utf8');
  assert.ok(src.includes('visibleFallback'), 'fallbacks must annotate the result');
  assert.ok(src.includes('modo invisível'), 'PT-BR warning text must be present');
});
test('W6e: ToolCard renders result warnings', () => {
  const src = fs.readFileSync(TOOL_CARD, 'utf8');
  assert.ok(src.includes('result?.warning') || src.includes('result.warning'), 'ToolCard must show warnings');
});
```

- [x] **T11.2. Implement**

1. Soul cases: `case 'setVisibleMode': return ok({ visibleMode: (lunaTools.setVisibleMode(p.enabled !== false), lunaTools.getVisibleMode()) });` + `case 'getVisibleMode': return ok({ visibleMode: lunaTools.getVisibleMode() });` (match the real dispatch idiom at `:4287-4588` — read neighbors first).
2. Registry: add both tools (meta icons 👁/🙈-style; no schema — fail-open is fine); update the wave5 coverage exclusion list (`wave5-tool-registry.test.cjs:185-186`) if it diffs against exports.
3. luna-tools: at both fallback sites (`:899-908`, `:934-943`) and the resolver-null path: `fallback.warning = '⚠️ Terminal visível não abriu — executado em modo invisível'; fallback.visibleFallback = true;`.
4. ToolCard: `{#if result?.warning}<div class="tool-warning">{result.warning}</div>}` + minimal style.
5. Rebuild dist (`corepack pnpm build` in luna-web) and commit dist.

- [x] **T11.3. Verify + commit** — wave1 + wave3 + wave4 + wave5 + build + full regression (200→203). `feat(soul,frontend): visible-mode tools dispatchable + fallback warning surfaced in ToolCard`. (verified 203/203 2026-07-12; commit deferred — adversarial review follows)

---

## Task 12 — DeepSeek: force-complete cap independent of byte-stability

**Files:** `packages/kernel/kimi-bridge.cjs` (generic block `:6048-6061`; enqueue `:6077-6083`; `_checkCompletionCandidate` `:5694-5745`); test wave2 (pure-helper + source-slice).

**Why (B#3):** completion requires UI not-generating (unreliable on DeepSeek) with a 5-cycle byte-identical backstop that cursor blink/code-block chrome can prevent forever → tools never delivered, no done. DeepSeek-only branch; Kimi hot path untouched.

- [x] **T12.1. Failing tests**

```js
test('W6-T12: force-complete decision fires after cap with stable length', () => {
  const { _shouldForceGenericComplete } = require('../kimi-bridge.cjs');
  const now = Date.now();
  assert.strictEqual(_shouldForceGenericComplete({ firstSeenAt: now - 50_000, lastLengthChangeAt: now - 12_000, uiGenerating: true }, now), true,
    'past cap + length-stable 10s must force-complete even while UI says generating');
  assert.strictEqual(_shouldForceGenericComplete({ firstSeenAt: now - 10_000, lastLengthChangeAt: now - 12_000, uiGenerating: true }, now), false,
    'before cap must not force');
  assert.strictEqual(_shouldForceGenericComplete({ firstSeenAt: now - 50_000, lastLengthChangeAt: now - 2_000, uiGenerating: true }, now), false,
    'still-growing text must not force');
});
test('W6-T12: generic block wires the force-complete helper', () => {
  const window = sliceAround(src, 'detectedTools', 3000);
  assert.ok(window.includes('_shouldForceGenericComplete'), 'generic completion must consult the helper');
});
```

- [x] **T12.2. Implement**

Extract pure helper `_shouldForceGenericComplete({firstSeenAt, lastLengthChangeAt, uiGenerating}, now)` → `now - firstSeenAt > 45_000 && now - lastLengthChangeAt > 10_000`. In `_pollThinkingAndResponse` (`:6041-6084`): record `session._genericFirstSeenAt` on first non-empty response and `session._genericLastLengthChangeAt` on length change; when the helper fires, set `uiState.isGenerating = false` and log a warn. Tools flow through the existing enqueue at `:6077-6083`; the soul drain + done proceed normally. Export the helper for tests.

- [x] **T12.3. Verify + commit** — wave2 + full regression (203→205). `fix(bridge): DeepSeek force-complete cap (45s + 10s length-stable) - tools delivered even when UI completion heuristics never fire`.

---

## Task 13 — Close the wave: bugs.md bookkeeping

**Files:** `packages/kernel/.brain/bugs.md`.

- [x] Move to Resolved (new `### Wave 6 — hotfixes` entries appended to the existing Wave 6 section): silent exits #1/#2/#4 (bridge waits, drain, MAX_LOOPS), auto-continue pure-response (bridge part), stale replay loop, script swallowed, history duplication, DeepSeek delivery, terminal robustness. Keep Open (Wave 7 candidates): parser duplication refactor, extension nested-params regex, heuristic validators, cross-user agent/swarm (needs live observation), frontend chunk-replay dedup (cosmetic), `invalidatePromptCache` wiring, workspace hardcoded, config keys (miniReminder/toolResultPrompt/loopRules), `dashboardCommandRouter` success:true, non-atomic soul writeFileSync sites, anonymousConsult/legacy `_waitForResponse`/runTask bounded-wait sweep (lower-priority paths found in investigation B).
- [x] Commit: `docs(brain): close Wave 6 - never-stop guarantee, replay loop killed, system terminal, script recovered`.

---

## Final steps (after T13)

1. Full regression — report final count.
2. `git push origin main`.
3. `pm2 restart luna-server luna-telegram-adapter` (NO `--update-env`) + verify online + `curl :3458` 200 + `pm2 save`.
4. Final PT-BR report to the owner with the live-validation checklist (send a message, let it idle — no duplicate reply; ask for a `{"script"}` — it runs; break-glass: every hang now ends in a visible event).

## Out of scope (explicitly deferred)

- Provider abstraction, soul→kernel rename, ChatArea/ToolCard decomposition (decisions.md).
- Bridge parser unification into one real parser (big refactor; T6/T9 remove the worst symptoms).
- Extension nested-params regex (needs jsonrepair in the extension bundle).
- Heuristic validators (needs real parser), cross-user agent/swarm (needs live URL observation), chunk-replay dedup (cosmetic).
- `runTask`/legacy `_waitForResponse`/`anonymousConsult` bounded-wait sweep — logged for Wave 7 (investigation B "additional candidates").
- Persisting the visible-mode toggle across restarts; Telegram toggle propagation (C caveats).

## Self-Review

- Every investigation finding has a task: A-Q1→T5, A-Q2→T6/T7, A-Q3→T9, A-Q4/Q5→T8, B#1→T1, B#2→T2, B#3→T12, B#4→T3, B#5→T4/T5, B#6→T4, C-Q1/Q2→T10, C-Q3/Q4→T11. ✅
- Timeouts honor the owner's "zero limits" stance: 120s/5min/10min/45s/60min/50-loops — all large, all paired with visible events. ✅
- No task touches PM2 until the final close; only T11 rebuilds dist; no new npm deps anywhere (walker reuses existing code). ✅
- Test conventions match existing suites (source-slice from wave2, oracle replication from wave1 A3, direct unit for pure helpers). Each task states its exact count delta: 177 → 205. ✅
- Ordering: turn-termination first (owner's #1 pain), then loop roots (T5 before T6/T7 since T7 relies on the `cached` flag shape), script recovery, terminal, DeepSeek last (independent branch). ✅
