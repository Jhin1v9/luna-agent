// wave2-bridge.test.cjs — Wave 2 regression tests (Fix A, Fix B, Fix C, Fix D, Fix E)
// Run: node --test packages/kernel/tests/wave2-bridge.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const BRIDGE_PATH = path.join(__dirname, '..', 'kimi-bridge.cjs');
const INJECTED_PATH = path.join(__dirname, '..', 'luna-extension', 'injected.js');
const OBSERVER_PATH = path.join(__dirname, '..', 'kimi-dom-observer.js');

/**
 * Return a source window of `span` chars centered on the first occurrence of
 * `needle` (empty string when not found). Robust to line-number drift.
 */
const sliceAround = (s, needle, span) => {
  const i = s.indexOf(needle);
  return i === -1 ? '' : s.slice(Math.max(0, i - span / 2), i + span / 2);
};

/**
 * Extract the Kimi `textContent` selector string from a SELECTORS definition:
 * the `textContent:` line that follows the Kimi-branch marker `.segment-assistant`
 * (or, in the observer, the single SELECTORS object which is Kimi-only).
 */
function extractKimiTextContentLine(src, fileLabel) {
  const lines = src.split('\n');
  const matches = lines.filter(l => l.includes('textContent:') && l.includes('.segment-text'));
  assert.strictEqual(matches.length, 1, `${fileLabel}: exactly one Kimi textContent line expected (found ${matches.length})`);
  return matches[0];
}

/**
 * Locate the body of `pollWithTimeout` defined inside `_pollThinkingAndResponse`
 * and return its source slice. Robust to line-number drift: searches for the
 * `pollWithTimeout` token that appears AFTER `_pollThinkingAndResponse`, then
 * brace-matches from the opening `{` of the arrow function.
 */
function extractPollWithTimeoutBody(src) {
  const methodIdx = src.indexOf('_pollThinkingAndResponse');
  assert.notStrictEqual(methodIdx, -1, '_pollThinkingAndResponse must exist in kimi-bridge.cjs');

  const pollIdx = src.indexOf('pollWithTimeout', methodIdx);
  assert.notStrictEqual(pollIdx, -1, 'pollWithTimeout must exist inside _pollThinkingAndResponse');

  const openBrace = src.indexOf('{', pollIdx);
  assert.notStrictEqual(openBrace, -1, 'pollWithTimeout arrow body must open with {');

  let depth = 0;
  for (let i = openBrace; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(openBrace, i + 1);
    }
  }
  assert.fail('pollWithTimeout body braces never balanced');
}

test('A1: session declaration is hoisted above the generic-provider block in pollWithTimeout', () => {
  const src = fs.readFileSync(BRIDGE_PATH, 'utf8');
  const body = extractPollWithTimeoutBody(src);

  const decl = 'const session = userId ? this.userSessions.get(userId) : null;';
  const genericBlock = "if (provider !== 'kimi')";

  const declIdx = body.indexOf(decl);
  assert.notStrictEqual(declIdx, -1, 'session declaration must exist in pollWithTimeout');

  // Exactly ONE declaration — the inner one inside the generic block must be gone,
  // otherwise the hoisted one would be shadowed (or a redeclaration SyntaxError).
  const occurrences = body.split(decl).length - 1;
  assert.strictEqual(occurrences, 1, `session declaration must appear exactly once in pollWithTimeout (found ${occurrences})`);

  const genericIdx = body.indexOf(genericBlock);
  assert.notStrictEqual(genericIdx, -1, "generic-provider block `if (provider !== 'kimi')` must exist");

  assert.ok(
    declIdx < genericIdx,
    'session declaration must appear BEFORE the generic-provider block so the shared empty-extraction tail can use it for the Kimi provider'
  );
});

test('A1b: empty-extraction tail references the hoisted session (empty-wait branch is reachable)', () => {
  const src = fs.readFileSync(BRIDGE_PATH, 'utf8');
  const body = extractPollWithTimeoutBody(src);

  assert.ok(
    body.includes("source: 'empty-wait'"),
    'empty-wait branch must exist in pollWithTimeout'
  );
  assert.ok(
    body.includes('session._lastEmptyLayersLogAt'),
    'empty-extraction tail must reference session._lastEmptyLayersLogAt'
  );

  // The tail must sit AFTER the generic-provider block — i.e. the session it
  // references can only be the hoisted declaration.
  const genericIdx = body.indexOf("if (provider !== 'kimi')");
  const tailIdx = body.indexOf('session._lastEmptyLayersLogAt');
  assert.ok(tailIdx > genericIdx, 'empty-extraction tail must follow the generic-provider block');
});

// ── Fix B: parent .markdown-container removed from Kimi textContent selectors ──

for (const [label, filePath] of [
  ['injected.js', INJECTED_PATH],
  ['kimi-dom-observer.js', OBSERVER_PATH],
]) {
  test(`B1: ${label} Kimi textContent selector excludes parent .markdown-container, keeps leaf .segment-text`, () => {
    const src = fs.readFileSync(filePath, 'utf8');
    const line = extractKimiTextContentLine(src, label);

    assert.ok(
      !line.includes('.markdown-container'),
      `${label}: textContent must NOT contain .markdown-container (parent of leaf text nodes — caused doubled paragraphs). Line: ${line.trim()}`
    );
    assert.ok(
      line.includes('.segment-text'),
      `${label}: textContent must still contain leaf selector .segment-text. Line: ${line.trim()}`
    );
    assert.ok(
      line.includes('.message-content'),
      `${label}: textContent must still contain leaf selector .message-content. Line: ${line.trim()}`
    );
  });
}

test('B1b: DeepSeek textContent selector is intentionally left unchanged pending live-DOM verification', () => {
  const src = fs.readFileSync(INJECTED_PATH, 'utf8');
  const dsLine = src.split('\n').find(l => l.includes("textContent: '.ds-markdown"));
  assert.ok(dsLine, 'injected.js: DeepSeek textContent line must still exist');
  assert.ok(
    dsLine.includes('.ds-markdown, .message-content'),
    'DeepSeek selector must be unchanged (only a comment documents the unverified nesting assumption)'
  );
});

// ── Fix C: extension event buffers filtered by tab URL (cross-user theft) ──

const { KimiBridge } = require(BRIDGE_PATH);

// _consumeExtensionEvents only reads global.__lunaExtensionEventBuffers and
// the module-scoped logger — no `this` state is touched, so a bare {} is a
// sufficient fake receiver.
const consume = (url) => KimiBridge.prototype._consumeExtensionEvents.call({}, url);

function seedBuffers(entries) {
  // entries: Array<[extSessionId, events[]]>
  global.__lunaExtensionEventBuffers = new Map(entries);
}

function streamStateEvent(urlFields, response) {
  return { eventType: 'stream_state', data: { response, thinking: '' }, ...urlFields };
}

test.afterEach(() => {
  delete global.__lunaExtensionEventBuffers;
});

test('C1a: two buffers — consuming for URL A returns only A\u2019s events, B\u2019s buffer untouched', () => {
  const urlA = 'https://kimi.ai/chat/thread-a';
  const urlB = 'https://kimi.ai/chat/thread-b';
  seedBuffers([
    ['ext-A', [streamStateEvent({ url: urlA, tabUrl: urlA }, 'A text')]],
    ['ext-B', [streamStateEvent({ url: urlB, tabUrl: urlB }, 'B text')]],
  ]);

  const events = consume(urlA);

  assert.strictEqual(events.length, 1, 'exactly one event consumed');
  assert.strictEqual(events[0].type, 'state_change');
  assert.strictEqual(events[0].response, 'A text');

  const buffers = global.__lunaExtensionEventBuffers;
  assert.ok(!buffers.has('ext-A') || buffers.get('ext-A').length === 0, 'A buffer emptied or deleted');
  assert.deepStrictEqual(
    buffers.get('ext-B'),
    [streamStateEvent({ url: urlB, tabUrl: urlB }, 'B text')],
    'B buffer must be UNTOUCHED'
  );
});

test('C1b: tracking query string (?utm=...) still matches the same thread', () => {
  const clean = 'https://kimi.ai/chat/thread-x';
  const dirty = 'https://kimi.ai/chat/thread-x?utm_source=telegram&ref=abc#frag';
  seedBuffers([
    ['ext-1', [streamStateEvent({ url: dirty, tabUrl: dirty + '/' }, 'tracked')]],
  ]);

  const events = consume(clean);

  assert.strictEqual(events.length, 1, 'event with tracking params must be consumed for the same thread');
  assert.strictEqual(events[0].response, 'tracked');
});

test('C1c: no-url events + two buffers → none consumed (ownership unknown)', () => {
  seedBuffers([
    ['ext-1', [streamStateEvent({}, 'orphan-1')]],
    ['ext-2', [streamStateEvent({}, 'orphan-2')]],
  ]);

  const events = consume('https://kimi.ai/chat/anything');

  assert.strictEqual(events.length, 0, 'no-url events must NOT be consumed when multiple buffers exist');
  assert.strictEqual(global.__lunaExtensionEventBuffers.get('ext-1').length, 1, 'buffer 1 untouched');
  assert.strictEqual(global.__lunaExtensionEventBuffers.get('ext-2').length, 1, 'buffer 2 untouched');
});

test('C1d: no-url events + exactly one buffer → consumed (single-user dev preserved)', () => {
  seedBuffers([
    ['ext-1', [streamStateEvent({}, 'orphan')]],
  ]);

  const events = consume('https://kimi.ai/chat/anything');

  assert.strictEqual(events.length, 1, 'no-url events must be consumed when only one buffer exists');
  assert.strictEqual(events[0].response, 'orphan');
  assert.ok(
    !global.__lunaExtensionEventBuffers.has('ext-1') || global.__lunaExtensionEventBuffers.get('ext-1').length === 0,
    'single buffer emptied or deleted after consumption'
  );
});

// C2: pin the handler-side event shape the filter depends on. If
// luna-extension-handler.cjs ever renames/moves `url`/`tabUrl`, the bridge
// filter silently treats every event as no-url — this test must fail first.
test('C2: handler buffers events with top-level url/tabUrl (shape contract)', () => {
  const handlerSrc = fs.readFileSync(
    require('node:path').join(__dirname, '../../../apps/dashboard/luna-extension-handler.cjs'),
    'utf8'
  );
  assert.ok(
    /_bufferEvent\(sessionId,\s*\{\s*eventType,\s*data,\s*timestamp,\s*url,\s*tabId,\s*tabUrl\s*\}\)/.test(handlerSrc),
    'handler must buffer events with flat top-level url/tabUrl — the bridge filter reads raw.tabUrl || raw.url'
  );
});

// ── Fix D: DOM poller bounded to stream + premature completion guard ──

const { isPrematureCompletion } = require(path.join(__dirname, '..', 'lib', 'stream-completion-guard.cjs'));

test('D3a: isPrematureCompletion — empty state (nothing streamed yet) is premature', () => {
  assert.strictEqual(isPrematureCompletion({ lastResponse: '', lastThinking: '' }), true);
  assert.strictEqual(isPrematureCompletion({ lastResponse: undefined, lastThinking: undefined }), true);
  assert.strictEqual(isPrematureCompletion({ lastResponse: null, lastThinking: null }), true);
});

test('D3b: isPrematureCompletion — any response text seen → not premature', () => {
  assert.strictEqual(isPrematureCompletion({ lastResponse: 'Hello', lastThinking: '' }), false);
  assert.strictEqual(isPrematureCompletion({ lastResponse: 'Hello', lastThinking: 'hmm' }), false);
});

test('D3c: isPrematureCompletion — any thinking text seen → not premature', () => {
  assert.strictEqual(isPrematureCompletion({ lastResponse: '', lastThinking: 'reasoning...' }), false);
});

/**
 * Extract the `finally` block of sendMessageStream (the stream-end cleanup).
 * Brace-matches from the `finally {` that follows the method signature.
 */
function extractSendMessageStreamFinally(src) {
  const methodIdx = src.indexOf('async *sendMessageStream(');
  assert.notStrictEqual(methodIdx, -1, 'sendMessageStream must exist in kimi-bridge.cjs');

  const finallyIdx = src.indexOf('} finally {', methodIdx);
  assert.notStrictEqual(finallyIdx, -1, 'sendMessageStream must have a finally block');

  const openBrace = src.indexOf('{', finallyIdx);
  let depth = 0;
  for (let i = openBrace; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(openBrace, i + 1);
    }
  }
  assert.fail('sendMessageStream finally block braces never balanced');
}

test('D1: sendMessageStream finally stops the DOM poller BEFORE clearing processing', () => {
  const src = fs.readFileSync(BRIDGE_PATH, 'utf8');
  const finallyBody = extractSendMessageStreamFinally(src);

  const stopIdx = finallyBody.indexOf('_stopDomPoller');
  assert.notStrictEqual(stopIdx, -1, 'finally must call _stopDomPoller (poller is now bounded to the active stream)');

  const processingIdx = finallyBody.indexOf('processing = false');
  assert.notStrictEqual(processingIdx, -1, 'finally must still clear session.processing');

  assert.ok(
    stopIdx < processingIdx,
    '_stopDomPoller must run BEFORE session.processing = false so the poller stops while the turn is still marked active'
  );

  assert.ok(
    !finallyBody.includes('NÃO paramos o DOM poller'),
    'v7.0 keep-poller-running comment must be gone — the poller no longer survives the stream'
  );
});

// D2: pin the post-Enter purge — it must sit right after _pressEnterOnInput
// and clear queue events, lastReadIndex, and _completionState.
test('D2: sendMessageStream purges stale queue right after Enter (content assertion)', () => {
  const src = fs.readFileSync(BRIDGE_PATH, 'utf8');
  // Multiple functions call _pressEnterOnInput; the purge lives in
  // sendMessageStream, right after its 'Step 6' log line.
  const enterIdx = src.indexOf("log.info(`[DEBUG-LUNA] Step 6: pressing Enter`);");
  assert.ok(enterIdx !== -1, 'sendMessageStream Enter step must exist');
  const window = src.slice(enterIdx, enterIdx + 800);
  assert.ok(window.includes('queue.events.length = 0;'), 'purge must clear queue.events');
  assert.ok(window.includes('queue.lastReadIndex = 0;'), 'purge must reset lastReadIndex');
  assert.ok(window.includes('session._completionState = null'), 'purge must reset completion state');
});

// ── Fix E: per-source response cursors with cross-source prefix guard ──

const { createResponseCursor } = require(path.join(__dirname, '..', 'lib', 'stream-text-cursor.cjs'));

test('E1a: same source monotonic growth → exact deltas, no repeats', () => {
  const c = createResponseCursor();

  assert.deepStrictEqual(c.next('chrome_extension', 'Hel'), { emit: 'Hel', diverged: false });
  assert.deepStrictEqual(c.next('chrome_extension', 'Hello'), { emit: 'lo', diverged: false });
  assert.deepStrictEqual(c.next('chrome_extension', 'Hello world'), { emit: ' world', diverged: false });

  // Same full text again → nothing re-emitted
  assert.deepStrictEqual(c.next('chrome_extension', 'Hello world'), { emit: null, diverged: false });
  assert.strictEqual(c.committed, 'Hello world');
});

test('E1b: two sources, same text, different chunking → no duplication, committed == final text', () => {
  const c = createResponseCursor();

  // Extension streams in small chunks
  assert.deepStrictEqual(c.next('chrome_extension', 'Hello '), { emit: 'Hello ', diverged: false });
  assert.deepStrictEqual(c.next('chrome_extension', 'Hello world'), { emit: 'world', diverged: false });

  // Poll arrives with the same text in one shot — everything already committed
  assert.deepStrictEqual(c.next('dom_poll', 'Hello world'), { emit: null, diverged: false });

  // Poll then gets ahead — only the genuinely new suffix is emitted
  assert.deepStrictEqual(c.next('dom_poll', 'Hello world!'), { emit: '!', diverged: false });

  assert.strictEqual(c.committed, 'Hello world!', 'total committed must equal the final text exactly once');
});

test('E1c: internally-duplicated source (pre-Fix-B "HelloHello" shape) → divergence flagged, no garbage emitted', () => {
  const c = createResponseCursor();

  // Clean source commits the real text first
  assert.deepStrictEqual(c.next('dom_poll', 'Hello'), { emit: 'Hello', diverged: false });
  assert.deepStrictEqual(c.next('dom_poll', 'Hello world'), { emit: ' world', diverged: false });

  // Doubled-paragraph producer shows up with internally duplicated text
  const res = c.next('chrome_extension', 'HelloHello world');
  assert.strictEqual(res.diverged, true, 'divergence must be flagged');
  assert.strictEqual(res.emit, null, 'divergent chunk must be swallowed');
  assert.strictEqual(c.committed, 'Hello world', 'committed text must be untouched by the divergent source');
});

test('E1d: source shrink (DOM rebuild) → no emit, cursor reset, subsequent growth emits correctly', () => {
  const c = createResponseCursor();

  assert.deepStrictEqual(c.next('dom_poll', 'Hello'), { emit: 'Hello', diverged: false });
  assert.deepStrictEqual(c.next('dom_poll', 'Hello world'), { emit: ' world', diverged: false });

  // DOM rebuild: the source shrinks — move the cursor, emit nothing
  assert.deepStrictEqual(c.next('dom_poll', 'Hello w'), { emit: null, diverged: false });

  // Growth from the reset cursor resumes normally off the committed prefix
  assert.deepStrictEqual(c.next('dom_poll', 'Hello world again'), { emit: ' again', diverged: false });
  assert.strictEqual(c.committed, 'Hello world again');
});

test('E1e: trailing-whitespace difference between sources is tolerated (no permanent divergence lock)', () => {
  const c = createResponseCursor();

  // Extension keeps the trailing space, the poll producer trims it
  assert.deepStrictEqual(c.next('chrome_extension', 'Hello '), { emit: 'Hello ', diverged: false });

  // Trimmed full text: not an extension of committed, but of committed(trimEnd) — tolerated
  assert.deepStrictEqual(c.next('dom_poll', 'Hello'), { emit: null, diverged: false });

  // The trimmed source keeps streaming — must NOT be locked out as divergent
  assert.deepStrictEqual(c.next('dom_poll', 'Hello world'), { emit: 'world', diverged: false });
  assert.strictEqual(c.committed, 'Hello world');
});

test('E1f: diverged flag returned and committed unchanged on cross-source disagreement', () => {
  const c = createResponseCursor();

  assert.deepStrictEqual(c.next('dom_poll', 'Hello world'), { emit: 'Hello world', diverged: false });
  const before = c.committed;

  const res = c.next('chrome_extension', 'Completely different text');
  assert.strictEqual(res.diverged, true);
  assert.strictEqual(res.emit, null);
  assert.strictEqual(c.committed, before, 'committed must be unchanged after a divergent event');
});

test('W6-T1: new-assistant wait loop is bounded and cancellable', () => {
  const src = fs.readFileSync(BRIDGE_PATH, 'utf8');
  // Anchor on the generator definition (plain 'sendMessageStream' also appears
  // in earlier comments), then locate the loop's own selector probe.
  // W6-T6 adaptation: the pre-send marker capture added an EARLIER
  // querySelectorAll('.segment-assistant') inside sendMessageStream, so the
  // loop is now anchored on its unique 'New assistant detected' log line
  // (all four needles sit within -1293..-849 chars of it).
  const streamIdx = src.indexOf('async *sendMessageStream');
  assert.notStrictEqual(streamIdx, -1, 'sendMessageStream must exist');
  const loopIdx = src.indexOf('New assistant detected', streamIdx);
  assert.notStrictEqual(loopIdx, -1, 'new-assistant loop must exist');
  const window = src.slice(Math.max(0, loopIdx - 1500), loopIdx + 1500);
  assert.ok(window.includes('NEW_ASSISTANT_TIMEOUT_MS = 120_000'), 'loop must have a timeout constant');
  assert.ok(window.includes('Date.now() > newAssistantDeadline'), 'loop must check the deadline');
  assert.ok(window.includes('NO_ASSISTANT_DETECTED'), 'loop must throw a visible error on expiry');
  assert.ok(window.includes("if (stopConsuming) throw new Error('STREAM_CANCELLED')"), 'loop body must break on cancel');
});

// ── W6-T3: the three infinite send waits in sendMessageStream ──
// NOTE (adaptation): the task-spec needles 'already processing' and
// 'textHasChanged' first match OUT OF SCOPE sites (sendImage queue at :3074,
// another method at :2710). Anchored instead on strings unique to the three
// target sites inside sendMessageStream.

test('W6-T3: pre-send processing drain is bounded and self-healing', () => {
  const window = sliceAround(fs.readFileSync(BRIDGE_PATH, 'utf8'), 'waiting for drain', 2000);
  assert.ok(window.includes('PROCESSING_DRAIN_TIMEOUT_MS'), 'drain wait must be bounded');
  assert.ok(/processing = false/.test(window), 'expired drain must force-clear the dead processing flag');
});

test('W6-T3: Phase 0 has a generation-start timeout', () => {
  const window = sliceAround(fs.readFileSync(BRIDGE_PATH, 'utf8'), 'Phase 0: waiting for first text change', 3000);
  assert.ok(window.includes('GENERATION_START_TIMEOUT_MS'), 'Phase 0 must be bounded');
  assert.ok(/GENERATION_NEVER_STARTED/.test(window), 'Phase 0 expiry must throw a visible error');
});

test('W6-T3: Phase 1 safety timeout is re-enabled (large but real)', () => {
  const src = fs.readFileSync(BRIDGE_PATH, 'utf8');
  assert.ok(/MESSAGE_SAFETY_TIMEOUT_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/.test(src), 'safety timeout constant must exist at 60min');
  assert.ok(!src.includes('Safety timeout disabled'), 'the disabled comment must be gone');
  const checkIdx = src.indexOf('Date.now() - messageStartTime > MESSAGE_SAFETY_TIMEOUT_MS');
  assert.ok(checkIdx !== -1, 'the expiry check must exist');
  const window = src.slice(checkIdx, checkIdx + 600);
  assert.ok(window.includes('isComplete = true'), 'expiry must force completion');
  assert.ok(window.includes('break'), 'expiry must break the wait loop into the final-extraction tail');
});

// ── W6-T6: turn-scoped phantom-action detection ──
// NOTE (adaptation): plain '_enqueueDomEvent' / 'sendMessageStream' first match
// call sites and comments OUT OF SCOPE (same problem W6-T1/T3 hit). Anchored on
// the definition signatures instead.

test('W6-T6a: _enqueueDomEvent consults a cross-turn seen-set', () => {
  const src = fs.readFileSync(BRIDGE_PATH, 'utf8');
  const defIdx = src.indexOf('_enqueueDomEvent(userId, event)');
  assert.notStrictEqual(defIdx, -1, '_enqueueDomEvent definition must exist');
  const window = src.slice(Math.max(0, defIdx - 500), defIdx + 2500);
  assert.ok(/_domEventSeen|seenDomEvents/.test(window), 'enqueue must consult a cross-turn seen-set');
});

test('W6-T6b: sendMessageStream captures the pre-send assistant marker and dom detectors use it', () => {
  const src = fs.readFileSync(BRIDGE_PATH, 'utf8');
  const markerRe = /_turnAssistant(Marker|Index|Count)|preSendAssistant/;

  const streamIdx = src.indexOf('async *sendMessageStream');
  assert.notStrictEqual(streamIdx, -1, 'sendMessageStream definition must exist');
  const streamWindow = src.slice(streamIdx, streamIdx + 16000);
  // Pin the actual assignment — the unrelated v7.7 variable preSendAssistantCount
  // used to satisfy the old markerRe and made this assertion vacuous.
  assert.ok(/session\._turnAssistantMarker\s*=/.test(streamWindow),
    'a pre-send assistant marker must be assigned at send start');
  // W6-T6 review follow-up: the marker must come from the pre-Enter snapshot
  // count — a post-Enter evaluate races Kimi's optimistic placeholder render
  // and can exclude the whole turn from DOM scanning.
  // (Needle must include 'resolvedProvider': bare 'session._turnAssistantMarker ='
  // is a prefix of the poll's '===  'number' check and anchors on the wrong site.)
  const assignWindow = sliceAround(src, 'session._turnAssistantMarker = resolvedProvider', 400);
  assert.ok(assignWindow.includes('preSendAssistantCount'),
    'marker must reuse the race-free pre-send snapshot count');

  // 'dom-structure' first occurs at the source tag; the marker-scoped evaluate
  // sits ~7.5k chars before it — span 20000 covers both.
  // W10-T2: needle tightened to the source tag itself — the bridge now
  // requires bridge-libs/dom-scripts/poll-dom-structure.js at the top of the
  // file, whose path contains the bare 'dom-structure' substring and stole
  // the old anchor.
  const domWindow = sliceAround(src, "source: 'dom-structure'", 20000);
  assert.ok(markerRe.test(domWindow), 'dom-structure poll must use the marker to skip pre-turn segments');

  // '_extractJsonBlocksFromDOM' first occurs at its poller call site, which must
  // pass the session marker (definition keeps the param optional).
  const jsonWindow = sliceAround(src, '_extractJsonBlocksFromDOM', 3000);
  assert.ok(markerRe.test(jsonWindow), '_extractJsonBlocksFromDOM must receive/use the marker');
});

// ── W6-T9: {"script"} JSON must never be silently dropped ──
// Kimi's DOM renders script JSON with LITERAL newlines inside string values.
// Strict JSON.parse rejects that; the recovered object must expose .script.

test('W6-T9a: extractResponseFromCompleteJson recovers script with literal newlines', () => {
  const { extractResponseFromCompleteJson } = require(BRIDGE_PATH);
  // Literal \n INSIDE the string value — exactly what the Kimi DOM delivers.
  const raw = '{"script": "#!/bin/bash\nset -e\nmkdir -p /tmp/x", "language": "bash"}';
  const r = extractResponseFromCompleteJson(raw);
  assert.ok(r && r.type === 'script' && typeof r.script === 'string',
    'script must be recovered, got ' + JSON.stringify(r));
  assert.ok(r.script.includes('mkdir -p'), 'script body must survive the newline walker');

  // Same recovery must hold for a chat response with a literal newline.
  const r2 = extractResponseFromCompleteJson('{"response": "linha um\nlinha dois"}');
  assert.ok(r2 && r2.type === 'response' && r2.text.includes('linha dois'),
    'response with literal newline must be recovered, got ' + JSON.stringify(r2));
});

test('W6-T9b: _extractJsonToolCalls Strategy 2 matches the script key', () => {
  const { _extractJsonToolCalls } = require(BRIDGE_PATH);
  const tools = _extractJsonToolCalls('text before {"script": "echo oi", "language": "bash"} text after');
  assert.strictEqual(tools.length, 1, 'exactly one tool call expected, got ' + JSON.stringify(tools));
  assert.strictEqual(tools[0].tool, 'executeScript',
    'script JSON must map to executeScript, got ' + JSON.stringify(tools[0]));
  assert.ok(tools[0].params.code.includes('echo oi'),
    'executeScript params.code must carry the script body');
});

// ── W6-T12: DeepSeek force-complete cap ──
// UI completion heuristics (cursor blink etc.) can keep isGenerating=true
// forever on generic providers. A pure cap must force completion after 45s
// visible + 10s length-stable so tools are still delivered.

test('W6-T12a: force-complete decision fires after cap with stable length', () => {
  const { _shouldForceGenericComplete } = require(BRIDGE_PATH);
  const now = Date.now();
  assert.strictEqual(_shouldForceGenericComplete({ firstSeenAt: now - 50_000, lastLengthChangeAt: now - 12_000, uiGenerating: true }, now), true,
    'past cap + length-stable 10s must force-complete even while UI says generating');
  assert.strictEqual(_shouldForceGenericComplete({ firstSeenAt: now - 10_000, lastLengthChangeAt: now - 12_000, uiGenerating: true }, now), false,
    'before the 45s cap must not force');
  assert.strictEqual(_shouldForceGenericComplete({ firstSeenAt: now - 50_000, lastLengthChangeAt: now - 2_000, uiGenerating: true }, now), false,
    'still-growing text (< 10s length-stable) must not force');
  assert.strictEqual(_shouldForceGenericComplete({ firstSeenAt: now - 50_000, lastLengthChangeAt: now - 12_000, uiGenerating: false }, now), false,
    'must not force when the UI already reports not-generating');
});

test('W6-T12b: generic-provider block wires the force-complete helper', () => {
  const src = fs.readFileSync(BRIDGE_PATH, 'utf8');
  // Anchor on the turn-tracking field: its first occurrence IS the generic
  // block wiring ('detectedTools' would anchor the dom-structure in-page code).
  const window = sliceAround(src, '_genericFirstSeenAt', 8000);
  assert.ok(window.includes('_shouldForceGenericComplete'),
    'generic completion must consult the force-complete helper');
  assert.ok(window.includes('generic-provider'),
    'slice must sit inside the generic-provider block');
});

// ── W7-T4: verify-and-retry submit (typed messages never sit unsent) ──

test('W7-T4a: sendMessageStream fills via _fillContentEditable (no direct fill(text)) and submits via _submitWithVerification', () => {
  const src = fs.readFileSync(BRIDGE_PATH, 'utf8');
  const streamIdx = src.indexOf('async *sendMessageStream(');
  assert.notStrictEqual(streamIdx, -1, 'sendMessageStream must exist');
  const step6Idx = src.indexOf('Step 6: pressing Enter', streamIdx);
  assert.notStrictEqual(step6Idx, -1, 'stream Enter step must exist');
  const window = src.slice(streamIdx, step6Idx + 600);

  assert.ok(window.includes('this._fillContentEditable(inputLocator, text)'),
    'stream must fill the input via the Lexical-safe helper');
  assert.ok(!window.includes('inputLocator.fill(text)'),
    'stream must NOT use Playwright fill(text) directly (desyncs the Lexical EditorState — Enter becomes a no-op)');
  assert.ok(window.includes('this._submitWithVerification(page, inputLocator, text'),
    'stream must submit via _submitWithVerification');
});

test('W7-T4b: _submitWithVerification is called at every submit point', () => {
  const src = fs.readFileSync(BRIDGE_PATH, 'utf8');
  const callCount = src.split('this._submitWithVerification(').length - 1;
  assert.ok(callCount >= 5, `_submitWithVerification must be called at >= 5 submit points (found ${callCount})`);

  const windowBetween = (startNeedle, endNeedle) => {
    const start = src.indexOf(startNeedle);
    assert.notStrictEqual(start, -1, `${startNeedle} must exist`);
    const end = src.indexOf(endNeedle, start + startNeedle.length);
    assert.notStrictEqual(end, -1, `${endNeedle} must exist after ${startNeedle}`);
    return src.slice(start, end);
  };

  // The 5 submit points from the owner report (sendMessageStream is pinned
  // by W7-T4a above; sendMessageNoWait also wired as a 6th, low-risk site).
  const sites = [
    ['async sendMessage(userId', 'async sendMessageNoWait('],
    ['async sendMessageNoWait(', 'async getStatus('],
    ['async sendImage(', 'async sendFile('],
    ['async sendFile(userId', 'async _sendFileViaWebBridge('],
    ['async anonymousConsult(', null],
  ];
  for (const [start, end] of sites) {
    const window = end ? windowBetween(start, end) : src.slice(src.indexOf(start));
    assert.ok(window.includes('this._submitWithVerification('),
      `${start} must submit via _submitWithVerification`);
  }
});

test('W7-T4c: _submitWithVerification implements the 3-strategy chain with post-submit verification and SEND_NOT_CONFIRMED', () => {
  const src = fs.readFileSync(BRIDGE_PATH, 'utf8');
  const defIdx = src.indexOf('async _submitWithVerification(page, inputLocator, text');
  assert.notStrictEqual(defIdx, -1, '_submitWithVerification must be defined');
  const body = src.slice(defIdx, defIdx + 6000);

  assert.ok(body.includes('this._pressEnterOnInput(inputLocator)'),
    'strategy 1 must be the synthetic KeyboardEvent Enter');
  assert.ok(body.includes("page.keyboard.press('Enter')"),
    'strategy 2 must include a TRUSTED Enter via Playwright keyboard');
  assert.ok(body.includes('this._fillContentEditable(inputLocator, text'),
    'strategy 2 must re-fill via the Lexical-safe helper');
  assert.ok(body.includes('.send-button-container'),
    'strategy 3 must click the send-button-container (same selector as the steer)');
  assert.ok(body.includes('.segment-assistant'),
    'verification must watch for a new assistant segment');
  assert.ok(body.includes('SEND_NOT_CONFIRMED: texto permanece no input do ${providerDisplayName(submitCfg)}'),
    'must throw a clear SEND_NOT_CONFIRMED error after all attempts');
});

test('W7-T4d: error-path input cleanup uses _fillContentEditable(locator, \'\') — no fill(\'\') left', () => {
  const src = fs.readFileSync(BRIDGE_PATH, 'utf8');
  assert.ok(!src.includes(".fill('')"),
    "no fill('') cleanup may remain — it does not clear the Lexical EditorState");
  const lexicalClears = src.split('this._fillContentEditable(page.locator(\'textarea, [contenteditable="true"]\').first(), \'\')').length - 1;
  assert.ok(lexicalClears >= 5,
    `all 5 catch cleanups must use _fillContentEditable(locator, '') (found ${lexicalClears})`);
});

test('W7-T4e: submit verification is transition-based against a pre-submit baseline (no pre-existing DOM state counts)', () => {
  const src = fs.readFileSync(BRIDGE_PATH, 'utf8');
  const defIdx = src.indexOf('async _submitWithVerification(page, inputLocator, text');
  assert.notStrictEqual(defIdx, -1, '_submitWithVerification must be defined');
  const body = src.slice(defIdx, defIdx + 6000);

  // Baseline captured BEFORE the strategy loop: stop-button leftover from a
  // previous turn or a send button disabled on an empty input must never
  // count as a successful submit (review follow-up — the initial version
  // confirmed on any disabled button / any generating state, even ones that
  // pre-dated the submit).
  assert.ok(body.includes('baseline.generating'),
    'generating signal must be gated on the pre-submit baseline (false→true transition)');
  assert.ok(body.includes('baseline.sendDisabled'),
    'send-disabled signal must be gated on the pre-submit baseline (false→true transition)');
  assert.ok(body.includes('state.assistants > baseline.assistants'),
    'assistant signal must be a count increase vs the pre-submit baseline');
  // An input clear only proves the send if the box was OBSERVED holding the
  // typed text first — a silent fill failure must not look like a submit.
  assert.ok(body.includes('inputHeldPrefix'),
    'input-clear signal must require the text to have been observed in the box first');
});

test('W7-T4f: injectSteer also fills via the Lexical-safe helper (no desync-prone fill(text) left in any submit path)', () => {
  const src = fs.readFileSync(BRIDGE_PATH, 'utf8');
  const steerIdx = src.indexOf('async injectSteer(userId, text)');
  assert.notStrictEqual(steerIdx, -1, 'injectSteer must exist');
  const endIdx = src.indexOf('async *sendMessageStream(', steerIdx);
  assert.notStrictEqual(endIdx, -1, 'sendMessageStream must follow injectSteer');
  const window = src.slice(steerIdx, endIdx);

  assert.ok(window.includes('this._fillContentEditable(inputLocator, text)'),
    'steer must fill via the Lexical-safe helper — a desynced fill() makes the send-button click a silent no-op');
  assert.ok(!window.includes('inputLocator.fill(text)'),
    'no submit path may use Playwright fill(text) directly (desyncs the Lexical EditorState)');
});

// ── W8-T2: string-aware tool-JSON extraction everywhere ──

test('W8-T2a: _extractJsonToolCalls parses writeFile whose content has braces/HTML/JS inside strings (full params round-trip)', () => {
  const { _extractJsonToolCalls } = require(BRIDGE_PATH);
  // Realistic HTML/JS payload: balanced {} blocks PLUS a lone "}" inside a
  // string literal. The pre-W8 regex + naive brace counting cut the slice at
  // that internal brace → JSON.parse failed → the tool was silently dropped.
  const content = [
    '<div class="card">',
    '  <h1>Título</h1>',
    '</div>',
    '<script>',
    'function main() {',
    '  const data = { a: 1 };',
    '  console.log("}");',
    '}',
    '</script>',
  ].join('\n');
  const payload = { tool: 'writeFile', params: { path: '/tmp/w8-t2a.html', content } };
  const text = 'Aqui está o arquivo:\n' + JSON.stringify(payload) + '\nPronto.';

  const tools = _extractJsonToolCalls(text);
  assert.strictEqual(tools.length, 1, 'exactly one tool expected, got ' + JSON.stringify(tools));
  assert.strictEqual(tools[0].tool, 'writeFile');
  assert.deepStrictEqual(tools[0].params, payload.params,
    'params must round-trip EXACTLY — braces/quotes inside the content string must not truncate the slice');
});

/**
 * Pull a top-level function body out of injected.js by signature, with a
 * string-aware brace matcher (the extractor itself contains '{'/'}' char
 * literals, so naive counting overruns).
 */
function extractExtensionFunctionSource(src, signature) {
  const idx = src.indexOf(signature);
  assert.notStrictEqual(idx, -1, `${signature} must exist in injected.js`);
  const openBrace = src.indexOf('{', idx);
  assert.notStrictEqual(openBrace, -1, `${signature} must open a body`);
  let depth = 0, inStr = false, strCh = '', escape = false, inComment = false;
  for (let i = openBrace; i < src.length; i++) {
    const ch = src[i];
    if (inComment) { if (ch === '\n') inComment = false; continue; }
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (inStr) { if (ch === strCh) inStr = false; continue; }
    if (ch === '/' && src[i + 1] === '/') { inComment = true; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = true; strCh = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(idx, i + 1);
    }
  }
  assert.fail(`${signature} braces never balanced`);
}

test('W8-T2b: extension extractFirstJsonObject round-trips nested params the old non-greedy regex truncated', () => {
  const src = fs.readFileSync(INJECTED_PATH, 'utf8');
  // The old fallback regex must be GONE from the fallback path.
  assert.ok(!src.includes('text.match(/\\{[\\s\\S]*?\\}/)'),
    'detectJsonBlocks must no longer use the non-greedy regex fallback');

  // Unit the real algorithm: eval the function source lifted from injected.js
  // (the extension IIFE has no exports and touches window, so importing the
  // module is not an option).
  const fnSrc = extractExtensionFunctionSource(src, 'function extractFirstJsonObject');
  const extractFirstJsonObject = eval('(' + fnSrc + ')');

  const payload = {
    tool: 'writeFile',
    params: { path: 'x.html', content: '<div>{}</div><script>function f(){ return {a:1}; }</script>' },
  };
  // Strict JSON.parse fails on DOM chrome → the fallback extractor runs.
  const domText = 'json\nCopy Download\n' + JSON.stringify(payload);

  const objText = extractFirstJsonObject(domText);
  assert.ok(objText, 'extractor must find the object amid DOM junk');
  assert.deepStrictEqual(JSON.parse(objText), payload, 'nested params must round-trip intact');

  // Negative control: the pre-W8 regex stops at the first '}' inside the
  // content string — its slice never parses back to the payload.
  const oldMatch = domText.match(/\{[\s\S]*?\}/);
  let oldParsed = null;
  try { oldParsed = JSON.parse(oldMatch[0]); } catch {}
  assert.ok(oldParsed === null || JSON.stringify(oldParsed) !== JSON.stringify(payload),
    'old regex must FAIL on this input (proves the test guards the fix)');
});

test('W8-T2c: stream accumulator starts buffering when a wrapper begins mid-delta (prose prefix preserved)', () => {
  const src = fs.readFileSync(BRIDGE_PATH, 'utf8');
  const streamIdx = src.indexOf('async *sendMessageStream(');
  assert.notStrictEqual(streamIdx, -1, 'sendMessageStream must exist');

  // The mid-text trigger must exist and run BEFORE the accumulation branch so
  // the re-sliced wrapper tail flows into the existing fast path.
  const triggerIdx = src.indexOf('findMidTextJsonWrapperStart(delta)', streamIdx);
  assert.notStrictEqual(triggerIdx, -1, 'mid-delta wrapper trigger must exist in sendMessageStream');
  const accumIdx = src.indexOf('if (isAccumulatingJson) {', streamIdx);
  assert.notStrictEqual(accumIdx, -1, 'accumulator branch must exist');
  assert.ok(triggerIdx < accumIdx, 'mid-delta split must run before the accumulation branch');

  const window = src.slice(Math.max(streamIdx, triggerIdx - 400), triggerIdx + 400);
  assert.ok(window.includes("yield { type: 'response_delta', text: delta.slice(0, wrapperIdx) }"),
    'prose prefix must still reach chat as a normal response_delta');
  assert.ok(window.includes('delta = delta.slice(wrapperIdx)'),
    'delta must be re-sliced to the wrapper start so raw JSON never leaks to chat');
  assert.ok(window.includes('!looksLikeJsonStart(delta)'),
    'split must only fire when the fast path (delta starts with wrapper) did not');

  // The helper must look for exactly the wrapper keys the accumulator understands.
  const defIdx = src.indexOf('function findMidTextJsonWrapperStart');
  assert.notStrictEqual(defIdx, -1, 'helper must be defined at module level');
  const defWindow = src.slice(defIdx, defIdx + 400);
  for (const k of ['{"tool"', '{"script"', '{"response"']) {
    assert.ok(defWindow.includes(`'${k}'`), `helper must detect ${k}`);
  }
});

test('W8-T2d: json_buffer script sites propagate the extracted language instead of hardcoded bash', () => {
  const src = fs.readFileSync(BRIDGE_PATH, 'utf8');
  const matches = src.match(/(?:extracted|cleanR)\.language \|\| 'bash'/g) || [];
  assert.ok(matches.length >= 3,
    `expected >= 3 json_buffer language propagations (found ${matches.length})`);
  assert.ok(!src.includes("code: extracted.script, language: 'bash'"),
    'no json_buffer site may hardcode language: bash for extracted scripts');
  assert.ok(!src.includes("code: cleanR.script, language: 'bash'"),
    'DOM-shrink script site must propagate cleanR.language');

  // The extractor must actually surface the field, otherwise the propagation
  // is dead code.
  // v12.0: the extractor now delegates to lib/tool-json-parser.cjs — accept the
  // propagation in the delegation window, the legacy fallback, or the lib.
  const defIdx = src.indexOf('function extractResponseFromCompleteJson');
  assert.notStrictEqual(defIdx, -1, 'extractResponseFromCompleteJson must exist');
  const defWindow = src.slice(defIdx, defIdx + 1500);
  const libSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'tool-json-parser.cjs'), 'utf8');
  assert.ok(
    defWindow.includes('language: parsed.language') ||
    defWindow.includes('language: unified.language') ||
    libSrc.includes('language: parsed.language'),
    'script language must propagate (bridge extractor, legacy fallback, or unified parser lib)');
});
