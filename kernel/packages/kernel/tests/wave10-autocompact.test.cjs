// wave10-autocompact.test.cjs — Wave 10 T2 regression tests (auto-compact on context limit)
// A: luna-soul.cjs case 'context_limit' — auto-compact + resend the original
//    user message ONCE (mirrors the Telegram path); second limit → manual hint.
// B: orphan page-level scanner (bridge-libs/dom-scripts/poll-dom-structure.js)
//    revived and wired, throttled, into _pollThinkingAndResponse → DomPoller →
//    sendMessageStream context_limit event path.
// C: /compactar slash command (mobile access to manual compact).
// D: luna-api-server.cjs fake compact endpoint marked deprecated (dead code).
// E: dead 'context_limit' frontend handler removed from ChatArea.svelte.
// Run: node --test packages/kernel/tests/wave10-autocompact.test.cjs
'use strict';

// Point LUNA_KERNEL_DIR at this repo's packages/kernel BEFORE requiring any
// luna module (luna-config reads env at require time) — same as wave1 tests.
const path = require('node:path');
const KERNEL = path.join(__dirname, '..');
process.env.LUNA_KERNEL_DIR = KERNEL;

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const SOUL_PATH = path.join(KERNEL, 'luna-soul.cjs');
const BRIDGE_PATH = path.join(KERNEL, 'kimi-bridge.cjs');
const SCANNER_PATH = path.join(KERNEL, 'bridge-libs/dom-scripts/poll-dom-structure.js');
const CHAT_AREA_PATH = path.join(KERNEL, 'luna-web/src/components/ChatArea.svelte');
const CHAT_INPUT_PATH = path.join(KERNEL, 'luna-web/src/components/ChatInput.svelte');
const SLASH_PATH = path.join(KERNEL, 'luna-web/src/lib/slashCommands.js');
const API_SERVER_PATH = path.join(KERNEL, '..', '..', '_archive', 'kernel-debug-utils', 'luna-api-server.cjs'); // v12.0: movido para _archive (Fase 6)

const soulSrc = fs.readFileSync(SOUL_PATH, 'utf8');
const bridgeSrc = fs.readFileSync(BRIDGE_PATH, 'utf8');
const scannerSrc = fs.readFileSync(SCANNER_PATH, 'utf8');
const chatAreaSrc = fs.readFileSync(CHAT_AREA_PATH, 'utf8');
const chatInputSrc = fs.readFileSync(CHAT_INPUT_PATH, 'utf8');
const apiServerSrc = fs.readFileSync(API_SERVER_PATH, 'utf8');

const { onContextLimit, shouldForceNewChat } = require('../lib/auto-compact-policy.cjs');

// ── Helpers: mocked soul for behavioral tests ────────────────────────────────

function makeSoulHarness({ streamScripts, compactGen }) {
  const { LunaSoul } = require('../luna-soul.cjs');
  const soul = new LunaSoul({});

  const calls = { send: [], buildContext: [], compact: 0 };

  soul.sessionManager = {
    loadSession: () => ({ mode: 'thinking' }),
    appendEvent: () => {},
    readRecentEvents: () => [],
  };
  soul._buildContext = async (sessionId, input, opts = {}) => {
    calls.buildContext.push({ input, isFirstMessage: opts.isFirstMessage });
    return { prompt: 'PROMPT::' + input };
  };
  soul._processModeResult = async () => ({ events: [], pendingPromises: [], output: null });
  soul.kimiBridge = {
    sendMessageStream: (userId, prompt, opts = {}) => {
      calls.send.push({ prompt, newChat: opts.newChat });
      const script = streamScripts[calls.send.length - 1] || [{ type: 'done', response: 'fallback', thinking: '' }];
      return (async function* () {
        for (const ev of script) yield ev;
      })();
    },
  };
  soul._compactContext = (sessionId, userId) => {
    calls.compact++;
    return compactGen(sessionId, userId);
  };

  return { soul, calls };
}

async function collectEvents(gen) {
  const events = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

const LIMIT_TEXT = 'Your conversation with Kimi is getting too long. Try starting a new session.';

// ── (a) One-shot guard: policy unit tests ────────────────────────────────────

test('A-policy: onContextLimit → compact_and_resend once, then fallback_hint', () => {
  assert.strictEqual(onContextLimit({ autoCompactAttempted: false }), 'compact_and_resend');
  assert.strictEqual(onContextLimit({ autoCompactAttempted: true }), 'fallback_hint');
  assert.strictEqual(onContextLimit(null), 'compact_and_resend');
});

test('A-policy: shouldForceNewChat is suppressed after an auto-compact', () => {
  // Normal first message → force new chat (unchanged behavior).
  assert.strictEqual(shouldForceNewChat({ provider: 'kimi', isFirstMessage: true, bridgeRetryCount: 0, autoCompactAttempted: false }), true);
  // After an auto-compact the fresh thread already exists (checkpoint inside)
  // — forcing another newChat would throw it away.
  assert.strictEqual(shouldForceNewChat({ provider: 'kimi', isFirstMessage: true, bridgeRetryCount: 0, autoCompactAttempted: true }), false);
  // Non-first messages and non-kimi providers never force.
  assert.strictEqual(shouldForceNewChat({ provider: 'kimi', isFirstMessage: false, bridgeRetryCount: 0, autoCompactAttempted: false }), false);
  assert.strictEqual(shouldForceNewChat({ provider: 'deepseek', isFirstMessage: true, bridgeRetryCount: 0, autoCompactAttempted: false }), false);
  assert.strictEqual(shouldForceNewChat({ provider: 'kimi', isFirstMessage: true, bridgeRetryCount: 1, autoCompactAttempted: false }), false);
});

// ── (a) Behavioral: context_limit → auto-compact → resend ONCE ───────────────

test('A: context_limit auto-compacts and resends the original message into the fresh thread', async () => {
  const compactOk = (sessionId) => (async function* () {
    yield { type: 'compact_start', message: 'start', sessionId };
    yield { type: 'compact_end', message: 'end', sessionId, chatUrl: 'http://kimi/chat/new' };
    return { success: true, summary: 's', chatUrl: 'http://kimi/chat/new' };
  })();
  const { soul, calls } = makeSoulHarness({
    streamScripts: [
      [{ type: 'context_limit', response: LIMIT_TEXT }],
      [{ type: 'done', response: 'resposta após compactar', thinking: '' }],
    ],
    compactGen: compactOk,
  });

  const events = await collectEvents(soul.processMessageStream('mensagem original', { sessionId: 't-a', userId: 'u-a' }));

  // Resent exactly once: 2 sends, original message in the rebuilt prompt.
  assert.strictEqual(calls.send.length, 2, 'must resend exactly once');
  assert.ok(calls.send[1].prompt.includes('mensagem original'), 'resent prompt must carry the original user message');
  // First send of a fresh session forces newChat; the resend must NOT
  // (the checkpoint thread created by _compactContext would be discarded).
  assert.strictEqual(calls.send[0].newChat, true, 'first send keeps the newChat behavior');
  assert.strictEqual(calls.send[1].newChat, false, 'resend after auto-compact must not force another newChat');
  // Context rebuilt with mini-reminder (checkpoint event is in the session).
  assert.strictEqual(calls.buildContext[1].isFirstMessage, false, 'resend context must use isFirstMessage:false');

  assert.strictEqual(calls.compact, 1, 'one compact only');
  // Frontend contract: system message + forwarded compact events + final done.
  assert.ok(events.some(e => e.type === 'system' && /compactando automaticamente/i.test(e.message)),
    'must emit the PT-BR auto-compact system message, got: ' + JSON.stringify(events.filter(e => e.type === 'system')));
  assert.ok(events.some(e => e.type === 'compact_start') && events.some(e => e.type === 'compact_end'),
    'compact progress events must be forwarded to the frontend');
  const done = events.filter(e => e.type === 'done').pop();
  assert.ok(done, 'must end with done');
  assert.strictEqual(done.result.success, true);
  assert.ok((done.result.response || '').includes('resposta após compactar'), 'done must carry the resent turn response');
});

test('A: a second context_limit on the resent message does NOT compact again (one-shot)', async () => {
  const compactOk = () => (async function* () {
    yield { type: 'compact_end', message: 'end', sessionId: 't-a2' };
    return { success: true, summary: 's', chatUrl: 'http://kimi/chat/new' };
  })();
  const { soul, calls } = makeSoulHarness({
    streamScripts: [
      [{ type: 'context_limit', response: LIMIT_TEXT }],
      [{ type: 'context_limit', response: LIMIT_TEXT }],
      [{ type: 'done', response: 'should never be sent', thinking: '' }],
    ],
    compactGen: compactOk,
  });

  const events = await collectEvents(soul.processMessageStream('msg', { sessionId: 't-a2', userId: 'u-a2' }));

  assert.strictEqual(calls.compact, 1, 'second context_limit must not trigger a second compact');
  assert.strictEqual(calls.send.length, 2, 'no third send after the fallback');
  assert.ok(events.some(e => e.type === 'system' && /novamente/i.test(e.message)),
    'fallback must emit the manual-hint system message');
  const done = events.filter(e => e.type === 'done').pop();
  assert.ok(done, 'fallback must still emit done (never silent exit)');
  assert.strictEqual(done.result.success, true);
});

// ── (b) _compactContext failure → visible error + done, no resend ────────────

test('B: _compactContext returning success:false → visible error + done, no resend', async () => {
  const compactFail = (sessionId) => (async function* () {
    yield { type: 'compact_start', message: 'start', sessionId };
    yield { type: 'compact_error', message: 'boom', sessionId };
    return { success: false, error: 'boom' };
  })();
  const { soul, calls } = makeSoulHarness({
    streamScripts: [
      [{ type: 'context_limit', response: LIMIT_TEXT }],
      [{ type: 'done', response: 'should never be sent', thinking: '' }],
    ],
    compactGen: compactFail,
  });

  const events = await collectEvents(soul.processMessageStream('msg', { sessionId: 't-b1', userId: 'u-b1' }));

  assert.strictEqual(calls.compact, 1);
  assert.strictEqual(calls.send.length, 1, 'no resend when compaction fails');
  assert.ok(events.some(e => e.type === 'error' && /boom/.test(e.error)),
    'failure must surface as a visible error event, got: ' + JSON.stringify(events.filter(e => e.type === 'error')));
  const done = events.filter(e => e.type === 'done').pop();
  assert.ok(done, 'must emit done even on compact failure');
  assert.strictEqual(done.result.success, false);
});

test('B: _compactContext throwing → visible error + done, no resend', async () => {
  const compactThrow = () => (async function* () {
    throw new Error('compact exploded');
  })();
  const { soul, calls } = makeSoulHarness({
    streamScripts: [
      [{ type: 'context_limit', response: LIMIT_TEXT }],
      [{ type: 'done', response: 'should never be sent', thinking: '' }],
    ],
    compactGen: compactThrow,
  });

  const events = await collectEvents(soul.processMessageStream('msg', { sessionId: 't-b2', userId: 'u-b2' }));

  assert.strictEqual(calls.send.length, 1, 'no resend when compaction throws');
  assert.ok(events.some(e => e.type === 'error' && /compact exploded/.test(e.error)),
    'thrown error must surface as a visible error event');
  assert.strictEqual(events.filter(e => e.type === 'done').pop().result.success, false);
});

// ── (c) /compactar slash command ─────────────────────────────────────────────

const { SLASH_COMMANDS, parseSlashCommand } = require('../luna-web/src/lib/slashCommands.js');

test('C: /compactar is registered with the compactContext handler', () => {
  const def = SLASH_COMMANDS.find(c => c.cmd === '/compactar');
  assert.ok(def, '/compactar must exist in SLASH_COMMANDS');
  assert.strictEqual(def.handler, 'compactContext');
  assert.ok(def.desc && def.icon, 'must have desc and icon like the other entries');
});

test('C: /compactar parses as a slash command', () => {
  const parsed = parseSlashCommand('/compactar');
  assert.ok(parsed, 'must parse');
  assert.strictEqual(parsed.command, '/compactar');
  assert.deepStrictEqual(parsed.args, []);
});

test('C: ChatArea wires compactContext to compactSession() with the same flow as the button', () => {
  assert.ok(chatAreaSrc.includes("slashDef.handler === 'compactContext'"), 'handler branch missing');
  assert.ok(chatAreaSrc.includes('compactSession(activeSessionId'), 'must call compactSession with the active session');
  assert.ok(/compactSession\(activeSessionId, 'luna-default', \(ev\) => handleEvent\(ev\)\)/.test(chatAreaSrc),
    'compact events must flow through handleEvent like the ChatHeader button');
  assert.ok(chatAreaSrc.includes('compactSession'), 'compactSession must be imported in ChatArea');
});

test('C: help and autocomplete derive from SLASH_COMMANDS (so /compactar appears in both)', () => {
  assert.ok(chatAreaSrc.includes('SLASH_COMMANDS.map(c => `${c.cmd} — ${c.desc}`)'), '/ajuda must list SLASH_COMMANDS');
  assert.ok(chatInputSrc.includes('SLASH_COMMANDS'), 'ChatInput autocomplete must use SLASH_COMMANDS');
});

// ── (d) page-level scanner ───────────────────────────────────────────────────

const { scanPageContextLimit, pollDomStructure } = require('../bridge-libs/dom-scripts/poll-dom-structure.js');

function fakeDocument(elements) {
  const prev = global.document;
  global.document = { querySelectorAll: () => elements };
  return () => { if (prev === undefined) delete global.document; else global.document = prev; };
}

const el = (text, closestHit = false) => ({
  innerText: text,
  textContent: text,
  closest: () => (closestHit ? {} : null),
});

test('D: scanner detects the Kimi context-limit notice outside the bubbles (modal/banner)', () => {
  const restore = fakeDocument([
    el('Some random page chrome text that is long enough to scan'),
    el('Your conversation with Kimi is getting too long. Try starting a new session to continue chatting.'),
  ]);
  try {
    const hit = scanPageContextLimit();
    assert.ok(hit && hit.isContextLimit === true, 'must detect the notice');
    assert.strictEqual(hit.source, 'dom-context-limit');
    assert.ok(hit.response.length > 20);
  } finally { restore(); }
});

test('D: scanner skips chat segments (no false positive on user text mentioning the phrase)', () => {
  const restore = fakeDocument([
    el('o que significa context limit nessa conversa?', true), // inside .segment-user → skipped
  ]);
  try {
    assert.strictEqual(scanPageContextLimit(), null, 'text inside chat segments must be skipped');
  } finally { restore(); }
});

test('D: scanner ignores too-short texts and non-matching pages', () => {
  let restore = fakeDocument([el('context limit')]); // < 20 chars
  try { assert.strictEqual(scanPageContextLimit(), null); } finally { restore(); }

  restore = fakeDocument([el('Uma página completamente normal sem nenhum aviso de limite de contexto aqui')]);
  try { assert.strictEqual(scanPageContextLimit(), null); } finally { restore(); }
});

test('D: scanner detects the Chinese variants too', () => {
  const restore = fakeDocument([el('你的会话太长了，请发起一个新会话来继续聊天吧谢谢')]);
  try {
    const hit = scanPageContextLimit();
    assert.ok(hit && hit.isContextLimit, 'Chinese notice must be detected');
  } finally { restore(); }
});

test('D: scanner regex stays in sync with KimiBridge._isContextLimitResponse', () => {
  const extractRegex = (src, anchor) => {
    const i = src.indexOf(anchor);
    assert.ok(i !== -1, `anchor missing: ${anchor}`);
    const m = src.slice(i, i + 1500).match(/\/([^/]+)\/i/);
    assert.ok(m, 'regex literal not found after anchor');
    return m[1];
  };
  const bridgeRegex = extractRegex(bridgeSrc, '_isContextLimitResponse(response)');
  const scannerRegex = extractRegex(scannerSrc, 'function scanPageContextLimit');
  assert.strictEqual(scannerRegex, bridgeRegex, 'scanner and bridge must use the same context-limit alternatives');
});

test('D: scanner is wired, throttled, and feeds the context_limit event path', () => {
  // Module is loaded by the bridge.
  assert.ok(bridgeSrc.includes("require('./bridge-libs/dom-scripts/poll-dom-structure.js')"),
    'bridge must require the revived scanner module');
  assert.ok(bridgeSrc.includes('page.evaluate(scanPageContextLimit)'),
    '_pollThinkingAndResponse must evaluate the scanner in the page');
  // Throttled: not every poll tick (poller runs every 1.5s).
  assert.ok(bridgeSrc.includes('page._lunaContextLimitScanAt'), 'per-page throttle marker missing');
  assert.ok(bridgeSrc.includes('lastLimitScanAt >= 5000'), 'throttle interval (5s) missing');
  // DomPoller converts the poll result into the same context_limit event path.
  assert.ok(bridgeSrc.includes('if (poll.isContextLimit)'), 'DomPoller must branch on poll.isContextLimit');
  const pollerWindow = bridgeSrc.slice(bridgeSrc.indexOf('if (poll.isContextLimit)'), bridgeSrc.indexOf('if (poll.isContextLimit)') + 700);
  assert.ok(pollerWindow.includes("type: 'context_limit'"), 'DomPoller must enqueue a context_limit event');
  // sendMessageStream consumes it and yields context_limit upstream.
  assert.ok(bridgeSrc.includes('let pageContextLimit = null;'), 'consumer state missing');
  assert.ok(bridgeSrc.includes("case 'context_limit':"), 'consumer switch must handle context_limit');
  assert.ok(bridgeSrc.includes('!!pageContextLimit || this._isContextLimitResponse(finalResponse)'),
    'final check must OR the page-level event with the text-based check');
});

test('D: poll-dom-structure.js is a safe module (no browser code at require time) and exports both functions', () => {
  assert.strictEqual(typeof scanPageContextLimit, 'function');
  assert.strictEqual(typeof pollDomStructure, 'function');
  assert.ok(scannerSrc.includes("typeof module !== 'undefined'"), 'module guard must keep it loadable as a plain script');
  // pollDomStructure delegates the page scan to the shared scanner (single source).
  assert.ok(scannerSrc.includes('const pageLimit = scanPageContextLimit();'),
    'pollDomStructure must reuse scanPageContextLimit');
});

// ── (e) dead frontend handler removed; stub endpoint marked deprecated ───────

test('E: ChatArea no longer handles the never-emitted context_limit event', () => {
  assert.ok(!chatAreaSrc.includes("case 'context_limit'"),
    "dead case 'context_limit' must be removed (soul never re-emits it)");
});

test('D-api: legacy luna-api-server compact stub is marked deprecated', () => {
  const i = apiServerSrc.indexOf('async function handleCompact');
  assert.ok(i !== -1, 'handleCompact must exist');
  const head = apiServerSrc.slice(Math.max(0, i - 900), i);
  assert.ok(/DEPRECATED STUB/.test(head), 'stub must carry a DEPRECATED marker');
  assert.ok(head.includes('luna-chat-routes.js'), 'marker must point to the real endpoint');
});

// ── Soul source-level guarantees ─────────────────────────────────────────────

test('A-src: soul imports the policy module and uses it in the stream loop', () => {
  assert.ok(soulSrc.includes("require('./lib/auto-compact-policy.cjs')"), 'policy import missing');
  assert.ok(soulSrc.includes('onContextLimit({ autoCompactAttempted })'), 'one-shot decision must go through the policy');
  assert.ok(soulSrc.includes('shouldForceNewChat({ provider, isFirstMessage, bridgeRetryCount, autoCompactAttempted })'),
    'newChat decision must go through the policy');
  assert.ok(soulSrc.includes('let autoCompactAttempted = false;'), 'per-message guard flag missing');
  assert.ok(soulSrc.includes('continue autoCompactLoop;'), 'resend must re-enter the stream loop');
});

test('A-src: soul drains the unified compact flow and forwards its events', () => {
  const i = soulSrc.indexOf("case 'context_limit':");
  assert.ok(i !== -1, 'context_limit case missing');
  const end = soulSrc.indexOf("case 'done':", i);
  assert.ok(end !== -1, 'next case anchor missing');
  const window = soulSrc.slice(i, end);
  assert.ok(window.includes('const flow = yield* this._runCompactFlow(sessionId, userId, messageInput, options);'),
    'must call _runCompactFlow with sessionId, userId and messageInput');
  assert.ok(window.includes('flow.action'), 'flow result must drive the resend decision');
  assert.ok(window.includes("type: 'error'"), 'compact failure must yield a visible error');
  const doneCount = (window.match(/type: 'done'/g) || []).length;
  assert.ok(doneCount >= 2, 'both failure and fallback paths must emit done');
});

test('A-src: Telegram path is untouched (still resends with newChat:true)', () => {
  assert.ok(soulSrc.includes('if (firstTry?.contextLimit && !options.newChat)'),
    'Telegram context-limit retry guard must remain');
  assert.ok(soulSrc.includes('this.kimiBridge.sendMessage(userId, prompt, { ...options, newChat: true }, provider)'),
    'Telegram must still resend with newChat:true');
});
