// wave1-soul.test.cjs — Wave 1 Fix A regression tests
// Run: node --test packages/kernel/tests/wave1-soul.test.cjs
'use strict';

// Point LUNA_KERNEL_DIR at this repo's packages/kernel BEFORE requiring any
// luna module, so the real config/master prompt are loaded (luna-config reads
// env at require time).
const path = require('node:path');
const KERNEL_DIR = path.join(__dirname, '..');
process.env.LUNA_KERNEL_DIR = KERNEL_DIR;

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');

const lunaConfig = require('../config/luna-config.js');
const { buildSystemPrompt, parseKimiResponse, parseTagResponse } = require('../luna-soul.cjs');

test('A1: buildSystemPrompt injects master prompt JSON examples and persona', () => {
  const masterPath = lunaConfig.PATHS.masterPrompt;
  const master = fs.readFileSync(masterPath, 'utf8');

  // Exact JSON example line from the master prompt (tool examples section).
  const markerLine = master
    .split('\n')
    .find(l => l.includes('{"tool": "readFile", "params": {"path": "{{WORKSPACE}}/arquivo.txt"}}'));
  assert.ok(markerLine, 'marker line must exist in LUNA_MASTER_PROMPT.md');

  // buildSystemPrompt interpolates {{WORKSPACE}} with the workspace path.
  // Unknown user → fallback workspace = LUNA_HOME.
  const workspace = process.env.LUNA_HOME || path.join(os.homedir(), '.luna');
  const expected = markerLine.replace('{{WORKSPACE}}', workspace);

  const personaMarker = 'WAVE1-PERSONA-MARKER';
  const out = buildSystemPrompt({
    masterPrompt: master,
    personaContent: personaMarker,
    userId: 'wave1-test-user',
  });

  assert.ok(
    out.includes(expected),
    'system prompt must include the exact JSON example line from the master prompt'
  );
  assert.ok(
    out.includes(personaMarker),
    'system prompt must include persona content'
  );
});

test('A1b: 20k cap never truncates the master prompt tail (BOTTOM EXAMPLES)', () => {
  const master = fs.readFileSync(lunaConfig.PATHS.masterPrompt, 'utf8');
  const bottomMarker = '[JSON FORMAT — BOTTOM EXAMPLES';
  assert.ok(master.includes(bottomMarker), 'master prompt must contain the bottom examples marker');

  // Worst case: every section at its max size. Pre-master content alone
  // exceeds 20k, so a naive whole-string slice would drop the master tail.
  const out = buildSystemPrompt({
    masterPrompt: master,
    personaContent: 'P'.repeat(5000),
    memoryContext: 'M'.repeat(5000),
    agentsMd: 'A'.repeat(5000),
    brainContext: 'B'.repeat(12000),
    userId: 'wave1-test-user',
  });

  assert.ok(
    out.includes(bottomMarker),
    'master prompt tail must survive the 20k cap even with max-size sections'
  );
  assert.ok(
    out.endsWith(master.slice(-50)),
    'master prompt must be the LAST thing in the system prompt'
  );
});

test('A2: followUp and toolLoop templates contain JSON format examples', () => {
  const cfg = JSON.parse(fs.readFileSync(lunaConfig.PATHS.promptConfig, 'utf8'));
  for (const key of ['followUp', 'toolLoop']) {
    const tpl = cfg.prompts[key];
    assert.ok(typeof tpl === 'string' && tpl.length > 0, `${key} template must exist`);
    assert.ok(tpl.includes('"params"'), `${key} must contain "params"`);
    assert.ok(tpl.includes('{"tool"'), `${key} must contain {"tool" example`);
  }
});

// A3: the phantom-tool guard in processMessageStream fires only when CHAT came
// from a VALID {"response": ...} JSON wrapper. The guard itself lives inside the
// stream generator (not unit-testable without heavy mocks), but its validity
// oracle is replicated here verbatim: parseKimiResponse must return a plain
// object with a string `response` field (jsonrepair can turn plain text into an
// array, which must NOT count as a wrapper).
function isValidResponseWrapper(text) {
  const obj = parseKimiResponse(text);
  return obj !== null && typeof obj === 'object' && !Array.isArray(obj) && typeof obj.response === 'string';
}

test('A3: wrapper oracle distinguishes valid JSON response from plain-text fallback', () => {
  // Valid fenced wrapper → oracle true → guard ignores DOM actions
  const fenced = '```json\n{"response": "Claro! 🌙"}\n```';
  assert.strictEqual(isValidResponseWrapper(fenced), true, 'fenced wrapper must be valid');
  assert.strictEqual(parseTagResponse(fenced).mode, 'CHAT');

  // Valid bare wrapper → oracle true → guard ignores DOM actions
  assert.strictEqual(isValidResponseWrapper('{"response": "Sem cercas."}'), true, 'bare wrapper must be valid');

  // Plain text (fallback CHAT path) → oracle false → guard must NOT fire,
  // DOM tool results stay legit and are fed back to Kimi
  const plain = 'Aqui está o resultado da sua busca, sem JSON nenhum.';
  assert.strictEqual(parseTagResponse(plain).mode, 'CHAT', 'plain text falls back to CHAT');
  assert.strictEqual(isValidResponseWrapper(plain), false, 'plain text must NOT be a valid wrapper');
});

// W6-T2: _waitPromisesWithDrain must be bounded — a tool promise that never
// settles (stuck CDP call, blocking computer-use) must not hang the turn
// forever. After the drain timeout, each pending tool is force-resolved with
// a visible action_end failure and the generator returns.
test('W6-T2: _waitPromisesWithDrain force-resolves hung tools after the drain timeout', { timeout: 5000 }, async () => {
  const { LunaSoul } = require('../luna-soul.cjs');
  const soul = new LunaSoul({});
  soul._drainTimeoutMs = 300; // test override so the suite stays fast
  const eventBus = { queue: [], push(ev) { this.queue.push(ev); } };
  const never = new Promise(() => {});
  // Pending collection is an array of bare Promise objects (the real shape:
  // domActionPromises / result.pendingPromises). Push sites annotate them
  // with _toolName / _domResult so the timeout event can name the tool.
  const domResult = { tool: 'stuckTool', result: null };
  never._toolName = 'stuckTool';
  never._domResult = domResult;
  const pending = [never];
  const events = [];
  for await (const ev of soul._waitPromisesWithDrain(pending, eventBus, 'sess-t2')) events.push(ev);
  assert.ok(events.some(e => e.type === 'action_end' && /expirou|timeout|timed out/i.test(JSON.stringify(e))),
    'a hung tool must end with a visible action_end failure, got: ' + JSON.stringify(events));
  assert.ok(domResult.result && domResult.result.success === false,
    'domResult must be filled with the failure payload for downstream loop-back, got: ' + JSON.stringify(domResult.result));
});

// W6-T4: turn-termination guarantees in processMessageStream.
// Source-assertion tests: the generator itself needs a live bridge to run,
// so we pin the terminal-event structure directly on the source.
const SOUL = path.join(__dirname, '..', 'luna-soul.cjs');
const sliceAround = (s, needle, span) => {
  const i = s.indexOf(needle);
  return i === -1 ? '' : s.slice(Math.max(0, i - span / 2), i + span / 2);
};

test('W6-T4 (v13.0): no global tool-count ceiling; semantic guards bound the loop', () => {
  // Owner directive 2026-08-13: Luna must execute as many tools as the model
  // emits — the old MAX_LOOPS=50 ceiling silently killed long tool chains.
  // Runaway protection is semantic: circuit breaker on identical repeats,
  // cached-replay stop, bounded truncated-JSON retries.
  const src = fs.readFileSync(SOUL, 'utf8');
  assert.ok(!/MAX_LOOPS\s*=\s*\d/.test(src), 'numeric MAX_LOOPS ceiling must be gone');
  assert.ok(src.includes('MAX_LOOPS = Number.POSITIVE_INFINITY'), 'loop ceiling must be unbounded');
  const guard = fs.readFileSync(require('node:path').join(__dirname, '../luna-tool-guard.cjs'), 'utf8');
  assert.ok(guard.includes('CIRCUIT_OPEN'), 'circuit breaker (identical-call loop protection) must exist');
});

test('W6-T4: retry-exhaustion error is followed by done', () => {
  const src = fs.readFileSync(SOUL, 'utf8');
  // Anchor on login_required (sibling branch of the error yield) with a tight
  // window so a *later* unrelated done cannot satisfy the assertion.
  const window = sliceAround(src, 'login_required', 1200);
  const errIdx = window.indexOf("type: 'error'");
  assert.ok(errIdx !== -1, 'error yield must exist');
  assert.ok(window.slice(errIdx).includes("type: 'done'"), 'error emission must be followed by done');
});

test('W6-T4: _buildContext calls inside the stream catch are guarded', () => {
  const src = fs.readFileSync(SOUL, 'utf8');
  // Guard 1: crash-recovery autocontinue rebuild (anchor just before it).
  // Match `this._buildContext` (the call), not bare `_buildContext` (appears in comments).
  const streamErrWindow = sliceAround(src, 'Stream error:', 2500);
  const bcIdx = streamErrWindow.indexOf('this._buildContext');
  assert.ok(bcIdx !== -1, '_buildContext call must exist near the Stream error anchor — anchor drifted?');
  assert.ok(/try\s*\{/.test(streamErrWindow.slice(Math.max(0, bcIdx - 300), bcIdx)),
    '_buildContext in crash-recovery scope must be try-guarded');
  // Guard 2: STREAM_CANCELLED branch rebuild (~40 lines after the first occurrence).
  const cancelWindow = sliceAround(src, 'STREAM_CANCELLED', 8000);
  const cancelBcIdx = cancelWindow.indexOf('this._buildContext');
  assert.ok(cancelBcIdx !== -1, '_buildContext must exist in the STREAM_CANCELLED branch — anchor drifted?');
  assert.ok(/try\s*\{/.test(cancelWindow.slice(Math.max(0, cancelBcIdx - 300), cancelBcIdx)),
    '_buildContext in the STREAM_CANCELLED branch must be try-guarded');
});

// W6-T5: the executed-action cache must be loop-proof — one replay per real
// execution, failures never cached, and a bounded FIFO size. Without this,
// a duplicate tool action replays the cached result forever (Kimi re-sends →
// replay → re-sends → replay...) and stale failures echo back as fresh errors.
test('W6-T5a: cached action results are fed back at most once', () => {
  const { LunaSoul } = require('../luna-soul.cjs');
  const soul = new LunaSoul({});
  const result = { success: true, output: 'ok' };
  soul._markActionExecuted('sess-t5a', 'hash-1', result);
  const first = soul._getRecentActionResult('sess-t5a', 'hash-1');
  assert.strictEqual(first, result, 'first duplicate read must replay the cached result');
  const second = soul._getRecentActionResult('sess-t5a', 'hash-1');
  assert.strictEqual(second, null, 'second read of the same hash must NOT replay (already fed back)');
});

test('W6-T5b: failures are never cached for replay', () => {
  const { LunaSoul } = require('../luna-soul.cjs');
  const soul = new LunaSoul({});
  soul._markActionExecuted('sess-t5b', 'hash-f', { success: false, error: 'boom' });
  assert.strictEqual(soul._getRecentActionResult('sess-t5b', 'hash-f'), null,
    'a failed action must not be cached — it re-executes instead of replaying a stale error');
});

test('W6-T5c: action cache is size-bounded (FIFO eviction)', () => {
  const { LunaSoul, ACTION_CACHE_MAX } = require('../luna-soul.cjs');
  assert.ok(Number.isInteger(ACTION_CACHE_MAX) && ACTION_CACHE_MAX > 0,
    'ACTION_CACHE_MAX must be exported as a positive integer');
  const soul = new LunaSoul({});
  // Insert ACTION_CACHE_MAX + 1 distinct hashes into one session.
  for (let i = 0; i <= ACTION_CACHE_MAX; i++) {
    soul._markActionExecuted('sess-t5c', `hash-${i}`, { success: true, i });
  }
  const sessionCache = soul._executedActionCache.get('sess-t5c');
  assert.strictEqual(sessionCache.size, ACTION_CACHE_MAX, 'cache must be capped at ACTION_CACHE_MAX');
  assert.strictEqual(soul._getRecentActionResult('sess-t5c', 'hash-0'), null,
    'the oldest entry must be evicted FIFO');
  const last = soul._getRecentActionResult('sess-t5c', `hash-${ACTION_CACHE_MAX}`);
  assert.ok(last && last.i === ACTION_CACHE_MAX, 'the newest entry must still be present');
});

// W6-T7: defense in depth behind bridge turn-scoping (W6-T6). A CHAT/DONE turn
// whose domActionResults are ALL cached replays (W6-T5 marks replays with
// cached: true) executed nothing new — it must stop as pure chat instead of
// feeding stale replays back and auto-continuing a finished turn forever.
test('W6-T7: all-cached domActionResults on a CHAT turn stop as pure chat', () => {
  // Replicate the stop decision as a pure oracle (A3 pattern):
  const shouldStopAsPureChat = (mode, domActionResults) => {
    const allCached = domActionResults.length > 0 && domActionResults.every(r => r.cached === true);
    return (mode === 'CHAT' || mode === 'DONE') && (domActionResults.length === 0 || allCached);
  };
  assert.strictEqual(shouldStopAsPureChat('CHAT', []), true, 'plain chat stops');
  assert.strictEqual(shouldStopAsPureChat('CHAT', [{ tool: 'executeShell', result: {}, cached: true }]), true, 'all-cached replays stop');
  assert.strictEqual(shouldStopAsPureChat('DONE', [{ tool: 'executeShell', result: {}, cached: true }]), true, 'DONE + all-cached stops');
  assert.strictEqual(shouldStopAsPureChat('CHAT', [{ tool: 'executeShell', result: {}, cached: true }, { tool: 'readFile', result: {} }]), false, 'one fresh result keeps feed-back');
  assert.strictEqual(shouldStopAsPureChat('CHAT', [{ tool: 'readFile', result: {} }]), false, 'fresh results feed back');
  assert.strictEqual(shouldStopAsPureChat('ACTION', []), false, 'ACTION never stops here');

  // Source pin: the soul must compute allCached with the same shape (hard assert).
  const src = fs.readFileSync(SOUL, 'utf8');
  const w = sliceAround(src, 'allCached', 600);
  assert.ok(/every\(\(?\s*r\s*\)?\s*=>\s*r\.cached\s*===\s*true\)/.test(w),
    'soul must gate on every result carrying cached === true');
});

// W6-T8: single-writer persistence. response_detected is a live-streaming
// signal only — _handleChat is the sole persister of the assistant response.
// With both persisting, every chat reply lands twice in session history.
test('W6-T8a: response_detected does not persist — _handleChat is the sole writer', () => {
  const src = fs.readFileSync(SOUL, 'utf8');
  const idx = src.indexOf("case 'response_detected'");
  assert.notStrictEqual(idx, -1, "case 'response_detected' must exist — anchor drifted?");
  const window = sliceAround(src, "case 'response_detected'", 800);
  assert.ok(window.includes("type: 'response_detected'"),
    'window must contain the case body (the yield) — anchor drifted?');
  // Assert the call shape `.appendEvent(` — the W6-T8 comment in the case body
  // legitimately contains the bare word "appendEvent".
  assert.ok(!window.includes('.appendEvent('),
    'response_detected must not call appendEvent (_handleChat is the sole writer)');
});

// ── W6-T9c: soul backstop — raw tool/script JSON is never persisted as chat ──
// The pure helper interprets a response that IS a JSON payload; prose (even
// with embedded JSON) passes through; broken intent-JSON yields an invalid
// marker so _processModeResult can swap in a friendly PT-BR error.

test('W6-T9c: _tryExtractRawToolJson classifies raw JSON responses', () => {
  const { _tryExtractRawToolJson } = require('../luna-soul.cjs');

  // Raw script JSON → the exact shape parseKimiResponse produces for scripts
  // (mode SCRIPT + script field — _processModeResult's SCRIPT case dispatches
  // it as executeScript).
  const script = _tryExtractRawToolJson('{"script": "echo oi", "language": "bash"}');
  assert.deepStrictEqual(script, { mode: 'SCRIPT', script: 'echo oi', language: 'bash' },
    'script JSON must re-dispatch in parseKimiResponse SCRIPT shape');

  // Raw tool JSON → ACTION shape with params.
  const tool = _tryExtractRawToolJson('{"tool": "readFile", "params": {"path": "/tmp/x"}}');
  assert.deepStrictEqual(tool, { mode: 'ACTION', tool: 'readFile', params: { path: '/tmp/x' } },
    'tool JSON must re-dispatch as ACTION');

  // Prose that merely embeds JSON must NOT match — the whole response has to
  // be the JSON object.
  assert.strictEqual(_tryExtractRawToolJson('olha aqui {"tool": "readFile"} legal'), null,
    'prose with embedded JSON must pass through untouched');
  assert.strictEqual(_tryExtractRawToolJson('oi tudo bem?'), null,
    'plain prose must pass through untouched');

  // W6-T9 review (Major 1): valid JSON that is NOT a tool/script payload is
  // legitimate chat content (user asked to SEE a JSON example) — never eat it.
  assert.strictEqual(_tryExtractRawToolJson('{"name": "demo", "version": "1.0"}'), null,
    'valid non-tool JSON must fall through to normal chat');
  assert.strictEqual(_tryExtractRawToolJson('```json\n{"name": "demo"}\n```'), null,
    'fenced non-tool JSON must fall through to normal chat');

  // W6-T9 review (Minor): flat {tool, ...fields} JSON folds into params like
  // parseKimiResponse's ACTION case does.
  const flat = _tryExtractRawToolJson('{"tool": "readFile", "path": "/tmp/y"}');
  assert.deepStrictEqual(flat, { mode: 'ACTION', tool: 'readFile', params: { path: '/tmp/y' } },
    'flat tool JSON must fold extra fields into params');

  // W6-T9 review (accepted risk, pinned): a WHOLE fenced tool-JSON reply — no
  // prose at all — dispatches as an action. Any prose defeats the gate (above).
  const fencedTool = _tryExtractRawToolJson('```json\n{"tool": "readFile", "params": {"path": "/etc/hosts"}}\n```');
  assert.ok(fencedTool && fencedTool.mode === 'ACTION' && fencedTool.tool === 'readFile',
    'whole-response fenced tool JSON dispatches as ACTION (pinned accepted behavior)');

  // Clearly intended JSON but unparseable → invalid marker (never persist raw).
  const broken = _tryExtractRawToolJson('{ "tool": ]');
  assert.ok(broken && broken.invalid === true,
    'broken intent-JSON must yield the invalid marker, got ' + JSON.stringify(broken));

  // Source-pin: the backstop must actually be wired inside _processModeResult.
  // Anchor on the call expression (parsed.response) — the helper definition
  // uses (text), so this uniquely hits the call site.
  const src = fs.readFileSync(SOUL, 'utf8');
  const callIdx = src.indexOf('_tryExtractRawToolJson(parsed.response)');
  assert.notStrictEqual(callIdx, -1,
    '_tryExtractRawToolJson must be called on parsed.response — wiring removed?');
  const window = src.slice(Math.max(0, callIdx - 2000), callIdx + 2000);
  assert.ok(window.includes('_processModeResult'),
    'the backstop call must live inside _processModeResult');
  // And it must sit BEFORE the mode switch, so re-dispatch covers every mode path.
  const switchIdx = src.indexOf('switch (mode)', callIdx);
  assert.ok(switchIdx !== -1 && switchIdx - callIdx < 2000,
    'backstop must run before the mode switch in _processModeResult');
  // W6-T9 review (Major 2): re-dispatch must MUTATE parsed in place — recursing
  // with a fresh object leaves the outer frame as CHAT, so `done` carries the
  // raw JSON and the agent loop terminates without feeding the result back.
  assert.ok(!window.includes('return this._processModeResult(rawToolJson'),
    're-dispatch must not recurse with a fresh object (outer frame stays CHAT)');
  assert.ok(window.includes('Object.assign(parsed, rawToolJson)'),
    're-dispatch must mutate parsed in place');
});

// ── W6-T11: soul dispatches setVisibleMode/getVisibleMode ────────────────────
// Both tools are exported by luna-tools.cjs but the dispatch switch had no
// cases for them → "Ferramenta desconhecida". Source-pin the cases AND that
// they actually dispatch (not just mention the names).

test('W6e-a: soul dispatches setVisibleMode/getVisibleMode', () => {
  const src = fs.readFileSync(SOUL, 'utf8');
  assert.ok(src.includes("case 'setVisibleMode'") && src.includes("case 'getVisibleMode'"),
    'dispatch cases must exist in the lunaTools.* switch');
  const idx = src.indexOf("case 'setVisibleMode'");
  const window = src.slice(idx, idx + 800);
  assert.ok(window.includes('lunaTools.setVisibleMode'),
    'setVisibleMode case must call lunaTools.setVisibleMode (dispatch, not just a mention)');
  assert.ok(window.includes('getVisibleMode'),
    'the dispatch window must also read back getVisibleMode');
});

// ── Wave 7 Task 2 (d): honest plan-mode prompt ──────────────────────────────
// The old prompt advertised ipython/python as tools, which collided with
// Kimi's internal IPython ("Execute Python code") — she either used HER
// sandbox believing it was the user's PC, or refused ("não posso acessar").
// The prompt must state the JSON-only mechanism and advertise no ipython tool.
test('W7-T2d: plan-mode prompt — JSON-only mechanism, no ipython tool, ends with json examples', () => {
  const src = fs.readFileSync(SOUL, 'utf8');
  const start = src.indexOf('_buildPlanModePrompt(userInput)');
  assert.notStrictEqual(start, -1, '_buildPlanModePrompt must exist');
  const end = src.indexOf('_stripJsonResponseWrapper', start);
  assert.notStrictEqual(end, -1, 'window end anchor (_stripJsonResponseWrapper) must exist');
  const body = src.slice(start, end);

  // (1) The mechanism sentence: no own tools, JSON blocks executed by Luna on
  // the real PC, refusal is forbidden.
  assert.ok(body.includes('Você NÃO tem ferramentas próprias, nem ipython, nem terminal'),
    'prompt must open with the mechanism sentence (no own tools / no ipython / JSON only)');
  assert.ok(body.includes('a Luna executa no PC Linux real'),
    'mechanism must say Luna executes on the real Linux PC');

  // (2) ipython/python must NOT be advertised as tools. The word "ipython"
  // legitimately appears in the mechanism sentence ("nem ipython"), so assert
  // on the advertised-tools section and on tool entries only.
  const toolsStart = body.indexOf('FERRAMENTAS DE LEITURA PERMITIDAS');
  const toolsEnd = body.indexOf('SINTAXE OBRIGATÓRIA', toolsStart);
  assert.notStrictEqual(toolsStart, -1, 'tools section must exist');
  assert.notStrictEqual(toolsEnd, -1, 'tools section end anchor must exist');
  const toolsSection = body.slice(toolsStart, toolsEnd);
  assert.ok(!/ipython/i.test(toolsSection),
    'advertised read-only tools must not include ipython');
  assert.ok(!/\bpython\b/i.test(toolsSection),
    'advertised read-only tools must not include python');
  assert.ok(!/- ipython/.test(body), 'no ipython tool entry anywhere in the prompt');
  assert.ok(!body.includes('glob, ipython, python'),
    'rule 5 read-only list must not end with ipython/python');

  // (3) Ends with EXACT json examples (tool + response) — owner's standing rule.
  const tail = body.slice(-900);
  assert.ok(tail.includes('EXEMPLOS EXATOS'),
    'prompt tail must contain the exact-examples block');
  assert.ok(tail.includes('json\n{"tool": "readFile"'),
    'prompt tail must contain a fenced json tool example');
  assert.ok(tail.includes('json\n{"response": "# Plano'),
    'prompt tail must contain a fenced json response (plan) example');
});

// ── Wave 8 Task 1 (a): prompt-config edits take effect without restart ──────
// The nexo-dashboard POST /api/luna/config route writes luna-prompt-config.json
// — the file the soul caches via getPromptConfig(). Without cache invalidation,
// UI prompt edits only applied after a process restart.
test('W8-T1a: prompt-config write route invalidates the soul prompt cache', () => {
  const SERVER = path.join(__dirname, '..', '..', '..', 'apps', 'dashboard', 'server.js');
  const src = fs.readFileSync(SERVER, 'utf8');
  const idx = src.indexOf("app.post('/api/luna/config'");
  assert.notStrictEqual(idx, -1, 'POST /api/luna/config route must exist in apps/dashboard/server.js');
  const end = src.indexOf("app.get('/api/luna/diagnose'", idx);
  assert.notStrictEqual(end, -1, 'diagnose route must follow the config route — anchor drifted?');
  const window = src.slice(idx, end);
  assert.ok(window.includes('writeFileSync'), 'route must write the prompt config file');
  assert.ok(window.includes('invalidatePromptCache'),
    'route must call invalidatePromptCache() after writing the config');

  // The soul must export the invalidator for the route to require() it...
  const soulSrc = fs.readFileSync(SOUL, 'utf8');
  const exportsIdx = soulSrc.indexOf('module.exports');
  assert.ok(soulSrc.slice(exportsIdx).includes('invalidatePromptCache'),
    'luna-soul.cjs must export invalidatePromptCache');

  // ...and getPromptConfig must also self-heal cross-process: the writer can
  // live in another process (nexo-dashboard vs luna-server), so the cache
  // must reload when the file mtime changes.
  const gpcIdx = soulSrc.indexOf('function getPromptConfig()');
  assert.notStrictEqual(gpcIdx, -1, 'getPromptConfig must exist');
  const gpcWindow = soulSrc.slice(gpcIdx, gpcIdx + 900);
  assert.ok(gpcWindow.includes('mtime'), 'getPromptConfig must reload on file mtime change');
});

// ── Wave 8 Task 1 (b): follow-up context uses the session workspace ─────────
// The follow-up/toolLoop branch hardcoded workspace 'luna-cli', leaking one
// user's workspace context into every other session AND leaving the tool
// guard without the session user's workspace root on follow-up turns.
test('W8-T1b: follow-up context derives workspace from the session, not literal luna-cli', () => {
  const src = fs.readFileSync(SOUL, 'utf8');
  const start = src.indexOf('SUBSEQUENT MESSAGES / TOOL LOOP');
  assert.notStrictEqual(start, -1, 'follow-up branch must exist in _buildContext');
  const end = src.indexOf('async _processMode', start);
  assert.notStrictEqual(end, -1, 'window end anchor (_processMode) must exist');
  const window = src.slice(start, end);

  assert.ok(!window.includes("'luna-cli'"),
    "follow-up context must not reference the hardcoded 'luna-cli' workspace");
  assert.ok(window.includes('options.userId || session?.userId'),
    'follow-up must derive the user from options.userId / session.userId (same as first-message branch)');
  assert.ok(window.includes('ensureWorkspace(followUpUserId'),
    'follow-up must ensure the session user workspace exists (feeds the tool guard roots)');
  assert.ok(window.includes('getFormattedManifest(followUpUserId)'),
    'workspace manifest must be read for the session user');
  assert.ok(window.includes('getActiveFilesContext(followUpUserId)'),
    'active-files context must be read for the session user');
});

// ── Wave 8 Task 1 (c): config keys honored with hardcoded fallback ──────────
// toolResultPrompt / miniReminder must be read from luna-prompt-config.json;
// the pre-Wave-8 hardcoded texts stay as fallback defaults. loopRules.
// maxAutoContinues must override the MAX_AUTO_CONTINUES constant when set.
test('W8-T1c: toolResultPrompt/miniReminder come from config with fallback defaults', () => {
  const { buildToolResultPrompt, buildMiniReminder } = require('../luna-soul.cjs');

  // Custom config wins (explicit cfg injection = oracle for getPromptConfig()).
  const custom = buildToolResultPrompt(
    { toolsUsed: 'readFile', successCount: '1', totalCount: '1', outputText: 'OK' },
    { toolResultPrompt: 'CUSTOM-RESULT-{{toolsUsed}}-{{outputText}}' }
  );
  assert.strictEqual(custom, 'CUSTOM-RESULT-readFile-OK', 'custom toolResultPrompt must be used and interpolated');

  // Absent config → the pre-Wave-8 hardcoded text.
  const dflt = buildToolResultPrompt(
    { toolsUsed: 'readFile', successCount: '1', totalCount: '2', outputText: 'OUT' },
    null
  );
  assert.ok(dflt.startsWith('✅ FERRAMENTA EXECUTADA — readFile'), 'default toolResultPrompt head changed');
  assert.ok(dflt.includes('📊 STATUS: 1/2 sucesso(s)'), 'default must interpolate counts');
  assert.ok(dflt.includes('📝 RESULTADO:\nOUT'), 'default must interpolate outputText');
  assert.ok(dflt.includes('NUNCA repita readFile com os mesmos parâmetros.'), 'default rules tail changed');

  // miniReminder: custom config wins; absent → shipped default text (interpolated).
  const mr = buildMiniReminder({ USER_ID: 'u1', WORKSPACE: '/ws' }, { miniReminder: 'CUSTOM-REMINDER-{{USER_ID}}' });
  assert.strictEqual(mr, 'CUSTOM-REMINDER-u1', 'custom miniReminder must be used and interpolated');
  const mrDefault = buildMiniReminder({ USER_ID: 'u1', WORKSPACE: '/ws' }, null);
  assert.ok(mrDefault.includes('[LUNA — CONTINUAÇÃO]'), 'default miniReminder must be the shipped text');
  assert.ok(mrDefault.includes('User: u1') && mrDefault.includes('Workspace: /ws'),
    'default miniReminder must interpolate USER_ID/WORKSPACE');

  // Source pins: the helpers must actually be wired into the soul flows.
  const src = fs.readFileSync(SOUL, 'utf8');
  assert.ok(src.includes('loopInput = buildToolResultPrompt({'),
    'tool-loop loopInput must be built via buildToolResultPrompt');
  assert.ok(src.includes('miniReminder: buildMiniReminder') || /miniReminder[,\n]/.test(sliceAround(src, 'interpolateTemplate(followUpTemplate', 400)),
    'follow-up interpolation must expose miniReminder');
  // loopRules.maxAutoContinues must win over the constant.
  const macIdx = src.indexOf('MAX_AUTO_CONTINUES');
  assert.notStrictEqual(macIdx, -1, 'MAX_AUTO_CONTINUES must exist');
  const macWindow = sliceAround(src, 'const MAX_AUTO_CONTINUES', 500);
  assert.ok(macWindow.includes('loopRules'), 'MAX_AUTO_CONTINUES must read config loopRules');
  assert.ok(macWindow.includes(': 3'), 'constant 3 must remain as the fallback default');
});
