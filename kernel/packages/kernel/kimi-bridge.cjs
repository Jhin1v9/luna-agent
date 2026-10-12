/**
 * Luna-Kimi Bridge v2.2
 * Multi-user Playwright automation for Kimi Web (kimi.ai) via CDP
 * v2.2: Always uses persistent profile (~/.luna/chrome-profile) to preserve Kimi login across sessions.
 *       Kills Chrome if running with a temporary /tmp/ profile. Copies login data from user's Chrome on first run.
 * vTEST: unique marker 1785751600
 *
 * Patterns borrowed from luna-cto-agent.cjs (Luna v15.1–v19.0):
 * - Persistent Logger with circular buffer + rotation
 * - Keep-alive (uncaughtException / unhandledRejection)
 * - SessionStore (CheckpointManager pattern) with debounced save
 * - Multi-strategy selector fallback
 *
 * Architecture:
 * - Single BrowserContext (contexts()[0]) — the ONLY one with logged-in cookies
 * - One Page per Telegram userId
 * - Semaphore limits max concurrent pages (default 5)
 * - Idle cleanup closes inactive pages after 10min
 * - Crash/disconnect detection with auto-reconnect
 * - Rate limiting per userId
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { jsonrepair } = require('jsonrepair');
const { WebBridgeClient } = require('./webbridge-client.cjs');
const { isPrematureCompletion } = require('./lib/stream-completion-guard.cjs');
const { createResponseCursor } = require('./lib/stream-text-cursor.cjs');
const { makeDomEventDedupKey } = require('./lib/tool-dedup-key.cjs');
const { parseToolJson } = require('./lib/tool-json-parser.cjs'); // v12.0: unified tolerant parser

// v12.0: persistent Chrome crash/disconnect telemetry — console logs die with
// the process; this JSONL survives for post-mortem (Chrome restarting randomly).
const CHROME_EVENTS_LOG = path.join(__dirname, '..', '..', 'logs', 'chrome-events.log');
function logChromeEvent(kind, details = {}) {
  try {
    fs.mkdirSync(path.dirname(CHROME_EVENTS_LOG), { recursive: true });
    fs.appendFileSync(CHROME_EVENTS_LOG, JSON.stringify({ ts: new Date().toISOString(), kind, ...details }) + '\n');
  } catch {}
}
// W10-T2: page-level context-limit scanner (revived orphan dom-script) —
// detects Kimi's "conversation too long" notice even when it renders as a
// modal/banner outside the response bubbles.
const { scanPageContextLimit } = require('./bridge-libs/dom-scripts/poll-dom-structure.js');
const { loadProviderConfig, listProviders, getProviderUrl, getProviderSelector, getProviderCookies, getProviderFeature, getProviderInputSelector, getProviderResponseSelectors, getProviderUiSelectors } = require('./provider-loader.cjs');
const { resolveChain, providerDisplayName, firstMatchingLocator, waitForChain } = require('./lib/provider-selectors.cjs');

console.error('[KIMI-BRIDGE-BOOT] vTEST marker loaded 1785751600');

// Lazy-load turndown — fail gracefully if not installed
let TurndownService = null;
try {
  TurndownService = require('turndown');
} catch (e) {
  console.warn('[KimiBridge] turndown not installed; Markdown extraction will fallback to plain text');
}

// ============================================================
// KEEP-ALIVE — don't let the process die
// ============================================================
process.on('uncaughtException', (err) => {
  console.error('[KIMI-KEEP-ALIVE] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[KIMI-KEEP-ALIVE] Unhandled Rejection:', reason);
});

// ============================================================
// CONFIG — v5.2: centralized with fallback to env vars
// ============================================================
let config;
try {
  config = require('./config/luna-config');
} catch (e) {
  // Fallback if config module not available (e.g. standalone use)
  config = null;
}

const CDP_PORTS = config?.KIMI?.cdpPorts || [9222, 9223, 9224, 9225];
const DEFAULT_TIMEOUT = 1800000; // 30 minutes — was 120000
const DEFAULT_PROVIDER = 'kimi';

const MAX_CONCURRENT_PAGES = parseInt(process.env.KIMI_MAX_PAGES, 10) || config?.KIMI?.maxPages || 5;
const IDLE_TIMEOUT_MS = parseInt(process.env.KIMI_IDLE_TIMEOUT, 10) || config?.TIMEOUTS?.kimiIdle || 10 * 60 * 1000;
const KIMI_PERSISTENT_MODE = process.env.KIMI_PERSISTENT_MODE === 'true' || process.env.KIMI_PERSISTENT_MODE === '1' || config?.KIMI?.persistentMode || false;
const COOLDOWN_MS = parseInt(process.env.KIMI_COOLDOWN_MS, 10) || config?.TIMEOUTS?.kimiCooldown || 5000;
const MAX_TEXT_TYPE_LENGTH = parseInt(process.env.KIMI_MAX_TYPE_LENGTH, 10) || config?.KIMI?.maxTextTypeLength || 500;
const LOG_MAX_SIZE_MB = parseInt(process.env.KIMI_LOG_MAX_MB, 10) || config?.KIMI?.logMaxSizeMB || 10;
const ARTIFACTS_DIR = config?.PATHS?.artifacts || path.join(__dirname, '..', 'ARTIFACTS');
const SESSION_STORE_PATH = path.join(ARTIFACTS_DIR, 'kimi-sessions.json');
const COOKIES_BACKUP_PATH = path.join(__dirname, 'kimi-cookies.json');
const COOKIES_MANUAL_PATH = path.join(__dirname, 'kimi-cookies.manual.json');

// v11.0: paths for connecting to the user's real Chrome instead of a cloned profile
const USER_CHROME_DIR = path.join(require('os').homedir(), '.config', 'google-chrome');
const USER_CHROME_DEVTOOLS_PORT_FILE = path.join(USER_CHROME_DIR, 'DevToolsActivePort');
const USER_CHROME_DESKTOP_FILES = [
  path.join(require('os').homedir(), '.local', 'share', 'applications', 'google-chrome.desktop'),
  path.join(require('os').homedir(), '.local', 'share', 'applications', 'com.google.Chrome.desktop'),
  '/usr/share/applications/google-chrome.desktop',
  '/usr/share/applications/com.google.Chrome.desktop',
];
const USER_CHROME_CMD_CANDIDATES = [
  '/usr/bin/google-chrome-stable',
  '/opt/google/chrome/google-chrome',
  '/opt/google/chrome/chrome',
  'google-chrome-stable',
  'google-chrome',
];

function makeCdpUrl(port) { return `http://127.0.0.1:${port}`; }
function getPortFromUrl(url) {
  try { return parseInt(new URL(url).port, 10); } catch { return 9222; }
}

if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

// ============================================================
// UTILS
// ============================================================
function hashUserId(userId) {
  return crypto.createHash('sha256').update(String(userId)).digest('hex').slice(0, 8);
}

// v10.38-fix: Normalize URLs for landing-page comparison.
// Browsers may add trailing slashes or reorder query params, so we compare
// only origin + pathname (with trailing slash removed) and ignore query/hash.
function normalizeBaseUrl(url) {
  try {
    const u = new URL(url);
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch (e) {
    return url;
  }
}

function isSameLandingPage(currentUrl, expectedUrl) {
  return normalizeBaseUrl(currentUrl) === normalizeBaseUrl(expectedUrl);
}

// v9.4-fix: JSON Accumulation Buffer — prevents code leak from multi-line JSON wrappers.
// When Kimi streams {"response": "..."} with code inside, the inner code chunks
// don't look like JSON (no "response" key, don't start with '{'). We buffer ALL
// chunks until the JSON wrapper is complete (balanced braces), then extract.

function looksLikeJsonStart(text) {
  if (!text || typeof text !== 'string') return false;
  let t = text.trimStart();
  // v10.8-fix: Strip Kimi DOM code-block header (e.g. "JSON\nCopy\n") so JSON
  // wrappers rendered inside .segment-code blocks are still detected.
  t = t.replace(/^\s*JSON\s*(?:Copy|复制|複製)\s*/i, '').trimStart();
  // v10.24-fix: Also detect malformed Kimi wrappers like {"success":true,"mode":"RESPONSE","message":"..."}
  return t.startsWith('{') && (
    t.includes('"response"') ||
    t.includes('"tool"') ||
    t.includes('"script"') ||
    t.includes('"mode"') ||
    (t.includes('"success"') && t.includes('"message"'))
  );
}

// v12.1: a delta that is ONLY the beginning of a possible wrapper (`{"`, `{"t`…)
// — the real keys arrive in the NEXT chunk, so looksLikeJsonStart misses it and
// the raw JSON leaks into the chat as response text (seen live: deleteFile JSON
// streamed as `{"` / `tool": "deleteFile` / … fragments).
function isTinyJsonFragment(delta) {
  if (!delta) return false;
  const t = delta.trim();
  return t.length > 0 && t.length <= 12 && /^\{["\w]*$/.test(t);
}

function isJsonComplete(text) {
  if (!text) return false;
  let depth = 0;
  let inString = false;
  let escape = false;
  let foundFirstBrace = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\') {
      escape = true;
      continue;
    }
    if (c === '"') {
      // v11.1-fix: Tolerate unescaped internal quotes inside string values.
      // A closing quote is real only when the next significant char is , : } or ].
      if (inString) {
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j++;
        if (j >= text.length || text[j] === ',' || text[j] === ':' || text[j] === '}' || text[j] === ']') {
          inString = false;
        }
        // else: unescaped internal quote, stay inside string
      } else {
        inString = true;
      }
      continue;
    }
    if (!inString) {
      if (c === '{') { depth++; foundFirstBrace = true; }
      else if (c === '}') depth--;
    }
  }
  return foundFirstBrace && depth === 0;
}

// v10.35-fix (W8-T2a: hoisted to module scope so _extractJsonToolCalls can
// reuse it — previously defined inline in the generic-provider extractor):
// robustly extract the first complete JSON object using string-aware brace
// counting. Tolerates unescaped double quotes inside string values (common
// when LLMs embed HTML/JS inside JSON): a closing quote is only real when the
// next significant character is , : } or ]. `startFrom` lets callers loop over
// multiple top-level objects in a single text.
function extractFirstCompleteJsonObject(text, startFrom = 0) {
  if (!text || text.length < 10) return null;
  let i = startFrom;
  while (i < text.length) {
    if (text[i] !== '{') { i++; continue; }
    const start = i;
    let depth = 1;
    let inString = false;
    let escape = false;
    i++;
    while (i < text.length && depth > 0) {
      const c = text[i];
      if (escape) {
        escape = false;
      } else if (c === '\\') {
        escape = true;
      } else if (c === '"') {
        if (inString) {
          let j = i + 1;
          while (j < text.length && /\s/.test(text[j])) j++;
          if (j >= text.length || text[j] === ',' || text[j] === ':' || text[j] === '}' || text[j] === ']') {
            inString = false;
          }
          // else: unescaped internal quote, stay inside string
        } else {
          inString = true;
        }
      } else if (!inString) {
        if (c === '{') depth++;
        else if (c === '}') depth--;
      }
      i++;
    }
    if (depth === 0) {
      return text.slice(start, i);
    }
  }
  return null;
}

// W8-T2c: locate a JSON wrapper ({"tool"/{"script"/{"response") that starts
// mid-delta (position > 0), so the stream accumulator can split off the prose
// prefix and buffer the wrapper instead of leaking raw JSON into the chat.
function findMidTextJsonWrapperStart(text) {
  if (!text || typeof text !== 'string') return -1;
  const keys = ['{"tool"', '{"script"', '{"response"'];
  let best = -1;
  for (const k of keys) {
    const idx = text.indexOf(k);
    if (idx > 0 && (best === -1 || idx < best)) best = idx;
  }
  return best;
}

// v11.1-fix: Manual extraction for file-write tool JSONs with unescaped quotes.
function extractWriteFileFromText(text) {
  if (!text || text.length < 30) return null;
  const toolMatch = text.match(/"tool"\s*:\s*"([^"]+)"/);
  if (!toolMatch) return null;
  const tool = toolMatch[1];
  if (!['writeFile', 'appendFile', 'replaceInFile'].includes(tool)) return null;

  function extractStringValue(key) {
    const pattern = new RegExp(`"${key}"\\s*:\\s*"`);
    const m = text.match(pattern);
    if (!m) return null;
    let i = text.indexOf(m[0]) + m[0].length;
    let val = '';
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\\' && i + 1 < text.length) {
        const next = text[i + 1];
        switch (next) {
          case 'n': val += '\n'; break;
          case 't': val += '\t'; break;
          case 'r': val += '\r'; break;
          case 'b': val += '\b'; break;
          case 'f': val += '\f'; break;
          case '\\': val += '\\'; break;
          case '"': val += '"'; break;
          case '/': val += '/'; break;
          case 'u':
            if (i + 5 < text.length) {
              const hex = text.slice(i + 2, i + 6);
              const code = parseInt(hex, 16);
              if (!isNaN(code)) {
                val += String.fromCharCode(code);
                i += 4;
                break;
              }
            }
            val += next;
            break;
          default: val += next; break;
        }
        i += 2;
        continue;
      }
      if (ch === '"') {
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j++;
        if (j >= text.length || text[j] === ',' || text[j] === '}' || text[j] === ']') {
          return val;
        }
        val += ch;
        i++;
        continue;
      }
      val += ch;
      i++;
    }
    return val;
  }

  const path = extractStringValue('path');
  const content = extractStringValue('content');
  if (!path || content === null) return null;
  const params = { path, content };
  if (tool === 'replaceInFile') {
    // v13.0 (F3.3): emit the CANONICAL schema names (old/new). The old code
    // renamed to oldString/newString — a name no downstream layer accepted,
    // so every recovered replaceInFile died in schema validation.
    const oldStr = extractStringValue('old') || extractStringValue('oldStr') || extractStringValue('oldString') || extractStringValue('old_string') || extractStringValue('oldText');
    const newStr = extractStringValue('new') || extractStringValue('newStr') || extractStringValue('newString') || extractStringValue('new_string') || extractStringValue('newText');
    if (oldStr !== null) params.old = oldStr;
    if (newStr !== null) params.new = newStr;
  }
  return { type: 'tool', tool, params };
}

// v11.8-fix: defensive sanity check for state_change events. If a producer
// (extension/poller) accidentally delivers thinking text inside the response
// field, split it out before the cursor sees it. This is a last-line guard;
// the source of truth is still the extension selectors.
const THINK_PREFIX_REGEX = /^(O usu[áa]rio|Vou |Agora |Preciso |Primeiro |Vamos |Ent[aã]o |Deixa |Hmm |Ok |Okay |Let me |I need |I'll |First |Now |So |The user |Pensando|Analisando|Raciocinando|Reasoning|Thinking|Processando|Buscando|Searching|Concluindo|Conclu[íi]do)/i;
// v12.3: the extension/poller sometimes delivers the system prompt text as
// response before Kimi generates. Any text carrying these markers is not a
// real assistant response and must be discarded.
const SYSTEM_PROMPT_MARKERS = [
  '--- CONTEXTO DO SISTEMA ---',
  '--- MENSAGEM ATUAL ---',
  'Responda usando APENAS UM code block JSON',
  'NUNCA repita respostas anteriores',
  'Formatos: {\"response\":',
  'Formatos:{\"response\":',
];
function isSystemPromptLeak(text) {
  if (!text || typeof text !== 'string') return false;
  return SYSTEM_PROMPT_MARKERS.some(m => text.includes(m));
}
function sanitizeStateChange(ev) {
  let t = ev.thinking || '';
  let r = ev.response || '';

  // If response contains a thinking prefix and we have no explicit thinking, split.
  if (r && !t) {
    const codeIdx = r.indexOf('```');
    const jsonIdx = r.search(/\{\s*"/);
    const firstRealIdx = codeIdx >= 0 && jsonIdx >= 0 ? Math.min(codeIdx, jsonIdx)
      : codeIdx >= 0 ? codeIdx
      : jsonIdx >= 0 ? jsonIdx
      : -1;
    if (firstRealIdx > 10) {
      const before = r.slice(0, firstRealIdx).trim();
      const after = r.slice(firstRealIdx).trim();
      if (THINK_PREFIX_REGEX.test(before) || before.length < 500) {
        t = before;
        r = after;
      }
    }
    // Entire response is reasoning and no JSON/code block.
    if (!r.includes('```') && !r.includes('{') && (THINK_PREFIX_REGEX.test(r) || r.length < 300)) {
      t = r;
      r = '';
    }
  }

  // If thinking somehow contains a real response, keep only the reasoning prefix.
  if (t && !r) {
    const codeIdx = t.indexOf('```');
    const jsonIdx = t.search(/\{\s*"/);
    const firstRealIdx = codeIdx >= 0 && jsonIdx >= 0 ? Math.min(codeIdx, jsonIdx)
      : codeIdx >= 0 ? codeIdx
      : jsonIdx >= 0 ? jsonIdx
      : -1;
    if (firstRealIdx > 10) {
      r = t.slice(firstRealIdx);
      t = t.slice(0, firstRealIdx).trim();
    }
  }

  // v12.3: never let leaked system prompt text pass as response.
  if (r && isSystemPromptLeak(r)) {
    log.info(`[sanitizeStateChange] dropping response that contains system prompt leak (${r.length} chars)`);
    r = '';
  }
  return { thinking: t, response: r };
}

// W6-T9: Node-side character walker — escapes RAW newline/CR/tab characters
// that appear INSIDE JSON string values (Kimi's DOM renders script JSON with
// literal newlines, which strict JSON.parse rejects). Characters outside
// strings are left untouched. Ported from the in-page tolerantJsonParse.
function _preEscapeJsonStringNewlines(str) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString) {
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
    }
    out += ch;
  }
  return out;
}

/**
 * W6-T12: Pure decision helper — should a generic provider (DeepSeek etc.)
 * force-complete the response even while the UI still reports "generating"?
 * Fires when the response has been visible for >45s AND its text length has
 * been stable for >10s. Backstop for UI completion heuristics that never fire
 * (cursor blink / code-block chrome can keep isGenerating=true forever, which
 * starves tool delivery and makes Luna "stop out of nowhere").
 */
function _shouldForceGenericComplete({ firstSeenAt, lastLengthChangeAt, uiGenerating }, now) {
  if (!uiGenerating) return false;
  if (!firstSeenAt || !lastLengthChangeAt) return false;
  return (now - firstSeenAt > 45_000) && (now - lastLengthChangeAt > 10_000);
}

function extractResponseFromCompleteJson(text) {
  // v12.0: delegate to the unified tolerant parser (lib/tool-json-parser.cjs).
  // On top of the legacy strategies it adds jsonrepair (truncated/malformed
  // JSON) and generic tool-field rescue — a truncated tool call is recovered
  // instead of silently dropped. Legacy path kept as final fallback.
  const unified = parseToolJson(text);
  if (unified && unified.kind !== 'prose') {
    if (unified.repaired || unified.rescued) {
      console.warn(`[LUNA-RESCUE] tolerant parser recovered ${unified.kind}${unified.tool ? ' (' + unified.tool + ')' : ''}`);
    }
    // v12.1: a tool/script recovered from TRUNCATED json carries partial
    // params — never execute it (it nearly deleted the wrong directory).
    if (unified.truncated && unified.kind !== 'response') {
      console.warn(`[LUNA-RESCUE] truncated ${unified.kind} NOT executed: ${unified.tool || ''}`);
    } else {
      if (unified.kind === 'response') return { type: 'response', text: unified.text };
      if (unified.kind === 'tool') return { type: 'tool', tool: unified.tool, params: unified.params };
      if (unified.kind === 'script') return { type: 'script', script: unified.script, language: unified.language };
    }
  }
  return _extractResponseFromCompleteJsonLegacy(text);
}

function _extractResponseFromCompleteJsonLegacy(text) {
  if (!text) return null;
  // v10.24-fix: Strip DOM-extracted code block headers before parsing
  let cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .replace(/^\s*JSON\s*(?:Copy|复制|複製)\s*/i, '')
    .replace(/^\s*json\s*(?:Copy|复制|複製)\s*/i, '')
    .trim();
  const mapParsed = (parsed) => {
    if (parsed.response !== undefined && typeof parsed.response === 'string') {
      return { type: 'response', text: parsed.response };
    }
    if (parsed.tool !== undefined) {
      return { type: 'tool', tool: parsed.tool, params: parsed.params || {} };
    }
    if (parsed.script !== undefined) {
      // W8-T2d: propagate the language so json_buffer sites don't hardcode 'bash'.
      return { type: 'script', script: parsed.script, language: parsed.language };
    }
    // v10.24-fix: Tolerate malformed wrappers where Kimi sends {"success":true,"mode":"RESPONSE","message":"..."}
    if (parsed.message !== undefined && typeof parsed.message === 'string' && !parsed.tool && !parsed.script) {
      return { type: 'response', text: parsed.message };
    }
    return null;
  };
  try {
    const mapped = mapParsed(JSON.parse(cleaned));
    if (mapped) return mapped;
  } catch {}
  // W6-T9: strict parse failed — the DOM may have emitted literal newlines/tabs
  // inside string values (common for {"script": "#!/bin/bash\n..."}). Escape
  // control characters inside strings and try again before the regex fallback.
  try {
    const mapped = mapParsed(JSON.parse(_preEscapeJsonStringNewlines(cleaned)));
    if (mapped) return mapped;
  } catch {}
  // Fallback regex extraction for malformed but complete JSON
  try {
    const respMatch = cleaned.match(/"response"\s*:\s*"([\s\S]*?)"\s*[,}]/);
    if (respMatch) {
      return { type: 'response', text: respMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\') };
    }
    const msgMatch = cleaned.match(/"message"\s*:\s*"([\s\S]*?)"\s*[,}]/);
    if (msgMatch) {
      return { type: 'response', text: msgMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\') };
    }
    // W6-T9: recover {"script": "...", "language": "..."} from malformed JSON
    const scriptMatch = cleaned.match(/"script"\s*:\s*"([\s\S]*?)"\s*[,}]/);
    if (scriptMatch) {
      const langMatch = cleaned.match(/"language"\s*:\s*"([^"]*)"/);
      const result = { type: 'script', script: scriptMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\') };
      if (langMatch) result.language = langMatch[1];
      return result;
    }
  } catch {}
  // v11.1-fix: Last resort for file-write tool JSONs with unescaped quotes inside content.
  const writeFileTool = extractWriteFileFromText(cleaned);
  if (writeFileTool) {
    return writeFileTool;
  }
  return null;
}

// ============================================================
// v5.6: ROBUST ELEMENT INTERACTION — best practices from industry research
// https://playwright.dev/docs/best-practices
// https://www.browserstack.com/guide/playwright-locator
// ============================================================

/**
 * Smart click with multi-strategy fallback.
 * Priority: CSS selector → ARIA attributes → text content → icon detection → coordinates.
 * Uses getBoundingClientRect to click the CENTER of the element (works through shadow DOM/iframes).
 * @param {Page} page — Playwright page
 * @param {Object} strategies — { css?, aria?, text?, icon?, coords? }
 * @param {string} label — human-readable label for logging
 * @returns {Promise<boolean>} — true if clicked
 */
async function smartClick(page, strategies, label = 'element') {
  const attempts = [];

  // Strategy 1: CSS selector (most stable)
  if (strategies.css) {
    attempts.push(async () => {
      const el = page.locator(strategies.css).first();
      if (await el.count() > 0) {
        const box = await el.evaluate(el => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height, visible: r.width > 0 && r.height > 0 };
        }).catch(() => null);
        if (box?.visible) {
          await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
          return true;
        }
      }
      return false;
    });
  }

  // Strategy 2: ARIA role + label
  if (strategies.aria) {
    attempts.push(async () => {
      const { role, label: ariaLabel, name } = strategies.aria;
      let locator;
      if (role && ariaLabel) {
        locator = page.getByRole(role, { name: ariaLabel, exact: false });
      } else if (role && name) {
        locator = page.getByRole(role, { name, exact: false });
      } else if (ariaLabel) {
        locator = page.getByLabel(ariaLabel, { exact: false });
      } else if (role) {
        locator = page.getByRole(role);
      }
      if (!locator) return false;
      if (await locator.count() > 0) {
        const box = await locator.first().evaluate(el => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height, visible: r.width > 0 && r.height > 0 };
        }).catch(() => null);
        if (box?.visible) {
          await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
          return true;
        }
      }
      return false;
    });
  }

  // Strategy 3: Text content (regex or partial match)
  if (strategies.text) {
    attempts.push(async () => {
      const patterns = Array.isArray(strategies.text) ? strategies.text : [strategies.text];
      for (const pattern of patterns) {
        let locator;
        if (typeof pattern === 'string') {
          locator = page.getByText(pattern, { exact: false });
        } else {
          // Regex: use Playwright locator with hasText regex
          locator = page.locator('button, [role="button"], a, div').filter({ hasText: pattern }).first();
        }
        if (await locator.count() > 0) {
          const box = await locator.first().evaluate(el => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height, visible: r.width > 0 && r.height > 0 };
          }).catch(() => null);
          if (box?.visible) {
            await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
            return true;
          }
        }
      }
      return false;
    });
  }

  // Strategy 4: Icon detection (SVG, img with specific src, etc.)
  if (strategies.icon) {
    attempts.push(async () => {
      const clicked = await page.evaluate((iconHint) => {
        const buttons = document.querySelectorAll('button, [role="button"], a');
        for (const btn of buttons) {
          const html = btn.innerHTML.toLowerCase();
          if (html.includes('svg') || html.includes('<img') || html.includes('icon')) {
            if (!iconHint || html.includes(iconHint.toLowerCase())) {
              const r = btn.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                // Return center coordinates
                return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
              }
            }
          }
        }
        return null;
      }, strategies.icon);
      if (clicked) {
        await page.mouse.click(clicked.x, clicked.y);
        return true;
      }
      return false;
    });
  }

  // Strategy 5: Coordinate fallback (last resort)
  if (strategies.coords) {
    attempts.push(async () => {
      const [x, y] = strategies.coords;
      await page.mouse.click(x, y);
      return true;
    });
  }

  // Execute strategies in order
  for (let i = 0; i < attempts.length; i++) {
    try {
      const success = await attempts[i]();
      if (success) {
        log.info(`[smartClick] Clicked ${label} via strategy ${i + 1}`);
        return true;
      }
    } catch (e) {
      // Continue to next strategy
    }
  }

  log.warn(`[smartClick] Failed to click ${label} — all strategies exhausted`);
  return false;
}

/**
 * Detect the language of the Kimi Web UI.
 * Returns 'en', 'zh', 'zh-tw', 'pt', or 'unknown'.
 */
async function detectPageLanguage(page) {
  return await page.evaluate(() => {
    const htmlLang = document.documentElement.lang || '';
    if (htmlLang.startsWith('zh')) {
      return htmlLang.includes('tw') || htmlLang.includes('hant') ? 'zh-tw' : 'zh';
    }
    if (htmlLang.startsWith('pt')) return 'pt';
    if (htmlLang.startsWith('en')) return 'en';
    // Fallback: detect by common UI text
    const bodyText = document.body.innerText;
    if (bodyText.includes('登录') || bodyText.includes('使用 Google 登录')) return 'zh';
    if (bodyText.includes('登入') || bodyText.includes('使用 Google 帳戶登入')) return 'zh-tw';
    if (bodyText.includes('Entrar') || bodyText.includes('Fazer login')) return 'pt';
    return 'unknown';
  }).catch(() => 'unknown');
}

// ============================================================
// LOGGER — persistent with circular buffer + rotation
// ============================================================
class KimiLogger {
  constructor() {
    this.logFile = path.join(ARTIFACTS_DIR, 'kimi-bridge.log');
    this.events = [];
  }

  _h() {
    return new Date().toISOString();
  }

  _rotateIfNeeded() {
    try {
      if (fs.existsSync(this.logFile)) {
        const stats = fs.statSync(this.logFile);
        if (stats.size > LOG_MAX_SIZE_MB * 1024 * 1024) {
          const rotated = this.logFile + '.1';
          if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
          fs.renameSync(this.logFile, rotated);
        }
      }
    } catch (e) { /* ignore rotation errors */ }
  }

  _w(level, msg) {
    const line = `[${level}] [${this._h()}] ${msg}`;
    console.log(line);
    try {
      this._rotateIfNeeded();
      fs.appendFileSync(this.logFile, line + '\n');
    } catch (e) { /* ignore log write errors */ }
    this.events.push({ type: level, msg, time: this._h() });
    if (this.events.length > 200) this.events.shift();
  }

  info(m) { this._w('INFO', m); }
  success(m) { this._w('SUCCESS', m); }
  error(m) { this._w('ERROR', m); }
  warn(m) { this._w('WARN', m); }
  debug(m) { this._w('DEBUG', m); }
  getEvents() { return this.events; }
}
const log = new KimiLogger();

// ============================================================
// SESSION STORE — persists user sessions between restarts
// ============================================================
class KimiSessionStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = this._load();
    this._saveTimer = null;
  }

  _load() {
    const defaults = { users: {}, lastCleanup: null };
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8').replace(/^\uFEFF/, '');
        const parsed = JSON.parse(raw);
        return { ...defaults, ...parsed };
      }
    } catch (err) {
      log.warn(`SessionStore load failed: ${err.message}`);
    }
    return defaults;
  }

  _saveImmediate() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      log.warn(`SessionStore save failed: ${err.message}`);
    }
  }

  save() {
    // Debounced save: batch rapid updates
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._saveImmediate(), 500);
  }

  getUser(userId) {
    return this.data.users[userId] || null;
  }

  setUser(userId, info) {
    this.data.users[userId] = { ...this.getUser(userId), ...info, updatedAt: new Date().toISOString() };
    this.save();
  }

  removeUser(userId) {
    delete this.data.users[userId];
    this.save();
  }

  getAllUserIds() {
    return Object.keys(this.data.users);
  }
}

// ============================================================
// SEMAPHORE — limits concurrent pages with ownership tracking
// ============================================================
class Semaphore {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this.waiters = [];
  }

  async acquire() {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release() {
    if (this.waiters.length > 0) {
      const next = this.waiters.shift();
      next();
    } else {
      this.current = Math.max(0, this.current - 1);
    }
  }
}

// ============================================================
// PROVIDER NETWORK INTERCEPTOR v7.5 — Multi-Provider
// ============================================================
// Intercepts provider responses server-side via the Playwright
// page.on('response') listener (PDS Fase 0: the CDP Fetch branch was
// removed — it never worked, see bugs.md:23). Immune to page
// anti-tampering, SPA navigation, React resets, or fetch restoration.

class ProviderNetworkInterceptor {
  constructor(page, providerConfig) {
    this.page = page;
    this.providerConfig = providerConfig;
    this.reasoning = [];
    this.content = [];
    this.toolCalls = [];
    this.lastActivity = Date.now();
    this._active = false;
    this._cdpSession = null;
    this._requestId = null;
    this._responseBuffer = '';
    // v13.0 (F1.1): turn isolation via monotonic generation. reset() bumps the
    // generation at the start of every turn; a response body that resolves
    // late (previous turn's HTTP stream finishing mid-turn) is discarded
    // instead of polluting the fresh turn's buffer.
    this._generation = 0;
    this.completedGeneration = -1;   // generation whose chat body fully arrived
    this.lastChatBodyCompletedAt = 0; // timestamp of that completion (primary stream-end signal)
  }

  async start() {
    if (this._active) return;
    this._active = true;
    // PDS Fase 0: the CDP Fetch branch was removed — it depended on
    // _buildFetchPatterns, which never existed, so every start() threw and
    // fell back to the Playwright listener anyway. The listener is now the
    // sole interception path.
    this._startPlaywrightFallback();
    log.info('[ProviderNetworkInterceptor] Started — listening via page.on("response")');
  }

  _startPlaywrightFallback() {
    this._listener = async (response) => {
      const url = response.url();
      log.info('[NetworkInterceptor] response url: ' + url);
      if (!this._isChatUrl(url)) return;
      // v13.0 (F1.1): capture the turn generation at event time. The body of a
      // PREVIOUS turn's chat response can resolve after reset() bumped the
      // generation for the next turn — it must never be parsed into the fresh
      // buffer (this was the "previous turn's text arrives one turn late" bug).
      const gen = this._generation;
      this.lastActivity = Date.now();
      try {
        const body = await response.body();
        const text = body.toString('utf-8');
        log.info('[NetworkInterceptor] chat response body length=' + text.length + ' firstUrl=' + url);
        if (gen !== this._generation) {
          log.info('[NetworkInterceptor] discarding stale chat body from generation ' + gen + ' (current=' + this._generation + ', length=' + text.length + ')');
          return;
        }
        this.completedGeneration = gen;
        this.lastChatBodyCompletedAt = Date.now();
        this._parseSse(text);
      } catch (e) {}
    };
    this.page.on('response', this._listener);
  }

  stop() {
    if (!this._active) return;
    this._active = false;
    if (this._cdpSession) {
      this._cdpSession.detach().catch(() => {});
      this._cdpSession = null;
    }
    if (this._listener) {
      this.page.off('response', this._listener);
      this._listener = null;
    }
  }

  reset() {
    this.reasoning = [];
    this.content = [];
    this.toolCalls = [];
    this._responseBuffer = '';
    this._generation++; // v13.0 (F1.1): new turn — in-flight bodies from older generations are stale
    this.lastActivity = Date.now();
  }

  getData() {
    const thinking = this.reasoning.join('');
    const response = this.content.join('');
    const toolCalls = this.toolCalls.length > 0 ? this.toolCalls.splice(0, this.toolCalls.length) : [];
    return {
      thinking,
      response,
      toolCalls,
      hasData: thinking.length > 0 || response.length > 0 || toolCalls.length > 0,
      source: 'network-intercept',
    };
  }

  _isChatUrl(url) {
    if (typeof url !== 'string') return false;
    // PDS Fase 0: provider-config apiEndpoints UNIONED with the legacy
    // hardcoded defaults — kimi.json stays untouched (owner directive) and
    // Kimi's URL coverage is identical to the pre-refactor hardcoded list.
    const endpoints = this.providerConfig?.apiEndpoints || [];
    const defaults = [
      '/api/chat',
      '/ChatService/Chat',
      '/kimi.gateway.chat',
      '/apiv2/kimi.chat',
      '/kimi.chat.v1.ChatService',
      '/ChatService/ChatCompletion',
    ];
    return endpoints.concat(defaults).some(ep => url.includes(ep));
  }

  _parseSse(text) {
    const lines = text.split('\n');
    for (const line of lines) {
      if (!line.trim() || !line.startsWith('data:')) continue;
      try {
        const json = JSON.parse(line.slice(5));

        // Kimi Connect-RPC format
        const msg = json?.result?.message || json?.message;
        if (msg) {
          if (msg.reasoning_content) this.reasoning.push(msg.reasoning_content);
          if (msg.content) this.content.push(msg.content);
          if (msg.tool_calls) this.toolCalls.push(...msg.tool_calls);
        }

        // Delta format
        const delta = json?.result?.delta || json?.delta;
        if (delta) {
          if (delta.reasoning_content) this.reasoning.push(delta.reasoning_content);
          if (delta.content) this.content.push(delta.content);
        }
      } catch (e) {
        // Ignore parse errors for malformed lines
      }
    }
  }
}

// ============================================================
// KIMI BRIDGE v2.1
// ============================================================
class KimiBridge {
  constructor(options = {}) {
    this.cdpUrl = options.cdpUrl || null; // discovered dynamically
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.maxPages = options.maxPages ?? 999;
    this.idleTimeout = options.idleTimeout ?? IDLE_TIMEOUT_MS;
    this.debug = options.debug || false;

    // Provider routing per user
    this.chatProviders = new Map(); // userId -> providerName
    this.defaultProvider = process.env.LUNA_DEFAULT_PROVIDER || DEFAULT_PROVIDER;

    this.browser = null;
    this.defaultContext = null; // Original Chrome context with login cookies
    this.userContexts = new Map(); // userId -> BrowserContext
    this.userSessions = new Map(); // userId -> { page, chatUrl, lastActivity, processing, mode, context }
    this.semaphore = new Semaphore(999); // Effectively unlimited
    this.store = new KimiSessionStore(SESSION_STORE_PATH);
    this.lastRequestTime = new Map(); // userId -> timestamp (rate limiting)
    this.idleTimer = null;
    this.cookieBackupTimer = null;
    this.persistentUserIds = new Set(); // userIds that should NEVER be cleaned up
    this.cancelledStreams = new Map(); // userId -> true (cancelled mid-stream)

    // v7.5: Network Interceptors — one per page, native Playwright response interception
    this.networkInterceptors = new Map(); // userId -> KimiNetworkInterceptor

    // v7.0: Decoupled DOM Event Queue — DOM reader is independent from stream lifecycle
    this.domEventQueues = new Map(); // userId -> { events: [], lastReadIndex: 0, createdAt: Date.now() }
    this.streamStopFlags = new Map(); // userId -> () => void (soft cancel signal)
    this.domPollingTasks = new Map(); // userId -> { active: boolean, startTime: number }

    // v5.6: WebBridge as PRIMARY, Playwright CDP as fallback
    this.webbridgeEnabled = true;
    this.webbridgeClients = new Map(); // userId -> WebBridgeClient
    this.webbridgeHealthy = false; // checked on connect()

    // Initialize turndown if available
    this.turndown = null;
    if (TurndownService) {
      this.turndown = new TurndownService({
        codeBlockStyle: 'fenced',
        headingStyle: 'atx',
        bulletListMarker: '-',
      });
    }
  }

  /**
   * Probe a single CDP port to see if Chrome is listening.
   */
  async _probePort(port) {
    const http = require('http');
    return new Promise((resolve) => {
      const req = http.get(`${makeCdpUrl(port)}/json/version`, (res) => {
        resolve(res.statusCode === 200 ? port : 0);
      });
      req.on('error', () => resolve(0));
      req.setTimeout(2000, () => { req.destroy(); resolve(0); });
    });
  }

  /**
   * Find first working CDP port among CDP_PORTS.
   * Returns 0 if none respond.
   */
  async _findWorkingPort() {
    for (const port of CDP_PORTS) {
      const ok = await this._probePort(port);
      if (ok) return port;
    }
    return 0;
  }

  /**
   * Get current CDP URL. Discovers dynamically on first use.
   */
  async _getCdpUrl() {
    if (this.cdpUrl) return this.cdpUrl;
    const port = await this._findWorkingPort();
    if (port) {
      this.cdpUrl = makeCdpUrl(port);
      log.info(`Auto-discovered Chrome on ${this.cdpUrl}`);
      return this.cdpUrl;
    }
    // Fallback to default for error messages
    return makeCdpUrl(CDP_PORTS[0]);
  }

  /**
   * Reset CDP URL (e.g. after Chrome restart on different port).
   */
  _resetCdpUrl() {
    this.cdpUrl = null;
  }

  // ── Provider routing ──
  setChatProvider(userId, provider) {
    try {
      loadProviderConfig(provider);
    } catch (e) {
      throw new Error(`Provider desconhecido: ${provider}`);
    }
    this.chatProviders.set(userId, provider);
    log.info(`[Provider] Chat ${hashUserId(userId)} set to provider: ${provider}`);
  }

  getChatProvider(userId) {
    return this.chatProviders.get(userId) || this.defaultProvider;
  }

  getProviderConfig(userId) {
    const provider = this.getChatProvider(userId);
    try {
      return loadProviderConfig(provider);
    } catch (e) {
      log.warn(`[Provider] Failed to load config for ${provider}, falling back to ${this.defaultProvider}`);
      return loadProviderConfig(this.defaultProvider);
    }
  }

  _modeUrl(provider, mode) {
    const cfg = this._loadProviderConfig(provider);
    return cfg.modeUrls?.[mode] || cfg.baseUrl;
  }

  /**
   * Open a fresh chat on the current page WITHOUT losing login state.
   * Strategy:
   *   1. Try clicking the provider's "New Chat" UI button (.new-chat-btn on Kimi).
   *      This reuses the same tab/context/cookies and is the most reliable way to
   *      start a new thread while staying logged in.
   *   2. Fallback to the configured new-chat landing URL via goto() if the button
   *      is not available.
   * Returns the page URL after opening the new chat.
   */
  async _openNewChat(page, provider = 'kimi') {
    const newChatUrl = this._modeUrl(provider, 'instant');
    if (!page || page.isClosed()) return newChatUrl;

    try {
      // v10.36-fix: Click the native "New Chat" button when available.
      // This preserves login state because it does not reload the origin.
      // PDS Fase 0: provider-configured chain, .new-chat-btn as final fallback.
      const newChatCfg = this._loadProviderConfig(provider);
      const newChatChain = resolveChain(newChatCfg, 'newChat', '.new-chat-btn');
      const { locator: newChatBtn, selector: newChatSel } = await firstMatchingLocator(page, newChatChain);
      if (newChatSel && await newChatBtn.count() > 0) {
        const isVisible = await newChatBtn.evaluate(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }).catch(() => false);
        if (isVisible) {
          await newChatBtn.click({ timeout: 10000 });
          log.info(`[_openNewChat] Clicked '${newChatSel}' for provider=${provider}`);
          await page.waitForTimeout(1500);
          const urlAfterClick = page.url();
          log.info(`[_openNewChat] URL after click: ${urlAfterClick}`);
          return urlAfterClick;
        }
      }
    } catch (e) {
      log.warn(`[_openNewChat] Button click failed: ${e.message} — falling back to goto`);
    }

    // Fallback: navigate to the provider's new-chat landing URL.
    log.info(`[_openNewChat] Falling back to goto ${newChatUrl}`);
    await page.goto(newChatUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    return page.url();
  }

  _loadProviderConfig(provider) {
    try {
      return loadProviderConfig(provider);
    } catch (e) {
      log.warn(`[Provider] Failed to load config for ${provider}, falling back to ${this.defaultProvider}`);
      return loadProviderConfig(this.defaultProvider);
    }
  }

  _getProviderSelectors(provider) {
    const cfg = this._loadProviderConfig(provider);
    return getProviderResponseSelectors(cfg);
  }

  /**
   * Resolve robust selector chains for the provider so the evaluate snippets
   * can iterate through fallbacks instead of relying on a single hardcoded class.
   */
  _resolveDomSelectorChains(provider) {
    const cfg = this._loadProviderConfig(provider);
    return {
      // v2.6.7-fix: include .segment-container as a fallback so Kimi's context-limit
      // notice bubble (which uses .segment-container, not .segment-assistant) is
      // still extracted as a response and caught by _isContextLimitResponse.
      assistant: resolveChain(cfg, 'assistantMessage', '.chat-content-item.chat-content-item-assistant', '.segment.segment-assistant', '.segment-container'),
      contentBox: resolveChain(cfg, 'responseContainer', '.segment-content-box', '.markdown-container', '.segment-assistant'),
      thinking: resolveChain(cfg, 'thinking', '.toolcall-container.thinking-container', '.thinking-container', '.toolcall-container[class*="thinking"]', '[class*="thinking"]', '[class*="reasoning"]'),
      thinkingText: resolveChain(cfg, 'thinkingText', '.toolcall-container.thinking-container .markdown-container', '.toolcall-container.thinking-container .markdown', '.thinking-container .markdown-container', '.thinking-container .markdown'),
      markdown: resolveChain(cfg, 'responseContainer', '.markdown-container', '.markdown'),
      paragraph: ['.paragraph', 'p', '[class*="text"]'],
      codeBlock: ['.segment-code', 'pre code', '[class*="code-block"]'],
      actionButtons: resolveChain(cfg, 'actionButtons', '.segment-assistant-actions .icon-button', '.segment-assistant-actions button', '.chat-content-item-assistant .icon-button', '.segment-assistant .icon-button'),
      messageList: resolveChain(cfg, 'messageList', '.message-list-container', '.message-list', '.chat-content-list', '.chat-list'),
      mode: resolveChain(cfg, 'mode', '.current-model .name', '.current-model', '.chat-editor-action .current-model', '.model-name .name'),
      modeEffort: resolveChain(cfg, 'modeEffort', '.current-model .current-effort', '.model-name .current-effort', '.current-effort'),
    };
  }

  /**
   * Resolve the provider to use for a user.
   * Priority: explicit provider > session.provider > stored provider > default.
   */
  _resolveProvider(userId, provider = null) {
    if (provider && typeof provider === 'string') return provider;
    const session = this.userSessions.get(userId);
    if (session?.provider) return session.provider;
    const stored = this.store?.getUser?.(userId);
    if (stored?.provider) return stored.provider;
    return this.defaultProvider || 'kimi';
  }

  /**
   * Return the base hostname for a provider config (e.g. "kimi.ai").
   */
  _providerDomain(provider) {
    const cfg = this._loadProviderConfig(provider);
    try {
      return new URL(cfg.baseUrl).hostname;
    } catch {
      return cfg.name;
    }
  }

  /**
   * v10.41-fix: Detect when the provider says the conversation reached its
   * context limit. Used by sendMessage/sendMessageStream to surface the flag
   * so callers can start a new chat only when actually needed.
   */
  _isContextLimitResponse(response) {
    // v11.8-fix: broaden detection for Portuguese/Spanish/English context-limit banners
    // and Kimi UI variants (e.g. "Você e o Kimi conversaram bastante. Tente iniciar um novo chat.")
    // Kimi's hardcoded context-limit messages in PT/EN/ES/ZH. Kept tight to the exact
    // phrases Kimi emits; broad regexes are intentionally avoided per owner directive.
    const contextLimitRegex = /Você e o Kimi|you and Kimi|t[uú] y Kimi|Tu y Kimi|Kimi conversaram bastante|Kimi have (?:talked|chatted)|han hablado mucho|Tente iniciar um novo chat|Try starting a new chat|Intenta iniciar un nuevo chat|iniciar um novo chat|tente iniciar um novo chat|start a new chat|nuevo chat|new chat|getting too long|conversation.*too long|reached.*(?:context|token|memory|input) limit|memory limit|input limit|try starting a new session|聊得太长|发起一个新会话|会话太长|对话太长|上下文太长|convers[ao].*(?:muito longa|bastante|demais|muitas mensagens)|conversaram bastante|conversamos bastante|muita conversa|muitas mensagens|chegou ao limite|atingiu o limite|atingimos o limite|limite de (?:contexto|tokens|mem[óo]ria).{0,25}(?:atingido|chegado|excedido|atingiu|atingimos|chegou|chegamos|excedeu|excedemos)|começar um novo chat|inicie um novo chat|create a new chat|refresh this chat|nueva sesi[óo]n|sesi[óo]n.*(?:muy larga|muy longa|demasiado larga|demasiado longa|lleg[óo] al l[íi]mite|llegamos al l[íi]mite|llegou ao limite)/i;
    if (!response) return false;
    return contextLimitRegex.test(response);
  }

  /**
   * v10.36-fix: Close stale provider landing-page tabs after migrating to a
   * new chat tab. Keeps only the active logged-in tab open so the user does not
   * see a deslogada page left behind.
   * v10.40-fix: Also close previous provider chat threads belonging to the same
   * Luna user so new chats do not pile up tabs in Chrome (Telegram mode sends
   * newChat for every turn).
   */
  async _closeStaleProviderTabs(context, keepPage, provider = 'kimi') {
    if (!context || !keepPage) return;
    const providerDomain = this._providerDomain(provider);
    const keepUserId = keepPage._lunaUserId;
    const pages = context.pages();
    for (const p of pages) {
      if (p === keepPage || p.isClosed()) continue;
      try {
        const url = p.url();
        if (!url.includes(providerDomain)) continue;
        // Close landing/new-chat pages that are not real chat threads.
        // Real threads contain /chat/<id>.
        const isStaleLanding = url.includes('chat_enter_method=new_chat') && !url.includes('/chat/');
        // Close managed chat threads owned by the same Luna user. This prevents
        // an infinite stack of Kimi tabs when each Telegram message opens a
        // fresh chat. Tabs without _lunaUserId are left alone to avoid killing
        // manually opened provider pages.
        const sameUserManaged = keepUserId && p._lunaUserId === keepUserId;
        if (isStaleLanding || sameUserManaged) {
          await p.close();
          log.info(`[_closeStaleProviderTabs] Closed stale provider tab: ${url} (landing=${isStaleLanding}, sameUser=${sameUserManaged})`);
        }
      } catch (e) {
        // ignore
      }
    }
  }

  _log(...args) {
    const msg = args.join(' ');
    if (this.debug) log.debug(msg);
  }

  /**
   * Determine whether a URL represents a valid thread URL for a provider.
   */
  _isProviderThreadUrl(provider, url) {
    if (!url || !provider) return false;
    switch (provider) {
      case 'kimi':
        return url.includes('/chat/');
      case 'deepseek':
        return url.includes('/c/');
      default:
        // For unknown providers, accept any URL under the provider domain.
        return true;
    }
  }

  /**
   * Save chat URL to store only if it's a valid thread URL for the active provider.
   * Prevents saving URLs outside the provider domain or without a valid thread path.
   */
  _saveChatUrl(userId, url, extra = {}) {
    if (!url) return;

    const provider = this._resolveProvider(userId);
    const providerDomain = this._providerDomain(provider);

    let isValid;
    try {
      isValid = new URL(url).hostname === providerDomain && this._isProviderThreadUrl(provider, url);
    } catch {
      isValid = false;
    }

    if (!isValid) {
      log.warn(`Refusing to save invalid chatUrl for ${provider}: ${url}`);
      return;
    }
    this.store.setUser(userId, { chatUrl: url, ...extra });
  }

  /**
   * Clear the persisted chat URL for a user.
   * Used before creating a new thread to prevent navigation back to the stale URL.
   */
  _clearChatUrl(userId) {
    const session = this.userSessions.get(userId);
    if (session) {
      session.chatUrl = null;
    }
    this.store.setUser(userId, { chatUrl: null, lastActivity: Date.now() });
    log.info(`Cleared chatUrl for user ${hashUserId(userId)}`);
  }

  /**
   * Capture and persist the current page URL for a user.
   * Throws if there is no active page or the URL cannot be read.
   * Invalid chat URLs are not persisted (see _saveChatUrl).
   */
  _captureCurrentChatUrl(userId) {
    const session = this.userSessions.get(userId);
    if (!session?.page) {
      throw new Error(`No active page for user ${hashUserId(userId)}`);
    }
    const url = session.page.url();
    if (!url) {
      throw new Error(`Could not read current URL for user ${hashUserId(userId)}`);
    }
    session.chatUrl = url;
    this._saveChatUrl(userId, url);
    log.info(`Captured chatUrl for user ${hashUserId(userId)}: ${url}`);
    return url;
  }

  /**
   * Connect to Chrome via CDP. Uses browser.contexts()[0] ONLY.
   * Never creates newContext() — incognito contexts lose the Kimi login.
   */
  async connect() {
    if (this.browser) {
      this._log('Already connected');
      return this;
    }

    // v5.6: Check WebBridge health FIRST — it's our PRIMARY driver
    try {
      const wb = new WebBridgeClient('luna-kimi');
      const health = await wb.healthCheck();
      if (health.ok && health.connected) {
        this.webbridgeHealthy = true;
        log.success('WebBridge PRIMARY ready on port 10086 — Playwright CDP is fallback');
      } else {
        this.webbridgeHealthy = false;
        log.warn('WebBridge not healthy — falling back to Playwright CDP');
      }
    } catch (e) {
      this.webbridgeHealthy = false;
      log.warn(`WebBridge check failed: ${e.message} — using Playwright CDP fallback`);
    }

    let cdpUrl = await this._getCdpUrl();
    log.info(`Connecting to Chrome at ${cdpUrl}`);
    try {
      this.browser = await chromium.connectOverCDP(cdpUrl);
    } catch (e) {
      // v3.7-fix: If connection fails, try to start Chrome automatically
      log.warn(`Failed to connect to Chrome at ${cdpUrl}: ${e.message}`);
      log.info('Attempting to start Chrome automatically...');
      const chromeStatus = await this.checkChrome();
      if (chromeStatus.running || chromeStatus.started) {
        // Re-discover CDP URL after starting Chrome
        this._resetCdpUrl();
        cdpUrl = await this._getCdpUrl();
        log.info(`Retrying connection to Chrome at ${cdpUrl}`);
        this.browser = await chromium.connectOverCDP(cdpUrl);
      } else {
        this._resetCdpUrl();
        throw new Error(`Cannot connect to Chrome: ${chromeStatus.error || e.message}`);
      }
    }
    const contexts = this.browser.contexts();

    if (!contexts || contexts.length === 0) {
      throw new Error('No browser contexts found via CDP. Is Chrome running with --remote-debugging-port?');
    }

    this.defaultContext = contexts[0];
    log.success(`Connected! Using default context with ${this.defaultContext.pages().length} existing page(s)`);

    // v10.36-fix: First, pull the latest cookies FROM the Chrome persistent profile
    // and write them to the master cookies file. This guarantees we always use the
    // cookies Chrome already has, instead of stale backups that log the user out.
    try {
      for (const providerName of listProviders()) {
        await this._syncMasterCookiesFromContext(providerName);
      }
    } catch (e) {
      log.warn(`Failed to sync master cookies from Chrome profile: ${e.message}`);
    }

    // v3.9-fix: Inject MASTER cookies into defaultContext so all new user contexts
    // inherit login state, even when Chrome was just started with an empty profile.
    // After v10.36 these cookies come from the persistent Chrome profile first.
    try {
      for (const providerName of listProviders()) {
        const providerCfg = loadProviderConfig(providerName);
        const cookiePaths = getProviderCookies(providerCfg);
        const masterPath = cookiePaths.master;
        if (fs.existsSync(masterPath)) {
          const masterData = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
          const masterCookies = masterData.cookies || [];
          if (masterCookies.length > 0) {
            await this.defaultContext.addCookies(masterCookies);
            log.info(`Injected ${masterCookies.length} MASTER cookies for ${providerName} into defaultContext`);
          }
        }
      }
    } catch (e) {
      log.warn(`Failed to inject MASTER cookies into defaultContext: ${e.message}`);
    }

    // v3.9-fix: Also inject localStorage into defaultContext pages.
    // PDS Fase 0: per-provider (was hardcoded to the kimi file), and only
    // into pages whose URL matches the provider host — localStorage is
    // per-origin, so injecting anywhere else was a no-op anyway.
    try {
      for (const providerName of listProviders()) {
        const providerCfg = loadProviderConfig(providerName);
        const cookiePaths = getProviderCookies(providerCfg);
        const masterLsPath = cookiePaths.localStorage;
        if (!fs.existsSync(masterLsPath)) continue;
        const masterLsData = JSON.parse(fs.readFileSync(masterLsPath, 'utf8'));
        const lsData = masterLsData.data || {};
        const keys = Object.keys(lsData);
        if (keys.length === 0) continue;
        const providerHost = this._providerDomain(providerName);
        for (const page of this.defaultContext.pages()) {
          if (!page.url().includes(providerHost)) continue;
          await page.evaluate((items) => {
            for (const [key, value] of Object.entries(items)) {
              try { localStorage.setItem(key, value); } catch (e) {}
            }
          }, lsData).catch(() => {});
        }
        log.info(`Injected ${keys.length} localStorage items for ${providerName} into matching defaultContext pages`);
      }
    } catch (e) {
      log.warn(`Failed to inject MASTER localStorage into defaultContext: ${e.message}`);
    }

    // Register crash/disconnect listeners
    this.browser.on('disconnected', async () => {
      log.warn('[CRASH-RECOVERY] Browser disconnected via CDP');
      logChromeEvent('browser_disconnected', { sessions: this.userSessions.size, queues: this.domEventQueues.size });
      this.browser = null;
      this.defaultContext = null;
      this.userContexts.clear();
      this._resetCdpUrl();
      // v8.6-fix: Auto-restart Chrome preemptively so next operation doesn't wait
      try {
        log.info('[CRASH-RECOVERY] Auto-restarting Chrome...');
        await this.checkChrome();
        log.info('[CRASH-RECOVERY] Chrome auto-restarted successfully');
      } catch (e) {
        log.warn('[CRASH-RECOVERY] Auto-restart failed:', e.message);
      }
      // v8.6-fix: Clear global state to prevent stale sessions
      this.domEventQueues.clear();
      this.streamStopFlags.clear();
      this.cancelledStreams.clear();
      this.networkInterceptors.forEach(i => i.stop());
      this.networkInterceptors.clear();
    });

    // Start idle cleanup timer
    this._startIdleCleanup();

    // Start cookie backup timer (save every 5 minutes)
    this._startCookieBackup();

    // v5.6-fix: Start background polling to keep pages alive (prevents mobile Chrome suspension)
    this._startBackgroundPolling();

    return this;
  }

  /**
   * Disconnect: close all user pages, release semaphore, disconnect browser.
   * NEVER calls browser.close() (that kills Chrome).
   */
  async disconnect() {
    log.info('Disconnecting KimiBridge...');

    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.bgPollTimer) {
      clearInterval(this.bgPollTimer);
      this.bgPollTimer = null;
    }

    // Close all user contexts (which also closes their pages)
    for (const [userId, ctx] of this.userContexts) {
      try {
        if (ctx && typeof ctx.close === 'function') {
          await Promise.race([
            ctx.close(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000)),
          ]);
          log.info(`Closed context for user ${hashUserId(userId)}`);
        }
      } catch (e) {
        log.warn(`Error closing context for ${hashUserId(userId)}: ${e.message}`);
      }
      this.semaphore.release();
    }
    this.userContexts.clear();
    this.userSessions.clear();

    if (this.browser) {
      try {
        if (typeof this.browser.disconnect === 'function') {
          await Promise.race([
            this.browser.disconnect(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000)),
          ]);
          log.info('Browser disconnected (CDP)');
        } else {
          log.warn('browser.disconnect not available, skipping');
        }
      } catch (e) {
        log.warn(`Browser disconnect error: ${e.message}`);
      }
      this.browser = null;
      this.defaultContext = null;
    }

    log.success('KimiBridge disconnected');
  }

  /**
   * Ensure connected to CDP with auto-reconnect on disconnect
   */
  async _ensureConnected() {
    if (!this.browser || !this.defaultContext) {
      log.info('Reconnecting to Chrome...');
      await this.connect();
    }
  }

  /**
   * Get or create an isolated BrowserContext for a user.
   * Copies cookies from the default context so the user is already logged in.
   */
  async _getOrCreateUserContext(userId) {
    await this._ensureConnected();

    // v7.4-fix: Use defaultContext instead of incognito context.
    // Incognito contexts do NOT load Chrome extensions (like Luna Extension),
    // causing the DOM observer to fall back to unreliable Playwright injection.
    // The defaultContext shares the same profile as the manually-started Chrome,
    // so extensions are available and login state persists.
    const ctx = this.defaultContext;

    // Re-inject MASTER cookies to ensure login state
    try {
      for (const providerName of listProviders()) {
        const providerCfg = loadProviderConfig(providerName);
        const cookiePaths = getProviderCookies(providerCfg);
        const masterPath = cookiePaths.master;
        if (fs.existsSync(masterPath)) {
          const masterData = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
          const masterCookies = masterData.cookies || [];
          if (masterCookies.length > 0) {
            await ctx.addCookies(masterCookies);
            log.info(`Re-injected ${masterCookies.length} MASTER cookies for ${providerName} into defaultContext for user ${hashUserId(userId)}`);
          }
        }
      }
    } catch (e) {
      log.warn(`Failed to re-inject MASTER cookies for ${hashUserId(userId)}: ${e.message}`);
    }

    this.userContexts.set(userId, ctx);
    return ctx;
  }

  /**
   * Rate limiting: check if user is within cooldown
   */
  _checkCooldown(userId) {
    const last = this.lastRequestTime.get(userId);
    if (last && Date.now() - last < COOLDOWN_MS) {
      const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 1000);
      throw new Error(`Aguarde ${remaining}s antes de enviar outra mensagem`);
    }
    this.lastRequestTime.set(userId, Date.now());
  }

  /**
   * v8.6: Recover a user's session after Chrome crash/disconnect.
   * Reconnects to Chrome, restores the chat URL, and returns the page.
   */
  async recoverSession(userId) {
    log.info(`[CRASH-RECOVERY] Recovering session for user ${hashUserId(userId)}`);
    try {
      await this._ensureConnected();
      const stored = this.store.getUser(userId);
      const provider = stored?.provider || this.defaultProvider || 'kimi';
      const chatUrl = stored?.chatUrl || this._modeUrl(provider, 'instant');
      const mode = stored?.mode || 'instant';

      // Get or create page
      const page = await this._getOrCreateUserPage(userId, provider);
      if (!page || page.isClosed()) {
        throw new Error('Failed to recover page after crash');
      }

      // Navigate back to the saved chat URL
      let currentUrl = '';
      try { currentUrl = page.url(); } catch (e) { currentUrl = ''; }
      if (!currentUrl.includes(chatUrl.split('?')[0].split('/').pop())) {
        log.info(`[CRASH-RECOVERY] Navigating to saved chat URL: ${chatUrl}`);
        await page.goto(chatUrl, { waitUntil: 'domcontentloaded', timeout: 0 });
        await page.waitForTimeout(2000);
      }

      log.info(`[CRASH-RECOVERY] Session recovered for user ${hashUserId(userId)} at ${chatUrl}`);
      return { page, chatUrl, mode, success: true };
    } catch (e) {
      log.error(`[CRASH-RECOVERY] Failed to recover session: ${e.message}`);
      return { success: false, error: e.message };
    }
  }

  /**
   * Get or create a dedicated Page for a user.
   * Reuses existing page if still open.
   */
  async _getOrCreateUserPage(userId, providerArg = null) {
    await this._ensureConnected();

    const provider = this._resolveProvider(userId, providerArg);
    const providerDomain = this._providerDomain(provider);

    const existing = this.userSessions.get(userId);
    if (existing && existing.page && !existing.page.isClosed()) {
      // If the existing page is on a different provider domain, don't reuse it.
      // The caller will navigate to the correct URL later, but using the wrong
      // page can cause _verifySession to run the wrong selectors.
      const currentUrl = existing.page.url();
      if (!currentUrl.includes(providerDomain)) {
        log.info(`Existing page for user ${hashUserId(userId)} is on a different domain (${currentUrl}), creating a new page for provider ${provider}`);
        try { await existing.page.close(); } catch {}
        this.userSessions.delete(userId);
      } else {
        // v3.8-fix: Removed aggressive evaluate() health-check.
        // The evaluate() call fails when the page is still loading/navigating,
        // causing the bridge to close a perfectly good logged-in page and
        // create a new unlogged one. isClosed() is sufficient.
        existing.lastActivity = Date.now();
        existing.provider = provider;
        // v7.0-fix: Re-inject observer on reused pages (may have been navigated)
        await this._injectEventQueueObserver(existing.page).catch(() => {});
        return existing.page;
      }
    }

    // v2.6.8-fix: Each Luna Web session is a distinct user ('web-<sessionId>') and
    // must talk in its own provider chat thread. Sharing a single Chrome tab across
    // sessions caused messages from different users/chats to land in the same Kimi
    // thread. We now reuse a page ONLY when it already belongs to the same userId
    // AND is on the persisted chat URL; otherwise we create a dedicated page.
    const stored = this.store.getUser(userId);
    const storedChatUrl = stored?.chatUrl || null;
    const targetChatId = storedChatUrl?.includes('/chat/')
      ? storedChatUrl.split('/chat/')[1].split('?')[0]
      : null;

    const existingPages = this.defaultContext?.pages() || [];
    const ownPages = [];
    const otherUserActivePages = [];
    for (const p of existingPages) {
      if (p.isClosed()) continue;
      try {
        const url = p.url();
        if (!url || !url.includes(providerDomain)) continue;
        const pageUserId = p._lunaUserId;
        if (pageUserId && pageUserId !== userId) {
          // Mark pages owned by another user so we never steal them.
          const otherSession = this.userSessions.get(pageUserId);
          const isActive = otherSession && (otherSession.processing || (Date.now() - otherSession.lastActivity) < 30 * 60 * 1000);
          otherUserActivePages.push({ p, url, userId: pageUserId, active: isActive });
          continue;
        }
        // Same userId or unassigned page.
        const isChatThread = url.includes('/chat/');
        const matchesTarget = targetChatId ? url.includes(`/chat/${targetChatId}`) : false;
        ownPages.push({ p, url, isChatThread, matchesTarget, score: (matchesTarget ? 4 : 0) + (isChatThread ? 2 : 1) });
      } catch (e) {
        // Page may be closing, skip
      }
    }

    // Reuse only if we own the page and it matches the saved chat URL.
    if (ownPages.length > 0 && storedChatUrl) {
      ownPages.sort((a, b) => b.score - a.score);
      const best = ownPages[0];
      if (best.matchesTarget) {
        const p = best.p;
        p._lunaUserId = userId;
        p._lunaProvider = provider;
        const session = {
          page: p,
          context: this.defaultContext,
          chatUrl: storedChatUrl,
          provider,
          lastActivity: Date.now(),
          processing: false,
          mode: stored?.mode || 'instant',
          sessionSaved: false,
        };
        this.userSessions.set(userId, session);
        log.info(`Reusing own ${providerDomain} page for user ${hashUserId(userId)}: ${best.url}`);
        this._saveChatUrl(userId, session.chatUrl, { mode: session.mode, provider });
        return p;
      }
    }

    if (otherUserActivePages.length > 0) {
      log.info(`Not reusing ${otherUserActivePages.length} provider page(s) owned by other users for ${hashUserId(userId)}`);
    }

    // Acquire semaphore slot (now effectively unlimited)
    log.info(`Acquiring slot for user ${hashUserId(userId)} (${this.semaphore.current}/${this.maxPages})`);
    await this.semaphore.acquire();

    // Get or create isolated context for this user
    const userCtx = await this._getOrCreateUserContext(userId);

    // If we have a persisted chat URL, go directly to it. Otherwise open a fresh
    // chat so this session never lands in another user's thread.
    let chatUrl = storedChatUrl;
    let needsNewChat = false;
    if (!chatUrl) {
      chatUrl = this._modeUrl(provider, 'instant');
      needsNewChat = true;
    }

    let page = null;
    try {
      log.info(`Creating new page for user ${hashUserId(userId)} (provider=${provider})`);
      page = await userCtx.newPage();
      page._lunaUserId = userId; // for cookie re-sync in _verifySession
      page._lunaProvider = provider;

      // Register crash listener
      page.on('crash', () => {
        log.error(`Page crashed for user ${hashUserId(userId)}`);
        logChromeEvent('page_crash', { user: hashUserId(userId), url: page.url() });
        this.userSessions.delete(userId);
        this.semaphore.release();
      });

      // v7.5: No JavaScript injection into page. Network interception is handled
      // server-side via Playwright's native page.on('response'). DOM polling uses
      // page.evaluate() on demand. This is immune to page anti-tampering.

      await page.goto(chatUrl, { waitUntil: 'domcontentloaded', timeout: 0 });
      await page.waitForTimeout(2000);

      // v3.3-fix: Re-inject via evaluate after navigation to ensure observer is active
      // addInitScript only works for future navigations; evaluate ensures current page
      await this._injectDomObserverEvaluate(page);
      // v7.5: No page-level JS injection needed. Network Interceptor is server-side.

      // v3.9-fix: Inject localStorage tokens (access_token, refresh_token etc)
      // These are REQUIRED for provider login state in addition to cookies
      await this._injectMasterLocalStorage(page, provider);

      // v3.9-fix: Verify login state after navigation. If logged out, re-inject cookies
      // and reload. This fixes stale contexts created before master cookies were saved.
      const providerCfg = this._loadProviderConfig(provider);
      const loginSelector = getProviderSelector(providerCfg, 'loginIndicator');
      const appContentSelector = getProviderSelector(providerCfg, 'appContent');
      const isLoggedIn = await page.evaluate(({ loginSel, appSel }) => {
        const hasLoginForm = loginSel ? !!document.querySelector(loginSel) : false;
        const hasAppContent = appSel ? !!document.querySelector(appSel) : false;
        return !hasLoginForm && hasAppContent;
      }, { loginSel: loginSelector, appSel: appContentSelector }).catch(() => false);

      if (!isLoggedIn) {
        log.warn(`Page opened logged-out for ${hashUserId(userId)} — attempting cookie restore + reload...`);
        try {
          const cookiePaths = getProviderCookies(providerCfg);
          const masterPath = cookiePaths.master;
          if (fs.existsSync(masterPath)) {
            const masterData = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
            const masterCookies = masterData.cookies || [];
            if (masterCookies.length > 0) {
              await userCtx.addCookies(masterCookies);
              log.info(`Injected ${masterCookies.length} MASTER cookies before reload`);
            }
          }
        } catch (e) {
          log.warn(`Cookie restore before reload failed: ${e.message}`);
        }
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        // Re-inject localStorage after reload
        await this._injectMasterLocalStorage(page, provider);

        const stillLoggedOut = await page.evaluate(({ loginSel, appSel }) => {
          const hasLoginForm = loginSel ? !!document.querySelector(loginSel) : false;
          const hasAppContent = appSel ? !!document.querySelector(appSel) : false;
          return !hasLoginForm && !hasAppContent;
        }, { loginSel: loginSelector, appSel: appContentSelector }).catch(() => true);

        if (stillLoggedOut) {
          log.warn(`Still logged out after cookie reload — will try _autoLogin on next message`);
        } else {
          log.success(`Cookie restore + reload worked! User ${hashUserId(userId)} is now logged in.`);
        }
      }
    } catch (e) {
      log.warn(`Navigation failed for ${hashUserId(userId)}: ${e.message}`);
      if (page && !page.isClosed()) {
        try { await page.close(); } catch {}
      }
      this.semaphore.release();
      throw e;
    }

    // v2.6.8-fix: A brand-new Luna session with no saved chat must start in a
    // fresh provider thread, not in whatever tab happened to be open.
    if (needsNewChat) {
      try {
        const freshChatUrl = await this._openNewChat(page, provider);
        log.info(`[_getOrCreateUserPage] Opened fresh chat for ${hashUserId(userId)}: ${freshChatUrl}`);
      } catch (openErr) {
        log.warn(`[_getOrCreateUserPage] _openNewChat failed: ${openErr.message}`);
      }
    }

    const session = {
      page,
      context: userCtx,
      chatUrl: page.url(),
      provider,
      lastActivity: Date.now(),
      processing: false,
      mode: stored?.mode || 'instant',
      sessionSaved: false,
    };

    this.userSessions.set(userId, session);
    this._saveChatUrl(userId, session.chatUrl, { mode: session.mode, provider });

    log.success(`Page ready for user ${hashUserId(userId)}: ${session.chatUrl}`);
    return page;
  }

  /**
   * Auto-login fallback: opens login modal, clicks "Continue with Google",
   * and selects the nexodigital account. Used when cookie re-sync fails.
   * v3.8-fix: Handles both modal-already-visible and needs-to-click-sidebar cases.
   */
  async _autoLogin(page, userId) {
    const provider = userId ? this.getChatProvider(userId) : 'kimi';
    const cfg = this.getProviderConfig(userId || 'default');
    if (!cfg.features?.autoLogin) {
      log.info(`[_autoLogin] Skipped for provider: ${provider} (manual login required)`);
      return false;
    }
    log.info('[_autoLogin] Attempting automatic Google sign-in...');
    try {
      const context = page.context();

      // Phase 1: Ensure login modal is visible
      // v5.6-fix: Multi-language support for login detection (EN, PT, ZH, ZH-TW)
      const loginTexts = [
        'Continue with Google', 'Google', 
        '使用 Google 登录', 'Google 登录', '使用 Google 帳戶登入',
        'Entrar com Google', 'Fazer login com Google'
      ];
      let hasModal = await page.evaluate((texts) =>
        texts.some(t => document.body.innerText.includes(t))
      , loginTexts).catch(() => false);

      if (!hasModal) {
        log.info('[_autoLogin] Login modal not visible — clicking sidebar Log In button...');
        // v5.6-fix: Multi-language sidebar login button support
        const sidebarLoginTexts = ['Log In', '登录', '登入', 'Entrar', 'Fazer login', 'Sign In'];
        const clickedSidebar = await page.evaluate((texts) => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node;
          while (node = walker.nextNode()) {
            const trimmed = node.textContent.trim();
            if (texts.some(t => trimmed === t || trimmed.includes(t))) {
              // Walk up to find clickable parent (.user-info or similar)
              let el = node.parentElement;
              for (let i = 0; i < 5 && el; i++) {
                if (el.classList?.contains('user-info') ||
                    el.classList?.contains('user-info-container') ||
                    el.onclick ||
                    window.getComputedStyle(el).cursor === 'pointer') {
                  el.click();
                  return true;
                }
                el = el.parentElement;
              }
              // Fallback: click the text node parent
              node.parentElement.click();
              return true;
            }
          }
          return false;
        }, sidebarLoginTexts);

        if (!clickedSidebar) {
          // Coordinate fallback: bottom-left sidebar area where Log In lives
          await page.mouse.click(97, 585);
          log.info('[_autoLogin] Clicked sidebar Log In via coordinates fallback');
        } else {
          log.info('[_autoLogin] Clicked sidebar Log In button');
        }

        // Wait for modal to appear
        let modalAttempts = 0;
        while (modalAttempts < 20) {
          hasModal = await page.evaluate((texts) =>
            texts.some(t => document.body.innerText.includes(t))
          , loginTexts).catch(() => false);
          if (hasModal) break;
          await page.waitForTimeout(500);
          modalAttempts++;
        }

        if (!hasModal) {
          log.warn('[_autoLogin] Login modal did not appear after clicking sidebar');
          return false;
        }
        log.info('[_autoLogin] Login modal is now visible');
      }

      // Phase 2: Click "Continue with Google" inside the modal
      // v5.6-fix: Try multiple strategies to find the Google button
      let clicked = false;
      
      // Strategy 1: Locator with regex (covers EN, PT, ZH)
      const googleBtn = page.locator('button, [role="button"], div[role="button"]')
        .filter({ hasText: /Continue with Google|Google|使用 Google|Google 登录|Google 登入|Entrar com Google|Fazer login/i })
        .first();
      if (!clicked && await googleBtn.count() > 0) {
        await googleBtn.click({ timeout: 5000 });
        clicked = true;
        log.info('[_autoLogin] Clicked "Continue with Google" via locator');
      }
      
      // Strategy 2: Look for any button containing Google logo/icon
      if (!clicked) {
        const iconBtn = await page.evaluate(() => {
          const buttons = document.querySelectorAll('button, [role="button"]');
          for (const btn of buttons) {
            const html = btn.innerHTML.toLowerCase();
            if (html.includes('google') || html.includes('g-') || html.includes('svg')) {
              btn.click();
              return true;
            }
          }
          return false;
        });
        if (iconBtn) {
          clicked = true;
          log.info('[_autoLogin] Clicked Google button via icon detection');
        }
      }
      
      // Strategy 3: Coordinate fallback (center of modal)
      if (!clicked) {
        await page.mouse.click(640, 300);
        clicked = true;
        log.info('[_autoLogin] Clicked "Continue with Google" via coordinates fallback');
      }

      // Phase 3: Wait for Google auth flow
      // The auth can happen in 3 ways:
      // A) New popup/tab with accounts.google.com (account chooser)
      // B) Same-page redirect to accounts.google.com
      // C) Already logged in — immediate redirect back to Kimi (no chooser)
      await page.waitForTimeout(3000);
      
      let googlePage = null;
      let attempts = 0;
      while (attempts < 20) {
        const pages = context.pages();
        googlePage = pages.find(p => p.url().includes('accounts.google.com'));
        if (googlePage) break;
        
        // Also check if current page redirected to Google
        const currentUrl = page.url();
        if (currentUrl.includes('accounts.google.com')) {
          googlePage = page;
          break;
        }
        
        await page.waitForTimeout(500);
        attempts++;
      }
      
      if (!googlePage) {
        // Case C: No Google page appeared — maybe already logged in or redirect happened instantly
        log.info('[_autoLogin] No Google auth page appeared — checking if already logged in...');
      } else {
        log.info('[_autoLogin] Google auth page detected');
        
        // Phase 4: Select available Google account on chooser
        let selectedAccount = null;
        
        // Wait a moment for the chooser to fully render
        await googlePage.waitForTimeout(1500);
        
        // Strategy 1: Try nexodigital first
        const nexodigitalBtn = googlePage.locator('div[role="button"], div[role="link"], [data-email]')
          .filter({ hasText: /nexodigital\.sys@gmail\.com|nexodigital/i })
          .first();
        if (await nexodigitalBtn.count() > 0) {
          await nexodigitalBtn.click({ timeout: 10000 });
          selectedAccount = 'nexodigital';
        } else {
          const altNexo = googlePage.getByText('nexodigital', { exact: false }).first();
          if (await altNexo.count() > 0) {
            await altNexo.click();
            selectedAccount = 'nexodigital';
          }
        }
        
        // Strategy 2: Fallback to Abner Gabriel
        if (!selectedAccount) {
          const abnerBtn = googlePage.locator('div[role="button"], div[role="link"], [data-email]')
            .filter({ hasText: /Abner Gabriel|nninguem17@gmail\.com/i })
            .first();
          if (await abnerBtn.count() > 0) {
            await abnerBtn.click({ timeout: 10000 });
            selectedAccount = 'Abner Gabriel';
          } else {
            const altAbner = googlePage.getByText('Abner Gabriel', { exact: false }).first();
            if (await altAbner.count() > 0) {
              await altAbner.click();
              selectedAccount = 'Abner Gabriel';
            }
          }
        }
        
        // Strategy 3: Select first account with @ email
        if (!selectedAccount) {
          const firstAccount = googlePage.locator('div[role="button"], div[role="link"]')
            .filter({ hasText: /@/ })
            .first();
          if (await firstAccount.count() > 0) {
            const accountText = await firstAccount.textContent();
            await firstAccount.click({ timeout: 10000 });
            selectedAccount = accountText?.trim().split('\n')[0] || 'first-available';
          }
        }
        
        // Strategy 4: If no account chooser but there's a "Continue" or password field,
        // the user might need to confirm — try clicking first interactive element
        if (!selectedAccount) {
          const anyBtn = googlePage.locator('button, [role="button"]').first();
          if (await anyBtn.count() > 0) {
            const btnText = await anyBtn.textContent();
            log.info(`[_autoLogin] No account found, clicking first button: ${btnText?.substring(0, 50)}`);
            await anyBtn.click({ timeout: 10000 });
            selectedAccount = 'auto-clicked';
          }
        }
        
        if (!selectedAccount) {
          log.warn('[_autoLogin] Could not find any Google account or button on auth page');
          return false;
        }
        log.info(`[_autoLogin] Selected account: ${selectedAccount}`);
      }

      // Phase 5: Wait for redirect back to Kimi and verify login
      log.info('[_autoLogin] Waiting for login to complete...');
      let loginAttempts = 0;
      let isLoggedIn = false;
      while (loginAttempts < 30) {
        isLoggedIn = await page.evaluate(() => {
          const hasLoginForm = !!(
            document.querySelector('form[action*="login"], form[action*="auth"]') ||
            document.querySelector('input[type="password"]')
          );
          const hasAppContent = !!(document.querySelector('.chat-editor, .markdown-container, .segment-assistant-actions'));
          return !hasLoginForm && hasAppContent;
        }).catch(() => false);
        
        if (isLoggedIn) break;
        await page.waitForTimeout(1000);
        loginAttempts++;
      }

      if (isLoggedIn) {
        log.success('[_autoLogin] Automatic login successful!');
        try {
          const cookies = await context.cookies();
          if (cookies && cookies.length > 0) {
            const backupPath = path.join(ARTIFACTS_DIR, 'kimi-cookies-backup.json');
            fs.writeFileSync(backupPath, JSON.stringify(cookies, null, 2));
            log.info(`[_autoLogin] Backed up ${cookies.length} cookies to ${backupPath}`);
          }
        } catch (e) {
          log.warn(`[_autoLogin] Cookie backup after login failed: ${e.message}`);
        }
        return true;
      }
      log.warn('[_autoLogin] Login did not complete successfully');
      return false;
    } catch (e) {
      log.warn(`[_autoLogin] Error during auto-login: ${e.message}`);
      return false;
    }
  }

  /**
   * Verify the user session is not expired (not showing Log In screen)
   * Uses provider-specific login selectors.
   */
  async _verifySession(page) {
    const provider = page._lunaProvider || this.defaultProvider || 'kimi';
    const providerCfg = this._loadProviderConfig(provider);
    const loginSelector = getProviderSelector(providerCfg, 'loginIndicator');
    const appContentSelector = getProviderSelector(providerCfg, 'appContent');

    const evalLoggedIn = async () => {
      return page.evaluate(({ loginSel, appSel }) => {
        const loginEl = loginSel ? document.querySelector(loginSel) : null;
        const pwdEl = document.querySelector('input[type="password"]');
        const appEl = appSel ? document.querySelector(appSel) : null;
        const result = {
          hasLoginForm: !!loginEl,
          hasPassword: !!pwdEl,
          hasAppContent: !!appEl,
        };
        return { loggedIn: !(result.hasLoginForm || result.hasPassword) && result.hasAppContent, debug: result };
      }, { loginSel: loginSelector, appSel: appContentSelector }).catch((e) => ({ loggedIn: false, debug: { error: e.message } }));
    };

    const evalResult = await evalLoggedIn();
    let isLoggedIn = evalResult.loggedIn;
    log.info(`[_verifySession] provider=${provider} isLoggedIn=${isLoggedIn}`);

    if (!isLoggedIn) {
      // Attempt cookie restoration before giving up
      let restored = false;
      try {
        const userId = page._lunaUserId;
        const ctx = userId ? this.userContexts.get(userId) : null;

        // Step 0: Kimi may show a login modal or sidebar "Log In" button even when
        // a valid auth cookie is present. Trigger the OAuth flow so the modal closes
        // and the existing cookie session is activated.
        if (!restored && provider === 'kimi') {
          try {
            const modal = page.locator('.login-modal-mask, .login-modal').first();
            const hasModal = await modal.count() > 0 && await modal.isVisible();
            if (hasModal) {
              // Prefer Google OAuth inside the modal — it uses the browser's saved
              // Google session and dismisses the modal automatically.
              const googleBtn = modal.locator('.google-login-btn, button:has-text("Continue with Google"), button:has-text("Google")').first();
              if (await googleBtn.count() > 0 && await googleBtn.isVisible()) {
                log.info(`[_verifySession] Clicking Kimi Google login button in modal for ${hashUserId(userId)}`);
                await googleBtn.click();
                await page.waitForTimeout(4000);
                if (await evalLoggedIn()) {
                  log.success(`Google login modal click restored session for user ${hashUserId(userId)}`);
                  // The modal may still be open even though the cookie session is active.
                  // Reload to dismiss the overlay so subsequent clicks (new chat, send) work.
                  try {
                    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
                    await page.waitForTimeout(2000);
                    log.info(`[_verifySession] Reloaded page to dismiss login modal`);
                  } catch (e) {
                    log.warn(`[_verifySession] Post-login reload failed: ${e.message}`);
                  }
                  restored = true;
                }
              }
            }
            if (!restored) {
              const loginBtn = page.locator('button:has-text("Log In"), button:has-text("Log in")').first();
              if (await loginBtn.count() > 0 && await loginBtn.isVisible()) {
                log.info(`[_verifySession] Clicking Kimi Log In button to activate cookie session for ${hashUserId(userId)}`);
                await loginBtn.click();
                await page.waitForTimeout(3000);
                if (await evalLoggedIn()) {
                  log.success(`Log In button click restored session for user ${hashUserId(userId)}`);
                  restored = true;
                }
              }
            }
          } catch (e) {
            log.warn(`[_verifySession] Login button click failed: ${e.message}`);
          }
        }

        // Step 1: Try loading from MASTER cookies file (permanent save after manual login)
        if (!restored && ctx) {
          const cookiePaths = getProviderCookies(providerCfg);
          const masterPath = cookiePaths.master;
          if (fs.existsSync(masterPath)) {
            try {
              const masterData = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
              const masterCookies = masterData.cookies || [];
              if (masterCookies.length > 0) {
                await ctx.addCookies(masterCookies);
                log.info(`Loaded ${masterCookies.length} cookies from MASTER backup for user ${hashUserId(userId)} (provider=${provider})`);
                await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
                await page.waitForTimeout(2000);
                if (await evalLoggedIn()) {
                  log.success(`MASTER cookies restored session for user ${hashUserId(userId)}`);
                  restored = true;
                }
              }
            } catch (e) {
              log.warn(`MASTER cookie load failed: ${e.message}`);
            }
          }
        }

        // Step 2: Try re-sync from default context
        if (!restored && userId && this.defaultContext && ctx) {
          const cookies = await this.defaultContext.cookies();
          if (cookies && cookies.length > 0) {
            await ctx.addCookies(cookies);
            log.info(`Re-synced ${cookies.length} cookies from default context for user ${hashUserId(userId)}`);
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
            await page.waitForTimeout(1500);
            if (await evalLoggedIn()) {
              log.success(`Cookie re-sync restored session for user ${hashUserId(userId)}`);
              restored = true;
            }
          }
        }

        // Step 3: Try loading from persistent backup file
        if (!restored && ctx) {
          const loaded = await this._loadCookiesFromFile(ctx);
          if (loaded) {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
            await page.waitForTimeout(1500);
            if (await evalLoggedIn()) {
              log.success(`Cookie backup restored session for user ${hashUserId(userId)}`);
              restored = true;
            }
          }
        }
      } catch (e) {
        log.warn(`Cookie re-sync failed: ${e.message}`);
      }

      if (!restored) {
        // Step 4: Attempt automatic provider login as last resort (only if supported)
        log.warn(`Session expired for user ${hashUserId(page._lunaUserId)} — attempting auto-login...`);
        const autoLoginOk = await this._autoLogin(page, page._lunaUserId);
        if (autoLoginOk) {
          log.success(`Auto-login restored session for user ${hashUserId(page._lunaUserId)}`);
          return true;
        }
        throw new Error(`${provider.toUpperCase()}_LOGIN_REQUIRED`);
      }
      return true;
    }
    return true;
  }

  /**
   * v7.7-INFALÍVEL: Extract ALL new content since preSendSnapshot.
   * Instead of guessing which assistant is the "correct" one, we capture
   * the DOM state BEFORE sending, then AFTER the response is complete,
   * and return the DIFFERENCE. This is immune to:
   * - Confirmation messages appearing after the real response
   * - Multiple assistants being created
   * - DOM structure changes
   * - Index shifting
   */
  async _extractResponseDiff(page, preSendSnapshot = [], provider = null) {
    const resolvedProvider = provider || page._lunaProvider || this.defaultProvider || 'kimi';
    if (resolvedProvider !== 'kimi') {
      // v10.27-fix: snapshot diff relies on Kimi-specific .segment-assistant.
      // For non-Kimi providers, use the generic extraction path directly.
      return this._extractResponse(page, {});
    }

    if (!preSendSnapshot || preSendSnapshot.length === 0) {
      // Fallback: no snapshot, use last assistant
      return this._extractResponse(page, {});
    }

    try {
      const chains = this._resolveDomSelectorChains(resolvedProvider);
      const postSnapshot = await page.evaluate((selectors) => {
        function allMatches(root, sels) {
          const seen = new Set();
          const out = [];
          for (const sel of sels) {
            for (const el of root.querySelectorAll(sel)) {
              if (!seen.has(el)) { seen.add(el); out.push(el); }
            }
          }
          return out;
        }
        function firstMatch(root, sels) {
          for (const sel of sels) {
            const el = root.querySelector(sel);
            if (el) return el;
          }
          return null;
        }
        const assistants = allMatches(document, selectors.assistant);
        return assistants.map((el, i) => {
          // Extract all meaningful text from this assistant
          let text = '';
          const contentBox = firstMatch(el, selectors.contentBox);
          if (contentBox) {
            for (const cb of allMatches(contentBox, selectors.codeBlock)) {
              const t = (cb.innerText || cb.textContent || '').trim();
              if (t) text += t + '\n\n';
            }
            for (const md of allMatches(contentBox, selectors.markdown)) {
              // v10.42-fix: skip markdown nodes that live inside the thinking container
              if (selectors.thinking?.length && md.closest && md.closest(selectors.thinking[0])) continue;
              const t = (md.innerText || md.textContent || '').trim();
              if (t) text += t + '\n\n';
            }
            for (const p of allMatches(contentBox, selectors.paragraph)) {
            // v2.6.6-fix: skip paragraphs inside the thinking container so reasoning text does not leak into the final response.
            if (selectors.thinking?.length && p.closest && p.closest(selectors.thinking[0])) continue;
              const t = (p.innerText || p.textContent || '').trim();
              if (t) text += t + '\n\n';
            }
          }
          return {
            index: i,
            text: text.trim(),
            textLength: text.trim().length,
          };
        });
      }, chains);

      let newContent = '';
      let sources = [];

      // Strategy A: New assistants (index >= preSendSnapshot.length)
      for (let i = preSendSnapshot.length; i < postSnapshot.length; i++) {
        const assistant = postSnapshot[i];
        if (assistant.textLength > 0) {
          newContent += assistant.text + '\n\n';
          sources.push(`new-assistant-${i}`);
        }
      }

      // Strategy B: Existing assistants that changed significantly
      for (let i = 0; i < Math.min(preSendSnapshot.length, postSnapshot.length); i++) {
        const preText = preSendSnapshot[i] || '';
        const postText = postSnapshot[i]?.text || '';
        if (postText.length > preText.length + 10) {
          // Significant change — extract only the NEW part
          const newPart = postText.slice(preText.length).trim();
          if (newPart.length > 10) {
            newContent += newPart + '\n\n';
            sources.push(`changed-assistant-${i}`);
          }
        }
      }

      newContent = newContent.trim();

      if (newContent.length > 0) {
        log.success(`[v7.7] Extracted via snapshot-diff (${sources.join(', ')}): ${newContent.length} chars`);
        return newContent;
      }

      // If no diff found, try extracting from the last assistant as fallback
      const lastAssistant = postSnapshot[postSnapshot.length - 1];
      if (lastAssistant && lastAssistant.textLength > 0) {
        log.warn(`[v7.7] No diff detected, falling back to last assistant (${lastAssistant.textLength} chars)`);
        return lastAssistant.text;
      }
    } catch (e) {
      log.warn(`[v7.7] Snapshot diff failed: ${e.message} — falling back to _extractResponse`);
    }

    return this._extractResponse(page, {});
  }

  /**
   * v11.9-fix: Extract the FULL thinking text from the newest assistant bubble.
   * Used at the end of sendMessageStream to fix truncated or delayed thinking
   * bubbles — the DOM is the source of truth once the turn is complete.
   */
  async _extractFinalThinking(page, provider = 'kimi') {
    const resolvedProvider = provider || page._lunaProvider || this.defaultProvider || 'kimi';
    const chains = this._resolveDomSelectorChains(resolvedProvider);

    // v2.6.6-fix: Kimi collapses the thinking container when the response starts,
    // so innerText only returns a short preview. We expand the container by clicking
    // its title/header, wait for the full reasoning DOM to render, then extract.
    try {
      const expandSelectors = chains.thinking.map(s => s + ' .toolcall-title-container, ' + s + ' .toolcall-title-name, ' + s).join(', ');
      await page.evaluate(({ selectors }) => {
        function firstMatch(root, sels) {
          for (const sel of sels) {
            const el = root.querySelector(sel);
            if (el) return el;
          }
          return null;
        }
        const assistants = Array.from(document.querySelectorAll(selectors.assistant.join(', ')));
        const lastAssistant = assistants[assistants.length - 1];
        if (!lastAssistant) return;
        const thinkContainer = firstMatch(lastAssistant, selectors.thinking);
        if (!thinkContainer) return;
        const title = thinkContainer.querySelector('.toolcall-title-container, .toolcall-title-name');
        if (title) {
          title.click();
          title.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
      }, { selectors: chains });
      await new Promise(r => setTimeout(r, 600));
    } catch (e) {}

    const result = await page.evaluate((selectors) => {
      function allMatches(root, sels) {
        const seen = new Set();
        const out = [];
        for (const sel of sels) {
          for (const el of root.querySelectorAll(sel)) {
            if (!seen.has(el)) { seen.add(el); out.push(el); }
          }
        }
        return out;
      }
      function firstMatch(root, sels) {
        for (const sel of sels) {
          const el = root.querySelector(sel);
          if (el) return el;
        }
        return null;
      }
      const assistants = allMatches(document, selectors.assistant);
      if (!assistants.length) return '';
      const lastAssistant = assistants[assistants.length - 1];
      const thinkContainer = firstMatch(lastAssistant, selectors.thinking);
      if (!thinkContainer) return '';
      const raw = thinkContainer.textContent || '';
      if (!raw) return '';
      return raw
        .replace(/\b(Copy|复制|複製|Copiar)\b/gi, '')
        .replace(/^\s*\b(Thinking|Think|Pensando|Analisando|Analisar|Raciocínio|Raciocinando|Concluído|Concluindo|Raciocínio concluído|Reasoning|Processando|Searching|Buscando)\b\s*[.:]?\s*/i, '')
        .replace(/\s*JSON\s*$/i, '')
        .trim();
    }, chains).catch(() => '');

    return result || '';
  }

  /**
   * v7.7: Capture a snapshot of all assistant texts before sending.
   * This snapshot is used by _extractResponseDiff to compute the difference.
   */
  async _capturePreSendSnapshot(page, provider = 'kimi') {
    try {
      const chains = this._resolveDomSelectorChains(provider);
      const snapshot = await page.evaluate((selectors) => {
        function allMatches(root, sels) {
          const seen = new Set();
          const out = [];
          for (const sel of sels) {
            for (const el of root.querySelectorAll(sel)) {
              if (!seen.has(el)) { seen.add(el); out.push(el); }
            }
          }
          return out;
        }
        function firstMatch(root, sels) {
          for (const sel of sels) {
            const el = root.querySelector(sel);
            if (el) return el;
          }
          return null;
        }
        const assistants = allMatches(document, selectors.assistant);
        return assistants.map((el) => {
          let text = '';
          const contentBox = firstMatch(el, selectors.contentBox);
          if (contentBox) {
            for (const cb of allMatches(contentBox, selectors.codeBlock)) {
              const t = (cb.innerText || cb.textContent || '').trim();
              if (t) text += t + '\n\n';
            }
            for (const md of allMatches(contentBox, selectors.markdown)) {
              // v10.42-fix: skip pre-send thinking markdown so the diff only sees new response text
              if (selectors.thinking?.length && md.closest && md.closest(selectors.thinking[0])) continue;
              const t = (md.innerText || md.textContent || '').trim();
              if (t) text += t + '\n\n';
            }
            for (const p of allMatches(contentBox, selectors.paragraph)) {
            // v2.6.6-fix: skip paragraphs inside the thinking container so reasoning text does not leak into the final response.
            if (selectors.thinking?.length && p.closest && p.closest(selectors.thinking[0])) continue;
              const t = (p.innerText || p.textContent || '').trim();
              if (t) text += t + '\n\n';
            }
          }
          return text.trim();
        });
      }, chains);
      log.info(`[v7.7] Captured pre-send snapshot: ${snapshot.length} assistants`);
      return snapshot;
    } catch (e) {
      log.warn(`[v7.7] Failed to capture pre-send snapshot: ${e.message}`);
      return [];
    }
  }

  /**
   * Extract response using multi-strategy fallback.
   * Prioritizes stream interceptor, then React Fiber, then DOM selectors.
   * v7.7: Kept as fallback for _extractResponseDiff.
   */
  async _extractResponse(page, options = {}) {
    // v7.5: Unified DOM extraction using the SAME logic as _pollThinkingAndResponse Layer 2.5
    // This ensures consistency between the DOM poller and final extraction.
    const { preferAssistantIndex, userId } = options;

    // v7.5: Strategy 0 — Network Interceptor (PRIMARY, server-side)
    // Uses Playwright's native page.on('response') — immune to page anti-tampering.
    if (userId) {
      const interceptor = this.networkInterceptors.get(userId);
      if (interceptor) {
        const data = interceptor.getData();
        if (data.response && data.response.trim().length > 0) {
          log.success(`[v7.5] Extracted via network-intercept: ${data.response.slice(0, 80)}...`);
          return data.response.trim();
        }
      }
    }

    // Strategy 0b: Legacy JS-injected stream interceptor (DEPRECATED)
    try {
      const intercepted = await page.evaluate(() => {
        const s = window.__lunaStream;
        if (s && s.active && s.content) {
          return Array.isArray(s.content) ? s.content.join('') : (s.content || '');
        }
        return null;
      });
      if (intercepted && intercepted.trim()) {
        log.success(`Extracted via stream-intercept-legacy: ${intercepted.slice(0, 80)}...`);
        return intercepted.trim();
      }
    } catch (e) {
      this._log(`Stream intercept extraction failed: ${e.message}`);
    }

    // v7.5: Strategy 1 — Unified DOM extraction (same as _pollThinkingAndResponse Layer 2.5)
    // v10.8-fix: Uses provider selector chains so the new Kimi frontend keeps working
    // when classes change again.
    try {
      const chains = this._resolveDomSelectorChains(provider);
      const domResult = await page.evaluate(({ selectors, prefIdx }) => {
        function allMatches(root, sels) {
          const seen = new Set();
          const out = [];
          for (const sel of sels) {
            for (const el of root.querySelectorAll(sel)) {
              if (!seen.has(el)) { seen.add(el); out.push(el); }
            }
          }
          return out;
        }
        function firstMatch(root, sels) {
          for (const sel of sels) {
            const el = root.querySelector(sel);
            if (el) return el;
          }
          return null;
        }

        const assistants = allMatches(document, selectors.assistant);
        if (!assistants.length) return null;

        let assistant = assistants[assistants.length - 1];
        if (prefIdx !== undefined && prefIdx >= 0 && prefIdx < assistants.length) {
          assistant = assistants[prefIdx];
        }

        let thinking = '';
        let response = '';

        const thinkContainer = firstMatch(assistant, selectors.thinking);
        if (thinkContainer) {
          const raw = thinkContainer.textContent || '';
          if (raw) {
            thinking = raw
              .replace(/^\s*\b(Thinking|Think|Pensando|Analisando|Analisar|Raciocínio|Raciocinando|Concluído|Concluindo|Raciocínio concluído|Reasoning|Processando|Searching|Buscando)\b\s*[.:]?\s*/i, '')
              .replace(/\s*JSON\s*Copy\s*$/i, '')
              .trim();
          }
        }

        const thinkStarters = /^(O usuário|Vou |Agora |Preciso |Primeiro |Vamos |Então |Deixa |Hmm |Ok |Okay |Let me |I need |I'll |First |Now |So |The user |Hmm |Okay )/i;
        const contentBox = firstMatch(assistant, selectors.contentBox);
        if (!contentBox) return null;

        const markdownContainers = allMatches(contentBox, selectors.markdown);
        let rawResponse = '';
        const seenResponseTexts = new Set();
        // v10.43-fix: helper reused from poll path
        function tryParseResponseJson(text) {
          if (!text || text.length < 10) return null;
          let cleaned = text
            .replace(/^s*```(?:json)?s*/i, '')
            .replace(/s*```s*$/i, '')
            .replace(/^s*JSONs*(?:Copy|复制|複製)s*/i, '')
            .trim();
          // v2.6.7-fix: "JSON Copy" header may leave newlines before the actual JSON block.
          // Find the first opening brace and parse from there instead of requiring it at index 0.
          const braceIdx = cleaned.indexOf('{');
          if (braceIdx === -1) return null;
          const candidate = cleaned.slice(braceIdx);
          try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed.response === 'string') return parsed.response;
          } catch {}
          return null;
        }
        for (const md of markdownContainers) {
          if (thinkContainer && md.closest && md.closest(selectors.thinking[0])) continue;
          let mdHasResponseJson = false;
          for (const cb of allMatches(md, selectors.codeBlock)) {
            const text = (cb.innerText || cb.textContent || '').trim();
            if (!text) continue;
            if (text.startsWith('{') && text.includes('"tool"')) {
              // tool JSON block, not user-facing text
              continue;
            }
            const responseText = tryParseResponseJson(text);
            if (responseText !== null) {
              if (!seenResponseTexts.has(responseText)) {
                seenResponseTexts.add(responseText);
                rawResponse += responseText + '\n\n';
              }
              mdHasResponseJson = true;
              continue;
            }
            if (!seenResponseTexts.has(text)) {
              seenResponseTexts.add(text);
              rawResponse += text + '\n\n';
            }
          }
          if (mdHasResponseJson) continue;
          for (const p of allMatches(md, selectors.paragraph)) {
            const text = (p.innerText || p.textContent || '').trim();
            if (text && !seenResponseTexts.has(text)) {
              seenResponseTexts.add(text);
              rawResponse += text + '\n\n';
            }
          }
        }

        // OLD structure fallback
        if (!rawResponse) {
          const containerBlock = contentBox.querySelector('.container-block');
          const blockItems = containerBlock
            ? containerBlock.querySelectorAll('.block-item')
            : contentBox.querySelectorAll('.block-item');
          for (const item of blockItems) {
            if (firstMatch(item, selectors.thinking)) continue;
            if (thinkContainer && (item === thinkContainer || thinkContainer.contains(item))) continue;
            for (const cb of item.querySelectorAll('.segment-code, pre code, [class*="code-block"]')) {
              const text = (cb.textContent || cb.innerText || '').trim();
              if (text) rawResponse += text + '\n\n';
            }
            for (const p of item.querySelectorAll('.paragraph, p, [class*="text"]')) {
              const text = (p.innerText || p.textContent || '').trim();
              if (text) rawResponse += text + '\n\n';
            }
          }
        }

        rawResponse = rawResponse.trim();

        if (thinkContainer && rawResponse) {
          const codeBlockIdx = rawResponse.indexOf('```');
          const jsonStartIdx = rawResponse.search(/\{\s*"/);
          const firstRealIdx = codeBlockIdx >= 0 && jsonStartIdx >= 0
            ? Math.min(codeBlockIdx, jsonStartIdx)
            : (codeBlockIdx >= 0 ? codeBlockIdx : jsonStartIdx);

          if (firstRealIdx > 10) {
            const beforeReal = rawResponse.slice(0, firstRealIdx).trim();
            const afterReal = rawResponse.slice(firstRealIdx).trim();
            if (thinkStarters.test(beforeReal) || beforeReal.length < 400) {
              thinking = thinking ? thinking + '\n\n' + beforeReal : beforeReal;
              response = afterReal;
            } else {
              response = rawResponse;
            }
          } else if (firstRealIdx === 0) {
            response = rawResponse;
          } else if (!rawResponse.includes('```') && !rawResponse.includes('{')) {
            thinking = thinking ? thinking + '\n\n' + rawResponse : rawResponse;
            response = '';
          } else {
            response = rawResponse;
          }
        } else {
          response = rawResponse;
        }

        if (!thinkContainer && response && !thinking) {
          const isThink = thinkStarters.test(response) && response.length < 500 &&
                          !response.includes('"response"') && !response.includes('"tool"');
          if (isThink) {
            thinking = response;
            response = '';
          }
        }

        return { thinking: thinking || '', response: response || '', source: 'dom-unified', assistantIndex: prefIdx };
      }, { selectors: chains, prefIdx: preferAssistantIndex });

      if (domResult && domResult.response) {
        log.success(`Extracted via dom-unified (assistant ${domResult.assistantIndex ?? 'last'}): ${domResult.response.slice(0, 80)}...`);
        return domResult.response.trim();
      }
    } catch (e) {
      this._log(`DOM unified extraction failed: ${e.message}`);
    }

    // v7.5: Strategy 2 — Try previous assistant if last one looks like a confirmation
    try {
      const chains = this._resolveDomSelectorChains(provider);
      const prevResult = await page.evaluate((selectors) => {
        function allMatches(root, sels) {
          const seen = new Set();
          const out = [];
          for (const sel of sels) {
            for (const el of root.querySelectorAll(sel)) {
              if (!seen.has(el)) { seen.add(el); out.push(el); }
            }
          }
          return out;
        }
        function firstMatch(root, sels) {
          for (const sel of sels) {
            const el = root.querySelector(sel);
            if (el) return el;
          }
          return null;
        }
        const assistants = allMatches(document, selectors.assistant);
        if (assistants.length < 2) return null;
        const prevAssistant = assistants[assistants.length - 2];
        if (!prevAssistant) return null;

        let response = '';
        const contentBox = firstMatch(prevAssistant, selectors.contentBox);
        if (contentBox) {
          for (const cb of allMatches(contentBox, selectors.codeBlock)) {
            const text = (cb.innerText || cb.textContent || '').trim();
            if (text) response += text + '\n\n';
          }
        }
        return response.trim() || null;
      }, chains);
      if (prevResult && prevResult.includes('{') && prevResult.includes('"tool"')) {
        log.success(`Extracted via previous-assistant: ${prevResult.slice(0, 80)}...`);
        return prevResult;
      }
    } catch (e) {
      this._log(`Previous assistant extraction failed: ${e.message}`);
    }

    // Strategy 3 — Generic provider fallback
    const provider = page._lunaProvider || this.defaultProvider || 'kimi';
    if (provider !== 'kimi') {
      const generic = await this._genericProviderExtraction(page, provider);
      if (generic.response && generic.response.trim().length > 0) {
        log.success(`Extracted via generic-provider: ${generic.response.slice(0, 80)}...`);
        return generic.response.trim();
      }
    }

    throw new Error('EXTRACTION_FAILED: Nenhuma resposta encontrada');
  }

  /**
   * Generic extraction fallback for non-Kimi providers.
   * Uses provider config response selectors.
   */
  async _genericProviderExtraction(page, provider) {
    try {
      const cfg = this._loadProviderConfig(provider);
      const selectors = getProviderResponseSelectors(cfg);
      const codeBlockSelector = getProviderSelector(cfg, 'codeBlock') || 'pre code';
      const raw = await page.evaluate(({ containerSel, assistantSel, codeBlockSel }) => {
        let response = '';
        if (assistantSel) {
          const assistants = document.querySelectorAll(assistantSel);
          const last = assistants[assistants.length - 1];
          if (last) response = (last.innerText || last.textContent || '').trim();
        }
        if (!response && containerSel) {
          const containers = document.querySelectorAll(containerSel);
          const last = containers[containers.length - 1];
          if (last) response = (last.innerText || last.textContent || '').trim();
        }
        // Gather all code-block texts for tool JSON detection.
        const codeBlocks = [];
        try {
          document.querySelectorAll(codeBlockSel).forEach(el => {
            const text = (el.textContent || el.innerText || '').trim();
            if (text) codeBlocks.push(text);
          });
        } catch {}
        return { response, codeBlocks };
      }, { containerSel: selectors.container, assistantSel: selectors.assistant, codeBlockSel: codeBlockSelector });

      // v10.27-fix: Clean up DeepSeek code-block artifacts ("json\nCopy\nDownload\n{...}")
      // and unwrap JSON wrappers like {"response": "..."}.
      let response = raw.response || '';
      response = response.replace(/^json\s*[\r\n]+/i, '').trim();
      response = response.replace(/^(Copy\s+Download\s*[\r\n]+)/i, '').trim();
      response = response.replace(/\n\s*Copy\s*\n\s*Download\s*\n?/i, '\n').trim();

      // v10.35-fix: Robustly extract {"response":"..."} / {"message":"..."} wrappers.
      // DeepSeek may stream partial JSON or reset the DOM, so we scan character-by-character
      // to find the outermost complete JSON object and ignore trailing fragments.
      const findWrapperObject = (str) => {
        let i = 0;
        while (i < str.length) {
          if (str[i] !== '{') { i++; continue; }
          const start = i;
          let depth = 1;
          let inString = false;
          let escape = false;
          i++;
          while (i < str.length && depth > 0) {
            const c = str[i];
            if (escape) {
              escape = false;
            } else if (c === '\\') {
              escape = true;
            } else if (c === '"') {
              inString = !inString;
            } else if (!inString) {
              if (c === '{') depth++;
              else if (c === '}') depth--;
            }
            i++;
          }
          if (depth === 0) {
            const block = str.slice(start, i);
            if ((/"response"\s*:/.test(block) || /"message"\s*:/.test(block)) && !/"tool"\s*:/.test(block)) {
              return block;
            }
          }
        }
        return null;
      };

      const wrapperBlock = findWrapperObject(response);
      if (wrapperBlock) {
        try {
          const parsed = JSON.parse(wrapperBlock);
          if (parsed && typeof parsed.response === 'string') {
            response = parsed.response.trim();
          } else if (parsed && typeof parsed.message === 'string' && !parsed.tool && !parsed.script) {
            response = parsed.message.trim();
          }
        } catch (e) {
          // Malformed wrapper — fall back to regex extraction instead of keeping raw JSON.
          const m = wrapperBlock.match(/"response"\s*:\s*"((?:\\.|[^"\\])*?)"/);
          if (m) {
            response = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          } else {
            const m2 = wrapperBlock.match(/"message"\s*:\s*"((?:\\.|[^"\\])*?)"/);
            if (m2) {
              response = m2[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            }
          }
        }
      }

      // v10.35-fix / W8-T2a: extractFirstCompleteJsonObject is now module-level
      // (hoisted so _extractJsonToolCalls reuses the same string-aware walker).
      // The call below resolves to the module function — behavior unchanged.

      // v11.1-fix: Manual extraction for writeFile/appendFile when JSON is malformed with
      // unescaped quotes inside the content string. We pull path and content directly so
      // large HTML/JS payloads are not lost.
      function extractWriteFileFallback(text) {
        if (!text || text.length < 30) return null;
        const toolMatch = text.match(/"tool"\s*:\s*"([^"]+)"/);
        if (!toolMatch) return null;
        const tool = toolMatch[1];
        if (!['writeFile', 'appendFile', 'replaceInFile'].includes(tool)) return null;

        function extractStringValue(key) {
          const pattern = new RegExp(`"${key}"\\s*:\\s*"`);
          const m = text.match(pattern);
          if (!m) return null;
          let i = text.indexOf(m[0]) + m[0].length;
          let val = '';
          while (i < text.length) {
            const ch = text[i];
            if (ch === '\\' && i + 1 < text.length) {
              const next = text[i + 1];
              switch (next) {
                case 'n': val += '\n'; break;
                case 't': val += '\t'; break;
                case 'r': val += '\r'; break;
                case 'b': val += '\b'; break;
                case 'f': val += '\f'; break;
                case '\\': val += '\\'; break;
                case '"': val += '"'; break;
                case '/': val += '/'; break;
                case 'u':
                  if (i + 5 < text.length) {
                    const hex = text.slice(i + 2, i + 6);
                    const code = parseInt(hex, 16);
                    if (!isNaN(code)) {
                      val += String.fromCharCode(code);
                      i += 4;
                      break;
                    }
                  }
                  val += next;
                  break;
                default: val += next; break;
              }
              i += 2;
              continue;
            }
            if (ch === '"') {
              let j = i + 1;
              while (j < text.length && /\s/.test(text[j])) j++;
              if (j >= text.length || text[j] === ',' || text[j] === '}' || text[j] === ']') {
                return val;
              }
              val += ch;
              i++;
              continue;
            }
            val += ch;
            i++;
          }
          return val;
        }

        const path = extractStringValue('path');
        const content = extractStringValue('content');
        if (!path || content === null) return null;
        const params = { path, content };
        if (tool === 'replaceInFile') {
          // v13.0 (F3.3): canonical names (old/new) — see the twin site above.
          const oldStr = extractStringValue('old') || extractStringValue('oldStr') || extractStringValue('oldString') || extractStringValue('old_string') || extractStringValue('oldText');
          const newStr = extractStringValue('new') || extractStringValue('newStr') || extractStringValue('newString') || extractStringValue('new_string') || extractStringValue('newText');
          if (oldStr !== null) params.old = oldStr;
          if (newStr !== null) params.new = newStr;
        }
        return { tool, params };
      }

      // v10.32-fix: Detect tool JSON blocks in code blocks and raw response for non-Kimi providers.
      const detectedTools = [];
      function tryParseToolJson(text) {
        if (!text || text.length < 10) return null;
        if (!text.includes('"tool"')) return null;
        // v11.0-fix: Helper that tries strict JSON, then jsonrepair for malformed LLM output.
        function tolerantParse(raw) {
          try {
            return JSON.parse(raw);
          } catch {}
          try {
            const repaired = jsonrepair(raw);
            if (repaired && repaired !== raw) return JSON.parse(repaired);
          } catch {}
          return null;
        }
        // First try the whole text directly (strict or repaired).
        const parsed = tolerantParse(text);
        if (parsed) {
          if (parsed && typeof parsed.tool === 'string' && parsed.params && typeof parsed.params === 'object') {
            return { tool: parsed.tool, params: parsed.params };
          }
          if (parsed && typeof parsed.tool === 'string' && (parsed.path || parsed.command || parsed.script || parsed.query)) {
            return { tool: parsed.tool, params: parsed };
          }
        }
        // v10.35-fix: If direct parse fails, try extracting the first complete JSON object.
        const completeObj = extractFirstCompleteJsonObject(text);
        if (completeObj && completeObj !== text) {
          const parsed2 = tolerantParse(completeObj);
          if (parsed2 && typeof parsed2.tool === 'string' && parsed2.params && typeof parsed2.params === 'object') {
            return { tool: parsed2.tool, params: parsed2.params };
          }
        }
        // v11.1-fix: Last resort for file-write tools with raw HTML/JS content.
        const writeFileFallback = extractWriteFileFallback(text);
        if (writeFileFallback) {
          log.warn(`[tryParseToolJson] Used writeFile fallback for malformed JSON (tool=${writeFileFallback.tool}, path=${writeFileFallback.params.path})`);
          return writeFileFallback;
        }
        return null;
      }
      for (const block of raw.codeBlocks || []) {
        // Strip DeepSeek code-block artifacts before parsing.
        let cleaned = block.replace(/^json\s*[\r\n]+/i, '').trim();
        cleaned = cleaned.replace(/^Copy\s+Download\s*[\r\n]+/i, '').trim();
        const toolAction = tryParseToolJson(cleaned);
        if (toolAction) detectedTools.push(toolAction);
      }
      // Also scan the raw response itself for any JSON tool object.
      const responseTool = tryParseToolJson(response);
      if (responseTool) detectedTools.push(responseTool);

      return { response: response.trim(), detectedTools, source: 'generic-provider', raw: (raw.response || '').substring(0, 200) };
    } catch (e) {
      return { response: '', detectedTools: [], source: 'generic-provider-error' };
    }
  }

  /**
   * Detect the actual mode currently selected in the Kimi UI or page URL
   */
  async _detectActualMode(page, provider = 'kimi') {
    const chains = this._resolveDomSelectorChains(provider);
    // Primary: read the provider-specific mode selector chain.
    const modeText = await page.evaluate((selectors) => {
      function allMatches(root, sels) {
        const seen = new Set();
        const out = [];
        for (const sel of sels) {
          for (const el of root.querySelectorAll(sel)) {
            if (!seen.has(el)) { seen.add(el); out.push(el); }
          }
        }
        return out;
      }
      const els = allMatches(document, selectors.mode);
      if (!els.length && selectors.modeEffort) els.push(...allMatches(document, selectors.modeEffort));
      return els.map(el => (el.innerText || el.textContent || '').trim()).join(' ');
    }, chains).catch(() => '');

    if (modeText) {
      const lower = modeText.toLowerCase();
      if (lower.includes('instant') || lower.includes('fast') || lower.includes('rapid')) return 'instant';
      if (lower.includes('thinking') || lower.includes('deep') || lower.includes('reason')) return 'thinking';
    }

    // Fallback: scan the whole body text for mode labels.
    try {
      const bodyText = await page.evaluate(() => (document.body?.innerText || '').toLowerCase());
      const hasInstant = /\binstant\b/i.test(bodyText);
      const hasThinking = /\bthinking\b/i.test(bodyText) || /\bdeep\b/i.test(bodyText);
      if (hasInstant && !hasThinking) return 'instant';
      if (hasThinking && !hasInstant) return 'thinking';
    } catch {}

    // URL-based fallback
    try {
      const url = page.url().toLowerCase();
      if (url.includes('instant')) return 'instant';
      if (url.includes('thinking') || url.includes('deep')) return 'thinking';
    } catch {}
    return null;
  }

  /**
   * Wait for response completion using Combined Signal with streaming support.
   * Calls onPartial(text, status) periodically so callers can show live updates.
   *
   * Status values:
   *   'writing'  — text changed since last poll (Kimi is generating)
   *   'thinking' — text stable for >5s but not yet complete (Kimi paused/re-reasoning)
   *   'done'     — action buttons visible + text stable for 2s (complete)
   *
   * Throws on timeout.
   */
  async _waitForResponse(page, mode = 'instant', onPartial = null, initialText = '', targetAssistantIndex = -1, provider = 'kimi') {
    // NO TIMEOUT — Kimi may execute Python for 10+ minutes. That's valid activity.
    // We wait until buttons appear + text is stable, forever.

    const chains = provider === 'kimi' ? this._resolveDomSelectorChains(provider) : null;

    // v7.6-fix + v10.8-fix: Helper to get text from target assistant or last markdown.
    // Uses provider selector chains so the new Kimi frontend keeps working.
    const getCurrentText = async () => {
      if (targetAssistantIndex >= 0) {
        return await page.evaluate(({ idx, selectors }) => {
          function allMatches(root, sels) {
            const seen = new Set();
            const out = [];
            for (const sel of sels) {
              for (const el of root.querySelectorAll(sel)) {
                if (!seen.has(el)) { seen.add(el); out.push(el); }
              }
            }
            return out;
          }
          function firstMatch(root, sels) {
            for (const sel of sels) {
              const el = root.querySelector(sel);
              if (el) return el;
            }
            return null;
          }
          const assistants = allMatches(document, selectors.assistant);
          if (idx >= assistants.length) return '';
          const assistant = assistants[idx];
          const markdown = firstMatch(assistant, selectors.markdown);
          return markdown ? (markdown.innerText || '').trim() : '';
        }, { idx: targetAssistantIndex, selectors: chains }).catch(() => '');
      }
      // v10.18-fix: Use finite timeout — landing page has no markdown yet.
      if (!chains) return await page.locator('.markdown-container .markdown').last().innerText({ timeout: 2000 }).catch(() => '');
      return await page.evaluate((selectors) => {
        function allMatches(root, sels) {
          const seen = new Set();
          const out = [];
          for (const sel of sels) {
            for (const el of root.querySelectorAll(sel)) {
              if (!seen.has(el)) { seen.add(el); out.push(el); }
            }
          }
          return out;
        }
        const mds = allMatches(document, selectors.markdown);
        const last = mds[mds.length - 1];
        return last ? (last.innerText || '').trim() : '';
      }, chains).catch(() => '');
    };

    // Phase 0: Wait for text to CHANGE from initialText — this ensures we don't
    // detect the previous response as "done" when buttons are still visible.
    log.info(`Waiting for new response text to appear${targetAssistantIndex >= 0 ? ` (assistant ${targetAssistantIndex})` : ''}...`);
    let textHasChanged = false;
    const changeStart = Date.now();
    while (true) {
      try {
        const currentText = await getCurrentText();
        if (currentText !== initialText && currentText.trim().length > 0) {
          textHasChanged = true;
          log.success('New response text detected');
          break;
        }
      } catch (e) {
        // Element might not exist yet
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!textHasChanged) {
      log.warn('Text did not change from initial — response may already be present or failed to start');
    }

    // Phase 1: Wait for action buttons (they appear when response is done)
    log.info('Waiting for assistant action buttons...');
    let buttonsVisible = false;
    try {
      if (chains) {
        buttonsVisible = await page.evaluate((sels) => {
          for (const sel of sels) {
            const el = document.querySelector(sel);
            if (el && el.offsetParent !== null) return true;
          }
          return false;
        }, chains.actionButtons);
      }
      if (!buttonsVisible) {
        await page.waitForSelector('.segment-assistant-actions .icon-button', {
          state: 'visible',
          timeout: 0,
        });
        buttonsVisible = true;
      }
      if (buttonsVisible) log.success('Action buttons detected — response likely complete');
    } catch (e) {
      log.warn(`Buttons not detected: ${e.message}`);
    }

    // Phase 2: Poll text with streaming callbacks
    log.info('Polling text with streaming...');
    const stabilityWindow = 2000;
    const thinkingWindow = 5000;
    const pollInterval = 1500;
    let lastText = '';
    let stableSince = null;
    let thinkingNotified = false;

    while (true) {
      try {
        const currentText = await getCurrentText();

        // Notify partial update when text changes
        if (currentText !== lastText && currentText.trim().length > 0) {
          stableSince = null;
          thinkingNotified = false;
          lastText = currentText;
          if (onPartial) {
            try { onPartial(currentText, 'writing'); } catch {}
          }
          continue;
        }

        // Text is stable
        if (currentText.trim().length > 0) {
          if (!stableSince) {
            stableSince = Date.now();
          } else {
            const stableFor = Date.now() - stableSince;

            // If buttons visible and stable >2s = DONE
            if (buttonsVisible && stableFor >= stabilityWindow) {
              log.success(`Text stable for ${stableFor}ms + buttons visible — response complete`);
              if (onPartial) {
                try { onPartial(currentText, 'done'); } catch {}
              }
              return lastText;
            }

            // If stable >5s but no buttons yet = THINKING (Kimi paused)
            if (!thinkingNotified && stableFor >= thinkingWindow) {
              thinkingNotified = true;
              log.info(`Text stable for ${stableFor}ms — Kimi may be re-reasoning`);
              if (onPartial) {
                try { onPartial(currentText, 'thinking'); } catch {}
              }
            }
          }
        }
      } catch (e) {
        // Element might not exist yet
      }

      await new Promise(r => setTimeout(r, pollInterval));
    }
  }

  /**
   * Set Kimi mode for a user's page.
   * For 'instant'/'thinking': clicks the Kimi mode selector.
   * Invalid modes are warned about and treated as 'instant' — never silently
   * mapped to Thinking.
   */
  async setMode(userId, mode, providerArg = null) {
    if (mode !== 'instant' && mode !== 'thinking') {
      log.warn(`setMode: invalid mode "${mode}" — treating as 'instant'`);
      mode = 'instant';
    }
    const provider = this._resolveProvider(userId, providerArg);
    const page = await this._getOrCreateUserPage(userId, provider);
    const session = this.userSessions.get(userId);
    session.provider = provider;

    // Instant / Thinking modes: use the Kimi mode selector dropdown (Kimi only)
    if (provider !== 'kimi') {
      session.mode = mode;
      this.store.setUser(userId, { mode, provider });
      this._log(`Mode ${mode} stored for provider ${provider} (no UI switch available)`);
      return mode;
    }

    const kimiMode = mode === 'instant' ? 'instant' : 'thinking';
    const currentLabel = await page.locator('.chat-editor-action .model-name').textContent({ timeout: 3000 }).catch(() => '');
    const targetKeywords = kimiMode === 'instant' ? ['Instant', 'instant', 'Fast', 'Rápido'] : ['Thinking', 'thinking', 'Deep', 'Reason'];

    const isAlreadySet = targetKeywords.some(kw => currentLabel.includes(kw));
    if (isAlreadySet) {
      this._log(`Already in ${mode} mode`);
      session.mode = mode;
      this.store.setUser(userId, { mode, provider });
      return mode;
    }

    log.info(`Switching user ${hashUserId(userId)} to ${mode} mode...`);

    // Try UI dropdown first
    try {
      // Try to dismiss any overlay first (Escape key or click on body)
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(200);

      // Click mode selector — use JS click to bypass overlay intercept
      await page.evaluate(() => {
        const el = document.querySelector('.chat-editor-action .model-name');
        if (el) el.click();
      });
      await page.waitForTimeout(500);

      // Try multiple dropdown selectors, find the one that matches any keyword
      const dropdownSelectors = ['[role=listbox]', '.dropdown-menu', '.model-dropdown', '[class*="dropdown"]', '[class*="menu"]'];
      let optionClicked = false;
      for (const ddSel of dropdownSelectors) {
        const dropdown = page.locator(ddSel).last();
        const count = await dropdown.count().catch(() => 0);
        if (count === 0) continue;
        for (const kw of targetKeywords) {
          const matched = dropdown.locator(`text=${kw}`).or(page.getByText(kw)).first();
          const matchedCount = await matched.count().catch(() => 0);
          if (matchedCount > 0) {
            await matched.click({ timeout: 3000 });
            optionClicked = true;
            break;
          }
        }
        if (optionClicked) break;
      }
      if (optionClicked) {
        await page.waitForTimeout(800);
        session.mode = mode;
        this.store.setUser(userId, { mode, provider });
        log.success(`Mode switched to ${mode} for user ${hashUserId(userId)}`);
        return mode;
      }
      log.warn(`Mode switch: dropdown found but no option matched keywords ${JSON.stringify(targetKeywords)}`);
    } catch (e) {
      log.warn(`Mode switch via UI failed: ${e.message}. Trying URL fallback...`);
    }

    // Fallback: navigate to mode URL if the provider has one
    try {
      const modeUrl = this._modeUrl(provider, mode);
      const currentUrl = page.url();
      if (modeUrl && !currentUrl.includes(modeUrl)) {
        log.info(`Mode switch fallback: navigating to ${modeUrl}`);
        await page.goto(modeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);
        session.mode = mode;
        this.store.setUser(userId, { mode, provider });
        return mode;
      }
    } catch (e2) {
      log.warn(`Mode switch URL fallback also failed: ${e2.message}`);
    }

    // Last resort: try to force mode via URL parameter
    try {
      const separator = page.url().includes('?') ? '&' : '?';
      const forcedUrl = page.url() + separator + `mode=${kimiMode}`;
      await page.goto(forcedUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await page.waitForTimeout(1500);
      log.warn(`Mode switch forced via URL param: ${forcedUrl}`);
    } catch (e3) {
      log.warn(`Mode switch force URL also failed: ${e3.message}`);
    }

    // Save mode anyway — the model will read from session
    session.mode = mode;
    this.store.setUser(userId, { mode, provider });
    log.warn(`Mode switch requested but could not verify via UI. Stored mode=${mode} in session.`);
    return mode;
  }

  /**
   * Create a new chat for a user (does NOT use sendMessage)
   * @param {Object} [opts] - options
   * @param {boolean} [opts.requireChatUrl=true] - If false, allows returning the
   *   provider's "new chat" landing page URL. The real chat URL will be captured
   *   after the first message is sent. Used by context compaction.
   */
  async newChat(userId, providerArg = null, opts = {}) {
    const { requireChatUrl = true } = opts;
    const provider = this._resolveProvider(userId, providerArg);
    const providerDomain = this._providerDomain(provider);
    const newChatUrl = this._modeUrl(provider, 'instant');

    const page = await this._getOrCreateUserPage(userId, provider);
    const session = this.userSessions.get(userId);
    session.provider = provider;

    // Clear any stale chatUrl before creating a new thread.
    this._clearChatUrl(userId);

    // v3.7-fix: Ensure interceptor is active on reused pages
    await this._injectStreamInterceptorEvaluate(page);

    // Reset stream interceptor state to prevent cross-message contamination
    await page.evaluate(() => {
      if (window.__lunaResetStream) {
        window.__lunaResetStream();
      } else if (window.__lunaStream) {
        // v3.7-fix: Must reset to empty ARRAYS, not strings, or .push() breaks
        window.__lunaStream.reasoning = [];
        window.__lunaStream.content = [];
        window.__lunaStream.events = [];
        window.__lunaStream.active = false;
        window.__lunaStream.error = null;
      }
    });

    const oldUrl = page.url();
    const context = page.context();
    const pagesBefore = new Set(context.pages());
    log.info(`Creating new chat for user ${hashUserId(userId)} provider=${provider} (current: ${oldUrl}, pages=${pagesBefore.size})`);

    // v10.36-fix: Open a new chat via the provider UI button when possible.
    // This keeps the same tab/context/cookies and avoids landing-page reloads
    // that can drop login state.
    const openedUrl = await this._openNewChat(page, provider);
    await page.waitForTimeout(1000);

    // Find any new page that opened in the same context (some providers open a tab)
    let newPage = null;
    const pagesAfter = context.pages();
    for (const p of pagesAfter) {
      if (!pagesBefore.has(p)) {
        let url = '';
        try { url = p.url(); } catch (e) { url = ''; }
        log.info(`newChat detected new tab: ${url}`);
        if (url.includes('/chat/') || url.includes(providerDomain)) {
          newPage = p;
          break;
        }
      }
    }

    if (newPage) {
      // Migrate to the new tab
      try {
        if (!page.isClosed()) await page.close();
        log.info(`Closed stale tab for user ${hashUserId(userId)}`);
      } catch (e) {
        log.warn(`Failed to close stale tab: ${e.message}`);
      }
      session.page = newPage;
      newPage._lunaUserId = userId;
      newPage._lunaProvider = provider;

      // v10.36-fix: Close any other leftover landing-page tabs.
      await this._closeStaleProviderTabs(context, newPage, provider);
    }

    let newUrl = newPage ? newPage.url() : openedUrl;

    // v5.3-fix: Post-navigation verification — aguardar URL válida com paciência
    const isValidChatUrl = (url) => (provider === 'kimi' ? url.includes('/chat/') : url.includes(providerDomain));
    if (!isValidChatUrl(newUrl)) {
      log.warn(`newChat: URL ainda não é chat válido (${newUrl}), aguardando...`);
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        newUrl = session.page.url();
        if (isValidChatUrl(newUrl)) break;
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // v5.3-fix: Inject stream interceptor na página atual (evaluate) + futuras (addInitScript)
    // ISSO é a correção crítica: sem _injectStreamInterceptorEvaluate, o agente não captura
    // as respostas da API na aba atual e fica "dormindo" para sempre.
    await this._injectStreamInterceptor(session.page);           // addInitScript — para futuras navs
    await this._injectStreamInterceptorEvaluate(session.page);   // evaluate — para página ATUAL (CRÍTICO!)
    await this._injectDomObserverEvaluate(session.page);
    await this._injectEventQueueObserver(session.page);          // v8.5: ultra-light observer para tempo real

    // v3.4: Verify we actually got a new chat URL
    const chatIdOld = oldUrl.includes('/chat/') ? oldUrl.split('/chat/')[1].split('?')[0] : null;
    const chatIdNew = newUrl.includes('/chat/') ? newUrl.split('/chat/')[1].split('?')[0] : null;
    if (chatIdOld && chatIdNew && chatIdOld === chatIdNew) {
      log.warn(`Still on same chat ID after newChat ( ${chatIdOld} ). URL did not change properly.`);
    }

    // v10.28-fix: For context compaction we may land on the provider's "new chat"
    // landing page. The real /chat/<id> URL only appears after the first message
    // is sent. Allow the caller to opt-in to this intermediate state.
    // v10.38-fix: Normalize URLs before comparison so trailing slashes or
    // reordered query params do not reject a valid landing page.
    const isNewChatLanding = isSameLandingPage(newUrl, newChatUrl);
    if (!isValidChatUrl(newUrl) && (!isNewChatLanding || requireChatUrl)) {
      log.error(`newChat failed for user ${hashUserId(userId)}: URL is not a valid chat (${newUrl}).`);
      throw new Error(`NEW_CHAT_FAILED: Não foi possível criar uma nova thread válida em ${provider} (URL: ${newUrl})`);
    }

    // Step 6: Mark chat with user identifier
    try {
      await session.page.evaluate((uid) => {
        const titleEl = document.querySelector('[class*="chat-title"], [class*="title"], h1, .chat-header-title');
        if (titleEl && !titleEl.textContent.includes(uid)) {
          titleEl.textContent = `[${uid}] ${titleEl.textContent}`;
        }
        document.body.dataset.lunaUserId = uid;
      }, hashUserId(userId));
      log.info(`Marked chat with user identifier: ${hashUserId(userId)}`);
    } catch (e) {
      log.warn(`Failed to mark chat with user ID: ${e.message}`);
    }

    // Update session (session.page was already migrated to the new tab above)
    session.chatUrl = newUrl;
    this._saveChatUrl(userId, newUrl, { provider });

    log.success(`New chat created for user ${hashUserId(userId)}: ${session.chatUrl}`);
    return { chatUrl: session.chatUrl, mode: session.mode };
  }

  /**
   * Send an image (screenshot, file, etc.) to Kimi Web.
   * Supports optional text to accompany the image.
   *
   * Strategy:
   * 1. Decode base64 to temp PNG file
   * 2. Inject a hidden file input into the Kimi DOM
   * 3. Use Playwright setInputFiles to upload
   * 4. Trigger change event so Kimi processes the upload
   * 5. Optionally send accompanying text
   * 6. Wait for response normally
   */
  async sendImage(userId, imageBase64, text = '', options = {}, provider = 'kimi') {
    if (!imageBase64 || !imageBase64.trim()) {
      throw new Error('Image base64 is required');
    }

    // Rate limiting
    this._checkCooldown(userId);

    const resolvedProvider = this._resolveProvider(userId, provider);
    const page = await this._getOrCreateUserPage(userId, resolvedProvider);
    const session = this.userSessions.get(userId);
    session.provider = resolvedProvider;

    if (session.processing) {
      log.warn(`User ${hashUserId(userId)} is already processing — queueing image upload`);
      // v8.4: NO TIMEOUT — wait forever for previous message to finish.
      while (session.processing) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    session.processing = true;
    session.lastActivity = Date.now();

    try {
      await this._verifySession(page);

      if (options.newChat) {
        const openedUrl = await this._openNewChat(page, resolvedProvider);
        if (session) {
          session.chatUrl = openedUrl;
          this._saveChatUrl(userId, session.chatUrl, { provider: resolvedProvider });
        }
      }

      // v10.39-fix: Keep image uploads in the correct Luna-linked chat thread.
      if (!options.newChat && session?.chatUrl) {
        const currentUrl = page.url();
        const expectedId = session.chatUrl.split('?')[0].split('/').pop();
        if (expectedId && !currentUrl.includes(expectedId)) {
          log.info(`[sendImage] URL mismatch for ${hashUserId(userId)}: current=${currentUrl}, expected=${session.chatUrl} — navigating to correct chat`);
          await page.goto(session.chatUrl, { waitUntil: 'domcontentloaded', timeout: 0 });
          await page.waitForTimeout(1500);
        }
      }

      if (options.mode) {
        await this.setMode(userId, options.mode, resolvedProvider);
      }

      const actualMode = await this._detectActualMode(page, resolvedProvider) || session?.mode || 'instant';
      log.info(`User ${hashUserId(userId)} sending image (text=${text ? 'yes' : 'no'}, mode=${actualMode})`);

      await page.bringToFront();

      // Step 1: Save base64 to temp file
      const tmpDir = path.join(ARTIFACTS_DIR, 'tmp-uploads');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const tmpFile = path.join(tmpDir, `kimi-upload-${hashUserId(userId)}-${Date.now()}.png`);
      const buffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      fs.writeFileSync(tmpFile, buffer);
      log.info(`Image saved to temp file: ${tmpFile} (${buffer.length} bytes)`);

      // Step 2: Open toolkit and use native file input
      // Kimi Web has a toolkit-popover with a hidden input[type=file]
      const toolkitBtn = page.locator('.toolkit-trigger-btn').first();
      const hasToolkit = await toolkitBtn.count() > 0;
      
      if (hasToolkit) {
        await toolkitBtn.click();
        await page.waitForTimeout(500);
      }
      
      // Use the native hidden input (appears in toolkit-popover)
      const fileInput = page.locator('.hidden-input, input[type="file"]').first();
      await fileInput.setInputFiles(tmpFile);
      log.info(`File input populated via native input: ${tmpFile}`);
      
      // Step 3: Trigger change event for frameworks that need it
      await page.evaluate(() => {
        const input = document.querySelector('.hidden-input') || document.querySelector('input[type="file"]');
        if (input) {
          input.dispatchEvent(new Event('change', { bubbles: true }));
          // Also trigger input event for React/Vue compatibility
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });

      // Wait for image to be processed by Kimi UI (thumbnail/preview appears)
      log.info('Waiting for image upload to be processed by Kimi...');
      await page.waitForTimeout(2000);

      // Step 4: Send optional text
      if (text && text.trim()) {
        const inputLocator = page.locator('textarea, [contenteditable="true"]').first();
        // W7-T4: Lexical-safe fill — fill() desyncs the React/Lexical
        // EditorState (visible text, Enter becomes a no-op).
        await this._fillContentEditable(inputLocator, text);
        await page.waitForTimeout(500);
      }

      // Step 5: Press Enter to send (W7-T4: verify-and-retry)
      const sendLocator = page.locator('textarea, [contenteditable="true"]').first();
      await this._submitWithVerification(page, sendLocator, text, { provider: resolvedProvider });
      log.info(`Image (+text) sent for user ${hashUserId(userId)}`);

      // Step 6: Wait for response
      const lastText = await this._waitForResponse(page, actualMode, options.onPartialResponse || null, '', -1, resolvedProvider);
      let response = await this._extractResponse(page, { userId });

      // CRITICAL: _extractResponse can return incomplete text. If it's much shorter
      // than the lastText we polled, use lastText as fallback to avoid cutting off [[action]] tags.
      if (lastText && lastText.length > 0) {
        const ratio = response.length > 0 ? response.length / lastText.length : 0;
        if (ratio < 0.5 && lastText.length > response.length) {
          log.warn(`sendMessage: _extractResponse incomplete (${response.length} vs polled ${lastText.length}), using polled text as fallback`);
          response = lastText;
        }
      }

      session.chatUrl = page.url();
      this._saveChatUrl(userId, session.chatUrl);

      log.success(`Response ready for user ${hashUserId(userId)} (len=${response.length})`);

      // Cleanup temp file
      try { fs.unlinkSync(tmpFile); } catch {}

      return {
        response,
        chatUrl: session.chatUrl,
        mode: session.mode,
      };
    } catch (err) {
      // W7-T4: Lexical-safe clear (fill('') leaves desynced text in the box).
      try {
        await this._fillContentEditable(page.locator('textarea, [contenteditable="true"]').first(), '');
      } catch {}
      throw err;
    } finally {
      session.processing = false;
      session.lastActivity = Date.now();
    }
  }

  /**
   * Send a generic file (txt, pdf, etc.) to Kimi Web.
   * v5.3: Generalized from sendImage — supports any file type.
   *
   * @param {string} userId
   * @param {string|Buffer} fileData — base64 string (with/without data URI) or Buffer
   * @param {string} fileName — e.g. 'message.txt', 'doc.pdf'
   * @param {string} text — optional accompanying text
   * @param {object} options
   */
  async sendFile(userId, fileData, fileName, text = '', options = {}, provider = 'kimi') {
    if (!fileData) {
      throw new Error('File data is required');
    }

    // Rate limiting
    this._checkCooldown(userId);

    const resolvedProvider = this._resolveProvider(userId, provider);

    // v5.6: Try WebBridge FIRST (PRIMARY), Playwright as fallback
    if (this.webbridgeHealthy) {
      try {
        log.info(`[sendFile] Using WebBridge PRIMARY for user ${hashUserId(userId)} provider=${resolvedProvider}`);
        const result = await this._sendFileViaWebBridge(userId, fileData, fileName, text, options, resolvedProvider);
        if (result && result.success) {
          log.success(`[sendFile] WebBridge succeeded for user ${hashUserId(userId)}`);
          return result;
        }
      } catch (wbErr) {
        log.warn(`[sendFile] WebBridge failed: ${wbErr.message} — falling back to Playwright CDP`);
      }
    }

    const page = await this._getOrCreateUserPage(userId, resolvedProvider);
    const session = this.userSessions.get(userId);
    session.provider = resolvedProvider;

    if (session.processing) {
      log.warn(`User ${hashUserId(userId)} already processing — queueing file upload`);
      // v8.4: NO TIMEOUT — wait forever for previous message to finish.
      while (session.processing) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    session.processing = true;
    session.lastActivity = Date.now();

    try {
      await this._verifySession(page);

      if (options.newChat) {
        const openedUrl = await this._openNewChat(page, resolvedProvider);
        if (session) {
          session.chatUrl = openedUrl;
          this._saveChatUrl(userId, session.chatUrl, { provider: resolvedProvider });
        }
      }

      // v10.39-fix: Keep file uploads in the correct Luna-linked chat thread.
      if (!options.newChat && session?.chatUrl) {
        const currentUrl = page.url();
        const expectedId = session.chatUrl.split('?')[0].split('/').pop();
        if (expectedId && !currentUrl.includes(expectedId)) {
          log.info(`[sendFile] URL mismatch for ${hashUserId(userId)}: current=${currentUrl}, expected=${session.chatUrl} — navigating to correct chat`);
          await page.goto(session.chatUrl, { waitUntil: 'domcontentloaded', timeout: 0 });
          await page.waitForTimeout(1500);
        }
      }

      if (options.mode) {
        await this.setMode(userId, options.mode, resolvedProvider);
      }

      const actualMode = await this._detectActualMode(page, resolvedProvider) || session?.mode || 'instant';
      log.info(`User ${hashUserId(userId)} sending file ${fileName} (text=${text ? 'yes' : 'no'}, mode=${actualMode})`);

      await page.bringToFront();

      // Step 1: Save file data to temp file
      const tmpDir = path.join(ARTIFACTS_DIR, 'tmp-uploads');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const ext = path.extname(fileName) || '.txt';
      const tmpFile = path.join(tmpDir, `kimi-upload-${hashUserId(userId)}-${Date.now()}${ext}`);

      let buffer;
      if (Buffer.isBuffer(fileData)) {
        buffer = fileData;
      } else if (typeof fileData === 'string' && fileData.includes('base64')) {
        // Strip data URI prefix if present
        const base64 = fileData.replace(/^data:[^;]+;base64,/, '');
        buffer = Buffer.from(base64, 'base64');
      } else if (typeof fileData === 'string') {
        buffer = Buffer.from(fileData, 'utf8');
      } else {
        throw new Error('Unsupported fileData type');
      }
      fs.writeFileSync(tmpFile, buffer);
      log.info(`File saved to temp file: ${tmpFile} (${buffer.length} bytes)`);

      // Helper: check if login modal appeared mid-operation and recover
      // v5.7-fix: When login is recovered, check if file is still in input.
      // The user reported that file stays in the field during login modal.
      const checkAndRecoverLogin = async (stepName) => {
        // First check — modal may appear temporarily during file processing
        let hasLoginModal = await page.evaluate(() => {
          return !!(
            document.querySelector('form[action*="login"], form[action*="auth"]') ||
            document.querySelector('input[type="password"]') ||
            document.querySelector('.login-modal, [class*="login-modal"], [class*="auth-modal"]')
          );
        }).catch(() => false);
        
        if (!hasLoginModal) return false;
        
        // Modal detected — wait a moment, it might disappear on its own (session refresh)
        log.warn(`[sendFile] Login modal detected after ${stepName} — waiting to see if it resolves...`);
        await page.waitForTimeout(5000);
        
        // Check again
        hasLoginModal = await page.evaluate(() => {
          return !!(
            document.querySelector('form[action*="login"], form[action*="auth"]') ||
            document.querySelector('input[type="password"]') ||
            document.querySelector('.login-modal, [class*="login-modal"], [class*="auth-modal"]')
          );
        }).catch(() => false);
        
        if (!hasLoginModal) {
          log.info(`[sendFile] Login modal resolved itself after ${stepName} — continuing`);
          return false;
        }
        
        // Modal persisted — attempt auto-login
        log.warn(`[sendFile] Login modal persisted after ${stepName} — attempting auto-login...`);
        const recovered = await this._autoLogin(page, page._lunaUserId);
        if (!recovered) {
          throw new Error('KIMI_LOGIN_REQUIRED');
        }
        log.success(`[sendFile] Auto-login recovered after ${stepName}`);
        
        // v5.7-fix: Check if file is still in the input after login recovery.
        // _autoLogin does NOT reload the page, so the file should still be there.
        const fileStillThere = await page.evaluate(() => {
          const input = document.querySelector('.hidden-input') || document.querySelector('input[type="file"]');
          return !!(input && (input.files?.length > 0 || input.value));
        }).catch(() => false);
        
        if (fileStillThere) {
          log.info(`[sendFile] File still in input after login recovery — continuing without restart`);
          return false; // Continue normally, file is still there
        }
        
        log.warn(`[sendFile] File lost from input after login recovery — will restart upload`);
        return 'RESTART_UPLOAD';
      };

      // v5.7-fix: Upload with login-recovery loop.
      // If login modal appears and file is lost, restart upload from scratch.
      let uploadAttempt = 0;
      const maxUploadAttempts = 2;
      let needRestart = false;

      while (uploadAttempt < maxUploadAttempts) {
        uploadAttempt++;
        needRestart = false;

        // Step 2: Open toolkit and use native file input
        const toolkitBtn = page.locator('.toolkit-trigger-btn').first();
        const hasToolkit = await toolkitBtn.count() > 0;

        if (hasToolkit) {
          await toolkitBtn.click();
          await page.waitForTimeout(500);
        }
        const toolkitResult = await checkAndRecoverLogin('toolkit click');
        if (toolkitResult === 'RESTART_UPLOAD') { needRestart = true; continue; }

        // Use the native hidden input
        const fileInput = page.locator('.hidden-input, input[type="file"]').first();
        await fileInput.setInputFiles(tmpFile);
        log.info(`File input populated via native input: ${tmpFile}`);
        const inputResult = await checkAndRecoverLogin('file input');
        if (inputResult === 'RESTART_UPLOAD') { needRestart = true; continue; }

        // Step 3: Trigger change event
        await page.evaluate(() => {
          const input = document.querySelector('.hidden-input') || document.querySelector('input[type="file"]');
          if (input) {
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        });

        // Wait for file to be processed by Kimi UI
        log.info('Waiting for file upload to be processed by Kimi...');
        await page.waitForTimeout(2000);
        const processingResult = await checkAndRecoverLogin('file processing');
        if (processingResult === 'RESTART_UPLOAD') { needRestart = true; continue; }

        // If we got here without restart, break the loop
        break;
      }

      if (needRestart && uploadAttempt >= maxUploadAttempts) {
        throw new Error('Upload failed: login recovery caused file loss and max attempts reached');
      }

      // Step 4: Send optional text
      if (text && text.trim()) {
        const inputLocator = page.locator('textarea, [contenteditable="true"]').first();
        // W7-T4: Lexical-safe fill — fill() desyncs the React/Lexical
        // EditorState (visible text, Enter becomes a no-op).
        await this._fillContentEditable(inputLocator, text);
        await page.waitForTimeout(500);
      }

      // Step 5: Press Enter to send (W7-T4: verify-and-retry)
      const sendLocator = page.locator('textarea, [contenteditable="true"]').first();
      await this._submitWithVerification(page, sendLocator, text, { provider: resolvedProvider });
      log.info(`File (+text) sent for user ${hashUserId(userId)}`);
      const sendResult = await checkAndRecoverLogin('send message');
      if (sendResult === 'RESTART_UPLOAD') {
        // If login happened after send, the message may have been sent already.
        // Just continue to wait for response.
        log.info('[sendFile] Login recovered after send — continuing to wait for response');
      }

      // Step 6: Wait for response
      const lastText = await this._waitForResponse(page, actualMode, options.onPartialResponse || null, '', -1, resolvedProvider);
      let response = await this._extractResponse(page, { userId });

      if (lastText && lastText.length > 0) {
        const ratio = response.length > 0 ? response.length / lastText.length : 0;
        if (ratio < 0.5 && lastText.length > response.length) {
          log.warn(`sendFile: _extractResponse incomplete (${response.length} vs polled ${lastText.length}), using polled text as fallback`);
          response = lastText;
        }
      }

      session.chatUrl = page.url();
      this._saveChatUrl(userId, session.chatUrl);

      log.success(`Response ready for user ${hashUserId(userId)} (len=${response.length})`);

      // Cleanup temp file
      try { fs.unlinkSync(tmpFile); } catch {}

      return {
        response,
        chatUrl: session.chatUrl,
        mode: session.mode,
      };
    } catch (err) {
      // W7-T4: Lexical-safe clear (fill('') leaves desynced text in the box).
      try { await this._fillContentEditable(page.locator('textarea, [contenteditable="true"]').first(), ''); } catch {}
      throw err;
    } finally {
      session.processing = false;
      session.lastActivity = Date.now();
    }
  }

  /**
   * Send a message and wait for response
   */
  // ============================================================
  // v5.6: WebBridge PRIMARY methods
  // ============================================================

  async _sendFileViaWebBridge(userId, fileData, fileName, text = '', options = {}, provider = 'kimi') {
    const wb = new WebBridgeClient(`luna-${hashUserId(userId)}`);
    const providerDomain = this._providerDomain(provider);
    const newChatUrl = this._modeUrl(provider, 'instant');

    // Step 1: Navigate to provider or find existing tab
    const listRes = await wb.listTabs();
    const providerTab = listRes.tabs?.find(t => t.url && t.url.includes(providerDomain));
    if (providerTab) {
      await wb.findTab(providerTab.url);
      log.info(`[WebBridge] Found existing ${provider} tab: ${providerTab.url}`);
    } else {
      await wb.navigate(newChatUrl, true);
      log.info(`[WebBridge] Opened new ${provider} tab`);
    }

    // Step 2: Save file to disk (WebBridge needs file paths)
    const tmpDir = path.join(ARTIFACTS_DIR, 'tmp-uploads');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const ext = path.extname(fileName) || '.txt';
    const tmpFile = path.join(tmpDir, `wb-upload-${hashUserId(userId)}-${Date.now()}${ext}`);

    let buffer;
    if (Buffer.isBuffer(fileData)) {
      buffer = fileData;
    } else if (typeof fileData === 'string' && fileData.includes('base64')) {
      const base64 = fileData.replace(/^data:[^;]+;base64,/, '');
      buffer = Buffer.from(base64, 'base64');
    } else if (typeof fileData === 'string') {
      buffer = Buffer.from(fileData, 'utf8');
    } else {
      throw new Error('Unsupported fileData type');
    }
    fs.writeFileSync(tmpFile, buffer);
    log.info(`[WebBridge] File saved to ${tmpFile} (${buffer.length} bytes)`);

    // Step 3: Use evaluate to reveal file input and set files DIRECTLY
    // This is the MOST RELIABLE method — bypasses accessibility tree entirely
    await this._sleep(1500);
    log.info('[WebBridge] Injecting file into Kimi via DOM evaluate...');
    
    // v5.7-fix: Check for login modal BEFORE attempting upload
    const loginCheck = await wb.evaluate(`
      (() => {
        const hasModal = !!(
          document.querySelector('form[action*="login"], form[action*="auth"]') ||
          document.querySelector('input[type="password"]') ||
          document.querySelector('.login-modal, [class*="login-modal"], [class*="auth-modal"]')
        );
        const loginTexts = ['Continue with Google', 'Google', '使用 Google 登录', 'Google 登录', '使用 Google 帳戶登入', 'Entrar com Google', 'Fazer login com Google'];
        const hasLoginText = loginTexts.some(t => document.body.innerText.includes(t));
        return { hasLoginModal: hasModal || hasLoginText };
      })()
    `);
    if (loginCheck.data?.value?.hasLoginModal) {
      log.warn('[WebBridge] Login modal detected — WebBridge cannot handle login. Falling back to Playwright CDP');
      throw new Error('LOGIN_MODAL_WEBBRIDGE_CANNOT_HANDLE');
    }

    const injectResult = await wb.evaluate(`
      (async () => {
        // Find or create file input
        let input = document.querySelector('input[type="file"]');
        
        // If not found, click toolkit button to reveal it
        if (!input) {
          const toolkitBtn = document.querySelector('.toolkit-trigger-btn, button[class*="toolkit"], [class*="upload"]');
          if (toolkitBtn) {
            toolkitBtn.click();
            await new Promise(r => setTimeout(r, 500));
            input = document.querySelector('input[type="file"]');
          }
        }
        
        if (!input) {
          // Create a hidden file input as last resort
          input = document.createElement('input');
          input.type = 'file';
          input.style.display = 'none';
          document.body.appendChild(input);
        }
        
        // Make sure it's visible and interactive
        input.style.display = 'block';
        input.style.visibility = 'visible';
        input.style.opacity = '1';
        input.style.position = 'fixed';
        input.style.top = '0';
        input.style.left = '0';
        input.style.zIndex = '999999';
        
        return { found: true, hasInput: !!input, tag: input?.tagName };
      })()
    `);
    log.info(`[WebBridge] File input ready: ${JSON.stringify(injectResult.data?.value)}`);

    // Step 4: Upload file using CSS selector (input is now visible)
    await this._sleep(500);
    try {
      await wb.upload("input[type='file']", [tmpFile]);
      log.info(`[WebBridge] Uploaded file via CSS selector`);
    } catch (uploadErr) {
      log.warn(`[WebBridge] Upload API failed: ${uploadErr.message}`);
      throw uploadErr;
    }

    // Step 5: Fill accompanying text using WebBridge fill (supports contenteditable natively)
    if (text && text.trim()) {
      await this._sleep(800);
      try {
        await wb.fill("textarea, [contenteditable='true']", text);
        log.info(`[WebBridge] Filled input with text via fill API`);
      } catch (fillErr) {
        log.warn(`[WebBridge] Fill API failed: ${fillErr.message} — using evaluate fallback`);
        await wb.evaluate(`
          const input = document.querySelector('textarea, [contenteditable="true"]');
          if (input) {
            if (input.isContentEditable) {
              input.focus();
              const sel = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(input);
              sel.removeAllRanges();
              sel.addRange(range);
              document.execCommand('insertText', false, ${JSON.stringify(text)});
            } else {
              const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
              const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
              setter.call(input, ${JSON.stringify(text)});
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        `);
      }
    }

    // v6.1-fix: Capture the last response text BEFORE sending, so we can
    // distinguish between the previous response and the new one.
    const initialRes = await wb.evaluate(`
      const containers = document.querySelectorAll('.markdown-container .markdown, .segment-assistant, [class*="assistant"]');
      const last = containers[containers.length - 1];
      return last ? last.innerText : '';
    `);
    const initialText = initialRes.data?.value || '';
    log.info(`[WebBridge] Captured initial text (${initialText.length} chars) before sending`);

    // Step 6: Send message — click send button or press Enter
    await this._sleep(500);
    try {
      const sendResult = await wb.evaluate(`
        (() => {
          // Strategy 1: Find send button by SVG icon or aria-label
          const allButtons = document.querySelectorAll('button');
          for (const btn of allButtons) {
            const aria = btn.getAttribute('aria-label') || '';
            if (/send|enviar|发送|submit/i.test(aria)) {
              btn.click();
              return { method: 'aria-button' };
            }
            // Check for SVG arrow icon inside button
            const svg = btn.querySelector('svg');
            if (svg && !btn.disabled && btn.getBoundingClientRect().width < 60) {
              btn.click();
              return { method: 'svg-button' };
            }
          }
          
          // Strategy 2: Press Enter on input
          const input = document.querySelector('textarea, [contenteditable="true"]');
          if (input) {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
            input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
            return { method: 'enter-key' };
          }
          
          return { method: 'none', error: 'No send mechanism found' };
        })()
      `);
      log.info(`[WebBridge] Sent message via: ${JSON.stringify(sendResult.data?.value)}`);
    } catch (e) {
      log.warn(`[WebBridge] Send failed: ${e.message}`);
    }

    // Step 7: Poll for response using evaluate (most reliable)
    log.info('[WebBridge] Waiting for response...');
    let response = '';
    let lastText = '';
    let stableFor = 0;
    const pollInterval = 1000;
    const maxWait = Number.MAX_SAFE_INTEGER;
    const startTime = Date.now();
    while (Date.now() - startTime < maxWait) {
      await this._sleep(pollInterval);

      const evalRes = await wb.evaluate(`
        const containers = document.querySelectorAll('.markdown-container .markdown, .segment-assistant, [class*="assistant"]');
        const last = containers[containers.length - 1];
        return last ? last.innerText : '';
      `);
      const currentText = evalRes.data?.value || '';

      // v6.1-fix: Ignore text that matches the initial (pre-send) response.
      // This prevents the previous response from being detected as the new one.
      if (currentText && currentText === initialText) {
        continue;
      }

      if (currentText && currentText !== lastText) {
        lastText = currentText;
        stableFor = 0;
      } else {
        stableFor += pollInterval;
      }

      // Check for completion: copy/regenerate buttons visible
      const doneCheck = await wb.evaluate(`
        const btn = document.querySelector('.segment-assistant-actions button, [class*="copy"], [class*="regenerate"]');
        return !!btn;
      `);
      const hasDoneButton = doneCheck.data?.value === true;

      if (hasDoneButton && stableFor > 3000 && currentText.length > 10) {
        response = currentText;
        break;
      }
      if (stableFor > 20000 && currentText.length > 10) {
        response = currentText;
        break;
      }
    }

    // Cleanup
    try { fs.unlinkSync(tmpFile); } catch {}

    return {
      success: true,
      response: response || lastText,
      chatUrl: this._modeUrl(provider, 'instant'),
      mode: options.mode || 'instant',
      provider,
    };
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /**
   * v10.18-fix: Dispatch native Enter key events to submit the Kimi input.
   * Playwright's press('Enter') does not trigger the Lexical editor's submit
   * handler on Kimi's landing page; native KeyboardEvent does.
   */
  async _pressEnterOnInput(inputLocator) {
    try {
      const el = await inputLocator.elementHandle();
      if (el) {
        await el.evaluate((node) => {
          for (const type of ['keydown', 'keypress', 'keyup']) {
            node.dispatchEvent(new KeyboardEvent(type, {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true,
              cancelable: true,
              composed: true,
            }));
          }
        });
        return;
      }
    } catch (e) {
      log.warn(`_pressEnterOnInput dispatch failed: ${e.message}`);
    }
    // Fallback to Playwright's press if element handle is unavailable
    await inputLocator.press('Enter');
  }

  /**
   * v10.35-fix: Fill a contenteditable/Lexical editor reliably.
   * Playwright's fill() does not register in React/Lexical contenteditable
   * on Kimi's landing/agent page. We use document.execCommand('insertText')
   * inside the focused editor, which Lexical observes correctly.
   */
  async _fillContentEditable(inputLocator, text) {
    await inputLocator.evaluate((el) => el.focus());
    const cleared = await inputLocator.evaluate((el) => {
      const tag = (el.tagName || '').toLowerCase();
      const isEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';
      if (tag === 'textarea' || tag === 'input') {
        el.value = '';
        el.selectionStart = 0;
        el.selectionEnd = 0;
      } else if (isEditable) {
        // Lexical/ProseMirror-safe clear: use a real Selection over the whole
        // editor, then delete. execCommand('selectAll') can select the whole
        // document on some editors and leave the editor state desynced.
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('delete', false, null);
        // Nuclear fallback if anything remains.
        if ((el.textContent || '').trim().length > 0) {
          el.innerHTML = '';
        }
      } else {
        el.textContent = '';
      }
      return (el.value || el.textContent || el.innerText || '').trim().length === 0;
    });
    if (!cleared) {
      log.warn('[_fillContentEditable] input was not fully cleared before typing');
    }

    // v2.6.6-fix: retry insertion with multiple strategies until the text is
    // actually observable in the input. Some Kimi renders swallow execCommand.
    const strategies = ['exec-insert', 'innerText-set', 'html-span'];
    for (let attempt = 0; attempt < strategies.length; attempt++) {
      const inserted = await inputLocator.evaluate((el, txt, strategy) => {
        const tag = (el.tagName || '').toLowerCase();
        const isEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';
        if (tag === 'textarea' || tag === 'input') {
          el.value = txt;
          el.selectionStart = el.selectionEnd = txt.length;
        } else if (strategy === 'innerText-set') {
          el.innerText = txt;
        } else if (strategy === 'html-span') {
          el.innerHTML = '<span>' + txt.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          document.execCommand('insertText', false, txt);
        }
        // Dispatch input events so React/Lexical state updates and send button enables
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: txt }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        const current = (el.value || el.textContent || el.innerText || '').trim();
        return current.includes(txt.trim());
      }, text, strategies[attempt]);
      if (inserted) {
        if (attempt > 0) {
          log.info(`[_fillContentEditable] text inserted on attempt ${attempt + 1} via '${strategies[attempt]}'`);
        }
        return;
      }
      log.warn(`[_fillContentEditable] attempt ${attempt + 1} ('${strategies[attempt]}') did not stick — retrying`);
      await new Promise(r => setTimeout(r, 200));
    }
    log.warn('[_fillContentEditable] typed text not found in input after all insertion attempts');
  }

  /**
   * W7-T4: Submit the typed message and VERIFY it actually left the input.
   * Kimi's Lexical editor can silently swallow the synthetic Enter (text
   * visible in the DOM but an empty/desynced EditorState) — the message then
   * sits in the box until the user presses Enter manually. Strategy chain,
   * one per attempt, with a ~10s verification poll after each:
   *   1. synthetic KeyboardEvent Enter (_pressEnterOnInput);
   *   2. Lexical-safe re-fill + TRUSTED Enter (Playwright click + keyboard);
   *   3. click the .send-button-container (same selector the steer uses).
   * Verification only fires on TRANSITIONS measured against a pre-submit
   * baseline — never on pre-existing DOM state: the input clearing after it
   * was OBSERVED holding the typed text, the assistant-segment count
   * increasing, the stop (generating) button appearing, or the send button
   * flipping to disabled. Throws SEND_NOT_CONFIRMED when all attempts fail
   * so the turn errors visibly instead of hanging silently (Wave 6 contract).
   */
  async _submitWithVerification(page, inputLocator, text, options = {}) {
    const submitStartTime = Date.now();
    const submitCfg = this._loadProviderConfig(options.provider || 'kimi');
    const submitAssistantChain = resolveChain(submitCfg, 'assistantMessage', '.segment-assistant');
    const submitSendChain = resolveChain(submitCfg, 'sendButton', '.send-button-container');
    const submitStopChain = resolveChain(submitCfg, 'stopButton', '.stop-button-container');
    // v2.6.8-fix: use the whitespace-normalized message (preferring the tail)
    // as the verification signature. A shared prefix between the previous and
    // new message used to fool the bridge into thinking the new text was already
    // in the input, causing the previous message to be re-sent.
    const signature = (text || '').replace(/\s+/g, ' ').trim();
    const normText = signature.length > 300 ? signature.slice(-300) : signature;
    const readInput = async () => {
      if (!normText) return '';
      const current = await inputLocator.inputValue().catch(() =>
        inputLocator.evaluate((el) => el.innerText || el.textContent || '').catch(() => '')
      );
      return (current || '').replace(/\s+/g, ' ').trim();
    };
    const readState = () => page.evaluate(({ assistantChain, sendChain, stopChain }) => {
      const firstMatch = (sels) => {
        for (const s of sels) { const el = document.querySelector(s); if (el) return el; }
        return null;
      };
      const assistants = assistantChain.length
        ? document.querySelectorAll(assistantChain.join(',')).length
        : 0;
      const sendBtn = firstMatch(sendChain);
      const sendDisabled = sendBtn
        ? (sendBtn.classList.contains('disabled') || sendBtn.getAttribute('aria-disabled') === 'true' || sendBtn.disabled === true)
        : false;
      const stopBtn = firstMatch(stopChain);
      const generating = !!stopBtn;
      // TRACE: capture stop button details for diagnostics
      const stopBtnInfo = stopBtn ? {
        tagName: stopBtn.tagName,
        className: (stopBtn.className || '').slice(0, 100),
        visible: stopBtn.offsetParent !== null,
        ariaLabel: stopBtn.getAttribute('aria-label') || '',
        textContent: (stopBtn.textContent || '').slice(0, 50)
      } : null;
      return { assistants, sendDisabled, generating, stopBtnInfo };
    }, { assistantChain: submitAssistantChain, sendChain: submitSendChain, stopChain: submitStopChain }).catch(() => null);

    // v2.6.8-fix: hard-clear the input before taking a baseline. This prevents
    // a stale previous message from being mistaken for the new text when the two
    // happen to share a prefix.
    try {
      await this._fillContentEditable(inputLocator, '');
      const afterClear = await readInput();
      if (afterClear) {
        log.warn(`[_submitWithVerification] input still contains text after clear: ${afterClear.slice(0, 80)}`);
      }
    } catch (clearErr) {
      log.warn(`[_submitWithVerification] pre-submit clear failed: ${clearErr.message}`);
    }

    // Pre-submit baseline. Only CHANGES relative to this state confirm the
    // submit — a stop button left over from a previous turn or a send button
    // disabled on an empty input must not count as success.
    const baseline = await readState() || { assistants: 0, sendDisabled: false, generating: false };
    // TRACE: log baseline state
    console.log(`[TRACE][SUBMIT_BASELINE] time=${Date.now()} elapsed=${Date.now() - submitStartTime}ms generating=${baseline.generating} assistants=${baseline.assistants} sendDisabled=${baseline.sendDisabled} stopBtnInfo=${JSON.stringify(baseline.stopBtnInfo || null)} textLen=${(text || '').length}`);
    // Sticky: true once the box is OBSERVED holding the typed text. An input
    // clear only proves the send if the text was there before — otherwise a
    // silent fill failure would look exactly like a successful submit.
    let inputHeldPrefix = normText ? (await readInput()).includes(normText) : false;
    if (normText && !inputHeldPrefix) {
      log.warn('[_submitWithVerification] typed text not visible in the input at baseline — pre-submit fill may have failed');
    }
    const strategies = ['synthetic-enter', 'trusted-enter', 'send-button-click'];

    for (let attempt = 0; attempt < strategies.length; attempt++) {
      const strategy = strategies[attempt];
      const attemptStartTime = Date.now();
      // TRACE: log attempt start
      console.log(`[TRACE][ATTEMPT_${attempt + 1}_STARTED] time=${attemptStartTime} strategy=${strategy} elapsed=${attemptStartTime - submitStartTime}ms`);
        // v12.0-fix: anti-echo guard. If a previous attempt ACTUALLY submitted
        // but no transition was observed within the verify window, retrying
        // would re-fill and re-send the SAME message (the duplicate-user-message
        // residual). Before any retry, check whether the signature already sits
        // in the rendered chat history (outside the editor) — if so, it was sent.
        if (attempt > 0 && normText) {
          const alreadySent = await page.evaluate((sig) => {
            const items = document.querySelectorAll('.chat-content-item, [class*="chat-content-item"], .segment');
            for (const el of items) {
              if (el.closest('.chat-editor') || el.closest('[contenteditable]')) continue;
              const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
              if (t && t.includes(sig)) return true;
            }
            return false;
          }, normText).catch(() => false);
          if (alreadySent) {
            log.info(`[_submitWithVerification] echo guard: message already in chat history — treating as sent (attempt ${attempt + 1})`);
            return { confirmed: true, strategy: 'echo-guard', weak: true };
          }
        }
      try {
        if (strategy === 'synthetic-enter') {
          await this._pressEnterOnInput(inputLocator);
        } else if (strategy === 'trusted-enter') {
          // The first Enter may have hit a desynced Lexical state — re-fill so
          // the EditorState actually holds the text, then send a TRUSTED Enter
          // via a real Playwright click + keyboard press.
          await this._fillContentEditable(inputLocator, text || '');
          if (normText && !inputHeldPrefix) {
            // Read the box back: only trust the re-fill if the text stuck.
            inputHeldPrefix = (await readInput()).includes(normText);
            if (!inputHeldPrefix) {
              log.warn('[_submitWithVerification] re-fill did not stick — input still missing the typed text');
            }
          }
          await page.waitForTimeout(300);
          await inputLocator.click({ timeout: 5000 }).catch(() => inputLocator.evaluate((el) => el.focus()));
          await page.keyboard.press('Enter');
        } else {
          const { locator: sendBtn } = await firstMatchingLocator(page, submitSendChain);
          if (await sendBtn.count() > 0) {
            await sendBtn.click({ timeout: 5000 });
          } else {
            log.warn('[_submitWithVerification] send button not found via provider chain — click strategy skipped');
          }
        }
      } catch (e) {
        log.warn(`[_submitWithVerification] strategy '${strategy}' threw: ${e.message}`);
      }

      // Empty-text sends (image/file without caption) have no input-text
      // signal; delivery is verified downstream by the response wait.
      if (!normText) {
        log.info(`[_submitWithVerification] empty-text submit via '${strategy}' (attempt ${attempt + 1}) — no input signal to verify`);
        return { confirmed: true, strategy, weak: true };
      }

      // Verify the submit: poll ~10s for a transition vs the baseline.
      const verifyDeadline = Date.now() + 10_000;
      let verifyIterations = 0;
      let lastVerifyState = null;
      while (Date.now() < verifyDeadline) {
        verifyIterations++;
        const current = await readInput();
        if (current.includes(normText)) inputHeldPrefix = true;
        const inputCleared = inputHeldPrefix && !current.includes(normText);
        const state = await readState();
        lastVerifyState = state;

        // TRACE: log generating state during verification (every 5 iterations to avoid noise)
        if (verifyIterations % 5 === 0 || state?.generating) {
          console.log(`[TRACE][VERIFY_POLL] time=${Date.now()} attempt=${attempt + 1} strategy=${strategy} iteration=${verifyIterations} generating=${state?.generating} inputCleared=${inputCleared} assistants=${state?.assistants} baselineAssistants=${baseline.assistants} stopBtnInfo=${JSON.stringify(state?.stopBtnInfo || null)}`);
        }

        // v2.6.6-fix: require that we actually OBSERVED the typed prefix in the
        // input before accepting a DOM transition as proof of submit. Otherwise a
        // stale previous message sitting in the box can generate a 'generating'
        // or 'send disabled' transition while the new text was never inserted.
        const hadText = !normText || inputHeldPrefix;
        if (inputCleared
          || (hadText && state && state.assistants > baseline.assistants)
          || (hadText && state && !baseline.generating && state.generating)
          || (hadText && state && !baseline.sendDisabled && state.sendDisabled)) {
          const confirmTime = Date.now();
          // TRACE: log confirmation with details
          console.log(`[TRACE][ATTEMPT_${attempt + 1}_CONFIRMED] time=${confirmTime} strategy=${strategy} elapsed=${confirmTime - attemptStartTime}ms totalElapsed=${confirmTime - submitStartTime}ms reason=${inputCleared ? 'inputCleared' : state.assistants > baseline.assistants ? 'assistantsGrew' : !baseline.generating && state.generating ? 'generatingStarted' : 'sendDisabled'} iterations=${verifyIterations}`);
          log.info(`[_submitWithVerification] submit confirmed via '${strategy}' (attempt ${attempt + 1})`);
          return { confirmed: true, strategy };
        }
        await page.waitForTimeout(300);
      }
      const attemptEndTime = Date.now();
      // TRACE: log attempt failure with structured reason
      const failReason = lastVerifyState?.generating ? 'generating_stuck' :
        !inputHeldPrefix ? 'input_not_filled' :
        'verification_timeout';
      console.log(`[TRACE][ATTEMPT_${attempt + 1}_FAILED] time=${attemptEndTime} strategy=${strategy} elapsed=${attemptEndTime - attemptStartTime}ms totalElapsed=${attemptEndTime - submitStartTime}ms reason=${failReason} iterations=${verifyIterations} finalGenerating=${lastVerifyState?.generating} finalStopBtn=${JSON.stringify(lastVerifyState?.stopBtnInfo || null)}`);
      log.warn(`[_submitWithVerification] attempt ${attempt + 1} ('${strategy}') NOT confirmed — no submit transition observed`);
      try {
        const failState = await readState();
        log.warn(`[_submitWithVerification] attempt ${attempt + 1} post-fail state: ${JSON.stringify(failState)} baseline=${JSON.stringify(baseline)} inputHeldPrefix=${inputHeldPrefix}`);
      } catch (e) { /* best-effort */ }
    }

    // v11.2-fix: Recovery pass. The dominant cause of all-3-attempts-failing is
    // Kimi still transitioning from the previous turn (generating flag stuck,
    // stop button present, editor re-rendering) when Luna re-sends a tool result
    // ~2s after the previous turn ended. Instead of throwing SEND_NOT_CONFIRMED
    // immediately, wait for generation to settle, re-fill, and retry once.
    try {
      const recoveryStartTime = Date.now();
      let recoveryState = await readState();
      // TRACE: log recovery start with full state
      console.log(`[TRACE][RECOVERY_STARTED] time=${recoveryStartTime} totalElapsed=${recoveryStartTime - submitStartTime}ms generating=${recoveryState?.generating} stopBtnInfo=${JSON.stringify(recoveryState?.stopBtnInfo || null)} reason=${recoveryState?.generating ? 'generating_stuck_after_3_attempts' : 'all_attempts_failed'}`);

      if (recoveryState && recoveryState.generating) {
        // TRACE: log that we're waiting for generating to clear
        console.log(`[TRACE][RECOVERY_WAIT_GENERATING] time=${Date.now()} waitingUpTo=30000ms stopBtnDetails=${JSON.stringify(recoveryState.stopBtnInfo || null)}`);
        log.info('[_submitWithVerification] recovery: Kimi still generating — waiting up to 30s for the turn to settle');
        const stopDeadline = Date.now() + 30_000;
        let generatingWaitIterations = 0;
        while (Date.now() < stopDeadline) {
          generatingWaitIterations++;
          recoveryState = await readState();
          // TRACE: log generating state during recovery wait (every 3 iterations)
          if (generatingWaitIterations % 3 === 0 || !recoveryState?.generating) {
            console.log(`[TRACE][RECOVERY_GENERATING_POLL] time=${Date.now()} iteration=${generatingWaitIterations} generating=${recoveryState?.generating} elapsed=${Date.now() - recoveryStartTime}ms stopBtnInfo=${JSON.stringify(recoveryState?.stopBtnInfo || null)}`);
          }
          if (recoveryState && !recoveryState.generating) break;
          await page.waitForTimeout(1000);
        }
        const generatingClearedTime = Date.now();
        // TRACE: log how long we waited for generating to clear
        console.log(`[TRACE][RECOVERY_GENERATING_CLEARED] time=${generatingClearedTime} waited=${generatingClearedTime - recoveryStartTime}ms iterations=${generatingWaitIterations} cleared=${!recoveryState?.generating}`);
        await page.waitForTimeout(1000);
      }
      await this._fillContentEditable(inputLocator, text || '');
      await page.waitForTimeout(500);
      const recoveryInput = await readInput();
      inputHeldPrefix = normText ? recoveryInput.includes(normText) : true;
      await inputLocator.click({ timeout: 8000 }).catch(() => inputLocator.evaluate((el) => el.focus()));
      await page.waitForTimeout(500);
      await page.keyboard.press('Enter');
      // TRACE: log recovery verify 1 start
      const recoveryVerify1Start = Date.now();
      console.log(`[TRACE][RECOVERY_VERIFY_1_START] time=${recoveryVerify1Start} totalElapsed=${recoveryVerify1Start - submitStartTime}ms`);
      let verifyDeadline = Date.now() + 12_000;
      let recoveryVerify1Iterations = 0;
      while (Date.now() < verifyDeadline) {
        recoveryVerify1Iterations++;
        const current = await readInput();
        if (current.includes(normText)) inputHeldPrefix = true;
        const inputCleared = inputHeldPrefix && !current.includes(normText);
        const state = await readState();
        if (inputCleared
          || (state && state.assistants > baseline.assistants)
          || (state && !baseline.generating && state.generating)
          || (state && !baseline.sendDisabled && state.sendDisabled)) {
          const confirmTime = Date.now();
          // TRACE: log recovery verify 1 confirmation
          console.log(`[TRACE][RECOVERY_VERIFY_1_CONFIRMED] time=${confirmTime} elapsed=${confirmTime - recoveryVerify1Start}ms totalElapsed=${confirmTime - submitStartTime}ms iterations=${recoveryVerify1Iterations}`);
          log.info('[_submitWithVerification] recovery pass (wait-then-retry) confirmed the submit');
          return { confirmed: true, strategy: 'recovery-wait-then-retry' };
        }
        await page.waitForTimeout(300);
      }
      // TRACE: log recovery verify 1 failure
      console.log(`[TRACE][RECOVERY_VERIFY_1_FAILED] time=${Date.now()} elapsed=${Date.now() - recoveryVerify1Start}ms iterations=${recoveryVerify1Iterations}`);

      const { locator: recoverySendBtn } = await firstMatchingLocator(page, submitSendChain);
      if (await recoverySendBtn.count() > 0) {
        await recoverySendBtn.click({ timeout: 8000 }).catch((e) => log.warn(`[_submitWithVerification] recovery send-button click failed: ${e.message}`));
        // TRACE: log recovery verify 2 start
        const recoveryVerify2Start = Date.now();
        console.log(`[TRACE][RECOVERY_VERIFY_2_START] time=${recoveryVerify2Start} totalElapsed=${recoveryVerify2Start - submitStartTime}ms`);
        verifyDeadline = Date.now() + 12_000;
        let recoveryVerify2Iterations = 0;
        while (Date.now() < verifyDeadline) {
          recoveryVerify2Iterations++;
          const current = await readInput();
          if (current.includes(normText)) inputHeldPrefix = true;
          const inputCleared = inputHeldPrefix && !current.includes(normText);
          const state = await readState();
          if (inputCleared
            || (state && state.assistants > baseline.assistants)
            || (state && !baseline.generating && state.generating)
            || (state && !baseline.sendDisabled && state.sendDisabled)) {
            const confirmTime = Date.now();
            // TRACE: log recovery verify 2 confirmation
            console.log(`[TRACE][RECOVERY_VERIFY_2_CONFIRMED] time=${confirmTime} elapsed=${confirmTime - recoveryVerify2Start}ms totalElapsed=${confirmTime - submitStartTime}ms iterations=${recoveryVerify2Iterations}`);
            log.info('[_submitWithVerification] recovery send-button click confirmed the submit');
            return { confirmed: true, strategy: 'recovery-send-click' };
          }
          await page.waitForTimeout(300);
        }
        // TRACE: log recovery verify 2 failure
        console.log(`[TRACE][RECOVERY_VERIFY_2_FAILED] time=${Date.now()} elapsed=${Date.now() - recoveryVerify2Start}ms iterations=${recoveryVerify2Iterations}`);
      }
      const recoveryEndTime = Date.now();
      const postRecovery = await readState();
      // TRACE: log recovery exhaustion
      console.log(`[TRACE][RECOVERY_EXHAUSTED] time=${recoveryEndTime} totalElapsed=${recoveryEndTime - submitStartTime}ms finalGenerating=${postRecovery?.generating} finalStopBtn=${JSON.stringify(postRecovery?.stopBtnInfo || null)}`);
      log.warn(`[_submitWithVerification] recovery pass exhausted — state=${JSON.stringify(postRecovery)}`);
    } catch (e) {
      // TRACE: log recovery failure
      console.log(`[TRACE][RECOVERY_FAILED] time=${Date.now()} totalElapsed=${Date.now() - submitStartTime}ms error=${e.message}`);
      log.warn(`[_submitWithVerification] recovery pass failed: ${e.message}`);
    }

    throw new Error(`SEND_NOT_CONFIRMED: texto permanece no input do ${providerDisplayName(submitCfg)} — a mensagem digitada não foi enviada após 3 tentativas (Enter sintético, Enter confiável, clique no botão de enviar)`);
  }

  async sendMessage(userId, text, options = {}, provider = 'kimi') {
    if (!text || !text.trim()) {
      throw new Error('Message text is required');
    }

    // Rate limiting
    this._checkCooldown(userId);

    const resolvedProvider = this._resolveProvider(userId, provider);
    const providerDomain = this._providerDomain(resolvedProvider);
    const page = await this._getOrCreateUserPage(userId, resolvedProvider);

    // Reset stream interceptor state to prevent cross-message contamination
    await page.evaluate(() => {
      if (window.__lunaResetStream) {
        window.__lunaResetStream();
      } else if (window.__lunaStream) {
        // Fallback for pages created before the update
        // v3.7-fix: Must reset to empty ARRAYS, not strings, or .push() breaks
        window.__lunaStream.reasoning = [];
        window.__lunaStream.content = [];
        window.__lunaStream.events = [];
        window.__lunaStream.active = false;
        window.__lunaStream.error = null;
      }
    });
    const session = this.userSessions.get(userId);
    session.provider = resolvedProvider;

    // Cooldown check: wait for current processing to finish
    if (session.processing) {
      log.warn(`User ${hashUserId(userId)} is already processing — queueing`);
      // v8.4: NO TIMEOUT — wait forever for previous message to finish.
      while (session.processing) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    session.processing = true;
    session.lastActivity = Date.now();

    // v7.6-fix: Reset network interceptor to prevent stale data from previous messages
    const interceptor = await this._getOrCreateInterceptor(userId);
    if (interceptor) interceptor.reset();

    try {
      // Verify session
      await this._verifySession(page);

      // Handle newChat option
      if (options.newChat) {
        const pageContext = page.context();
        const pagesBefore = new Set(pageContext.pages());
        const openedUrl = await this._openNewChat(page, resolvedProvider);

        // v10.36-fix: Kimi sometimes opens the new chat in a new tab.
        const pagesAfter = pageContext.pages();
        for (const p of pagesAfter) {
          if (!pagesBefore.has(p) && !p.isClosed()) {
            let url = '';
            try { url = p.url(); } catch (e) { url = ''; }
            log.info(`[sendMessage] detected new tab: ${url}`);
            if (url.includes('/chat/') || url.includes('kimi.ai')) {
              try { if (!page.isClosed()) await page.close(); } catch (e) {}
              session.page = p;
              p._lunaUserId = userId;
              p._lunaProvider = resolvedProvider;
              page = p;
              break;
            }
          }
        }

        session.chatUrl = page.url();
        this._saveChatUrl(userId, session.chatUrl, { provider: resolvedProvider });

        // v10.36-fix: Close leftover landing-page tabs so the user does not see
        // a deslogada page after the new chat opens in a new tab.
        await this._closeStaleProviderTabs(pageContext, page, resolvedProvider);
      }

      // v3.4: Verify we're on the correct chat URL. If newChat was used or
      // the page was redirected, ensure we navigate to the right conversation.
      const currentUrl = page.url();
      if (session.chatUrl && !currentUrl.includes(session.chatUrl.split('?')[0].split('/').pop())) {
        log.info(`URL mismatch: current=${currentUrl}, expected=${session.chatUrl} — navigating to correct chat`);
        await page.goto(session.chatUrl, { waitUntil: 'domcontentloaded', timeout: 0 });
        await page.waitForTimeout(1500);
      }

      // Set mode if specified (clicks the dropdown for instant/thinking)
      if (options.mode) {
        await this.setMode(userId, options.mode, resolvedProvider);
      }

      // Detect actual mode from UI for correct timeout
      const actualMode = await this._detectActualMode(page, resolvedProvider) || session.mode || 'instant';
      log.info(`User ${hashUserId(userId)} sending message (len=${text.length}, mode=${actualMode}, url=${page.url()})`);

      // Provider-configured input chain (PDS Fase 0). The hardcoded
      // 'textarea, [contenteditable]' pair stays as the final fallback, so
      // Kimi behaves exactly as before.
      const inputProviderCfg = this._loadProviderConfig(resolvedProvider);
      const inputChain = resolveChain(inputProviderCfg, 'input', 'textarea, [contenteditable="true"]');
      const { locator: inputLocator } = await firstMatchingLocator(page, inputChain);
      const inputCount = await inputLocator.count();
      if (inputCount === 0) {
        throw new Error(`Input field not found on ${providerDisplayName(inputProviderCfg)}`);
      }

      // Bring page to front (Chrome may throttle inactive tabs)
      await page.bringToFront();

      // Capture current text BEFORE sending — critical to detect new response.
      // If captured after Enter, fast responses will be mistaken for old text.
      // v10.18-fix: Use a finite timeout. On Kimi's landing page there is no
      // .markdown-container yet; timeout: 0 hangs forever waiting for one.
      // v10.8-fix: use provider selector chains for the new Kimi DOM.
      let initialText = '';
      if (resolvedProvider === 'kimi') {
        const chains = this._resolveDomSelectorChains(resolvedProvider);
        initialText = await page.evaluate((selectors) => {
          function allMatches(root, sels) {
            const seen = new Set();
            const out = [];
            for (const sel of sels) {
              for (const el of root.querySelectorAll(sel)) {
                if (!seen.has(el)) { seen.add(el); out.push(el); }
              }
            }
            return out;
          }
          const mds = allMatches(document, selectors.markdown);
          const last = mds[mds.length - 1];
          return last ? (last.innerText || '').trim() : '';
        }, chains).catch(() => '');
      } else {
        initialText = await page.locator('.markdown-container .markdown').last().innerText({ timeout: 2000 }).catch(() => '');
      }

      // v10.35-fix: Use Lexical-safe fill helper for Kimi contenteditable editor.
      await this._fillContentEditable(inputLocator, text);
      await page.waitForTimeout(500 + Math.floor(Math.random() * 1000));

      // v7.7-INFALÍVEL: Capture full snapshot before sending
      const preSendSnapshot = await this._capturePreSendSnapshot(page, resolvedProvider);
      const preSendAssistantCount = preSendSnapshot.length;

      // W7-T4: Press Enter to send with verify-and-retry (typed text must
      // never sit unsent in the Kimi input).
      await this._submitWithVerification(page, inputLocator, text, { provider: resolvedProvider });
      log.info(`Message sent for user ${hashUserId(userId)} (initialText=${initialText.length} chars, snapshot=${preSendAssistantCount} assistants)`);

      // v7.6-fix: Assistant detection for logging/compatibility
      // v10.27-fix: Skip Kimi-specific .segment-assistant detection for non-Kimi providers.
      let targetAssistantIndex = -1;
      if (resolvedProvider === 'kimi') {
        let newAssistantWaitCount = 0;
        // Poll at 2Hz instead of 10Hz to stop hammering Chrome with
        // page.evaluate during the assistant-detection window (~10s max).
        const assistChains = this._resolveDomSelectorChains(resolvedProvider);
        while (targetAssistantIndex < 0 && newAssistantWaitCount < 20) { // 20 * 500ms = 10s
          const assistants = await page.evaluate((selectors) => {
            function allMatches(root, sels) {
              const seen = new Set();
              const out = [];
              for (const sel of sels) {
                for (const el of root.querySelectorAll(sel)) {
                  if (!seen.has(el)) { seen.add(el); out.push(el); }
                }
              }
              return out;
            }
            function firstMatch(root, sels) {
              for (const sel of sels) {
                const el = root.querySelector(sel);
                if (el) return el;
              }
              return null;
            }
            const nodes = allMatches(document, selectors.assistant);
            return nodes.map((el, i) => ({
              index: i,
              textLength: el.innerText?.length || 0,
              hasMarkdown: !!firstMatch(el, selectors.markdown),
            }));
          }, assistChains);
          const currentCount = assistants.length;
          if (currentCount > preSendAssistantCount) {
            const newAssistant = assistants[preSendAssistantCount];
            if (newAssistant && (newAssistant.textLength > 0 || newAssistant.hasMarkdown)) {
              targetAssistantIndex = preSendAssistantCount;
              log.info(`[sendMessage] New assistant detected at index ${targetAssistantIndex}, textLen=${newAssistant.textLength}`);
            }
          }
          await new Promise(r => setTimeout(r, 500));
          newAssistantWaitCount++;
        }
      } else {
        log.info(`[sendMessage] Skipping Kimi assistant detection for provider=${resolvedProvider}`);
      }

      // Wait for response with combined signal + streaming
      const lastText = await this._waitForResponse(page, actualMode, options.onPartialResponse || null, initialText, targetAssistantIndex, resolvedProvider);

      // v7.7-INFALÍVEL: Extract using snapshot diff (PRIMARY)
      let response = '';
      try {
        const extracted = await this._extractResponseDiff(page, preSendSnapshot, resolvedProvider);
        if (extracted && extracted.trim().length > 0) {
          response = extracted.trim();
          log.info(`[sendMessage] _extractResponseDiff success: ${response.length} chars`);
        }
      } catch (e) {
        log.warn(`[sendMessage] _extractResponseDiff failed: ${e.message}`);
      }

      // Fallback: old extraction strategy
      if (!response) {
        const extractOptions = targetAssistantIndex >= 0
          ? { preferAssistantIndex: targetAssistantIndex, userId }
          : { userId };
        response = await this._extractResponse(page, extractOptions);
      }

      // CRITICAL: _extractResponse can return incomplete text. Fallback to polled text.
      if (lastText && lastText.length > 0) {
        const ratio = response.length > 0 ? response.length / lastText.length : 0;
        if (ratio < 0.5 && lastText.length > response.length) {
          log.warn(`sendMessage: extraction incomplete (${response.length} vs polled ${lastText.length}), using polled text as fallback`);
          response = lastText;
        }
      }

      // Update chat URL
      session.chatUrl = page.url();
      this._saveChatUrl(userId, session.chatUrl);

      log.success(`Response ready for user ${hashUserId(userId)} (len=${response.length})`);

      // v10.41-fix: Surface context-limit flag so the Telegram pipeline can
      // decide whether to start a fresh chat. Prevents throwing away context
      // on every turn when newChat is false by default.
      const isContextLimit = this._isContextLimitResponse(response);
      if (isContextLimit) {
        log.warn(`[sendMessage] Context limit detected for user ${hashUserId(userId)}`);
      }

      return {
        response,
        chatUrl: session.chatUrl,
        mode: session.mode,
        contextLimit: isContextLimit,
      };
    } catch (err) {
      // Try to clear input on error so next message doesn't have leftover text.
      // W7-T4: _fillContentEditable(locator, '') clears the Lexical EditorState
      // for real — fill('') leaves the desynced text in the box.
      try {
        await this._fillContentEditable(page.locator('textarea, [contenteditable="true"]').first(), '');
      } catch {}
      throw err;
    } finally {
      session.processing = false;
      session.lastActivity = Date.now();
    }
  }

  /**
   * Send a message to the provider Web UI without waiting for the full response.
   * Use this for checkpoint messages where we only need delivery confirmation.
   * Returns once the submit is verified (input cleared / assistant segment /
   * generating signal) — W7-T4: up to 3 submit attempts (~10s verification
   * each) plus a 30s belt-and-suspenders delivery poll.
   * @throws SEND_NOT_CONFIRMED if all 3 submit attempts fail; 'Delivery
   *   confirmation timed out' if the post-submit poll sees no transition.
   */
  async sendMessageNoWait(userId, text, options = {}) {
    if (!text || !text.trim()) {
      throw new Error('Message text is required');
    }

    const page = await this._getOrCreateUserPage(userId);
    const session = this.userSessions.get(userId);
    if (!session) {
      throw new Error(`No session for user ${hashUserId(userId)}`);
    }

    const resolvedProvider = session.provider || page._lunaProvider || this.defaultProvider || 'kimi';

    this._checkCooldown(userId);

    if (session.processing) {
      log.warn(`User ${hashUserId(userId)} is already processing — queueing no-wait message`);
      while (session.processing) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    session.processing = true;

    try {
      session.lastActivity = Date.now();
      await this._verifySession(page);

      if (options.mode) {
        await this.setMode(userId, options.mode);
      }

      const inputLocator = page.locator('textarea, [contenteditable="true"]').first();
      const inputCount = await inputLocator.count();
      if (inputCount === 0) {
        throw new Error('Input field not found on provider page');
      }

      await page.bringToFront();
      await inputLocator.evaluate((el) => el.focus());
      await page.waitForTimeout(200);

      // v10.38-fix: Use Lexical-safe fill helper so the editor state updates
      // and the send button enables correctly on Kimi's contenteditable input.
      await this._fillContentEditable(inputLocator, text);
      await page.waitForTimeout(500);

      // W7-T4: verify-and-retry submit (Enter → trusted Enter → send-button
      // click). The 30s delivery poll below is belt-and-suspenders and
      // confirms immediately once the submit transition is visible.
      const noWaitChains = this._resolveDomSelectorChains(resolvedProvider);
      const preSubmitAssistants = await page.evaluate((selectors) => {
        function allMatches(root, sels) {
          const seen = new Set();
          const out = [];
          for (const sel of sels) {
            for (const el of root.querySelectorAll(sel)) {
              if (!seen.has(el)) { seen.add(el); out.push(el); }
            }
          }
          return out;
        }
        return allMatches(document, selectors.assistant).length;
      }, noWaitChains).catch(() => 0);
      await this._submitWithVerification(page, inputLocator, text);
      log.info(`[sendMessageNoWait] Submitted message for user ${hashUserId(userId)}`);

      // Delivery poll: input cleared, a new assistant segment, or the stop
      // (generating) button — the same transitions the submit helper accepts,
      // so a confirmed send can never time out here just because the input
      // visually retained the text.
      let confirmed = false;
      const deliveryDeadline = Date.now() + 30000;
      while (Date.now() < deliveryDeadline) {
        let inputCleared = false;
        try {
          const currentValue = await inputLocator.inputValue().catch(async () => {
            return await inputLocator.evaluate((el) => el.innerText || el.textContent || '');
          });
          inputCleared = !currentValue || !currentValue.includes(text.slice(0, 100));
        } catch (e) {
          // ignore transient read errors
        }
        const state = await page.evaluate(({ selectors, base }) => {
          function allMatches(root, sels) {
            const seen = new Set();
            const out = [];
            for (const sel of sels) {
              for (const el of root.querySelectorAll(sel)) {
                if (!seen.has(el)) { seen.add(el); out.push(el); }
              }
            }
            return out;
          }
          function firstMatch(root, sels) {
            for (const sel of sels) {
              const el = root.querySelector(sel);
              if (el) return el;
            }
            return null;
          }
          return {
            assistantsGrew: allMatches(document, selectors.assistant).length > base,
            generating: !!firstMatch(document, selectors.stopButton),
          };
        }, { selectors: noWaitChains, base: preSubmitAssistants }).catch(() => null);
        if (inputCleared || (state && (state.assistantsGrew || state.generating))) {
          confirmed = true;
          log.info(`[sendMessageNoWait] Delivery confirmed for user ${hashUserId(userId)}`);
          break;
        }
        await page.waitForTimeout(300);
      }

      if (!confirmed) {
        throw new Error('Delivery confirmation timed out');
      }

      session.chatUrl = page.url();
      this._saveChatUrl(userId, session.chatUrl);

      return { sent: true, chatUrl: session.chatUrl, mode: session.mode };
    } catch (err) {
      // W7-T4: Lexical-safe clear (fill('') leaves desynced text in the box).
      try {
        await this._fillContentEditable(page.locator('textarea, [contenteditable="true"]').first(), '');
      } catch {}
      throw err;
    } finally {
      session.processing = false;
      session.lastActivity = Date.now();
    }
  }

  /**
   * Get status for a user's session
   */
  async getStatus(userId) {
    const session = this.userSessions.get(userId);
    if (!session) {
      return { active: false, message: 'No active session for this user' };
    }

    const page = session.page;
    if (!page || page.isClosed()) {
      return { active: false, message: 'Page was closed' };
    }

    const pageStatus = await page.evaluate(() => ({
      url: window.location.href,
      title: document.title,
      loggedIn: !document.body.innerText.includes('Log In'),
      hasResponse: !!document.querySelector('.markdown-container .paragraph'),
      mode: document.querySelector('.chat-editor-action .model-name')?.innerText?.trim() || null,
    })).catch(() => ({ error: 'Page evaluation failed' }));

    return {
      active: true,
      userId: hashUserId(userId),
      chatUrl: session.chatUrl,
      mode: session.mode,
      lastActivity: new Date(session.lastActivity).toISOString(),
      processing: session.processing,
      pageStatus,
    };
  }

  /**
   * Get global bridge status (all users)
   */
  async getGlobalStatus() {
    await this._ensureConnected();
    const users = [];
    for (const [userId, session] of this.userSessions) {
      users.push({
        userId: hashUserId(userId),
        chatUrl: session.chatUrl,
        mode: session.mode,
        lastActivity: new Date(session.lastActivity).toISOString(),
        processing: session.processing,
        pageClosed: !session.page || session.page.isClosed(),
      });
    }
    return {
      connected: !!this.browser,
      cdpUrl: this.cdpUrl,
      maxPages: this.maxPages,
      activePages: this.userSessions.size,
      semaphore: { current: this.semaphore.current, max: this.semaphore.max },
      users,
    };
  }

  /**
   * v11.0: Discover a CDP endpoint for the user's real Chrome.
   * Chrome 144+ can expose one via chrome://inspect/#remote-debugging
   * (writes DevToolsActivePort). Older Chrome needs --remote-debugging-port.
   */
  _discoverUserChromeCdp() {
    const fs = require('fs');
    const path = require('path');
    const http = require('http');

    // 1) Chrome 144+ DevToolsActivePort file
    if (fs.existsSync(USER_CHROME_DEVTOOLS_PORT_FILE)) {
      try {
        const lines = fs.readFileSync(USER_CHROME_DEVTOOLS_PORT_FILE, 'utf8').split(/\r?\n/).filter(Boolean);
        if (lines.length >= 2) {
          const port = parseInt(lines[0], 10);
          const wsPath = lines[1];
          if (port > 0 && wsPath) {
            return { port, wsPath, source: 'DevToolsActivePort' };
          }
        }
      } catch (e) { /* ignore */ }
    }

    // 2) Fallback: check if user's Chrome was launched with --remote-debugging-port
    try {
      const { execSync } = require('child_process');
      const ps = execSync("ps aux | grep -E '/opt/google/chrome/chrome|/usr/bin/google-chrome' | grep -v grep", { encoding: 'utf8' });
      const m = ps.match(/--remote-debugging-port=(\d+)/);
      if (m) {
        const port = parseInt(m[1], 10);
        return { port, wsPath: null, source: 'process' };
      }
    } catch (e) { /* ignore */ }

    return null;
  }

  /**
   * v11.0: Modify the user's Chrome .desktop launcher to always include
   * --remote-debugging-port, then gracefully restart Chrome so Luna can attach
   * to the user's real profile and reuse real login sessions.
   */
  async _enableUserChromeRemoteDebugging() {
    const fs = require('fs');
    const path = require('path');
    const { execSync, spawn } = require('child_process');
    const os = require('os');

    const flag = '--remote-debugging-port=9222';

    // Patch the first writable .desktop file we find
    let patchedFile = null;
    for (const desktopPath of USER_CHROME_DESKTOP_FILES) {
      if (!fs.existsSync(desktopPath)) continue;
      try {
        let content = fs.readFileSync(desktopPath, 'utf8');
        if (content.includes(flag)) { patchedFile = desktopPath; break; }
        // Add flag right after the chrome binary in Exec= lines
        const original = content;
        content = content.replace(
          /(Exec=\S*google-chrome(?:-stable)?\b)(\s+%U)?/g,
          `$1 ${flag}$2`
        );
        content = content.replace(
          /(Exec=\S*chrome(?:-stable)?\b)(\s+--app-id|\s+--incognito|\s+%U)?/g,
          `$1 ${flag}$2`
        );
        if (content !== original) {
          fs.writeFileSync(desktopPath, content, 'utf8');
          patchedFile = desktopPath;
          log.info(`Patched Chrome launcher for CDP: ${desktopPath}`);
          break;
        }
      } catch (e) {
        log.warn(`Could not patch ${desktopPath}: ${e.message}`);
      }
    }

    // Find the Chrome binary
    let chromePath = null;
    for (const cmd of USER_CHROME_CMD_CANDIDATES) {
      if (cmd.startsWith('/')) {
        if (fs.existsSync(cmd)) { chromePath = cmd; break; }
      } else {
        try { chromePath = execSync(`which ${cmd}`, { stdio: 'ignore', encoding: 'utf8' }).trim(); break; } catch {}
      }
    }
    if (!chromePath) {
      log.warn('Could not find Chrome binary to restart with CDP');
      return false;
    }

    // Gracefully close user's Chrome processes (except any already-debuggable one)
    const isUserChrome = (cmdline) => {
      return cmdline.includes('/opt/google/chrome/chrome') || cmdline.includes('/usr/bin/google-chrome');
    };

    try {
      const ps = execSync('ps aux', { encoding: 'utf8' });
      const pids = ps.split('\n')
        .filter(line => isUserChrome(line) && !line.includes('remote-debugging-port'))
        .map(line => parseInt(line.trim().split(/\s+/)[1], 10))
        .filter(n => n && !isNaN(n));

      if (pids.length === 0) {
        // Nothing to restart; launch a fresh user-Chrome with CDP
        try {
          const proc = spawn(chromePath, [flag, '--restore-last-session'], { detached: true, stdio: 'ignore', env: process.env });
          proc.unref();
          await new Promise(r => setTimeout(r, 3000));
          return true;
        } catch (e) {
          log.warn(`Failed to launch user Chrome with CDP: ${e.message}`);
          return false;
        }
      }

      log.info(`Requesting graceful shutdown of ${pids.length} user Chrome process(es) to enable CDP...`);
      for (const pid of pids) {
        try { process.kill(pid, 'SIGTERM'); } catch {}
      }

      // Wait up to 12s for processes to exit
      for (let i = 0; i < 24; i++) {
        await new Promise(r => setTimeout(r, 500));
        try {
          const still = execSync('ps aux', { encoding: 'utf8' })
            .split('\n')
            .filter(line => isUserChrome(line) && !line.includes('remote-debugging-port'));
          if (still.length === 0) break;
        } catch {}
      }

      // Last resort: SIGKILL anything still running
      try {
        const still = execSync('ps aux', { encoding: 'utf8' })
          .split('\n')
          .filter(line => isUserChrome(line) && !line.includes('remote-debugging-port'))
          .map(line => parseInt(line.trim().split(/\s+/)[1], 10))
          .filter(n => n && !isNaN(n));
        for (const pid of still) {
          try { process.kill(pid, 'SIGKILL'); } catch {}
        }
      } catch {}

      await new Promise(r => setTimeout(r, 1000));

      // Restart user's Chrome with CDP and session restore
      const proc = spawn(chromePath, [flag, '--restore-last-session'], { detached: true, stdio: 'ignore', env: process.env });
      proc.unref();
      log.info(`Restarted user Chrome with CDP (pid ${proc.pid})`);
      await new Promise(r => setTimeout(r, 4000));
      return true;
    } catch (e) {
      log.warn(`Error enabling user Chrome remote debugging: ${e.message}`);
      return false;
    }
  }

  /**
   * Ensure the Luna Chrome profile directory exists. We use a single isolated
   * directory for the CDP browser so the user can log in once inside it and
   * the session (cookies, localStorage, tokens) persists across restarts.
   * v11.0: Stop cloning the user's main profile — it invalidates device-bound
   * session tokens. Instead the user logs in directly inside Luna's Chrome.
   */
  _ensureChromeProfile() {
    // v11.1: Always use the kernel's own directory for the Chrome profile.
    // This guarantees the profile travels with the kernel installation and
    // survives restarts regardless of what LUNA_HOME/LUNA_DIR points to.
    const lunaProfile = path.join(__dirname, 'chrome-profile');
    if (!fs.existsSync(lunaProfile)) {
      fs.mkdirSync(lunaProfile, { recursive: true });
    }
    return lunaProfile;
  }

  /**
   * Check if Chrome/Chromium is running with CDP and start if needed.
   * v11.0: Best practice is to attach to the user's REAL Chrome profile via CDP
   * (Chrome 144+ remote-debugging toggle, or --remote-debugging-port). This
   * reuses the user's live login sessions without copying profiles. If that is
   * unavailable we fall back to the Luna-isolated profile copied from the user.
   */
  async checkChrome() {
    const { execSync, spawn } = require('child_process');
    const http = require('http');
    const os = require('os');
    const net = require('net');

    const probePort = (port) => new Promise((resolve) => {
      const req = http.get(`${makeCdpUrl(port)}/json/version`, (res) => {
        resolve(res.statusCode === 200 ? port : 0);
      });
      req.on('error', () => resolve(0));
      req.setTimeout(2000, () => { req.destroy(); resolve(0); });
    });

    const isPortOccupied = (port) => new Promise((resolve) => {
      const s = net.createServer();
      s.once('error', () => resolve(true));
      s.once('listening', () => { s.close(() => resolve(false)); });
      s.listen(port, '127.0.0.1');
    });

    // v11.0: Use Luna's isolated persistent profile. The user will log in
    // directly inside this Chrome instance once, and the session will persist
    // across Luna restarts because we always reuse the same user-data-dir.
    const profileDir = this._ensureChromeProfile();

    // Phase 1: Scan for an existing Luna Chrome with CDP on our ports
    for (const port of CDP_PORTS) {
      const ok = await probePort(port);
      if (!ok) continue;
      try {
        const psOutput = execSync(`ps aux | grep -E 'chrom(?:e|ium).*remote-debugging-port=${port}' | grep -v grep`, { encoding: 'utf8' });
        const dataDirMatch = psOutput.match(/--user-data-dir=([^\s]+)/);
        const existingProfileDir = dataDirMatch ? dataDirMatch[1] : null;

        if (psOutput.includes('--headless') || psOutput.includes('--ozone-platform=headless')) {
          log.warn(`Headless Chrome detected on port ${port}. Killing...`);
          execSync(`pkill -f 'chrom.*remote-debugging-port=${port}'`);
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        if (existingProfileDir && existingProfileDir.startsWith('/tmp/')) {
          log.warn(`Chrome on port ${port} is using a temporary profile ${existingProfileDir}. Killing...`);
          execSync(`pkill -f 'chrom.*remote-debugging-port=${port}'`);
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        this.cdpUrl = makeCdpUrl(port);
        log.info(`Reusing existing CDP Chrome on port ${port} (profile: ${existingProfileDir || 'default'})`);
        return { running: true, started: false, wasHeadless: false, port };
      } catch {
        this.cdpUrl = makeCdpUrl(port);
        return { running: true, started: false, wasHeadless: false, port };
      }
    }

    // Phase 2: Find a free CDP port
    let startPort = CDP_PORTS[0];
    for (const port of CDP_PORTS) {
      const occupied = await isPortOccupied(port);
      if (!occupied) { startPort = port; break; }
    }

    // Phase 3: Start visible Chrome/Chromium with the Luna profile (synced from user)
    const chromeCmds = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      process.env.CHROME_EXECUTABLE_PATH,
      process.env.LUNA_CHROME_PATH,
    ].filter(Boolean);
    if (process.platform === 'win32') {
      chromeCmds.push(
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
      );
    } else {
      chromeCmds.push(
        '/opt/google/chrome/google-chrome',
        '/opt/google/chrome/chrome',
        '/usr/local/bin/google-chrome-stable',
        '/usr/local/bin/google-chrome',
        '/usr/local/bin/chromium',
        '/usr/local/bin/chromium-browser',
        path.join(os.homedir(), '.local', 'bin', 'google-chrome'),
        'google-chrome-stable',
        'google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        'chromium',
        'chromium-browser'
      );
    }
    let chromePath = null;
    for (const cmd of chromeCmds) {
      try {
        if (path.isAbsolute(cmd)) {
          if (fs.existsSync(cmd) && !fs.statSync(cmd).isDirectory()) { chromePath = cmd; break; }
        } else if (process.platform === 'win32') {
          chromePath = execSync(`where ${cmd}`, { stdio: 'ignore', encoding: 'utf8' }).trim().split(/\r?\n/)[0];
          if (chromePath) break;
        } else {
          chromePath = execSync(`which ${cmd}`, { stdio: 'ignore', encoding: 'utf8' }).trim();
          if (chromePath) break;
        }
      } catch {}
    }
    if (!chromePath) {
      return { running: false, started: false, error: 'Chrome/Chromium não encontrado. Instale google-chrome-stable ou chromium.' };
    }

    try {
      log.info(`Starting ${chromePath} with Luna profile (synced from user): ${profileDir}`);

      const extensionPath = path.join(__dirname, 'luna-extension');
      const extensionArgs = [];
      if (fs.existsSync(extensionPath) && fs.existsSync(path.join(extensionPath, 'manifest.json'))) {
        extensionArgs.push('--load-extension=' + extensionPath);
      }

      const isRoot = process.getuid && process.getuid() === 0;
      const spawnEnv = process.platform === 'win32' ? process.env : { ...process.env, DISPLAY: process.env.DISPLAY || ':0' };
      const proc = spawn(chromePath, [
        `--remote-debugging-port=${startPort}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--user-data-dir=' + profileDir,
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        ...(isRoot ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
        ...extensionArgs,
        this._modeUrl(this.defaultProvider || 'kimi', 'instant'),
      ], { detached: true, stdio: 'ignore', env: spawnEnv });
      proc.unref();

      proc.on('error', (err) => log.warn(`[checkChrome] Chrome process error: ${err.message}`));
      proc.on('exit', (code, signal) => {
        if (code !== 0 && code !== null) {
          log.warn(`[checkChrome] Chrome process exited with code ${code}, signal ${signal}`);
        }
      });

      // Wait up to 30s for Chrome to open its CDP port
      let ok = false;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000));
        if (await probePort(startPort)) { ok = true; break; }
      }

      if (ok) {
        this.cdpUrl = makeCdpUrl(startPort);
        return { running: true, started: true, pid: proc.pid, profileDir, port: startPort };
      }
      return { running: false, started: true, pid: proc.pid, profileDir, port: startPort, error: 'Chrome iniciou mas não respondeu em 30s' };
    } catch (e) {
      return { running: false, started: false, error: e.message };
    }
  }

  /**
   * Check login state on a page using the provider's loginIndicator/appContent
   * selector chains (PDS Fase 0). A forced-auth URL (/sign_in, /login, /auth)
   * is decisive regardless of DOM content — DeepSeek keeps a textarea-less
   * page on chat.deepseek.com/sign_in when logged out.
   */
  async _checkLoginState(page, provider = 'kimi') {
    try {
      const loginCfg = this._loadProviderConfig(provider);
      const loginChain = resolveChain(loginCfg, 'loginIndicator', 'a[href*="login"], a[href*="signin"]');
      const appChain = resolveChain(loginCfg, 'appContent', 'textarea[placeholder], [contenteditable="true"]');
      return await page.evaluate(({ loginChain, appChain }) => {
        const url = location.href;
        if (/\/(sign[_-]?in|login|auth)(\/|$|\?|#)/i.test(url)) {
          return { loggedIn: false, loginRequired: true, url };
        }
        const firstMatch = (sels) => {
          for (const s of sels) { try { if (document.querySelector(s)) return true; } catch (e) {} }
          return false;
        };
        const hasLoginBtn = firstMatch(loginChain) || !!document.querySelector('input[type="password"]');
        const hasChatInput = firstMatch(appChain) || !!document.querySelector('div[role="textbox"]');
        const bodyText = document.body?.innerText?.toLowerCase() || '';
        const hasLoginText = bodyText.includes('log in') || bodyText.includes('sign in') || bodyText.includes('登录') || bodyText.includes('entrar');
        // Consider logged in if we see chat input AND no login text/button
        const loggedIn = hasChatInput && !hasLoginText && !hasLoginBtn;
        return { loggedIn, hasLoginBtn, hasChatInput, hasLoginText, url };
      }, { loginChain, appChain });
    } catch (e) {
      return { loggedIn: false, error: e.message };
    }
  }

  /**
   * Ensure user is logged into the configured provider. Opens page and brings to front.
   * If not logged in, navigates to provider base URL and starts polling.
   */
  async ensureLogin(userId, providerArg = null) {
    const provider = this._resolveProvider(userId, providerArg);
    const providerCfg = this._loadProviderConfig(provider);
    const loginUrl = providerCfg.baseUrl;

    let page;
    try {
      page = await this._getOrCreateUserPage(userId, provider);
      await page.bringToFront().catch(() => {});
    } catch (e) {
      return { loggedIn: false, error: `Failed to get page: ${e.message}`, action: 'login_required' };
    }

    // Check current state
    const state = await this._checkLoginState(page, provider);
    if (state.loggedIn) {
      return { loggedIn: true, message: `Já está logado em ${providerCfg.displayName}`, url: state.url, provider };
    }

    // Not logged in — navigate to provider base URL and bring to front
    log.info(`User not logged in, navigating to ${provider} login page`);
    try {
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 0 });
      await page.waitForTimeout(1500);
      await page.bringToFront().catch(() => {});
    } catch (e) {
      log.warn(`Navigation to ${loginUrl} failed: ${e.message}`);
      // Try again with a fresh page
      try {
        const session = this.userSessions.get(userId);
        if (session && session.page && !session.page.isClosed()) {
          await session.page.close().catch(() => {});
          this.userSessions.delete(userId);
          this.semaphore.current = Math.max(0, this.semaphore.current - 1);
        }
        page = await this._getOrCreateUserPage(userId, provider);
        await page.bringToFront().catch(() => {});
      } catch (e2) {
        return { loggedIn: false, error: `Failed to navigate: ${e2.message}`, action: 'login_required' };
      }
    }

    // Quick re-check after navigation
    const state2 = await this._checkLoginState(page, provider);
    if (state2.loggedIn) {
      return { loggedIn: true, message: `Já está logado em ${providerCfg.displayName}`, url: state2.url, provider };
    }

    return {
      loggedIn: false,
      message: `Naveguei para ${loginUrl}. Por favor, faça login manualmente no navegador que abriu.`,
      action: 'login_required',
      url: state2.url,
      provider,
    };
  }

  /**
   * Poll the page until login is detected or timeout.
   * @returns {Promise<{loggedIn: boolean, message: string}>}
   */
  async waitForLogin(userId, maxWaitMs = 60000, intervalMs = 2500) {
    const session = this.userSessions.get(userId);
    if (!session || !session.page || session.page.isClosed()) {
      return { loggedIn: false, message: 'Página não encontrada. Use /login primeiro.' };
    }
    const page = session.page;
    const start = Date.now();
    let lastState = null;

    while (Date.now() - start < maxWaitMs) {
      const state = await this._checkLoginState(page, this._resolveProvider(userId));
      lastState = state;
      if (state.loggedIn) {
        // Update stored chat URL
        try {
          const url = await page.evaluate(() => location.href);
          session.chatUrl = url;
          this._saveChatUrl(userId, url, { mode: session.mode });
        } catch {}
        // v10.37-auto-save: save session cookies on login detection
        if (!session.sessionSaved) {
          try {
            const providerName = this._resolveProvider(userId);
            await this._saveSessionFromContext(page, providerName);
            session.sessionSaved = true;
            log.info(`[AutoSave] Session saved for ${providerName} after login detection`);
          } catch (e) {
            log.warn(`[AutoSave] Failed to save session: ${e.message}`);
          }
        }
        return { loggedIn: true, message: 'Login detectado! Pronto para usar.', url: state.url };
      }
      await new Promise(r => setTimeout(r, intervalMs));
    }

    return {
      loggedIn: false,
      message: 'Tempo esgotado aguardando login. Faça login manualmente no Chrome.',
      lastState,
      action: 'login_timeout',
    };
  }

  /**
   * Logout user: close page, clear session, optionally kill Chrome.
   */
  async logout(userId, opts = {}) {
    const session = this.userSessions.get(userId);
    if (session) {
      if (session.page && !session.page.isClosed()) {
        try { await session.page.close(); } catch {}
      }
      this.userSessions.delete(userId);
      this.semaphore.current = Math.max(0, this.semaphore.current - 1);
    }

    if (opts.killChrome) {
      try {
        const { execSync } = require('child_process');
        // Kill Chrome on ALL possible CDP ports
        for (const port of CDP_PORTS) {
          try { execSync(`pkill -f 'chrome.*remote-debugging-port=${port}'`); } catch {}
        }
        this._resetCdpUrl();
        log.info('Chrome killed');
        return { success: true, message: 'Logout completo. Chrome fechado.' };
      } catch (e) {
        return { success: true, message: 'Sessão encerrada. Chrome já estava fechado.' };
      }
    }

    return { success: true, message: 'Logout completo. Sessão encerrada.' };
  }

  /**
   * Check if there's already a visible Chrome running on any CDP port.
   * Returns details including which port is in use.
   */
  async getChromeStatus() {
    const { execSync } = require('child_process');
    for (const port of CDP_PORTS) {
      try {
        const psOutput = execSync(`ps aux | grep 'chrome.*remote-debugging-port=${port}' | grep -v grep`, { encoding: 'utf8' });
        const isHeadless = psOutput.includes('--headless') || psOutput.includes('--ozone-platform=headless');
        const profileMatch = psOutput.match(/--user-data-dir=([^\s]+)/);
        const pidMatch = psOutput.match(/^\S+\s+(\d+)/);
        return {
          running: true,
          isHeadless: !!isHeadless,
          profileDir: profileMatch ? profileMatch[1] : null,
          pid: pidMatch ? parseInt(pidMatch[1]) : null,
          port,
        };
      } catch {
        // No Chrome on this port, try next
      }
    }
    return { running: false };
  }

  /**
   * Screenshot a user's page
   */
  async screenshot(userId, ssPath = null) {
    const page = await this._getOrCreateUserPage(userId);
    const filePath = ssPath || path.join(ARTIFACTS_DIR, `kimi-screenshot-${hashUserId(userId)}-${Date.now()}.png`);

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    await page.screenshot({ path: filePath, fullPage: true });
    log.info(`Screenshot saved: ${filePath}`);
    return filePath;
  }

  /**
   * Save cookies from default context to persistent JSON file
   */
  async _saveCookiesToFile() {
    if (!this.defaultContext) return;
    try {
      const cookies = await this.defaultContext.cookies();
      if (cookies && cookies.length > 0) {
        fs.writeFileSync(COOKIES_BACKUP_PATH, JSON.stringify(cookies, null, 2), 'utf8');
        log.info(`[Cookies] Saved ${cookies.length} cookies to backup file`);
      }
    } catch (e) {
      log.warn(`[Cookies] Failed to save: ${e.message}`);
    }
  }

  /**
   * v10.36-fix: Sync master cookies JSON from the current Chrome profile.
   * This forces the bridge to use the cookies already saved by Chrome instead
   * of stale file backups that can log the user out.
   */
  async _syncMasterCookiesFromContext(providerName = 'kimi') {
    if (!this.defaultContext) return false;
    try {
      const providerCfg = loadProviderConfig(providerName);
      const cookiePaths = getProviderCookies(providerCfg);
      const masterPath = cookiePaths.master;
      const cookies = await this.defaultContext.cookies();
      if (!cookies || cookies.length === 0) {
        log.info(`[_syncMasterCookiesFromContext] No cookies in Chrome profile yet for ${providerName}`);
        return false;
      }
      // Build master file in the expected format
      const providerDomain = providerCfg.domain || '.' + this._providerDomain(providerName).replace(/^www\./, '');
      const providerCookies = cookies.filter(c => c.domain.includes(providerDomain.replace(/^\./, '')) || c.domain.endsWith(providerDomain));
      const masterData = {
        savedAt: new Date().toISOString(),
        totalCookies: cookies.length,
        kimiCookies: providerCookies.length,
        cookies,
      };
      fs.mkdirSync(path.dirname(masterPath), { recursive: true });
      fs.writeFileSync(masterPath, JSON.stringify(masterData, null, 2), 'utf8');
      log.info(`[_syncMasterCookiesFromContext] Synced ${cookies.length} cookies (${providerCookies.length} for ${providerName}) from Chrome profile to ${masterPath}`);
      return true;
    } catch (e) {
      log.warn(`[_syncMasterCookiesFromContext] Failed to sync: ${e.message}`);
      return false;
    }
  }

  /**
   * Load cookies from persistent JSON file into a context
   */
  async _loadCookiesFromFile(targetCtx) {
    const sources = [
      { path: COOKIES_BACKUP_PATH, name: 'auto-backup' },
      { path: COOKIES_MANUAL_PATH, name: 'manual' },
    ];
    for (const src of sources) {
      try {
        if (!fs.existsSync(src.path)) continue;
        const raw = fs.readFileSync(src.path, 'utf8');
        const cookies = JSON.parse(raw);
        if (Array.isArray(cookies) && cookies.length > 0) {
          await targetCtx.addCookies(cookies);
          log.info(`[Cookies] Restored ${cookies.length} cookies from ${src.name}`);
          return true;
        }
      } catch (e) {
        log.warn(`[Cookies] Failed to load from ${src.name}: ${e.message}`);
      }
    }
    return false;
  }

  /**
   * Start periodic cookie backup timer
   */
  _startCookieBackup() {
    if (this.cookieBackupTimer) clearInterval(this.cookieBackupTimer);
    this.cookieBackupTimer = setInterval(() => {
      this._saveCookiesToFile().catch(() => {});
    }, 5 * 60 * 1000); // every 5 minutes
    // Also save immediately on start
    this._saveCookiesToFile().catch(() => {});
  }

  /**
   * v5.6-fix: Background polling to keep pages alive and detect new messages.
   * Prevents Chrome mobile from suspending the tab when user switches apps.
   * Polls every 30s: brings page to front and evaluates a no-op to keep alive.
   */
  _startBackgroundPolling() {
    if (this.bgPollTimer) clearInterval(this.bgPollTimer);
    this.bgPollTimer = setInterval(async () => {
      for (const [userId, session] of this.userSessions) {
        if (!session.page || session.page.isClosed()) continue;
        try {
          // v9.5-fix: REMOVED bringToFront() — it was causing command bursts when user
          // returned to the Kimi tab. Chrome already runs with anti-throttling flags:
          // --disable-background-timer-throttling --disable-backgrounding-occluded-windows
          // --disable-renderer-backgrounding. The evaluate no-op is enough to keep alive.
          await session.page.evaluate(() => {
            window.__lunaKeepAlive = Date.now();
            // Small real DOM work that Chrome cannot optimize away
            const el = document.createElement('span');
            el.style.display = 'none';
            el.id = '__luna-keepalive-' + Date.now();
            document.body.appendChild(el);
            setTimeout(() => el.remove(), 100);
          }).catch(() => {});
        } catch (e) {
          // Ignore errors — page may be navigating
        }
      }
    }, 10000); // Every 10 seconds
    log.info('Background polling started (10s interval, no bringToFront)');
  }

  /**
   * Mark a userId as persistent (never close its page due to idle timeout)
   */
  setPersistent(userId) {
    this.persistentUserIds.add(userId);
    log.info(`Persistent mode enabled for user ${hashUserId(userId)}`);
  }

  /**
   * Unmark a userId as persistent
   */
  unsetPersistent(userId) {
    this.persistentUserIds.delete(userId);
    log.info(`Persistent mode disabled for user ${hashUserId(userId)}`);
  }

  /**
   * Start idle cleanup timer — closes inactive pages (skips persistent users)
   */
  _startIdleCleanup() {
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = setInterval(() => {
      const now = Date.now();
      for (const [userId, session] of this.userSessions) {
        if (session.processing) continue;
        // v5.2-fix: Never clean up persistent users
        if (this.persistentUserIds.has(userId)) {
          continue;
        }
        if (KIMI_PERSISTENT_MODE) {
          // In global persistent mode, only clean up if explicitly not persistent
          // and idle for > 30min (double the normal timeout)
          if (now - session.lastActivity > this.idleTimeout * 3) {
            log.info(`Persistent mode: long-idle cleanup for user ${hashUserId(userId)}`);
          } else {
            continue;
          }
        }
        if (now - session.lastActivity > this.idleTimeout) {
          log.info(`Idle cleanup: closing page for user ${hashUserId(userId)}`);
          try {
            if (session.page && !session.page.isClosed()) {
              session.page.removeAllListeners('crash');
              session.page.close().catch(e => log.warn(`Idle close error: ${e.message}`));
            }
          } catch (e) {
            log.warn(`Idle cleanup error for ${hashUserId(userId)}: ${e.message}`);
          }
          this.userSessions.delete(userId);
          this.semaphore.release();
          // v8.7-fix: NEVER close defaultContext — it's shared across all users.
          // Only isolated contexts should be closed. defaultContext is managed externally.
          const ctx = this.userContexts.get(userId);
          if (ctx && ctx !== this.defaultContext && typeof ctx.close === 'function') {
            ctx.close().catch(e => log.warn(`Idle context close error: ${e.message}`));
            this.userContexts.delete(userId);
            log.info(`Idle cleanup: closed isolated context for user ${hashUserId(userId)}`);
          } else if (ctx === this.defaultContext) {
            this.userContexts.delete(userId);
          }
        }
      }
    }, 60000); // Check every minute
  }

  // ============================================================
  // STREAMING + STEER (v2.2)
  // ============================================================

  /**
   * Inject a stream interceptor script into the page to capture raw API responses.
   * This is the MOST reliable way to separate thinking from response because
   * the Kimi API returns them as separate fields (reasoning_content vs content).
   */
  async _injectStreamInterceptor(page) {
    try {
      const scriptPath = path.join(__dirname, 'kimi-bridge-interceptor-toolcalls.js');
      let script = fs.readFileSync(scriptPath, 'utf8');
      // Remove outer IIFE wrapper so it executes directly in page context
      script = script.replace(/^\s*\(\s*\)\s*=>\s*\{/, '').trim();
      if (script.endsWith('};')) {
        script = script.slice(0, -2).trim();
      } else if (script.endsWith('}')) {
        script = script.slice(0, -1).trim();
      }
      await page.addInitScript(script);
    } catch (e) {
      log.warn(`Stream interceptor injection failed: ${e.message}`);
    }
  }

  /**
   * v3.7-fix: Inject stream interceptor via page.evaluate after navigation.
   * addInitScript only works for future page loads; this ensures the current
   * page has the interceptor active immediately. Also re-injects on page reuse.
   */
  async _injectStreamInterceptorEvaluate(page) {
    try {
      const alreadyActive = await page.evaluate(() => !!window.__lunaStream);
      if (alreadyActive) return true;

      const scriptPath = path.join(__dirname, 'kimi-bridge-interceptor-toolcalls.js');
      let script = fs.readFileSync(scriptPath, 'utf8');
      script = script.replace(/^\s*\(\s*\)\s*=>\s*\{/, '').trim();
      if (script.endsWith('};')) {
        script = script.slice(0, -2).trim();
      } else if (script.endsWith('}')) {
        script = script.slice(0, -1).trim();
      }
      await page.evaluate(script => eval(script), script);
      log.info('Stream interceptor re-injected via evaluate');
      return true;
    } catch (e) {
      log.warn(`Stream interceptor evaluate injection failed: ${e.message}`);
      return false;
    }
  }

  /**
   * v3.3: Inject DOM MutationObserver to detect tool call containers in real-time.
   * Adds sequence numbers and timestamps to toolcall nodes for ordered execution.
   */
  async _injectDomObserver(page) {
    try {
      await page.addInitScript(() => {
        if (window.__lunaDomObserver) return; // Already injected

        window.__lunaToolCallSeq = 0;
        window.__lunaDomObserver = true;
        window.__lunaLastToolCallAt = 0;

        const chatContainerSelectors = [
          '.chat-container',
          '.message-list',
          '.chat-message-list',
          '[class*="chat"][class*="container"]',
          '[class*="message"][class*="list"]',
        ];

        function findChatContainer() {
          for (const sel of chatContainerSelectors) {
            const el = document.querySelector(sel);
            if (el) return el;
          }
          return document.body;
        }

        function processToolCallNode(node) {
          if (!node || node.__lunaProcessed) return;
          const isToolCall = node.classList && (
            node.classList.contains('toolcall-container') ||
            node.classList.contains('toolcall-ipython') ||
            node.classList.contains('toolcall-web_search') ||
            node.classList.contains('toolcall-browser') ||
            node.classList.contains('toolcall-computer')
          );
          if (!isToolCall) return;

          window.__lunaToolCallSeq++;
          node.__lunaProcessed = true;
          node.setAttribute('data-luna-seq', String(window.__lunaToolCallSeq));
          node.setAttribute('data-luna-detected-at', String(Date.now()));
          window.__lunaLastToolCallAt = Date.now();
        }

        const chatContainer = findChatContainer();
        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                processToolCallNode(node);
                // Also check children (if a parent was added containing tool calls)
                if (node.querySelectorAll) {
                  node.querySelectorAll('.toolcall-container, .toolcall-ipython, .toolcall-web_search, .toolcall-browser, .toolcall-computer')
                    .forEach(processToolCallNode);
                }
              }
            }
          }
        });

        observer.observe(chatContainer, { childList: true, subtree: true });

        // Process any existing tool calls
        chatContainer.querySelectorAll('.toolcall-container, .toolcall-ipython, .toolcall-web_search, .toolcall-browser, .toolcall-computer')
          .forEach(processToolCallNode);
      });
    } catch (e) {
      log.warn(`DOM observer injection failed: ${e.message}`);
    }
  }

  /**
   * v3.3-fix: Inject DOM observer via page.evaluate after navigation.
   * addInitScript only affects future page loads; this ensures the current
   * page has the observer active immediately.
   */
  async _injectDomObserverEvaluate(page) {
    try {
      await page.evaluate(() => {
        if (window.__lunaSimpleObserver) return true; // Already active

        window.__lunaToolCallSeq = 0;
        window.__lunaSimpleObserver = true;
        window.__lunaLastToolCallAt = 0;

        const chatContainerSelectors = [
          '.chat-container', '.message-list', '.chat-message-list',
          '[class*="chat"][class*="container"]', '[class*="message"][class*="list"]',
        ];

        function findChatContainer() {
          for (const sel of chatContainerSelectors) {
            const el = document.querySelector(sel);
            if (el) return el;
          }
          return document.body;
        }

        function processToolCallNode(node) {
          if (!node || node.__lunaProcessed) return;
          const isToolCall = node.classList && (
            node.classList.contains('toolcall-container') ||
            node.classList.contains('toolcall-ipython') ||
            node.classList.contains('toolcall-web_search') ||
            node.classList.contains('toolcall-browser') ||
            node.classList.contains('toolcall-computer')
          );
          if (!isToolCall) return;
          window.__lunaToolCallSeq++;
          node.__lunaProcessed = true;
          node.setAttribute('data-luna-seq', String(window.__lunaToolCallSeq));
          node.setAttribute('data-luna-detected-at', String(Date.now()));
          window.__lunaLastToolCallAt = Date.now();
        }

        const chatContainer = findChatContainer();
        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                processToolCallNode(node);
                if (node.querySelectorAll) {
                  node.querySelectorAll('.toolcall-container, .toolcall-ipython, .toolcall-web_search, .toolcall-browser, .toolcall-computer')
                    .forEach(processToolCallNode);
                }
              }
            }
          }
        });
        observer.observe(chatContainer, { childList: true, subtree: true });

        // Process existing tool calls
        chatContainer.querySelectorAll('.toolcall-container, .toolcall-ipython, .toolcall-web_search, .toolcall-browser, .toolcall-computer')
          .forEach(processToolCallNode);

        return true;
      });
    } catch (e) {
      log.warn(`DOM observer evaluate injection failed: ${e.message}`);
    }
  }

  /**
   * v7.0: Inject the MutationObserver-based event queue into the browser.
   * This observer runs independently of the stream and populates window.__lunaEventQueue.
   */
  async _injectEventQueueObserver(page) {
    try {
      // v11.6-fix: Detect the Luna Chrome extension by its MAIN-world observer.
      // The extension uses window.__lunaDomObserver + window.__lunaObserverVersion;
      // __lunaEventQueue is the legacy Playwright fallback and must NOT be required.
      const hasExtension = await page.evaluate(() => {
        return !!(window.__lunaDomObserver && window.__lunaObserverVersion);
      });
      if (hasExtension) {
        const extVersion = await page.evaluate(() => window.__lunaObserverVersion);
        log.info(`[v7.0] Chrome extension observer active (v${extVersion})`);
        // Make sure no legacy fallback observer is competing with the extension.
        await page.evaluate(() => {
          try {
            if (window.__lunaUltraLightObserver && window.__lunaUltraLightObserver.docObserver) {
              window.__lunaUltraLightObserver.docObserver.disconnect();
              window.__lunaUltraLightObserver = undefined;
            }
            if (window.__lunaEventQueue) window.__lunaEventQueue = undefined;
          } catch (e) {}
        }).catch(() => {});
        return true;
      }

      // Fallback: inject manually (for users without the extension)
      const observerPath = path.join(__dirname, 'kimi-dom-observer.js');
      const observerScript = fs.readFileSync(observerPath, 'utf8');
      await page.addInitScript(observerScript);
      await page.evaluate(observerScript);
      log.info('[v7.0] Event queue observer injected (fallback — consider installing the Chrome extension for 100% reliability)');
      return true;
    } catch (e) {
      log.warn(`[v7.0] Event queue observer injection failed: ${e.message}. Install the Luna Extension for reliable DOM observation.`);
      return false;
    }
  }

  // ============================================================
  // v7.0: DECOUPLED DOM EVENT QUEUE — DOM reader independent from stream
  // ============================================================

  /**
   * v7.5: Initialize or retrieve the KimiNetworkInterceptor for a user.
   * The interceptor uses Playwright's native page.on('response') to capture
   * API responses server-side. This is immune to page anti-tampering.
   */
  async _getOrCreateInterceptor(userId) {
    const session = this.userSessions.get(userId);
    if (!session || !session.page || session.page.isClosed()) return null;

    let interceptor = this.networkInterceptors.get(userId);
    if (!interceptor || interceptor.page !== session.page) {
      // Page changed or interceptor doesn't exist — create new one
      if (interceptor) interceptor.stop();
      interceptor = new ProviderNetworkInterceptor(session.page, this._loadProviderConfig(this.userSessions.get(userId)?.provider || 'kimi'));
      await interceptor.start();
      this.networkInterceptors.set(userId, interceptor);
      log.info(`[KimiNetworkInterceptor] Created for user ${hashUserId(userId)}`);
    }
    return interceptor;
  }

  /**
   * v7.5: Reset the interceptor before sending a new message.
   * Clears accumulated reasoning/content so the next message starts fresh.
   */
  _resetInterceptor(userId) {
    const interceptor = this.networkInterceptors.get(userId);
    if (interceptor) {
      interceptor.reset();
      log.info(`[KimiNetworkInterceptor] Reset for user ${hashUserId(userId)}`);
    }
  }

  /**
   * v8.6: Consume events from Chrome Extension's global buffer.
   * The extension runs in the MAIN world of kimi.ai and streams DOM events
   * directly via HTTP to luna-extension-handler.cjs, which buffers them in
   * global.__lunaExtensionEventBuffers. This is Layer 0 — highest priority.
   *
   * Wave2-fix (cross-user event theft): events are filtered by tab URL so a
   * poller only consumes events from ITS OWN page. The extension sessionId
   * has no relation to the luna userId, so draining every buffer let one
   * user's poller steal another user's streamed text/tool events.
   */
  _consumeExtensionEvents(expectedUrl) {

    try {
      const buffers = global.__lunaExtensionEventBuffers;
      if (!buffers || buffers.size === 0) {

        return [];
      }

      // Same chat thread, tolerant of tracking params and www differences.
      const normalizeUrl = (u) => {
        if (!u || typeof u !== 'string') return '';
        try {
          const url = new URL(u);
          // ignore www. vs bare domain
          url.hostname = url.hostname.replace(/^www\./, '');
          // keep origin + pathname only
          let pathname = url.pathname;
          if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
          return `${url.protocol}//${url.hostname}${pathname}`;
        } catch (e) {
          return u.split('#')[0].split('?')[0].replace(/\/+$/, '');
        }
      };
      const expected = normalizeUrl(expectedUrl);
      const multiBuffer = buffers.size > 1;
      let loggedNoUrl = false;


      for (const [sid, buf] of buffers) {
        if (!buf || buf.length === 0) continue;
        const first = buf[0];

      }

      const allEvents = [];
      for (const [sessionId, buf] of buffers) {
        if (!buf || buf.length === 0) continue;
        // Partition: matching events are consumed, the rest STAY in the
        // buffer for the poller that owns their tab.
        const remaining = [];
        for (const raw of buf) {
          const rawUrl = raw.tabUrl || raw.url || '';
          let belongs;
          if (!rawUrl) {
            // No URL info (older extension build): only safe to consume when
            // exactly one buffer exists (single-user dev scenario preserved).
            belongs = !multiBuffer;
            if (!loggedNoUrl) {

              loggedNoUrl = true;
            }
          } else {
            belongs = expected !== '' && normalizeUrl(rawUrl) === expected;
          }
          if (!belongs) {
            remaining.push(raw);
            continue;
          }

          // Translate extension event format to bridge internal format
          switch (raw.eventType) {
            case 'thinking_start': {
              allEvents.push({
                type: 'thinking_start',
                source: 'chrome_extension',
                timestamp: raw.timestamp || raw.bufferedAt || Date.now(),
              });
              break;
            }
            case 'stream_state': {
              if (raw.data) {
                allEvents.push({
                  type: 'state_change',
                  thinking: raw.data.thinking || '',
                  response: raw.data.response || '',
                  isStreaming: raw.data.isStreaming ?? true,
                  isComplete: raw.data.isComplete ?? false,
                  timestamp: raw.timestamp || raw.bufferedAt || Date.now(),
                });
              }
              break;
            }
            case 'thinking_update': {
              if (raw.data && raw.data.fullThinking) {
                allEvents.push({
                  type: 'thinking_update',
                  fullText: raw.data.fullThinking,
                  source: 'chrome_extension',
                  channel: raw.data.channel || 'THINKING',
                  timestamp: raw.timestamp || raw.bufferedAt || Date.now(),
                });
              }
              break;
            }
            case 'stream_end': {
              allEvents.push({
                type: 'completion_candidate',
                reason: 'stream_end',
                // v13.0 (F1.3): labeled consensus signal ('button' | 'inactivity')
                signal: (raw.data && raw.data.signal) || 'unknown',
                timestamp: raw.timestamp || raw.bufferedAt || Date.now(),
              });
              break;
            }
            case 'observer_ready': {
              // Log observer_ready event
              log.info(`[LunaExt] Observer ready: url=${raw.data?.url} version=${raw.data?.version}`);
              break;
            }
            case 'luna_build_sentinel': {
              // Log build sentinel event
              log.info(`[LUNA_BUILD_SENTINEL] ${raw.data?.sentinel} extensionUrl=${raw.data?.extensionUrl} version=${raw.data?.version}`);
              break;
            }
            case 'tool_call_detected': {
              if (raw.data && raw.data.tool) {
                // v13.0 (F1.5'): a JSON block auto-closed by miniJsonRepair is
                // syntactically valid but semantically INCOMPLETE (truncated
                // script/content). Never forward it for execution.
                if (raw.data.rescued === true) {
                  log.debug(`[ChromeExt] tool_call_detected dropped — rescued JSON (repaired mid-stream), waiting for the final complete block`);
                  break;
                }
                // v14.0: Check if this is from the new delimited protocol
                if (raw.data.protocol === 'delimited') {
                  log.info(`[TOOL_PROTOCOL][DETECTED] tool=${raw.data.tool} toolId=${raw.data.toolId} source=delimited`);
                  allEvents.push({
                    type: 'action_detected',
                    action: { tool: raw.data.tool, params: raw.data.params || {} },
                    source: 'delimited_protocol',
                    toolId: raw.data.toolId,
                    timestamp: raw.timestamp || raw.bufferedAt || Date.now(),
                  });
                } else {
                  allEvents.push({
                    type: 'action_detected',
                    action: { tool: raw.data.tool, params: raw.data.params || {} },
                    source: 'chrome_extension',
                    timestamp: raw.timestamp || raw.bufferedAt || Date.now(),
                  });
                }
              }
              break;
            }
            case 'tool_protocol_start': {
              // v14.0: New delimited protocol - tool call start detected
              log.info(`[TOOL_PROTOCOL][START] toolId=${raw.data?.toolId} timestamp=${raw.timestamp}`);
              break;
            }
            case 'tool_protocol_end': {
              // v14.0: New delimited protocol - tool call end detected
              log.info(`[TOOL_PROTOCOL][END] toolId=${raw.data?.toolId} timestamp=${raw.timestamp}`);
              break;
            }
            case 'luna_tool_call_complete': {
              // v2.0: Delimited protocol - tool call complete
              if (raw.data && raw.data.toolCall) {
                log.info(`[PROTOCOL][TOOL_COMPLETE] tool=${raw.data.toolCall.name} toolId=${raw.data.toolId} source=delimited channel=${raw.data.channel || 'OUTPUT'}`);
                allEvents.push({
                  type: 'action_detected',
                  action: { tool: raw.data.toolCall.name, params: raw.data.toolCall.arguments || {} },
                  source: 'delimited_protocol',
                  toolId: raw.data.toolId,
                  channel: raw.data.channel || 'OUTPUT',
                  timestamp: raw.timestamp || raw.bufferedAt || Date.now(),
                });
                // FASE B: Activate V2 authority for tools
                v2AuthorityActive = true;
                v2AuthorityType = 'tool';
                log.info(`[V2_AUTHORITY][ACTIVE] time=${Date.now()} type=tool tool=${raw.data.toolCall.name}`);
              }
              break;
            }
            case 'luna_response_complete': {
              // v2.0: Delimited protocol - response complete
              if (raw.data && raw.data.response !== undefined) {
                log.info(`[PROTOCOL][RESPONSE_COMPLETE] length=${raw.data.response.length} source=delimited channel=${raw.data.channel || 'OUTPUT'}`);
                allEvents.push({
                  type: 'response_detected',
                  response: typeof raw.data.response === 'string' ? raw.data.response : JSON.stringify(raw.data.response),
                  source: 'delimited_protocol',
                  channel: raw.data.channel || 'OUTPUT',
                  timestamp: raw.timestamp || raw.bufferedAt || Date.now(),
                });
                // FASE B: Activate V2 authority for responses
                v2AuthorityActive = true;
                v2AuthorityType = 'response';
                log.info(`[V2_AUTHORITY][ACTIVE] time=${Date.now()} type=response`);
              }
              break;
            }
            case 'luna_unknown_output': {
              // v2.0: Delimited protocol - unknown output (turn ended without protocol)
              if (raw.data) {
                log.warn(`[PROTOCOL][UNKNOWN_OUTPUT] reason=${raw.data.reason} textLength=${raw.data.text?.length || 0}`);
                allEvents.push({
                  type: 'unknown_output',
                  text: raw.data.text || '',
                  reason: raw.data.reason || 'unknown',
                  timestamp: raw.timestamp || raw.bufferedAt || Date.now(),
                });
              }
              break;
            }
            case 'tool_response_detected': {
              if (raw.data && raw.data.response !== undefined) {
                allEvents.push({
                  type: 'response_detected',
                  response: typeof raw.data.response === 'string' ? raw.data.response : JSON.stringify(raw.data.response),
                  source: 'chrome_extension',
                  timestamp: raw.timestamp || raw.bufferedAt || Date.now(),
                });
              }
              break;
            }
            case 'segment_complete': {
              // v8.7-fix: segment_complete is an internal instrumentation event.
              // It must NEVER be translated into a state_change with response text,
              // or it will leak into the chat as raw text. Log internally only.
              if (raw.data) {
                log.debug(`[ChromeExt] segment_complete: ${raw.data.textLength || 0} chars, ${raw.data.toolCallsCount || 0} tools, complete=${raw.data.isComplete}`);
              }
              break;
            }
            case 'json_block_added': {
              if (raw.data && raw.data.actions) {
                for (const action of raw.data.actions) {
                  // v13.0 (F1.5'): same rescued guard as tool_call_detected.
                  if (action.rescued === true) {
                    log.debug(`[ChromeExt] json_block_added action dropped — rescued JSON (repaired mid-stream)`);
                    continue;
                  }
                  allEvents.push({
                    type: 'action_detected',
                    action: { tool: action.tool, params: action.params || {} },
                    source: 'chrome_extension',
                    timestamp: raw.timestamp || raw.bufferedAt || Date.now(),
                  });
                }
              }
              if (raw.data && raw.data.responses) {
                for (const resp of raw.data.responses) {
                  allEvents.push({
                    type: 'response_detected',
                    response: typeof resp.response === 'string' ? resp.response : JSON.stringify(resp.response),
                    source: 'chrome_extension',
                    timestamp: raw.timestamp || raw.bufferedAt || Date.now(),
                  });
                }
              }
              break;
            }
            case 'button_state': {
              // Used indirectly — if stop button is not visible and we were streaming,
              // it signals completion. We handle this via stream_end though.
              break;
            }
            default: {
              // Unknown event type — ignore
              break;
            }
          }
        }
        if (remaining.length > 0) buffers.set(sessionId, remaining);
        else buffers.delete(sessionId); // fully drained — drop the empty buffer
      }
      return allEvents;
    } catch (e) {
      return [];
    }
  }

  /**
   * v7.0: Start a persistent DOM poller that runs independently of the stream.
   * This is the core of the decoupled architecture: the DOM is read continuously,
   * and the stream only consumes events from the queue.
   */
  _startDomPoller(userId) {
    const session = this.userSessions.get(userId);
    if (!session || !session.page || session.page.isClosed()) return;
    if (session.domPollerActive) return; // Already running

    session.domPollerActive = true;
    session.domPollerStartTime = Date.now();
    log.info(`[DomPoller] Starting for user ${hashUserId(userId)}`);

    const runLoop = async () => {
      while (session.domPollerActive && session.page && !session.page.isClosed()) {
        try {
          const provider = session.provider || 'kimi';
          // v8.6: LAYER 0 — Chrome Extension events (PRIMARY real-time source)
          // These come directly from the extension's injected.js DOM observer,
          // bypassing all Playwright overhead and network interception fallbacks.
          try {
            // Wave2-fix: pass this poller's page URL so only events from its
            // own tab are consumed (cross-user event theft fix).
            let pageUrl = '';
            try { pageUrl = session.page.url(); } catch (_) { pageUrl = ''; }

            const extEvents = this._consumeExtensionEvents(pageUrl);
            for (const ev of extEvents) {
              // v11.1-fix: DeepSeek's DOM observer emits partial tool_call events while
              // the JSON code block is still streaming. Each mutation yields a different
              // incomplete command, causing duplicate/mid-stream executions. For DeepSeek,
              // rely on generic-provider extraction only after generation is complete.
              if (provider === 'deepseek' && (
                ev.type === 'tool_call' ||
                ev.type === 'json_block_added' ||
                (ev.type === 'action_detected' && ev.source !== 'network_intercept')
              )) {
                continue;
              }
              switch (ev.type) {
                case 'thinking_start': {
                  this._enqueueDomEvent(userId, {
                    type: 'thinking_start',
                    source: 'chrome_extension',
                    timestamp: ev.timestamp || Date.now(),
                  });
                  break;
                }
                case 'state_change': {
                  this._enqueueDomEvent(userId, {
                    type: 'state_change',
                    thinking: ev.thinking || '',
                    response: ev.response || '',
                    isGenerating: ev.isStreaming ?? true,
                    canSteer: false,
                    source: 'chrome_extension',
                    timestamp: ev.timestamp || Date.now(),
                  });
                  break;
                }
                case 'thinking_update': {
                  // v11.8-fix: source-of-truth full thinking replacement from extension.
                  if (ev.fullText) {
                    this._enqueueDomEvent(userId, {
                      type: 'thinking_update',
                      fullText: ev.fullText,
                      source: 'chrome_extension',
                      timestamp: ev.timestamp || Date.now(),
                    });
                  }
                  break;
                }
                case 'thinking_delta': {
                  this._enqueueDomEvent(userId, {
                    type: 'thinking_delta',
                    text: ev.text || '',
                    fullThinking: ev.fullThinking || ev.thinking || '',
                    source: 'chrome_extension',
                    timestamp: ev.timestamp || Date.now(),
                  });
                  break;
                }
                case 'response_delta': {
                  this._enqueueDomEvent(userId, {
                    type: 'response_delta',
                    text: ev.text || '',
                    fullResponse: ev.fullResponse || ev.response || '',
                    source: 'chrome_extension',
                    timestamp: ev.timestamp || Date.now(),
                  });
                  break;
                }
                case 'action_detected': {
                  if (ev.action) {
                    this._enqueueDomEvent(userId, {
                      type: 'action_detected',
                      action: ev.action,
                      source: ev.source || 'chrome_extension',
                      timestamp: ev.timestamp || Date.now(),
                    });
                  }
                  break;
                }
                case 'response_detected': {
                  if (ev.response) {
                    this._enqueueDomEvent(userId, {
                      type: 'response_detected',
                      response: typeof ev.response === 'string' ? ev.response : JSON.stringify(ev.response),
                      source: ev.source || 'chrome_extension',
                      timestamp: ev.timestamp || Date.now(),
                    });
                  }
                  break;
                }
                case 'completion_candidate': {
                  this._enqueueDomEvent(userId, {
                    type: 'completion_candidate',
                    reason: ev.reason || 'stream_end',
                    signal: ev.signal || 'unknown', // v13.0 (F1.3): preserve consensus label
                    timestamp: ev.timestamp || Date.now(),
                  });
                  break;
                }
              }
            }
          } catch (extErr) {
            // Extension buffer may not exist yet — ignore
          }

          // v7.5: Poll DOM state via _pollThinkingAndResponse (uses Network Interceptor as primary)
          const poll = await this._pollThinkingAndResponse(session.page, userId);

          // W10-T2: Page-level context limit (modal/banner outside the bubbles).
          // Feed the SAME context_limit event path the soul already handles —
          // the stream consumer exits on it and yields context_limit upstream.
          // Stop polling this turn: _stopDomPoller in sendMessageStream's
          // finally re-arms cleanly for the next message.
          if (poll.isContextLimit) {
            log.warn(`[DomPoller] Page-level context limit detected (source=${poll.source}) — ending turn polling`);
            this._enqueueDomEvent(userId, {
              type: 'context_limit',
              response: poll.response,
              source: poll.source,
              timestamp: Date.now(),
            });
            session.domPollerActive = false;
            continue;
          }

          // v8.0-fix: Emit tool calls detected by network interceptor
          if (poll.toolCalls && poll.toolCalls.length > 0) {
            for (const tc of poll.toolCalls) {
              this._enqueueDomEvent(userId, {
                type: 'action_detected',
                action: { tool: tc.name, params: tc.params || tc.arguments || {} },
                code: tc.raw || JSON.stringify(tc),
                source: 'network_intercept',
                timestamp: Date.now(),
              });
            }
          }

          // v7.0: Only enqueue state events if not skipping non-critical
          if (!session.domPollerSkipNonCritical) {
            log.info(`[DomPoller] enqueue state_change response=${poll.response.length} isGen=${poll.isGenerating}`);
            this._enqueueDomEvent(userId, {
              type: 'state_change',
              thinking: poll.thinking,
              response: poll.response,
              isGenerating: poll.isGenerating,
              canSteer: poll.canSteer,
              source: poll.source,
              timestamp: Date.now(),
            });

            // Detect completion candidate
            this._checkCompletionCandidate(userId, poll);
          }

          // v7.0: SECONDARY — Consume events from browser-side MutationObserver
          try {
            const observerEvents = await session.page.evaluate(() => {
              if (!window.__lunaEventQueue) return [];
              return window.__lunaEventQueue.swap();
            });

            for (const ev of observerEvents) {
              // Translate observer events to internal format
              switch (ev.type) {
                case 'tool_call': {
                  if (ev.data && ev.data.tool) {
                    this._enqueueDomEvent(userId, {
                      type: 'action_detected',
                      action: { tool: ev.data.tool, params: ev.data.params || {} },
                      source: 'json_block',
                      timestamp: ev.ts || Date.now(),
                    });
                  }
                  break;
                }
                case 'tool_response': {
                  if (ev.data && ev.data.response) {
                    this._enqueueDomEvent(userId, {
                      type: 'response_detected',
                      response: typeof ev.data.response === 'string' ? ev.data.response : JSON.stringify(ev.data.response),
                      source: 'json_block',
                      timestamp: ev.ts || Date.now(),
                    });
                  }
                  break;
                }
                case 'json_block_added': {
                  if (ev.data && ev.data.actions) {
                    for (const action of ev.data.actions) {
                      this._enqueueDomEvent(userId, {
                        type: 'action_detected',
                        action: { tool: action.tool, params: action.params },
                        source: 'json_block',
                        timestamp: ev.ts || Date.now(),
                      });
                    }
                  }
                  if (ev.data && ev.data.responses) {
                    for (const resp of ev.data.responses) {
                      this._enqueueDomEvent(userId, {
                        type: 'response_detected',
                        response: typeof resp.response === 'string' ? resp.response : JSON.stringify(resp.response),
                        source: 'json_block',
                        timestamp: ev.ts || Date.now(),
                      });
                    }
                  }
                  break;
                }
                // v7.0-ext: Chrome extension emits these directly
                case 'action_detected': {
                  if (ev.action) {
                    this._enqueueDomEvent(userId, {
                      type: 'action_detected',
                      action: ev.action,
                      source: ev.source || 'json_block',
                      timestamp: ev.timestamp || Date.now(),
                    });
                  }
                  break;
                }
                case 'response_detected': {
                  if (ev.response) {
                    this._enqueueDomEvent(userId, {
                      type: 'response_detected',
                      response: typeof ev.response === 'string' ? ev.response : JSON.stringify(ev.response),
                      source: ev.source || 'json_block',
                      timestamp: ev.timestamp || Date.now(),
                    });
                  }
                  break;
                }
                // v8.5-fix: Ultra-light observer emits thinking_delta and response_delta
                case 'thinking_delta': {
                  if (ev.data && ev.data.text) {
                    this._enqueueDomEvent(userId, {
                      type: 'thinking_delta',
                      text: ev.data.text,
                      fullThinking: ev.data.fullThinking || '',
                      source: 'dom_observer',
                      timestamp: ev.ts || Date.now(),
                    });
                  }
                  break;
                }
                case 'response_delta': {
                  if (ev.data && ev.data.text) {
                    this._enqueueDomEvent(userId, {
                      type: 'response_delta',
                      text: ev.data.text,
                      fullResponse: ev.data.fullResponse || '',
                      source: 'dom_observer',
                      timestamp: ev.ts || Date.now(),
                    });
                  }
                  break;
                }
                case 'stream_end': {
                  this._enqueueDomEvent(userId, {
                    type: 'completion_candidate',
                    reason: 'stream_end',
                    signal: ev.signal || 'unknown', // v13.0 (F1.3): preserve consensus label
                    timestamp: ev.ts || Date.now(),
                  });
                  break;
                }
                case 'tool_container': {
                  if (ev.data && ev.data.preview) {
                    const preview = ev.data.preview;
                    // v10.42-fix: ignore tool_container previews that are actually the
                    // Kimi thinking block rendered inside a .toolcall-container.
                    const looksLikeThinking = /^(Think|Thinking|Pensando|Analisando|Analisar|Reasoning|Processando|Searching|Buscando)\b/i.test(preview.trim());
                    if (!looksLikeThinking) {
                      this._enqueueDomEvent(userId, {
                        type: 'action_detected',
                        action: { tool: 'executeShell', params: { command: preview } },
                        code: preview,
                        source: 'dom_mirror',
                        timestamp: ev.ts || Date.now(),
                      });
                    }
                  }
                  break;
                }
              }
            }
          } catch (e) {
            // Observer not available — fallback to direct DOM extraction
            // v11.1-fix: For DeepSeek, skip DOM tool extraction fallbacks because the
            // code blocks are still mutating while streaming and produce partial tools.
            if (provider !== 'deepseek') {
              try {
                const jsonBlocks = await this._extractJsonBlocksFromDOM(session.page, session?._turnAssistantMarker, provider);
                for (const action of jsonBlocks.actions) {
                  this._enqueueDomEvent(userId, { type: 'action_detected', action, source: 'json_block', timestamp: Date.now() });
                }
                for (const resp of jsonBlocks.responses) {
                  this._enqueueDomEvent(userId, { type: 'response_detected', response: resp.response, source: 'json_block', timestamp: Date.now() });
                }
              } catch (e2) {}
              try {
                const toolBlocks = await this._extractToolMirrorFromDOM(session.page);
                for (const block of toolBlocks) {
                  this._enqueueDomEvent(userId, { type: 'action_detected', action: this._convertIpythonToAction(block), code: block.code, kimiResult: block.result, kimiImages: block.images, source: 'dom_mirror', timestamp: Date.now() });
                }
              } catch (e2) {}
            }
          }
        } catch (e) {
          log.warn(`[DomPoller] Error for user ${hashUserId(userId)}: ${e.message}`);
        }

        // Poll interval: balance responsiveness vs Kimi page load.
        // v11.2-fix: 1500ms was too slow for the user — thinking/tools felt delayed.
        // Chrome Extension (Layer 0) is the fast path; DOM poll is the fallback.
        // 400ms keeps the fallback responsive without hammering the renderer.
        const interval = session.processing ? 400 : 3000;
        await new Promise(r => setTimeout(r, interval));
      }

      session.domPollerActive = false;
      if (session._domPollerStoppedResolve) {
        session._domPollerStoppedResolve();
        session._domPollerStoppedResolve = null;
      }
      log.info(`[DomPoller] Stopped for user ${hashUserId(userId)}`);
    };

    runLoop().catch(e => {
      log.error(`[DomPoller] Fatal error for user ${hashUserId(userId)}: ${e.message}`);
      session.domPollerActive = false;
      if (session._domPollerStoppedResolve) {
        session._domPollerStoppedResolve();
        session._domPollerStoppedResolve = null;
      }
    });
  }

  /**
   * v7.0: Stop the DOM poller for a user. Returns a Promise that resolves when stopped.
   */
  async _stopDomPoller(userId) {
    const session = this.userSessions.get(userId);
    if (!session || !session.domPollerActive) return;

    const wasActive = session.domPollerActive;
    session.domPollerActive = false;
    log.info(`[DomPoller] Stop requested for user ${hashUserId(userId)}`);

    // Wait for the poller loop to actually exit
    if (wasActive) {
      await new Promise(resolve => {
        session._domPollerStoppedResolve = resolve;
        // Safety: resolve after 2s even if poller didn't stop
        setTimeout(resolve, 2000);
      });
    }
  }

  /**
   * v7.0: Enqueue a DOM event for a user.
   */
  _enqueueDomEvent(userId, event) {
    let queue = this.domEventQueues.get(userId);
    if (!queue) {
      // v7.0-fix: Auto-create queue if poller runs before sendMessageStream
      queue = { events: [], lastReadIndex: 0, createdAt: Date.now(), queueId: `auto-${Date.now()}` };
      this.domEventQueues.set(userId, queue);
    }
    // W6-T6: cross-turn dedup for phantom-prone content events. Per-stream dedup
    // sets are recreated every loop turn, but the DOM still shows the PREVIOUS
    // turn's last assistant segment, so some detectors can re-emit its tool JSON
    // as new actions. A stable content hash (same logical event, different
    // timestamp) catches those re-emissions. Scoped to action_detected/
    // response_detected only: state_change/deltas are handled by per-source
    // cursors, and completion_candidate has no content (constant key) —
    // deduping it would break completion on every later turn.
    // Cleared on real user sends (sendMessageStream, !options.isAutoContinue).
    // Entries expire after SEEN_TTL_MS WITHOUT refresh: phantoms are re-emitted
    // seconds after the original (next turn's poll start), so they stay dropped
    // across consecutive turns, while a legitimate identical re-issue in a later
    // loop turn (e.g. re-run `npm test` after a fix — the soul's policy is
    // one replay then re-execute for real) is only suppressed inside this window.
    if (event.type === 'action_detected' || event.type === 'response_detected') {
      const session = this.userSessions.get(userId);
      if (session) {
        // v12.5-fix: TTL reduced from 10s to 2s. The bridge only needs to suppress
        // near-simultaneous double-detection (DOM poll + extension + observer firing
        // in the same tick). The soul's W6-T5 cache policy (1 replay + real re-execute)
        // is the real authority on whether a repeated action runs — the bridge must
        // not drop legitimate re-issues that arrive seconds later.
        const SEEN_TTL_MS = 2 * 1000;
        if (!session._domEventSeen) session._domEventSeen = new Map();
        const seen = session._domEventSeen;
        // W10-T1: key builder extracted to lib/tool-dedup-key.cjs. Only fields
        // every source provides go into the key — the extension never sends
        // `code` while the network interceptor does, so hashing it let the
        // same logical action slip past dedup and execute twice.
        const key = makeDomEventDedupKey(event);
        const now = Date.now();
        const seenAt = seen.get(key);
        if (seenAt !== undefined && now - seenAt < SEEN_TTL_MS) {
          console.log(`[BRIDGE] phantom drop (${event.type}): key=${key} age=${now - seenAt}ms`);
          return; // phantom re-detection — drop
        }
        if (seen.has(key)) seen.delete(key); // keep FIFO order honest on re-insert
        if (seen.size >= 500) seen.delete(seen.keys().next().value); // FIFO eviction
        seen.set(key, now);
      }
    }
    queue.events.push(event);
    // Circular buffer: trim to max 2000 events
    if (queue.events.length > 2000) {
      queue.events = queue.events.slice(-2000);
    }
  }

  /**
   * v7.0: Check for completion candidate based on DOM state.
   * Uses signal voting for robustness.
   */
  _checkCompletionCandidate(userId, poll) {
    const session = this.userSessions.get(userId);
    if (!session) return;

    const now = Date.now();
    const text = (poll.thinking || '') + (poll.response || '');

    // Initialize tracking
    if (!session._completionState) {
      session._completionState = {
        lastText: '',
        textStableSince: 0,
        lastIsGenerating: false,
        generatingStoppedAt: 0,
        signals: { buttonSend: 0, noGeneratingFlag: 0, textStable: 0, networkIdle: 0 },
      };
    }
    const cs = session._completionState;

    // Signal 1: Text stability
    if (text !== cs.lastText) {
      cs.textStableSince = 0;
      cs.signals.textStable = 0;
    } else if (cs.textStableSince === 0) {
      cs.textStableSince = now;
    }
    const textStableFor = cs.textStableSince ? now - cs.textStableSince : 0;
    if (textStableFor > 1500) cs.signals.textStable = 2;
    else if (textStableFor > 500) cs.signals.textStable = 1;

    // Signal 2: Generation stopped
    if (!poll.isGenerating && cs.lastIsGenerating) {
      cs.generatingStoppedAt = now;
    }
    const generatingStoppedFor = cs.generatingStoppedAt ? now - cs.generatingStoppedAt : 0;
    if (!poll.isGenerating) {
      cs.signals.noGeneratingFlag = generatingStoppedFor > 1000 ? 2 : 1;
    } else {
      cs.signals.noGeneratingFlag = 0;
      cs.generatingStoppedAt = 0;
    }

    // Signal 3: Button state (send visible = completion)
    cs.signals.buttonSend = poll.canSteer ? 2 : 0;

    // Signal 4: Network idle (inferred from no text changes + not generating)
    if (!poll.isGenerating && textStableFor > 3000) {
      cs.signals.networkIdle = 2;
    } else {
      cs.signals.networkIdle = 0;
    }

    cs.lastText = text;
    cs.lastIsGenerating = poll.isGenerating;

    // Vote: require sum >= 4 for completion, sustained for 800ms
    const totalSignal = cs.signals.textStable + cs.signals.noGeneratingFlag + cs.signals.buttonSend + cs.signals.networkIdle;
    if (totalSignal >= 4) {
      if (!cs.candidateSince) cs.candidateSince = now;
      else if (now - cs.candidateSince > 800) {
        // Emit completion candidate
        this._enqueueDomEvent(userId, {
          type: 'completion_candidate',
          signals: { ...cs.signals },
          signal: 'dom_vote', // v13.0 (F1.3): labeled consensus signal
          timestamp: now,
        });
        cs.candidateSince = 0; // Reset to avoid duplicate
      }
    } else {
      cs.candidateSince = 0;
    }
  }

  /**
   * v3.9-fix: Inject master localStorage data into page.
   * Kimi uses localStorage tokens (access_token, refresh_token) in addition
   * to cookies. Without these, the page appears logged-out even with cookies.
   */
  async _injectMasterLocalStorage(page, provider = 'kimi') {
    try {
      const providerCfg = this._loadProviderConfig(provider);
      const cookiePaths = getProviderCookies(providerCfg);
      const masterPath = cookiePaths.localStorage;
      if (!fs.existsSync(masterPath)) {
        log.warn(`No master localStorage file found for provider ${provider}`);
        return false;
      }
      const masterData = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
      const data = masterData.data || masterData.localStorage || masterData || {};
      const keys = Object.keys(data);
      if (keys.length === 0) {
        log.warn(`Master localStorage file is empty for provider ${provider}`);
        return false;
      }
      await page.evaluate((items) => {
        for (const [key, value] of Object.entries(items)) {
          try { localStorage.setItem(key, value); } catch (e) {}
        }
      }, data);
      log.info(`Injected ${keys.length} localStorage items into page for provider ${provider}`);
      return true;
    } catch (e) {
      log.warn(`Failed to inject master localStorage for provider ${provider}: ${e.message}`);
      return false;
    }
  }

  /**
   * Poll the DOM for current thinking and response text.
   * Uses MULTI-LAYER strategy:
   *   1. Stream interceptor (most reliable — reads raw API deltas)
   *   2. React Fiber inspection (finds component props)
   *   3. Computed-style heuristic (grey/italic = thinking)
   *   4. CSS selector fallback
   *
   * Returns { thinking, response, canSteer, isGenerating, source }
   */
  async _pollThinkingAndResponse(page, userId = null) {
    log.info('[TESTE_DEBUG_MARCADOR] _pollThinkingAndResponse called');
    // v3.6-fix: NO TIMEOUT — if page.evaluate() hangs, we wait. The user explicitly
    // requested no timeouts anywhere in the agent. Kimi may take 10+ minutes for
    // sandbox tools (python, web_search, browser). We wait patiently.
    const pollWithTimeout = async () => {
    const provider = page._lunaProvider || this.defaultProvider || 'kimi';
    try {
      // Wave 2 Fix A: hoist session lookup to the top of the try block so the
      // shared empty-extraction tail can reference it for the Kimi provider too
      // (it was previously declared only inside the generic-provider block,
      // making the empty-wait branch throw ReferenceError for provider='kimi').
      const session = userId ? this.userSessions.get(userId) : null;

      // W10-T2: Page-level context-limit scan (revived orphan scanner from
      // bridge-libs/dom-scripts/poll-dom-structure.js). Kimi can show the
      // "conversation too long" notice as a modal/banner OUTSIDE the response
      // bubbles, where _isContextLimitResponse(finalResponse) never sees it.
      // Throttled like the other poll-loop work: the full-page querySelectorAll
      // walk is expensive, so run it at most once every 5s per page (the
      // DomPoller ticks every 1.5s during processing → ~1 scan per 3-4 ticks).
      // Kimi-only: the notice text is Kimi's; other providers keep the old path.
      if (provider === 'kimi') {
        const lastLimitScanAt = page._lunaContextLimitScanAt || 0;
        if (Date.now() - lastLimitScanAt >= 5000) {
          page._lunaContextLimitScanAt = Date.now();
          let pageLimitScan = null;
          try {
            pageLimitScan = await page.evaluate(scanPageContextLimit);
          } catch (scanErr) {
            log.warn(`[_poll] page context-limit scan failed: ${scanErr.message}`);
          }
          if (pageLimitScan?.isContextLimit) {
            log.warn(`[_poll] PAGE-LEVEL context limit detected: ${(pageLimitScan.response || '').slice(0, 80)}`);
            const { canSteer, isGenerating } = await this._detectUiState(page, provider).catch(() => ({ canSteer: false, isGenerating: false }));
            return {
              thinking: '',
              response: pageLimitScan.response,
              canSteer,
              isGenerating,
              source: pageLimitScan.source,
              isContextLimit: true,
            };
          }
        }
      }

      // v7.5: Layer 1 — Native Playwright Network Interceptor (PRIMARY)
      // This replaces fragile JavaScript injection with server-side response capture.
      // Immune to page anti-tampering, SPA navigation, or React resets.
      let networkData = null;
      if (userId) {
        const interceptor = this.networkInterceptors.get(userId);
        if (interceptor) {
          networkData = interceptor.getData();
          if (networkData.hasData) {
            const { canSteer, isGenerating } = await this._detectUiState(page, provider);
            log.info(`[_poll] network-intercept: thinking=${networkData.thinking.length}, response=${networkData.response.length}, source=${networkData.source}`);
            return { ...networkData, canSteer, isGenerating };
          }
        }
      }

      // v7.5: Layer 1b — Legacy JS-injected stream interceptor (DEPRECATED, will be removed)
      // Kept briefly as transitional fallback while Network Interceptor stabilizes.
      const intercepted = await page.evaluate(() => {
        const s = window.__lunaStream;
        if (s && s.active) {
          const thinking = Array.isArray(s.reasoning) ? s.reasoning.join('') : (s.reasoning || '');
          const response = Array.isArray(s.content) ? s.content.join('') : (s.content || '');
          return {
            thinking,
            response,
            source: 'intercept-legacy',
            hasData: thinking.length > 0 || response.length > 0,
            active: s.active,
            contentLen: s.content?.length || 0,
            reasoningLen: s.reasoning?.length || 0,
          };
        }
        return null;
      });
      if (intercepted && intercepted.hasData) {
        const { canSteer, isGenerating } = await this._detectUiState(page, provider);
        log.info(`[_poll] interceptor-legacy: thinking=${intercepted.thinking.length}, response=${intercepted.response.length}`);
        return { ...intercepted, canSteer, isGenerating };
      }

      // Layer 2.5: DOM structure-based extraction (most reliable for Kimi Web v2026-05)
      // Supports TWO DOM structures:
      //   OLD: .segment-content-box > .container-block > .block-item > ...
      //   NEW: .segment-content-box > .markdown-container > .markdown > .segment-code
      // v10.0-fix: Filter out tool JSON code blocks from response text to prevent
      // tool JSON from leaking into the chat. Detected tools are returned separately
      // and enqueued as action_detected events by the caller.
      // W6-T6: when the session has a pre-send assistant marker, only scan
      // assistant segments at index >= marker — the previous turn's last segment
      // is still in the DOM and must not be re-detected. null marker => scan
      // everything, exactly as before (non-Kimi providers, no active send).
      const turnAssistantMarker = (session && typeof session._turnAssistantMarker === 'number') ? session._turnAssistantMarker : null;
      const chains = provider === 'kimi' ? this._resolveDomSelectorChains(provider) : null;
      const structureBased = await page.evaluate(({ selectors, assistantMarker }) => {
        function allMatches(root, sels) {
          const seen = new Set();
          const out = [];
          for (const sel of sels) {
            for (const el of root.querySelectorAll(sel)) {
              if (!seen.has(el)) { seen.add(el); out.push(el); }
            }
          }
          return out;
        }
        function firstMatch(root, sels) {
          for (const sel of sels) {
            const el = root.querySelector(sel);
            if (el) return el;
          }
          return null;
        }

        const assistants = allMatches(document, selectors.assistant);
        const scoped = typeof assistantMarker === 'number' ? assistants.slice(assistantMarker) : assistants;
        const lastAssistant = scoped[scoped.length - 1];
        if (!lastAssistant) return null;

        let thinking = '';
        let response = '';
        const detectedTools = [];

        function tryParseToolJson(text) {
          if (!text || text.length < 10) return null;
          if (!text.includes('"tool"') && !text.includes('"script"')) return null;
          try {
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed.tool === 'string' && parsed.params && typeof parsed.params === 'object') {
              return { tool: parsed.tool, params: parsed.params };
            }
            if (parsed && typeof parsed.tool === 'string' && (parsed.path || parsed.command || parsed.script || parsed.query)) {
              return { tool: parsed.tool, params: parsed };
            }
            // v12.5-fix: {"script": "...", "language": "bash"} is a valid tool call.
            if (parsed && typeof parsed.script === 'string' && parsed.script.trim()) {
              return { tool: 'executeScript', params: { code: parsed.script, language: parsed.language || 'bash' } };
            }
          } catch (e) {}
          return null;
        }

        // v10.8-fix: Extract {"response":"..."} wrappers rendered by Kimi inside
        // .segment-code blocks so the stream consumer gets clean text immediately.
        function tryParseResponseJson(text) {
          if (!text || text.length < 10) return null;
          const cleaned = text
            .replace(/^\s*```(?:json)?\s*/i, '')
            .replace(/\s*```\s*$/i, '')
            .replace(/^\s*JSON\s*(?:Copy|复制|複製)\s*/i, '')
            .trim();
          if (!cleaned.startsWith('{')) return null;
          try {
            const parsed = JSON.parse(cleaned);
            if (parsed && typeof parsed.response === 'string') return parsed.response;
          } catch {}
          return null;
        }

        // v10.8-fix: robust thinking extraction via selector chain.
        // v2.6.6-fix: the thinking container itself is the source of truth. Its innerText
        // already contains every reasoning paragraph; we only strip the header chrome.
        // This mirrors the Chrome extension strategy and avoids losing text when nested
        // markdown selectors fail to match all paragraphs.
        const thinkContainer = firstMatch(lastAssistant, selectors.thinking);
        if (thinkContainer) {
          const rawThinking = thinkContainer.textContent || '';
          thinking = rawThinking
            .replace(/^\s*\b(Thinking|Think|Pensando|Analisando|Analisar|Raciocínio|Raciocinando|Concluído|Concluindo|Raciocínio concluído|Reasoning|Processando|Searching|Buscando)\b\s*[.:]?\s*/i, '')
            .replace(/\s*JSON\s*Copy\s*$/i, '')
            .trim();
        }

        const thinkStarters = /^(O usuário|Vou |Agora |Preciso |Primeiro |Vamos |Então |Deixa |Hmm |Ok |Okay |Let me |I need |I'll |First |Now |So |The user |Hmm |Okay )/i;

        const contentBox = firstMatch(lastAssistant, selectors.contentBox);
        // v10.8-fix: Collect detailed diagnostics when extraction returns empty
        // so we can see exactly what the DOM looks like at that moment.
        const debugInfo = {
          assistantCount: assistants.length,
          scopedCount: scoped.length,
          hasContentBox: !!contentBox,
          lastAssistantClass: lastAssistant.className,
          lastAssistantTag: lastAssistant.tagName,
          lastAssistantTextLength: (lastAssistant.innerText || '').length,
          thinkingFound: !!thinkContainer,
        };

        // v10.8-fix: If contentBox is missing, scan the whole lastAssistant for
        // markdown/code blocks. The new Kimi frontend sometimes re-renders the
        // assistant segment without a distinct .segment-content-box wrapper.
        const scanRoot = contentBox || lastAssistant;

        // Strategy A: NEW structure — markdown containers
        const markdownContainers = allMatches(scanRoot, selectors.markdown);
        debugInfo.markdownCount = markdownContainers.length;
        debugInfo.codeBlocks = [];
        let rawResponse = '';
        const seenMarkdownTexts = new Set();
        const seenResponseTexts = new Set();
        for (const md of markdownContainers) {
          // v10.8-fix: skip markdowns that live inside the thinking container
          if (thinkContainer && md.closest) {
            const thinkingSelectors = Array.isArray(selectors.thinking) ? selectors.thinking : [selectors.thinking];
            if (thinkingSelectors.some(s => md.closest(s))) continue;
          }

          // v10.42-fix: avoid duplicate text when .markdown-container and .markdown
          // are nested and both selected.
          const mdText = (md.innerText || md.textContent || '').trim();
          if (mdText && seenMarkdownTexts.has(mdText)) continue;
          if (mdText) seenMarkdownTexts.add(mdText);

          // v10.43-fix: if a markdown container contains a JSON response wrapper,
          // ignore sibling paragraphs to avoid duplicating the same text twice
          // (Kimi renders the JSON code block and also mirrors its content as prose).
          let mdHasResponseJson = false;
          for (const cb of allMatches(md, selectors.codeBlock)) {
            const text = (cb.textContent || cb.innerText || '').trim();
            debugInfo.codeBlocks.push({ tag: cb.tagName, class: cb.className, textLen: text.length, textStart: text.slice(0, 80) });
            if (!text) continue;
            const toolAction = tryParseToolJson(text);
            if (toolAction) {
              detectedTools.push(toolAction);
              continue;
            }
            const responseText = tryParseResponseJson(text);
            if (responseText !== null) {
              if (!seenResponseTexts.has(responseText)) {
                seenResponseTexts.add(responseText);
                rawResponse += responseText + '\n\n';
              }
              mdHasResponseJson = true;
              continue;
            }
            if (!seenResponseTexts.has(text)) {
              seenResponseTexts.add(text);
              rawResponse += text + '\n\n';
            }
          }
          if (mdHasResponseJson) continue;
          for (const p of allMatches(md, selectors.paragraph)) {
            const text = (p.innerText || p.textContent || '').trim();
            if (text && !seenResponseTexts.has(text)) {
              seenResponseTexts.add(text);
              rawResponse += text + '\n\n';
            }
          }
        }
        debugInfo.rawResponsePreview = rawResponse.slice(0, 200);

        // Strategy B: OLD structure — container-block > block-item
        if (!rawResponse) {
          const containerBlock = scanRoot.querySelector('.container-block');
          const blockItems = containerBlock
            ? containerBlock.querySelectorAll('.block-item')
            : scanRoot.querySelectorAll('.block-item');
          for (const item of blockItems) {
            if (firstMatch(item, selectors.thinking)) continue;
            for (const cb of item.querySelectorAll('.segment-code, pre code, [class*="code-block"]')) {
              const text = (cb.textContent || cb.innerText || '').trim();
              if (!text) continue;
              const toolAction = tryParseToolJson(text);
              if (toolAction) {
                detectedTools.push(toolAction);
                continue;
              }
              rawResponse += text + '\n\n';
            }
            for (const p of item.querySelectorAll('.paragraph, p, [class*="text"]')) {
              const text = (p.innerText || p.textContent || '').trim();
              if (text) rawResponse += text + '\n\n';
            }
          }
        }

        rawResponse = rawResponse.trim();

        // v10.8-fix: thinking container lasts only while no real response is written
        // outside it. Once we have response text in a sibling markdown, we drop
        // any leaked thinking prefix from rawResponse.
        if (thinkContainer && rawResponse) {
          const codeBlockIdx = rawResponse.indexOf('```');
          const jsonStartIdx = rawResponse.search(/\{\s*"/);
          const firstRealIdx = codeBlockIdx >= 0 && jsonStartIdx >= 0
            ? Math.min(codeBlockIdx, jsonStartIdx)
            : (codeBlockIdx >= 0 ? codeBlockIdx : jsonStartIdx);

          if (firstRealIdx > 10) {
            const beforeReal = rawResponse.slice(0, firstRealIdx).trim();
            const afterReal = rawResponse.slice(firstRealIdx).trim();
            if (thinkStarters.test(beforeReal) || beforeReal.length < 400) {
              thinking = thinking ? thinking + '\n\n' + beforeReal : beforeReal;
              response = afterReal;
            } else {
              response = rawResponse;
            }
          } else if (firstRealIdx === 0) {
            response = rawResponse;
          } else if (!rawResponse.includes('```') && !rawResponse.includes('{')) {
            // v10.42-fix: rawResponse already excludes the dedicated thinking
            // container. If the remaining text does not read like a thinking
            // monologue, it IS the real response.
            const looksLikeThinking = thinkStarters.test(rawResponse) ||
              /^Think\b/i.test(rawResponse) ||
              /^Pensando\b/i.test(rawResponse) ||
              /^Analisando\b/i.test(rawResponse);
            if (looksLikeThinking) {
              thinking = thinking ? thinking + '\n\n' + rawResponse : rawResponse;
              response = '';
            } else {
              response = rawResponse;
            }
          } else {
            response = rawResponse;
          }
        } else {
          response = rawResponse;
        }

        if (!thinkContainer && response && !thinking) {
          const isThink = thinkStarters.test(response) && response.length < 500 &&
                          !response.includes('"response"') && !response.includes('"tool"');
          if (isThink) {
            thinking = response;
            response = '';
          }
        }

        if (thinking || response || detectedTools.length > 0) {
          return { thinking, response: response.trim(), detectedTools, source: 'dom-structure', _debug: debugInfo };
        }
        debugInfo.lastAssistantHtml = lastAssistant.outerHTML.slice(0, 4000);
        return { _empty: true, _debug: debugInfo };
      }, { selectors: chains, assistantMarker: turnAssistantMarker });

      if (structureBased && !structureBased._empty) {
        const { canSteer, isGenerating } = await this._detectUiState(page, provider);
        // v10.0-fix: Enqueue detected tools as action_detected events so they are
        // processed separately from the response text.
        if (structureBased.detectedTools && structureBased.detectedTools.length > 0 && userId) {
          // W6-T6 review: route through _enqueueDomEvent so cross-turn dedup and
          // queue management apply uniformly to every action_detected event.
          for (const toolAction of structureBased.detectedTools) {
            this._enqueueDomEvent(userId, {
              type: 'action_detected',
              action: toolAction,
              source: 'dom_structure_tool_filter',
              timestamp: Date.now(),
            });
          }
        }
        const isContextLimit = this._isContextLimitResponse(structureBased.response);
        log.info(`[_poll] dom-structure: thinking=${structureBased.thinking.length}, response=${structureBased.response.length}, tools=${(structureBased.detectedTools || []).length}, isContextLimit=${isContextLimit}, debug=${JSON.stringify(structureBased._debug || {})}`);
        const { _debug, ...rest } = structureBased;
        return { ...rest, isContextLimit, canSteer, isGenerating };
      }
      const debugStr = structureBased?._debug ? JSON.stringify(structureBased._debug) : 'no-debug';
      log.info(`[_poll] dom-structure: NOT FOUND debug=` + debugStr);

      // v8.5-fix: REMOVED Layer 2-4 (React fiber + TreeWalker + getComputedStyle)
      // The heavy DOM traversal every 400ms was freezing the Kimi page by competing
      // with React's main thread. We now rely on:
      //   - Layer 1: Network interceptor (CDP)
      //   - Layer 1b: Legacy JS-injected stream interceptor (window.__lunaStream)
      //   - Layer 2.5: Lightweight DOM structure extraction
      // If none of those work, return empty and wait for next poll cycle.

      // Generic provider fallback for DeepSeek and future providers
      if (provider !== 'kimi') {
        const generic = await this._genericProviderExtraction(page, provider);
        // W6-T12: reset force-complete tracking between turns — when no
        // response is visible the previous turn's timers must not leak forward.
        if (session && !generic.response) {
          session._genericFirstSeenAt = null;
          session._genericLastLengthChangeAt = null;
          session._genericLastLength = 0;
        }
        if (generic.response || (generic.detectedTools && generic.detectedTools.length > 0)) {
          let uiState = await this._detectUiState(page, provider);
          // v10.27-fix: DeepSeek's send button is disabled when the input is empty,
          // so _detectUiState reports canSteer=false/isGenerating=true forever.
          // Use response stability as a completion heuristic for non-Kimi providers.
          if (session) {
            if (session._lastPollResponse === generic.response && generic.response.length > 0) {
              session._responseStableCycles = (session._responseStableCycles || 0) + 1;
            } else {
              session._responseStableCycles = 0;
            }
            session._lastPollResponse = generic.response;
            // W6-T12: track first-seen time and length stability for the
            // force-complete cap consulted below.
            if (generic.response && generic.response.length > 0) {
              if (!session._genericFirstSeenAt) session._genericFirstSeenAt = Date.now();
              if (session._genericLastLength !== generic.response.length) {
                session._genericLastLengthChangeAt = Date.now();
                session._genericLastLength = generic.response.length;
              }
            }
            // v10.34-fix: Require more stable cycles for DeepSeek to avoid partial responses.
            // Quality over speed: only declare completion when we are confident.
            if (session._responseStableCycles >= 5) {
              uiState.isGenerating = false;
              uiState.canSteer = true; // enable buttonSend completion signal
            }
          }
          // Avoid log spam when the response is stable and idle.
          const shouldLogGeneric = !session || session._lastLoggedGenericResponse !== generic.response || session._lastLoggedGenericIsGen !== uiState.isGenerating;
          if (shouldLogGeneric) {
            log.info(`[_poll] generic-provider: response=${generic.response.length} chars tools=${(generic.detectedTools || []).length} isGen=${uiState.isGenerating}`);
            if (session) {
              session._lastLoggedGenericResponse = generic.response;
              session._lastLoggedGenericIsGen = uiState.isGenerating;
            }
          }
          // v10.34-fix: Do NOT stream partial responses for non-Kimi providers.
          // Wait until generation is complete, then return the full cleaned response
          // so JSON tool blocks are parsed and executed correctly.
          // W6-T12: force-complete cap — independent of UI heuristics. If the
          // response has been visible for >45s and its length stable for >10s,
          // complete even when _detectUiState still says "generating" (DeepSeek
          // cursor blink can keep that true forever, starving tool delivery).
          if (session && _shouldForceGenericComplete({
            firstSeenAt: session._genericFirstSeenAt,
            lastLengthChangeAt: session._genericLastLengthChangeAt,
            uiGenerating: uiState.isGenerating,
          }, Date.now())) {
            uiState.isGenerating = false;
            // W6-T12 review: mirror the stability backstop above — a declared
            // completion must also raise canSteer so the completion-candidate
            // vote (buttonSend signal) can reach quorum even when the extracted
            // text never goes byte-stable, and post-complete steer is not blocked.
            uiState.canSteer = true;
            log.warn(`[_poll] generic-provider: force-complete cap reached (45s seen + 10s length-stable) — completing despite UI still generating`);
          }
          if (uiState.isGenerating) {
            return { thinking: '', response: '', canSteer: uiState.canSteer, isGenerating: true, source: generic.source };
          }
          // v10.32-fix: Enqueue detected tool actions so Luna can execute them.
          if (generic.detectedTools && userId) {
            for (const toolAction of generic.detectedTools) {
              this._enqueueDomEvent(userId, { type: 'action_detected', action: toolAction, source: 'generic-provider-tool', timestamp: Date.now() });
            }
          }
          return { thinking: '', response: generic.response, canSteer: uiState.canSteer, isGenerating: false, source: generic.source };
        }
      }

      // Throttle this log to avoid spamming when the page is idle.
      const now = Date.now();
      if (!session || !session._lastEmptyLayersLogAt || now - session._lastEmptyLayersLogAt > 5000) {
        log.info(`[_poll] All lightweight layers exhausted — returning empty, will retry`);
        if (session) session._lastEmptyLayersLogAt = now;
      }
      const uiState = await this._detectUiState(page, provider);
      return { thinking: '', response: '', canSteer: uiState.canSteer, isGenerating: uiState.isGenerating, source: 'empty-wait' };
    } catch (e) {
      log.warn(`[_pollThinkingAndResponse] evaluate error: ${e.message}`);
      return { thinking: '', response: '', canSteer: false, isGenerating: false, source: 'error' };
    }
    }; // end pollWithTimeout

    // v3.6: No timeout — we patiently wait for the page to respond.
    // The user explicitly requested zero timeouts in the agent.
    return await pollWithTimeout().catch(err => {
      log.warn(`[_pollThinkingAndResponse] ${err.message} — returning empty fallback`);
      return { thinking: '', response: '', canSteer: false, isGenerating: false, source: 'error' };
    });
  }

  /**
   * Detect UI state: canSteer and isGenerating from DOM buttons.
   * v10.27-fix: Accept provider-specific UI selectors so non-Kimi providers
   * don't get misclassified by overly broad generic selectors.
   */
  async _detectUiState(page, provider = null) {
    try {
      const providerCfg = provider ? this._loadProviderConfig(provider) : null;
      const uiSelectors = providerCfg ? getProviderUiSelectors(providerCfg) : {};
      const normalize = (v) => {
        if (!v) return [];
        if (Array.isArray(v)) return v.map(s => s.trim()).filter(Boolean);
        return String(v).split(',').map(s => s.trim()).filter(Boolean);
      };
      const result = await page.evaluate(({ sendBtnSel, stopBtnSel, generatingSel }) => {
        function isVisible(el) { return el && el.offsetParent !== null; }
        // Can we steer? Prefer provider-specific send button, fall back to generics.
        const sendBtnSelectors = sendBtnSel.length
          ? sendBtnSel
          : ['.send-button-container', '[class*="send"]', 'button[type="submit"]', '[aria-label*="send" i]'];
        let canSteer = false;
        for (const sel of sendBtnSelectors) {
          const btn = document.querySelector(sel);
          if (btn && isVisible(btn)) {
            canSteer = !btn.disabled && !(typeof btn.className === 'string' && btn.className.includes('disabled'));
            if (canSteer) break;
          }
        }

        // Is still generating? Prefer provider-specific stop/generating selectors.
        const stopBtnSelectors = stopBtnSel.length
          ? stopBtnSel
          : ['.stop-button-container', '[class*="stop"]', '[class*="cancel"]', '[aria-label*="stop" i]'];
        let isGenerating = false;
        for (const sel of stopBtnSelectors) {
          const btn = document.querySelector(sel);
          if (btn && isVisible(btn)) {
            isGenerating = true;
            break;
          }
        }
        if (!isGenerating && generatingSel.length) {
          for (const sel of generatingSel) {
            const el = document.querySelector(sel);
            if (el && isVisible(el)) {
              isGenerating = true;
              break;
            }
          }
        }
        if (!isGenerating && !canSteer) {
          const anySend = document.querySelector('.send-button-container, [class*="send"]');
          if (!anySend || !isVisible(anySend)) isGenerating = true;
        }
        return { canSteer, isGenerating };
      }, {
        sendBtnSel: normalize(uiSelectors.sendButton),
        stopBtnSel: normalize(uiSelectors.stopButton),
        generatingSel: normalize(uiSelectors.generatingIndicator)
      });
      // v12.4-fix: active thinking/loading indicators are a source-of-truth signal
      // that Kimi is still working, even when the Stop button is hidden/transient.
      const hasLoading = await this._hasActiveLoadingIndicators(page);
      if (hasLoading && !result.isGenerating) {
        log.info(`[_detectUiState] forcing isGenerating=true because active loading/thinking indicators are visible`);
        result.isGenerating = true;
      }
      return result;
    } catch (e) {
      return { canSteer: false, isGenerating: false };
    }
  }

  /**
   * Detect active loading indicators in the DOM (spinners, thinking blocks, cursors).
   * Returns true if Kimi is still actively working on something.
   */
  async _hasActiveLoadingIndicators(page) {
    try {
      return await page.evaluate(() => {
        // 1. Spinners / loading dots
        const spinnerSelectors = [
          '.loading-spinner', '.spinner', '.loading-dots', '.animate-spin',
          '[class*="spinner"]', '[class*="loading"]', '[class*="animate-spin"]',
          'svg[class*="spin"]', 'svg[class*="loading"]',
        ];
        for (const sel of spinnerSelectors) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) return true;
        }

        // 2. Thinking / reasoning blocks that are still open/active
        const thinkingSelectors = [
          '.thinking-container', '.think-block', '.thinking-block',
          '.segment-thinking', '.assistant-thinking',
          '[data-testid="thinking"]', '[data-testid="think-block"]',
          '[class*="thinking"]:not([class*="completed"])',
          'details[open] .thinking-content',
        ];
        for (const sel of thinkingSelectors) {
          const els = document.querySelectorAll(sel);
          for (const el of els) {
            if (el.offsetParent !== null) {
              const text = el.innerText || '';
              // If it contains active-verbs, it's still running
              if (/^(Pensando|Thinking|Analisando|Analysing|Processando|Processing|Buscando|Searching)/i.test(text)) {
                return true;
              }
            }
          }
        }

        // 3. Cursor / typing indicator
        const cursorSelectors = [
          '.cursor-blink', '.typing-cursor', '[class*="cursor"]',
          '[class*="typing"]', '.animate-pulse',
        ];
        for (const sel of cursorSelectors) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) return true;
        }

        // 4. Code execution blocks that show "running" status
        const codeStatusSelectors = [
          '.code-execution-status', '.execution-status',
          '[class*="execution"][class*="running"]',
        ];
        for (const sel of codeStatusSelectors) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) {
            const text = el.innerText || '';
            if (/running|executing|executando|em execução/i.test(text)) return true;
          }
        }

        // 5. Kimi Web tool calls in progress (ipython, web_search, etc.)
        const toolCallSelectors = [
          '.toolcall-ipython', '.toolcall-web_search', '.toolcall-web_open_url',
          '.toolcall-container', '.tool-call-container',
          '[class*="toolcall"]', '[class*="tool-call"]',
        ];
        for (const sel of toolCallSelectors) {
          const els = document.querySelectorAll(sel);
          for (const el of els) {
            if (el.offsetParent !== null) {
              const text = el.innerText || '';
              // If the tool call shows active status keywords, it's still running
              if (/(executando|running|processando|processing|buscando|searching|calculando|calculating|analisando|analyzing)/i.test(text)) {
                return true;
              }
              // If the tool call has a loading/spinner indicator inside
              const hasSpinner = el.querySelector('.loading-spinner, .spinner, [class*="spin"], [class*="loading"]');
              if (hasSpinner && hasSpinner.offsetParent !== null) return true;
            }
          }
        }

        return false;
      });
    } catch (e) {
      return false; // If we can't detect, assume no loading (don't block forever)
    }
  }

  /**
   * DOM MIRROR v3.2 — Híbrida Inteligente
   * Extracts ipython code blocks, execution results, AND images from the DOM.
   *
   * Kimi Web renders:
   *   - Code: .segment-code with language-python
   *   - Stdout result: .segment-code with language-plain
   *   - Images: .ipython-images-container img
   *
   * Returns array of { code, result, images, language, source }.
   *   code   → the Python code
   *   result → stdout text from Kimi's sandbox execution
   *   images → array of { src, alt } for generated plots/diagrams
   */
  async _extractToolMirrorFromDOM(page, provider = 'kimi') {
    try {
      const chains = provider === 'kimi' ? this._resolveDomSelectorChains(provider) : null;
      return await page.evaluate((selectors) => {
        function allMatches(root, sels) {
          const seen = new Set();
          const out = [];
          for (const sel of sels) {
            for (const el of root.querySelectorAll(sel)) {
              if (!seen.has(el)) { seen.add(el); out.push(el); }
            }
          }
          return out;
        }
        function firstMatch(root, sels) {
          for (const sel of sels) {
            const el = root.querySelector(sel);
            if (el) return el;
          }
          return null;
        }

        // v3.3-fix: ensure seq counter exists for fallback assignment
        if (typeof window.__lunaToolCallSeq === 'undefined') window.__lunaToolCallSeq = 0;

        const results = [];
        const seen = new Set();
        let extractionSeq = 0;

        // v10.8-fix: Find the LAST assistant segment via provider selector chain.
        let assistants = selectors ? allMatches(document, selectors.assistant) : [];
        let lastAssistant = assistants.length ? assistants[assistants.length - 1] : null;
        if (!lastAssistant) {
          const fallbackSelectors = [
            '.segment-assistant', '.message-assistant',
            '[data-testid="assistant-message"]', '[data-testid="message-assistant"]',
            '.chat-message--assistant', '[class*="assistant"][class*="segment"]',
            '[class*="assistant"][class*="message"]',
          ];
          for (const sel of fallbackSelectors) {
            const els = document.querySelectorAll(sel);
            if (els.length) { lastAssistant = els[els.length - 1]; break; }
          }
        }
        if (!lastAssistant) return results;

        // ── v3.3: Security — verify node is inside assistant container ──
        function isInsideAssistant(node) {
          let parent = node.parentElement;
          while (parent) {
            const pc = (parent.className || '').toLowerCase();
            if (pc.includes('assistant') || pc.includes('segment-assistant') || pc.includes('message-assistant')) {
              return true;
            }
            parent = parent.parentElement;
          }
          return false;
        }

        // ── Helper: find the closest preceding .segment-code for a result block ──
        function findPrecedingCodeBlock(resultBlock, allCodeBlocks) {
          const resultRect = resultBlock.getBoundingClientRect();
          let closest = null;
          let closestDist = Infinity;
          for (const cb of allCodeBlocks) {
            const cbRect = cb.getBoundingClientRect();
            if (cbRect.top < resultRect.top) {
              const dist = resultRect.top - cbRect.bottom;
              if (dist < closestDist) {
                closestDist = dist;
                closest = cb;
              }
            }
          }
          return closest;
        }

        // ── Strategy A: Sandbox execution blocks (.toolcall-*) ──
        // v3.3: expanded to capture all tool types, not just ipython
        const toolcallSelectors = [
          '.toolcall-container.default.toolcall-ipython',
          '.toolcall-container.default.toolcall-web_search',
          '.toolcall-container.default.toolcall-browser',
          '.toolcall-container.default.toolcall-computer',
          '.toolcall-ipython',
          '.toolcall-web_search',
          '.toolcall-browser',
          '.toolcall-computer',
        ];
        for (const sel of toolcallSelectors) {
          const containers = lastAssistant.querySelectorAll(sel);
          for (const container of containers) {
            // Security: verify node is inside assistant container
            if (!isInsideAssistant(container)) continue;

            const content = container.querySelector('.toolcall-content');
            if (!content) continue;

            // Detect tool type from className
            const className = (container.className || '').toLowerCase();
            // v10.42-fix: the new Kimi frontend renders the thinking block as a
            // .toolcall-container.thinking-container; it is NOT a real tool call.
            if (className.includes('thinking') || className.includes('reasoning')) continue;
            // v2.6.6-fix: also skip any toolcall container nested inside a thinking container.
            if (container.closest && container.closest('.thinking-container, [class*="thinking-container"], [class*="thinking"]')) continue;
            let toolName = 'ipython';
            if (className.includes('web_search')) toolName = 'web_search';
            else if (className.includes('browser')) toolName = 'browser';
            else if (className.includes('computer')) toolName = 'computer';

            // Extract code from pre/code inside toolcall-content
            let codeText = '';
            const pre = content.querySelector('pre');
            const codeEl = content.querySelector('code');
            if (pre) codeText = pre.innerText.trim();
            else if (codeEl) codeText = codeEl.innerText.trim();
            else codeText = content.innerText.trim();

            if (!codeText || codeText.length < 5 || seen.has(codeText)) continue;
            seen.add(codeText);

            // Extract images from this container
            const images = [];
            container.querySelectorAll('img').forEach(img => {
              if (img.src && !img.src.includes('avatar.moonshot.cn') && !img.src.includes('statics.moonshot.cn')) {
                images.push({ src: img.src, alt: img.alt || '' });
              }
            });

            // Extract stdout/result text (plain text after code, not in pre/code)
            let resultText = '';
            const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null);
            let node;
            while ((node = walker.nextNode())) {
              const text = node.textContent.trim();
              if (text && text.length > 3 && !codeText.includes(text)) {
                resultText += text + '\n';
              }
            }

            // v3.3: extract sequence number and timestamp from MutationObserver
            // Fallback: assign at extraction time if observer hasn't processed this node
            let seq = parseInt(container.getAttribute('data-luna-seq') || '0', 10);
            let detectedAt = parseInt(container.getAttribute('data-luna-detected-at') || '0', 10);
            if (seq === 0) {
              seq = ++extractionSeq;
              container.setAttribute('data-luna-seq', String(seq));
            }
            if (detectedAt === 0) {
              detectedAt = Date.now();
              container.setAttribute('data-luna-detected-at', String(detectedAt));
            }

            results.push({
              code: codeText,
              result: resultText.trim(),
              images,
              language: 'python',
              source: 'kimi-sandbox',
              sandboxExecution: true,
              tool: toolName,
              seq,
              detectedAt,
            });
          }
        }

        // ── Strategy B: .segment-code blocks (text-only examples) ──
        // When Kimi shows code as text without sandbox execution
        // v3.4-fix: ONLY capture executable code (python, bash). Skip frontend
        // languages (js, html, css, json) — they're examples, not tools to run.
        lastAssistant.querySelectorAll('.segment-code').forEach(block => {
          // Security: verify node is inside assistant container
          if (!isInsideAssistant(block)) return;

          // v10.42-fix: the new Kimi frontend sometimes renders the thinking step as a
          // plain code block while streaming. It is NOT a tool call.
          if (block.closest && block.closest('.toolcall-container.thinking-container, .thinking-container, [class*="thinking"]')) return;

          const langEl = block.querySelector('.segment-code-lang');
          const lang = langEl ? langEl.innerText.toLowerCase() : '';

          // v3.4: Skip frontend/markup languages — they're response examples, not executable tools
          if (lang.includes('js') || lang.includes('javascript') || lang.includes('typescript') ||
              lang.includes('html') || lang.includes('css') || lang.includes('json') ||
              lang.includes('vue') || lang.includes('svelte') || lang.includes('jsx') || lang.includes('tsx')) {
            return;
          }

          const contentEl = block.querySelector('.segment-code-content, pre, code');
          if (!contentEl) return;
          let text = contentEl.innerText.trim();
          // Fallback: textContent often returns full text even when innerText is truncated
          // by virtual scrolling or lazy rendering in the DOM.
          if (text.length < 200) {
            const tc = (contentEl.textContent || '').trim();
            if (tc.length > text.length) {
              text = tc;
            }
          }
          // Also try to get text from sibling or parent if still short
          if (text.length < 200 && contentEl.parentElement) {
            const parentTc = (contentEl.parentElement.textContent || '').trim();
            if (parentTc.length > text.length && !parentTc.includes('Copy')) {
              text = parentTc;
            }
          }
          if (!text || text.length < 5 || seen.has(text)) return;
          seen.add(text);

          // v10.42-fix: ignore thinking content that leaked into a code block
          if (/^(Think|Thinking|Pensando|Analisando|Analisar|Reasoning|Processando|Searching|Buscando)\b/i.test(text)) return;

          // Skip plain-text results — they're outputs, not code
          if (lang.includes('plain')) return;

          let language = 'python';
          if (lang.includes('bash') || lang.includes('shell')) language = 'bash';

          results.push({
            code: text,
            result: '',
            images: [],
            language,
            source: 'kimi-text',
            sandboxExecution: false,
            tool: language === 'python' ? 'ipython' : language,
            seq: 0,
            detectedAt: 0,
          });
        });

        // ── Strategy C: .ipython-images-container (standalone images) ──
        // Sometimes images appear outside the toolcall container
        const imgContainer = lastAssistant.querySelector('.ipython-images-container');
        if (imgContainer && !results.some(r => r.images.length > 0)) {
          const images = [];
          imgContainer.querySelectorAll('img').forEach(img => {
            if (img.src && !img.src.includes('avatar.moonshot.cn') && !img.src.includes('statics.moonshot.cn')) {
              images.push({ src: img.src, alt: img.alt || '' });
            }
          });
          if (images.length && results.length) {
            // Attach images to the last result if none have images yet
            results[results.length - 1].images.push(...images);
          }
        }

        // v3.3: Sort results by sequence number (MutationObserver order) for FIFO execution
        results.sort((a, b) => a.seq - b.seq || a.detectedAt - b.detectedAt);

        return results;
      }, chains);
    } catch (e) {
      log.warn(`_extractToolMirrorFromDOM failed: ${e.message}`);
      return [];
    }
  }

  /**
   * v5.3: Extract JSON code blocks from the DOM in REAL-TIME.
   * Returns { responses: [], actions: [] } for FIFO streaming.
   * Detects {"response": "..."} and {"tool": "...", "params": {...}} blocks.
   * W6-T6: optional assistantMarker (count of pre-send .segment-assistant nodes)
   * scopes the scan to segments created by the current turn; when null/undefined
   * the behavior is exactly as before (scan the last assistant match).
   */
  async _extractJsonBlocksFromDOM(page, assistantMarker = null, provider = 'kimi') {
    try {
      const chains = provider === 'kimi' ? this._resolveDomSelectorChains(provider) : null;
      return await page.evaluate(({ selectors, marker }) => {
        function allMatches(root, sels) {
          const seen = new Set();
          const out = [];
          for (const sel of sels) {
            for (const el of root.querySelectorAll(sel)) {
              if (!seen.has(el)) { seen.add(el); out.push(el); }
            }
          }
          return out;
        }
        function firstMatch(root, sels) {
          for (const sel of sels) {
            const el = root.querySelector(sel);
            if (el) return el;
          }
          return null;
        }

        const responses = [];
        const actions = [];
        const seen = new Set();

        // v10.24-fix: Detect plain code blocks (bash/python) that are not wrapped in JSON.
        function detectScriptBlock(text, el) {
          const t = text.trim();
          if (t.length < 3) return null;
          if (t.startsWith('#!/bin/bash') || t.startsWith('#!/usr/bin/env bash') || t.startsWith('#!/bin/sh')) {
            return { tool: 'executeScript', params: { code: t, language: 'bash' } };
          }
          if (t.startsWith('#!/usr/bin/env python') || t.startsWith('#!/usr/bin/python')) {
            return { tool: 'executeScript', params: { code: t, language: 'python' } };
          }
          if (t.startsWith('#!/usr/bin/env node') || t.startsWith('#!/usr/bin/node')) {
            return { tool: 'executeScript', params: { code: t, language: 'node' } };
          }
          const langClass = Array.from(el.classList || []).find(c => c.startsWith('language-'));
          const lang = langClass ? langClass.replace('language-', '').toLowerCase() : '';
          if (['bash', 'shell', 'sh', 'zsh'].includes(lang)) {
            return { tool: 'executeScript', params: { code: t, language: 'bash' } };
          }
          if (['python', 'py', 'python3'].includes(lang)) {
            return { tool: 'executeScript', params: { code: t, language: 'python' } };
          }
          if (['powershell', 'ps1', 'pwsh'].includes(lang)) {
            return { tool: 'executeScript', params: { code: t, language: 'powershell' } };
          }
          if (['javascript', 'js', 'node'].includes(lang)) {
            return { tool: 'executeScript', params: { code: t, language: 'node' } };
          }
          return null;
        }

        // v10.8-fix: Find the LAST assistant segment via selector chain.
        const assistants = selectors ? allMatches(document, selectors.assistant) : [];
        let lastAssistant = assistants.length
          ? assistants[assistants.length - 1]
          : null;
        if (!lastAssistant && typeof marker === 'number') {
          // Fallback: old hardcoded selector with marker semantics preserved.
          const els = document.querySelectorAll('.segment-assistant');
          if (els.length > marker) lastAssistant = els[els.length - 1];
        }
        if (!lastAssistant) {
          const fallbackSelectors = [
            '.segment-assistant', '.message-assistant',
            '[data-testid="assistant-message"]', '[data-testid="message-assistant"]',
            '.chat-message--assistant', '[class*="assistant"][class*="segment"]',
            '[class*="assistant"][class*="message"]',
          ];
          for (const sel of fallbackSelectors) {
            const els = document.querySelectorAll(sel);
            if (els.length) { lastAssistant = els[els.length - 1]; break; }
          }
        }
        if (!lastAssistant) return { responses, actions };

        // v10.8-fix: Find ALL code blocks via selector chain + fallbacks.
        const codeSelectors = selectors
          ? [...selectors.codeBlock, '.segment-code', '.message-code', '[class*="code"][class*="segment"]',
             '.toolcall-content pre', '.toolcall-content code', '.markdown pre code', '.markdown-container pre code']
          : ['.segment-code', '.message-code', '[class*="code"][class*="segment"]',
             '.toolcall-content pre', '.toolcall-content code',
             '.markdown pre code', '.markdown-container pre code'];
        const allCodeEls = allMatches(lastAssistant, codeSelectors);

        // v2.6.6-fix: ABSOLUTE boundary rule — never extract response/tool JSON from inside
        // the thinking container. The model's reasoning may quote JSON examples that must
        // stay inside the thinking bubble and never be treated as real actions/responses.
        const thinkContainer = selectors
          ? firstMatch(lastAssistant, selectors.thinking)
          : lastAssistant.querySelector('.toolcall-container.thinking-container, .thinking-container, [class*="thinking-container"]');
        const isInsideThinking = (el) => {
          if (!thinkContainer) return false;
          let parent = el.parentElement;
          while (parent && parent !== lastAssistant) {
            if (parent === thinkContainer) return true;
            parent = parent.parentElement;
          }
          return false;
        };
        const filteredCodeEls = allCodeEls.filter(el => !isInsideThinking(el));

        for (const el of filteredCodeEls) {
          let text = '';
          // Try innerText first, then textContent
          text = (el.innerText || el.textContent || '').trim();
          // Fallback: get from parent pre if innerText is empty
          if (!text && el.parentElement && el.parentElement.tagName === 'PRE') {
            text = (el.parentElement.innerText || el.parentElement.textContent || '').trim();
          }
          if (!text || text.length < 10 || seen.has(text)) continue;
          seen.add(text);

          // Clean up JSON wrapper artifacts from DOM extraction
          const cleaned = text
            .replace(/^\s*JSON\s*(?:Copy|复制|複製)\s*/i, '')
            .replace(/^\s*json\s*(?:Copy|复制|複製)\s*/i, '');

          // v5.3-fix: Tolerant JSON parser that handles literal newlines inside strings
          // Kimi sometimes renders JSON code blocks with real newlines inside string values
          function tolerantJsonParse(str) {
            // v5.3-fix: Only parse COMPLETE JSON blocks.
            // If the string doesn't end with '}', it's still being streamed — skip it.
            const trimmed = str.trim();
            if (!trimmed.endsWith('}')) return null;

            // 1. Try standard JSON parse first
            try { return JSON.parse(str); } catch {}
            // 2. Try extracting first JSON object
            const firstBrace = str.indexOf('{');
            const lastBrace = str.lastIndexOf('}');
            if (firstBrace >= 0 && lastBrace > firstBrace) {
              const extracted = str.slice(firstBrace, lastBrace + 1);
              try { return JSON.parse(extracted); } catch {}
            }
            // 3. Regex-based extraction for tool/action JSON blocks
            // This handles malformed JSON with literal newlines inside strings
            const toolMatch = str.match(/"tool"\s*:\s*"([^"]+)"/);
            if (!toolMatch) return null;
            const tool = toolMatch[1];
            // Extract the entire params object - find "params": { ... }
            const paramsStart = str.indexOf('"params"');
            if (paramsStart === -1) return { tool, params: {} };
            let braceDepth = 0;
            let paramsStr = '';
            let inStr = false;
            let strChar = null;
            let escaped = false;
            for (let i = paramsStart; i < str.length; i++) {
              const ch = str[i];
              if (escaped) {
                paramsStr += ch;
                escaped = false;
                continue;
              }
              if (ch === '\\') {
                paramsStr += ch;
                escaped = true;
                continue;
              }
              if (!inStr) {
                if (ch === '"' || ch === "'") {
                  inStr = true; strChar = ch;
                } else if (ch === '{') {
                  braceDepth++;
                } else if (ch === '}') {
                  braceDepth--;
                  if (braceDepth === 0) {
                    paramsStr += ch;
                    break;
                  }
                }
                paramsStr += ch;
              } else {
                if (ch === strChar) {
                  inStr = false; strChar = null;
                }
                paramsStr += ch;
              }
            }
            // Replace literal newlines inside the params string with escaped newlines
            // We do this by walking again and only escaping newlines that are inside quotes
            let fixedParams = '';
            inStr = false; strChar = null; escaped = false;
            for (let i = 0; i < paramsStr.length; i++) {
              const ch = paramsStr[i];
              if (escaped) {
                fixedParams += ch;
                escaped = false;
                continue;
              }
              if (ch === '\\') {
                fixedParams += ch;
                escaped = true;
                continue;
              }
              if (!inStr) {
                if (ch === '"' || ch === "'") {
                  inStr = true; strChar = ch;
                }
                fixedParams += ch;
              } else {
                if (ch === strChar) {
                  inStr = false; strChar = null;
                  fixedParams += ch;
                } else if (ch === '\n') {
                  fixedParams += '\\n';
                } else if (ch === '\r') {
                  fixedParams += '\\r';
                } else if (ch === '\t') {
                  fixedParams += '\\t';
                } else {
                  fixedParams += ch;
                }
              }
            }
            try {
              const params = JSON.parse(fixedParams);
              return { tool, params };
            } catch {
              // Incomplete JSON — don't emit partial actions
              return null;
            }
          }

          const parsed = tolerantJsonParse(cleaned);

          if (!parsed) {
            // v10.24-fix: JSON failed — maybe this is a plain bash/python code block.
            const scriptBlock = detectScriptBlock(cleaned, el);
            if (scriptBlock) {
              actions.push({ ...scriptBlock, raw: text });
            }
            continue;
          }

          // Detect response block
          if (parsed.response !== undefined && !parsed.tool && !parsed.script) {
            responses.push({ response: parsed.response, raw: text });
          }
          // Detect action/tool block
          else if (parsed.tool && parsed.params !== undefined) {
            actions.push({
              tool: parsed.tool,
              params: parsed.params,
              raw: text,
            });
          }
          // Detect script block
          else if (parsed.script) {
            actions.push({
              tool: 'executeScript',
              params: { code: parsed.script, language: parsed.language || 'bash' },
              raw: text,
            });
          }
        }

        // v2.6.6-fix: thinking container code blocks are NEVER treated as actions/responses.
        return { responses, actions };
      }, { selectors: chains, marker: assistantMarker });
    } catch (e) {
      log.warn(`_extractJsonBlocksFromDOM failed: ${e.message}`);
      return { responses: [], actions: [] };
    }
  }

  /**
   * v7.5: Robust JSON tool call extractor — replaces fragile regex with actual JSON parsing.
   * Searches for JSON objects in text, including inside code blocks (```json ... ```).
   * Returns array of {tool, params} objects, or empty array if none found.
   */
  _extractJsonToolCalls(text) {
    if (!text || typeof text !== 'string') return [];
    const results = [];
    const foundKeys = new Set(); // Deduplication

    // Helper: try to parse a candidate string
    const tryParse = (candidate) => {
      try {
        const parsed = JSON.parse(candidate.trim());
        if (parsed.tool && typeof parsed.tool === 'string') {
          const key = JSON.stringify({ tool: parsed.tool, params: parsed.params || parsed.arguments || {} });
          if (!foundKeys.has(key)) {
            foundKeys.add(key);
            results.push({
              tool: parsed.tool,
              params: parsed.params || parsed.arguments || parsed,
              raw: candidate.trim(),
            });
          }
        } else if (parsed.script && typeof parsed.script === 'string') {
          // v10.24-fix: Detect JSON-wrapped scripts like {"script": "..."}.
          const key = JSON.stringify({ tool: 'executeScript', params: { code: parsed.script, language: parsed.language || 'bash' } });
          if (!foundKeys.has(key)) {
            foundKeys.add(key);
            results.push({
              tool: 'executeScript',
              params: { code: parsed.script, language: parsed.language || 'bash' },
              raw: candidate.trim(),
            });
          }
        }
      } catch (e) {
        // Not valid JSON or no tool/script field
      }
    };

    // Strategy 1: Extract from code blocks (```json ... ```)
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
    let match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
      tryParse(match[1]);
    }

    // Strategy 2: Extract raw JSON objects from text (W8-T2a: string-aware
    // walker — the old regex + naive brace counting cut the slice at braces
    // inside string values, e.g. writeFile HTML/JS content, and JSON.parse
    // then failed, silently dropping the tool). Walk every top-level object
    // respecting string literals/escapes; tryParse filters tool/script JSON
    // (W6-T9: script-only JSON maps to executeScript).
    let cursor = 0;
    while (cursor < text.length) {
      const objText = extractFirstCompleteJsonObject(text, cursor);
      if (!objText) break;
      tryParse(objText);
      const openIdx = text.indexOf('{', cursor);
      if (openIdx === -1) break;
      cursor = openIdx + objText.length;
    }

    // v12.0: rescue pass — no complete object parsed but a tool wrapper is
    // visibly present (truncated/malformed). The tolerant parser extracts the
    // tool name + best-effort params instead of dropping the call.
    if (results.length === 0 && /"tool"\s*:/.test(text)) {
      const rescued = parseToolJson(text);
      if (rescued && rescued.truncated && rescued.kind !== 'response') {
        // v12.1: partial mid-stream JSON — params would be incomplete. Skip;
        // the stream either completes the wrapper or the [CHECK] path asks
        // Kimi to reformat.
        console.warn('[LUNA-RESCUE] late-scan skipped truncated tool JSON');
      } else if (rescued && rescued.kind === 'tool') {
        console.warn(`[LUNA-RESCUE] late-scan recovered tool call: ${rescued.tool}`);
        results.push({ tool: rescued.tool, params: rescued.params, raw: text.slice(0, 500), rescued: true });
      } else if (rescued && rescued.kind === 'script') {
        console.warn('[LUNA-RESCUE] late-scan recovered script call');
        results.push({ tool: 'executeScript', params: { code: rescued.script, language: rescued.language || 'bash' }, raw: text.slice(0, 500), rescued: true });
      }
    }

    return results;
  }

  /**
   * v5.6-fix: Extract clean text from JSON blocks in the final response.
   * If the DOM shows raw JSON like {"response": "..."}, returns just the text.
   * Otherwise returns the original text unchanged.
   */
  _extractParsedText(text) {
    if (!text || typeof text !== 'string') return text;
    let cleaned = text.trim();

    // Fast path: doesn't look like JSON at all
    if (!cleaned.includes('{') && !cleaned.includes('```json')) return text;

    // v10.36-fix: Strip code block fences and Kimi DOM headers like "JSON\nCopy\n".
    cleaned = cleaned
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*$/gm, '')
      .replace(/```/g, '')
      .replace(/^\s*JSON\s*(?:Copy|复制|複製)\s*/gim, '')
      .replace(/^\s*json\s*(?:Copy|复制|複製)\s*/gim, '');

    // v10.36-fix: If the model duplicated the JSON block, keep only the first one.
    const firstBlockEnd = cleaned.indexOf('}\n\n{');
    if (firstBlockEnd > 0) {
      cleaned = cleaned.slice(0, firstBlockEnd + 1);
    }

    // Try to parse as JSON
    try {
      const parsed = JSON.parse(cleaned);
      // v5.7-fix: If JSON contains a tool call, return the FULL JSON so the parser can extract it.
      // Extracting only 'response' discards tool calls completely.
      if (parsed.tool && typeof parsed.tool === 'string') {
        return cleaned; // Return raw JSON — parser will extract tool call
      }
      if (parsed.script && typeof parsed.script === 'string') {
        return cleaned; // Return raw JSON — parser will extract script call
      }
      if (parsed.response && typeof parsed.response === 'string') {
        return parsed.response.trim();
      }
      // v10.24-fix: Tolerate malformed wrappers where Kimi sends {"success":true,"mode":"RESPONSE","message":"..."}
      if (parsed.message && typeof parsed.message === 'string' && !parsed.tool && !parsed.script) {
        return parsed.message.trim();
      }
    } catch {}

    // Try extracting first JSON object
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
        if (parsed.tool && typeof parsed.tool === 'string') {
          return cleaned.slice(firstBrace, lastBrace + 1); // Return raw JSON
        }
        if (parsed.script && typeof parsed.script === 'string') {
          return cleaned.slice(firstBrace, lastBrace + 1); // Return raw JSON
        }
        if (parsed.response && typeof parsed.response === 'string') {
          return parsed.response.trim();
        }
      } catch {}
    }

    // Try regex extraction of "response" field (only if no tool field detected)
    const hasToolField = /"tool"\s*:/.test(cleaned);
    if (!hasToolField) {
      const match = cleaned.match(/"response"\s*:\s*"([\s\S]*?)"\s*[,}]/);
      if (match) return match[1].trim();
    }

    return text;
  }

  /**
   * Check if extracted Python code appears complete (not mid-stream).
   * Prevents emitting incomplete code that would fail execution.
   */
  _isPythonCodeComplete(code) {
    if (!code || code.length < 10) return false;
    const lines = code.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
    if (lines.length === 0) return false;

    // Balance check: parentheses, brackets, braces
    let parens = 0, brackets = 0, braces = 0;
    let inString = false, stringChar = null;
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      const prev = code[i - 1];
      if (!inString) {
        if (ch === '"' || ch === "'") {
          inString = true; stringChar = ch;
        } else if (ch === '(') parens++;
        else if (ch === ')') parens--;
        else if (ch === '[') brackets++;
        else if (ch === ']') brackets--;
        else if (ch === '{') braces++;
        else if (ch === '}') braces--;
      } else {
        if (ch === stringChar && prev !== '\\') {
          inString = false; stringChar = null;
        }
      }
    }
    if (parens !== 0 || brackets !== 0 || braces !== 0) return false;

    // Last non-empty, non-comment line should not end with an operator or opening bracket
    const lastLine = lines[lines.length - 1].trim();
    const incompleteEnders = /[+\-*/%=<!>&|~(,[{]$/;
    if (incompleteEnders.test(lastLine)) return false;

    // Should not end with backslash (line continuation)
    if (lastLine.endsWith('\\')) return false;

    return true;
  }

  /**
   * Check if a bash code block looks complete.
   * Prevents emitting truncated heredocs or unclosed quotes as actions.
   */
  _isBashCodeComplete(code) {
    if (!code || code.length < 5) return false;

    // Check for unclosed heredoc: cat << 'EOF' ... (no closing EOF line)
    // Also handles heredocs inside bash -c "..." strings where \n is literal
    const heredocMatches = code.match(/<<\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/g);
    if (heredocMatches) {
      for (const hm of heredocMatches) {
        const m = hm.match(/<<\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/);
        if (!m) continue;
        const delimiter = m[1];
        // Check if the delimiter appears on its own line at the end
        const closeRe = new RegExp(`^${delimiter}\\s*$`, 'm');
        if (!closeRe.test(code)) {
          // Also check if the delimiter appears after a literal \n (common in bash -c strings)
          const literalCloseRe = new RegExp(`\\\\n${delimiter}\\b`);
          if (!literalCloseRe.test(code) && !code.includes(`\n${delimiter}`)) {
            return false;
          }
        }
      }
    }

    // Check for unclosed single/double quotes
    let inSingle = false, inDouble = false, escape = false;
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
      if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    }
    if (inSingle || inDouble) return false;

    // Check for unclosed backticks
    const backticks = (code.match(/`/g) || []).length;
    if (backticks % 2 !== 0) return false;

    // Check for unclosed $() or ()
    let parenDepth = 0;
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth--;
    }
    if (parenDepth !== 0) return false;

    // Last line should not end with backslash (line continuation)
    const lines = code.split('\n');
    const lastLine = lines[lines.length - 1].trim();
    if (lastLine.endsWith('\\')) return false;

    return true;
  }

  /**
   * Convert extracted ipython code into a Luna executeShell action.
   * Uses heredoc for multiline Python code to avoid escaping hell.
   */
  _convertIpythonToAction(block) {
    const { code, language } = block;

    if (language === 'bash' || language === 'shell') {
      return {
        tool: 'executeShell',
        params: { command: code },
      };
    }

    if (language === 'javascript' || language === 'node') {
      return {
        tool: 'executeShell',
        params: { command: `node -e ${JSON.stringify(code)}` },
      };
    }

    // Default: Python
    // Use heredoc to pass multiline code safely
    // Generate a unique delimiter to avoid collisions with code content
    const delimiter = `PYEOF_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const command = `python3 <<'${delimiter}'\n${code}\n${delimiter}`;

    return {
      tool: 'executeShell',
      params: { command, code },
    };
  }

  /**
   * Check if we can inject a steer message mid-response.
   */
  async canSteer(userId) {
    const session = this.userSessions.get(userId);
    if (!session || !session.page || session.page.isClosed()) return false;
    const { canSteer } = await this._pollThinkingAndResponse(session.page, userId);
    return canSteer;
  }

  /**
   * Inject a steer message while Kimi is generating.
   * This sends new text into the conversation mid-flight.
   */
  async injectSteer(userId, text) {
    if (!text || !text.trim()) {
      throw new Error('Steer text is required');
    }

    const page = await this._getOrCreateUserPage(userId);
    const session = this.userSessions.get(userId);

    log.info(`Injecting steer for user ${hashUserId(userId)}: "${text.slice(0, 60)}..."`);

    try {
      // Check if send button is active
      const canSteer = await this.canSteer(userId);
      if (!canSteer) {
        log.warn(`Cannot steer — send button is disabled (Kimi may be finalizing)`);
        return { success: false, error: 'Send button disabled — cannot steer right now' };
      }

      // Find input and inject text. W7-T4 review follow-up: Lexical-safe
      // fill — fill() desyncs the Lexical EditorState, and the send-button
      // click below would then silently send nothing.
      const steerCfg = this._loadProviderConfig(this._resolveProvider(userId));
      const steerInputChain = resolveChain(steerCfg, 'input', 'textarea, [contenteditable="true"]');
      const { locator: inputLocator } = await firstMatchingLocator(page, steerInputChain);
      await this._fillContentEditable(inputLocator, text);
      await page.waitForTimeout(300);

      // Click send or press Enter
      const steerSendChain = resolveChain(steerCfg, 'sendButton', '.send-button-container');
      const { locator: sendBtn } = await firstMatchingLocator(page, steerSendChain);
      const hasSendBtn = await sendBtn.count() > 0;

      if (hasSendBtn) {
        await sendBtn.click({ timeout: 3000 });
      } else {
        await this._pressEnterOnInput(inputLocator);
      }

      log.success(`Steer injected for user ${hashUserId(userId)}`);
      // W6-T6: a steer is real user input mid-stream — let identical tool JSON
      // be delivered again. Marker intentionally untouched: the in-flight
      // assistant segment must keep streaming.
      if (session) session._domEventSeen = new Map();
      return { success: true };
    } catch (err) {
      log.error(`Steer injection failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Send message with REAL-TIME STREAMING.
   * Yields: { type: 'thinking_delta'|'response_delta'|'can_steer'|'done', text?, value? }
   *
   * Pattern inspired by ShellAgent's Provider.chat() async generator.
   */
  async *sendMessageStream(userId, text, options = {}, provider = 'kimi') {
    if (!text || !text.trim()) {
      throw new Error('Message text is required');
    }

    // Rate limiting
    this._checkCooldown(userId);

    const resolvedProvider = this._resolveProvider(userId, provider);
    const page = await this._getOrCreateUserPage(userId, resolvedProvider);
    // v8.6-fix: Reset completion state and soft-cancel flag at start of every message
    let session = this.userSessions.get(userId);
    if (session) {
      session._completionState = null;
      session.softCancelRequested = false;
      session.provider = resolvedProvider;
    }

    // v7.5: Initialize Network Interceptor for this message
    // This replaces fragile JS injection with native Playwright response capture.
    let interceptor = null;
    try {
      interceptor = await this._getOrCreateInterceptor(userId);
    } catch (interceptorErr) {
    }
    if (interceptor) interceptor.reset();

    // v7.5: Also reset legacy stream interceptor (transitional, will be removed)
    await page.evaluate(() => {
      if (window.__lunaResetStream) {
        window.__lunaResetStream();
      } else if (window.__lunaStream) {
        window.__lunaStream.reasoning = [];
        window.__lunaStream.content = [];
        window.__lunaStream.events = [];
        window.__lunaStream.active = false;
        window.__lunaStream.error = null;
      }
    });

    // v7.0-fix: Wait for any ongoing processing. Unlike v6.x, we don't throw
    // STREAM_CANCELLED here — we wait for the previous stream to drain its
    // events or for the soft-cancel signal to propagate.
    // v9.5-fix: Guard against undefined session (userSessions may not have entry yet)
    // W6-T3: bounded + self-healing. If a previous stream died without clearing
    // `processing`, an unbounded wait here would hang every future message
    // BEFORE sending anything, with no event. Past 60s the previous stream is
    // provably dead — force-clear the flag and continue sending.
    const PROCESSING_DRAIN_TIMEOUT_MS = 60_000;
    if (session?.processing) {
      const drainDeadline = Date.now() + PROCESSING_DRAIN_TIMEOUT_MS;
      while (session?.processing) {
        if (Date.now() > drainDeadline) {
          log.warn(`[sendMessageStream] Processing drain timeout (${PROCESSING_DRAIN_TIMEOUT_MS}ms) for user ${hashUserId(userId)} — previous stream is dead, force-clearing processing flag`);
          session.processing = false;
          break;
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }

    if (session) {
      session.processing = true;
      session.lastActivity = Date.now();
    }
    this.cancelledStreams.delete(userId);
    this.streamStopFlags.delete(userId);

    // v7.0: Initialize per-message event queue
    const queueId = `q-${Date.now()}`;
    this.domEventQueues.set(userId, { events: [], lastReadIndex: 0, createdAt: Date.now(), queueId });
    const queue = this.domEventQueues.get(userId);

    // v7.0: Start DOM poller — runs INDEPENDENTLY of the stream
    this._startDomPoller(userId);

    try {
      await this._verifySession(page);
      if (options.newChat) {
        const pageContext = page.context();
        const pagesBefore = new Set(pageContext.pages());
        const openedUrl = await this._openNewChat(page, resolvedProvider);

        // v10.36-fix: Kimi sometimes opens the new chat in a new tab.
        // Detect and migrate to the new tab to keep sending on the active thread.
        const pagesAfter = pageContext.pages();
        for (const p of pagesAfter) {
          if (!pagesBefore.has(p) && !p.isClosed()) {
            let url = '';
            try { url = p.url(); } catch (e) { url = ''; }
            log.info(`[sendMessageStream] detected new tab: ${url}`);
            if (url.includes('/chat/') || url.includes('kimi.ai')) {
              try { if (!page.isClosed()) await page.close(); } catch (e) {}
              session.page = p;
              p._lunaUserId = userId;
              p._lunaProvider = resolvedProvider;
              page = p;
              break;
            }
          }
        }

        session = this.userSessions.get(userId);
        if (session) {
          session.chatUrl = page.url();
          this._saveChatUrl(userId, session.chatUrl, { provider: resolvedProvider });
        }

        // v10.36-fix: Close leftover landing-page tabs so the user does not see
        // a deslogada page after the new chat opens in a new tab.
        await this._closeStaleProviderTabs(pageContext, page, resolvedProvider);
      }

      // v10.39-fix: Defensive URL check — ensure this Luna session always talks
      // in its own Kimi chat thread. If the tab got reassigned or navigated
      // elsewhere, go back to the persisted chat URL before sending.
      if (!options.newChat && session?.chatUrl) {
        const currentUrl = page.url();
        const expectedId = session.chatUrl.split('?')[0].split('/').pop();
        if (expectedId && !currentUrl.includes(expectedId)) {
          log.info(`[sendMessageStream] URL mismatch for ${hashUserId(userId)}: current=${currentUrl}, expected=${session.chatUrl} — navigating to correct chat`);
          await page.goto(session.chatUrl, { waitUntil: 'domcontentloaded', timeout: 0 });
          await page.waitForTimeout(1500);
        }
      }

      if (options.mode) {
        await this.setMode(userId, options.mode, resolvedProvider);
      }
      const actualMode = await this._detectActualMode(page, resolvedProvider) || session?.mode || 'instant';
      log.info(`[v7.0] User ${hashUserId(userId)} streaming message (mode=${actualMode})`);

      // v6.1-fix: Inject text file contents directly into the prompt
      if (options.files && options.files.length > 0) {
        for (const file of options.files) {
          if (file.name && file.name.endsWith('.txt') && file.data && file.data.includes('base64')) {
            try {
              const base64Match = file.data.match(/^data:.*?;base64,(.+)$/);
              if (!base64Match) {
                log.warn(`[sendMessageStream] Data URI does not contain valid base64: ${file.name}`);
                continue;
              }
              const decoded = Buffer.from(base64Match[1], 'base64').toString('utf8');
              const placeholderRegex = /\[(?:Arquivo anexado|Anexo|File attached):\s*[^\]]+\]/i;
              if (placeholderRegex.test(text)) {
                text = text.replace(placeholderRegex, decoded);
                log.info(`[sendMessageStream] Injected ${decoded.length} chars from ${file.name} into prompt`);
              } else {
                text = text + '\n\n---\n' + decoded;
                log.info(`[sendMessageStream] Appended ${decoded.length} chars from ${file.name} to prompt`);
              }
              file._injected = true;
            } catch (e) {
              log.error(`[sendMessageStream] Failed to decode ${file.name}: ${e.message}`);
            }
          }
        }
        options.files = options.files.filter(f => !f._injected);
      }
      const streamProviderCfg = this._loadProviderConfig(resolvedProvider);
      const streamInputChain = resolveChain(streamProviderCfg, 'input', 'textarea, [contenteditable="true"]');
      // waitForChain (15s) replaces the instant count() that raced SPA
      // rendering — the DeepSeek "inputCount=0 on a logged page" bug.
      const { locator: inputLocator, selector: inputSelectorUsed } = await waitForChain(page, streamInputChain, { timeout: 15000 });
      if (!inputLocator) {
        const currentUrl = page.url();
        if (/\/(sign[_-]?in|login|auth)(\/|$|\?|#)/i.test(currentUrl)) {
          throw new Error(`${String(resolvedProvider).toUpperCase()}_LOGIN_REQUIRED: login page detected (${currentUrl}) — faça login no Chrome da Luna e recapture a sessão`);
        }
        throw new Error(`Input field not found on ${providerDisplayName(streamProviderCfg)}`);
      }
      await page.bringToFront();
      // v9.6-fix: Use a real timeout (not 0) so innerText throws when no markdown
      // exists on Kimi's home screen, allowing .catch to return '' instead of
      // hanging forever waiting for an element that never appears.
      // v10.8-fix: use provider selector chains for the new Kimi DOM.
      let initialText = '';
      if (resolvedProvider === 'kimi') {
        const chains = this._resolveDomSelectorChains(resolvedProvider);
        initialText = await page.evaluate((selectors) => {
          function allMatches(root, sels) {
            const seen = new Set();
            const out = [];
            for (const sel of sels) {
              for (const el of root.querySelectorAll(sel)) {
                if (!seen.has(el)) { seen.add(el); out.push(el); }
              }
            }
            return out;
          }
          const mds = allMatches(document, selectors.markdown);
          const last = mds[mds.length - 1];
          return last ? (last.innerText || '').trim() : '';
        }, chains).catch(() => '');
      } else {
        initialText = await page.locator('.markdown-container .markdown').last().innerText({ timeout: 2000 }).catch(() => '');
      }

      // v10.35-fix: For non-Kimi providers, the generic DOM extraction reads the LAST
      // assistant bubble. Capture the current response text via the same polling path
      // so Phase 0 ignores the previous response and only triggers when NEW content
      // arrives. This prevents immediate false-completion on DeepSeek when the prior
      // answer is still visible.
      if (resolvedProvider !== 'kimi') {
        try {
          const prePoll = await this._pollThinkingAndResponse(page, userId);
          if (prePoll && (prePoll.thinking || prePoll.response)) {
            initialText = (prePoll.thinking || '') + (prePoll.response || '');
            log.info(`[sendMessageStream] Non-Kimi pre-send response captured: ${initialText.length} chars`);
          }
        } catch (prePollErr) {
          log.warn(`[sendMessageStream] Failed to capture pre-send poll: ${prePollErr.message}`);
        }
      }

      // v7.7-INFALÍVEL: Capture FULL snapshot before sending (all assistant texts)
      // This replaces fragile assistant counting with snapshot diffing.
      const preSendSnapshot = await this._capturePreSendSnapshot(page, resolvedProvider);
      const preSendAssistantCount = preSendSnapshot.length;
      log.info(`[sendMessageStream] Pre-send snapshot: ${preSendAssistantCount} assistants captured`);

      // v10.18-fix: Focus the editor first. Kimi's Lexical contenteditable on the
      // landing page does not register fill()/Enter events unless it is focused.
      // Playwright's click() can hang on the landing editor, so we use JS focus().
      await inputLocator.evaluate((el) => el.focus());
      await page.waitForTimeout(200);

      // v2.6.8-fix: force the Chrome extension to reset its stream state before we
      // send a new message. This prevents stale thinking/response events from the
      // previous turn from leaking into the current turn and lagging the stream.
      await page.evaluate(() => {
        if (window.__lunaResetObserverState) window.__lunaResetObserverState();
      }).catch((resetErr) => log.warn(`[sendMessageStream] extension reset failed: ${resetErr.message}`));

      // W7-T4: Lexical-safe fill. Playwright's fill() does not register in the
      // React/Lexical contenteditable (text visible in the DOM but EditorState
      // empty → Enter becomes a no-op and the message sits unsent in the box).
      await this._fillContentEditable(inputLocator, text);
      await page.waitForTimeout(500);
      // TRACE: log bridge send started (about to call _submitWithVerification)
      console.log(`[TRACE][BRIDGE_SEND_STARTED] time=${Date.now()} userId=${hashUserId(userId)} textLen=${text.length} provider=${resolvedProvider}`);
      // W7-T4: verify-and-retry submit — typed text must never sit unsent.
      await this._submitWithVerification(page, inputLocator, text, { provider: resolvedProvider });
      // TRACE: log bridge send completed
      console.log(`[TRACE][BRIDGE_SEND_COMPLETED] time=${Date.now()} userId=${hashUserId(userId)}`);
      // Wave2-fix: discard everything the poller observed during send-prep —
      // it describes the PREVIOUS turn's DOM, not this message.
      queue.events.length = 0;
      queue.lastReadIndex = 0;
      if (session) {
        session._completionState = null;
        // W6-T12 review: per-turn reset of the force-complete tracking. The
        // poller runs during send-prep and can observe the PREVIOUS turn's
        // response without ever seeing an empty gap; without this reset
        // _genericFirstSeenAt leaks forward and the cap's 45s runway silently
        // degrades to just the 10s length-stable window on later turns.
        session._genericFirstSeenAt = null;
        session._genericLastLengthChangeAt = null;
        session._genericLastLength = 0;
      }
      // W6-T6: turn-scoped phantom-action detection.
      // (1) Pre-send assistant marker: number of .segment-assistant nodes that
      //     existed BEFORE this message was sent. Reuses the v7.7 pre-send
      //     snapshot count (captured pre-fill/pre-Enter above) — a post-Enter
      //     evaluate would race Kimi's optimistic render of this turn's
      //     placeholder segment and could exclude the whole turn from scanning.
      //     DOM detectors (dom-structure poll, _extractJsonBlocksFromDOM) only
      //     scan segments at index >= marker, so the previous turn's last
      //     assistant segment — still visible in the DOM — cannot be re-emitted
      //     as new actions. .segment-assistant is Kimi-only: other providers
      //     get null = "scan everything" (today's behavior).
      // (2) Cross-turn dom-event dedup reset: a REAL user send starts a new
      //     topic, so tool JSON identical to an earlier conversation must be
      //     allowed again. The soul marks its auto-continue loop sends with
      //     options.isAutoContinue (luna-soul.cjs); every other send clears.
      if (session) {
        session._turnAssistantMarker = resolvedProvider === 'kimi' ? preSendAssistantCount : null;
        if (!options.isAutoContinue) {
          session._domEventSeen = new Map();
        }
      }

      // v2.6.8-fix: Events produced by the extension/content-script pipeline before
      // this turn started can arrive late and overwrite the new turn's stream. We
      // record the turn start time and drop any queued event whose timestamp is
      // older than the start of this turn (with a small tolerance for clock skew).
      const turnStartTime = Date.now();
      // v7.7: Keep assistant detection for logging/compatibility, but extraction
      // will use snapshot diff which doesn't depend on correct index.
      // v10.27-fix: Kimi-specific .segment-assistant detection does not exist on
      // other providers (DeepSeek, etc.). Skip it for non-Kimi providers so the
      // generic polling path can stream the response.
      let newAssistantWaitCount = 0;
      let targetAssistantIndex = -1;
      // W6-T1: register the soft-cancel flag BEFORE the assistant-detection
      // loop so the loop can observe it (previously registered later, at
      // stream-consumer setup).
      let stopConsuming = false;
      this.streamStopFlags.set(userId, () => { stopConsuming = true; });
      // W6-T1: bounded wait — a renamed selector or a silent Enter failure must
      // not hang the stream forever (session.processing would stay true and
      // brick every future message from this user).
      const NEW_ASSISTANT_TIMEOUT_MS = 120_000;
      const newAssistantDeadline = Date.now() + NEW_ASSISTANT_TIMEOUT_MS;
      const assistChains = this._resolveDomSelectorChains(resolvedProvider);
      if (resolvedProvider === 'kimi') {
        while (true) {
          // W6-T1: cancel + deadline checks (this loop was previously
          // unbounded and ignored the cancel flag).
          if (stopConsuming) throw new Error('STREAM_CANCELLED');
          if (Date.now() > newAssistantDeadline) {
            throw new Error('NO_ASSISTANT_DETECTED: selector broke or send failed (no .segment-assistant within 120s)');
          }
          const assistants = await page.evaluate((selectors) => {
            function allMatches(root, sels) {
              const seen = new Set();
              const out = [];
              for (const sel of sels) {
                for (const el of root.querySelectorAll(sel)) {
                  if (!seen.has(el)) { seen.add(el); out.push(el); }
                }
              }
              return out;
            }
            function firstMatch(root, sels) {
              for (const sel of sels) {
                const el = root.querySelector(sel);
                if (el) return el;
              }
              return null;
            }
            const nodes = allMatches(document, selectors.assistant);
            return nodes.map((el, i) => ({
              index: i,
              textLength: el.innerText?.length || 0,
              hasMarkdown: !!firstMatch(el, selectors.markdown),
            }));
          }, assistChains);
          const currentCount = assistants.length;
          if (currentCount > preSendAssistantCount) {
            const newAssistant = assistants[preSendAssistantCount];
            if (newAssistant && (newAssistant.textLength > 0 || newAssistant.hasMarkdown)) {
              targetAssistantIndex = preSendAssistantCount;
              log.info(`[sendMessageStream] New assistant detected (index ${targetAssistantIndex}, textLen=${newAssistant.textLength})`);
              break;
            }
          }
          // W6-T1: bounded wait (NEW_ASSISTANT_TIMEOUT_MS above) — Chrome may
          // lag on large prompts, but a broken selector or failed send now
          // errors out instead of hanging forever.
          // 2026-07-14: throttle poll from 10Hz to 2Hz; the 41s wait in the
          // live test was observed hammering page.evaluate and pinning Chrome.
          if (++newAssistantWaitCount > 20) {
            log.info(`[sendMessageStream] New assistant not detected yet (wait=${newAssistantWaitCount*500}ms), continuing to wait...`);
          }
          await new Promise(r => setTimeout(r, 500));
        }
      } else {
      }

      await page.waitForTimeout(600);

      // v7.0: Stream consumer — reads from event queue, NOT from DOM directly
      let lastThinking = '';
      let lastResponse = '';
      // v13.0 (F1.3): per-turn consensus signals for stream end. A single
      // observational signal is only a CANDIDATE — see the acceptance gate in
      // the completion_candidate case below.
      const turnEndSignalCounts = { button: 0, inactivity: 0, dom_vote: 0, unknown: 0 };
      // v2.6.13-fix: carry the previous turn's final answer across generators so we
      // can ignore DOM leftovers that still show the old response at the start of a
      // new turn. `lastResponse` is local to this generator and starts empty.
      const previousTurnFinalResponse = session?.lastTurnFinalResponse || '';
      const previousTurnFinalThinking = session?.lastTurnFinalThinking || '';
      if (previousTurnFinalResponse) {
        log.info(`[sendMessageStream] previousTurnFinalResponse=${previousTurnFinalResponse.length} chars available for stale guard`);
      }
      // Wave2-fix E: per-source response cursors. Each producer (chrome_extension,
      // dom-structure poll, dom_observer) emits FULL cumulative text from its own
      // extraction; diffing all of them against one shared cursor duplicated or
      // corrupted chunks. The cursor keeps a per-source watermark and swallows
      // cross-source divergent chunks instead of emitting garbage.
      // lastResponse is kept for completion/final-extraction fallbacks.
      const responseCursor = createResponseCursor();
      // v12.3-fix: arm the stale guard IMMEDIATELY. Previously startNewTurn was
      // deferred until the first thinking_update/thinking_start, so a response
      // state_change that arrived before thinking (or without thinking) seeded
      // the cursor with the previous turn's answer and emitted it as the new
      // response. This produced "response N imitates response N-1".
      responseCursor.startNewTurn(previousTurnFinalResponse);
      // v11.8-fix: same per-source cursor for thinking, so deltas are as clean
      // as response deltas and the first thinking chunk is not swallowed by
      // Phase 0 seeding.
      const thinkingCursor = createResponseCursor();
      const divergedSourcesLogged = new Set(); // log.warn once per diverging source
      let lastCanSteer = false;
      let isComplete = false;
      // W6-T1: `stopConsuming` is declared and registered earlier (above the
      // new-assistant detection loop) so that loop can observe cancellation.
      let pollCount = 0;
      let textHasChanged = false;
      // W10-T2: page-level context_limit event from the DomPoller's revived
      // full-page scanner (modal/banner outside the response bubbles).
      let pageContextLimit = null;
      // v2.6.12-fix: reset the response cursor once the new turn's thinking starts.
      // This prevents any stale response text (from the previous turn or from the
      // DomPoller) from seeding the cursor and making the real new response diverge.
      let responseCursorResetForTurn = true;

      // v9.4-fix: JSON Accumulation Buffer state
      let jsonAccumulator = '';
      let isAccumulatingJson = false;
      let jsonAccumulatorLastGrowAt = 0; // v12.0-fix: completion guard — só segura o done enquanto o JSON ainda cresce
      let responseStableLen = -1, responseStableSince = 0; // v12.1: completion grace -- texto crescendo = turno vivo
      let thinkingStableLen = -1, thinkingStableSince = 0; // v12.3: thinking also blocks completion until stable

      // Track emitted actions for deduplication
      const emittedActionCodes = new Set();
      const emittedResponseHashes = new Set();
      const emittedJsonActionHashes = new Set();
      let domActionsCount = 0;
      let delimitedProtocolActionsCount = 0; // v14.0: Track delimited protocol tools
      
      // FASE B: V2 Authority Gate - track when V2 has produced a valid event
      let v2AuthorityActive = false;
      let v2AuthorityType = null; // 'tool' or 'response'

      // W10-T1: json_buffer action yields used to bypass emittedActionCodes
      // entirely, so the SAME tool call re-detected by another source
      // (extension / network intercept / late finalResponse scan) ran TWICE.
      // Route them through the same _dedupKeyForAction dedup as every other
      // action path (see the 'action_detected' case and the late-action scan).
      const buildJsonBufferAction = (tool, params) => {
        const dedupKey = this._dedupKeyForAction({ action: { tool, params } });
        if (emittedActionCodes.has(dedupKey)) return null;
        emittedActionCodes.add(dedupKey);
        domActionsCount++;
        return { type: 'action_detected', action: { tool, params }, source: 'json_buffer' };
      };

      // Phase 0: Wait for first text change via queue events.
      // Wave 11-fix: NO timeout waiting for Kimi. The user explicitly wants Luna
      // to wait indefinitely for the provider to respond. A silent send failure is
      // still surfaced by the heartbeat 'waiting' events.
      while (!textHasChanged && !stopConsuming) {
        while (queue.lastReadIndex < queue.events.length) {
          const ev = queue.events[queue.lastReadIndex++];
          // v12.0-fix: drop stale events from BEFORE this turn started. The
          // extension buffer survives across turns, and without this filter a
          // late state_change from the previous turn seeds lastResponse with
          // the OLD answer — the frontend then shows it as this turn's reply
          // (the "one message behind" bug). Same rule as Phase 1 (:8717).
          if (turnStartTime && ev.timestamp && ev.timestamp < turnStartTime - 500) {
            log.info(`[sendMessageStream] Phase 0: dropping stale ${ev.type} event (age=${turnStartTime - ev.timestamp}ms)`);
            continue;
          }
          // W10-T2: context limit detected by the page-level scanner before
          // any text streamed — skip the Phase 0 wait entirely.
          if (ev.type === 'context_limit') {
            pageContextLimit = ev;
            textHasChanged = true;
            log.warn(`[sendMessageStream] Phase 0: page-level context limit event received`);
            break;
          }
          if (ev.type === 'state_change') {
            const combined = (ev.thinking || '') + (ev.response || '');
            if (combined !== initialText && combined.length > 0) {
              textHasChanged = true;
              lastThinking = ev.thinking || '';
              lastResponse = ev.response || '';
              // Wave2-fix E: seed the cursor with the Phase 0 text (result
              // discarded) so the first Phase 1 delta from the same source
              // doesn't re-emit the seed text.
              responseCursor.next(ev.source || 'phase0', lastResponse);
              // v11.8-fix: seed the thinking cursor too, so the first thinking
              // delta in Phase 1 is a clean diff instead of being swallowed.
              thinkingCursor.next(ev.source || 'phase0', lastThinking);
              break;
            }
            // v10.35-fix: Trigger on generation start immediately, even at pollCount 0.
            // Non-Kimi providers (DeepSeek) may have the previous answer still visible;
            // isGenerating is the most reliable signal that a NEW response is beginning.
            if (ev.isGenerating) {
              textHasChanged = true;
              break;
            }
          }
        }
        if (++pollCount % 5 === 0) {
          yield { type: 'waiting', message: 'Aguardando resposta do Kimi...' };
        }
        await new Promise(r => setTimeout(r, 200));
      }

      // Phase 1: Consume events from queue until completion or cancel.
      // Wave 11-fix: NO safety timeout. Luna waits for Kimi as long as needed.
      // The user can hard-cancel at any time by sending a new message.

      // W10-T2: a page-level context_limit already received in Phase 0
      // short-circuits the whole consumer — the final-extraction tail below
      // still runs and yields the context_limit event upstream.
      if (pageContextLimit) isComplete = true;

      // v7.0: Soft cancel drain tracking
      let softCancelDrainStart = null;
      const SOFT_CANCEL_DRAIN_TIMEOUT = 24 * 60 * 60 * 1000; // 24h — wait forever for drain

      while (!isComplete) {
        // v12.1: track response-text stability for the completion grace below.
        if (lastResponse.length !== responseStableLen) {
          responseStableLen = lastResponse.length;
          responseStableSince = Date.now();
        }
        // v12.3: track thinking stability too -- completion must wait for reasoning.
        if (lastThinking.length !== thinkingStableLen) {
          thinkingStableLen = lastThinking.length;
          thinkingStableSince = Date.now();
        }
        // v7.0: HARD cancel check (from new message) — drain actions then throw
        if (stopConsuming) {
          log.warn(`[sendMessageStream] Hard cancel signaled for user ${hashUserId(userId)} — draining pending actions`);
          while (queue.lastReadIndex < queue.events.length) {
            const ev = queue.events[queue.lastReadIndex++];
            if (ev.type === 'action_detected') {
              // FASE B.1: V2 Authority Gate - block legacy tool if V2 is active
              if (v2AuthorityActive && v2AuthorityType === 'tool' && ev.source !== 'delimited_protocol') {
                log.info(`[V2_AUTHORITY][BLOCKED] time=${Date.now()} source=hard_cancel_drain reason=v2_tool_authority`);
                continue;
              }
              const dedupKey = this._dedupKeyForAction(ev);
              if (!emittedActionCodes.has(dedupKey)) {
                emittedActionCodes.add(dedupKey);
                domActionsCount++;
                yield { type: 'action_detected', action: ev.action, source: ev.source, code: ev.code, kimiResult: ev.kimiResult, kimiImages: ev.kimiImages };
              }
            }
          }
          throw new Error('STREAM_CANCELLED');
        }

        // v7.0 Opção 2: SOFT cancel check (user clicked red button)
        // We stop Kimi generation but keep draining the queue until:
        //   a) No more new events AND Kimi stopped generating, OR
        //   b) Drain timeout reached
        if (session?.softCancelRequested) {
          if (!softCancelDrainStart) {
            softCancelDrainStart = Date.now();
            log.info(`[sendMessageStream] Soft-cancel drain started for user ${hashUserId(userId)}`);
          }
          const hasNewEvents = queue.lastReadIndex < queue.events.length;
          const lastStateEvent = queue.events.slice().reverse().find(e => e.type === 'state_change');
          const kimiStillGenerating = lastStateEvent?.isGenerating ?? true;
          const drainElapsed = Date.now() - softCancelDrainStart;

          if (!hasNewEvents && !kimiStillGenerating) {
            log.info(`[sendMessageStream] Soft-cancel drain complete — no new events and Kimi stopped. Exiting gracefully.`);
            isComplete = true;
            break;
          }
          if (drainElapsed > SOFT_CANCEL_DRAIN_TIMEOUT) {
            log.warn(`[sendMessageStream] Soft-cancel drain timeout (${SOFT_CANCEL_DRAIN_TIMEOUT}ms) — forcing exit`);
            isComplete = true;
            break;
          }
        }

        // Wave 11-fix: no safety-net deadline. Luna waits for Kimi indefinitely.

        // Process all new events in queue
        while (queue.lastReadIndex < queue.events.length && !stopConsuming) {
          const ev = queue.events[queue.lastReadIndex++];

          // v2.6.8-fix: drop events that belong to the previous turn. The extension
          // batches events and some can arrive after we cleared the queue; their
          // timestamps let us identify and discard them before they corrupt the stream.
          if (turnStartTime && ev.timestamp && ev.timestamp < turnStartTime - 500) {
            log.info('[sendMessageStream] dropping stale event from previous turn');
            continue;
          }

          switch (ev.type) {
            case 'state_change': {
              const sanitized = sanitizeStateChange(ev);
              let t = sanitized.thinking || '';
              let r = sanitized.response || '';

              // v2.6.12-fix: the DomPoller starts before the message is sent and can
              // enqueue a state_change containing only the previous turn's response
              // still visible on screen. If we let it through, the response cursor
              // seeds with stale text and the new turn's real response is treated as
              // a continuation/divergence. Drop it when it exactly matches the text
              // that was already on screen before this turn began, or the final
              // answer committed at the end of the previous turn.
              // v12.3: guard now applies even when thinking is present (JSON echo while reasoning).
              if (r && (
                (initialText && r === initialText) ||
                (previousTurnFinalResponse && r === previousTurnFinalResponse)
              )) {
                log.info(`[sendMessageStream] dropping state_change that repeats previous-turn response (${r.length} chars)`);
                continue;
              }

              // v11.8-fix: diff thinking exactly like we diff response.
              // The Kimi page is the source of truth; the cursor emits only the
              // new suffix so the frontend accumulates a perfect mirror.
              if (t) {
                log.info(`[sendMessageStream] thinking_update from state_change: ${t.length} chars (lastThinking=${lastThinking.length})`);
                const preview = t.slice(0, 80).replace(/s+/g, ' ');
                log.info(`[sendMessageStream] thinking_update from state_change: ${t.length} chars preview="${preview}" source=${ev.source || 'state_change'} (lastThinking=${lastThinking.length})`);
                // DEBUG: bypass cursor diff for thinking — emit full update every time
                // const { emit, diverged } = thinkingCursor.next(ev.source, t);
                // if (diverged) { ... }
                // if (emit) { yield { type: 'thinking_delta', text: emit, fullThinking: t }; lastThinking = t; }
                // v2.6.12-fix: reset response cursor when new-turn thinking arrives.
                // Any stale response already seeded (from previous turn / DomPoller)
                // is discarded so the real response is emitted as a fresh delta.
                if (!responseCursorResetForTurn) {
                  responseCursor.startNewTurn(previousTurnFinalResponse);
                  responseCursorResetForTurn = true;
                  log.info('[sendMessageStream] response cursor startNewTurn on state_change (previousResponse=' + previousTurnFinalResponse.length + ' chars)');
                }
                yield { type: 'thinking_update', fullText: t, source: ev.source || 'state_change' };
                lastThinking = t;
              }

              // Yield response deltas
              // Wave2-fix E: diff against the per-source cursor instead of the
              // shared lastResponse — producers with divergent extractions no
              // longer spray duplicated/corrupted chunks.
              if (r && r !== lastResponse) {
                const { emit, diverged, stale } = responseCursor.next(ev.source, r);
                if (stale) {
                  log.info(`[sendMessageStream] dropping stale previous-turn response from source=${ev.source || 'unknown'} (${r.length} chars)`);
                  continue;
                }
                if (diverged) {
                  const srcKey = ev.source || 'unknown';
                  if (!divergedSourcesLogged.has(srcKey)) {
                    divergedSourcesLogged.add(srcKey);
                    log.warn(`[sendMessageStream] Response source '${srcKey}' diverged from committed text — swallowing chunk to avoid duplicated stream`);
                  }
                }
                if (emit) {
                  let delta = emit;
                  // W8-T2c: a JSON wrapper starting mid-delta (prose followed by
                  // {"tool"/{"script"/{"response") used to leak raw JSON into the
                  // chat and lose the tool. Emit the prose prefix as normal text
                  // and let the existing accumulator path buffer the wrapper tail.
                  if (!isAccumulatingJson && !looksLikeJsonStart(delta)) {
                    const wrapperIdx = findMidTextJsonWrapperStart(delta);
                    if (wrapperIdx > 0) {
                      yield { type: 'response_delta', text: delta.slice(0, wrapperIdx) };
                      delta = delta.slice(wrapperIdx);
                    }
                  }
                  // v9.4-fix: JSON Accumulation Buffer
                  // Once accumulating, ALL chunks go to the buffer — never emit as response_delta
                  if (isAccumulatingJson) {
                    jsonAccumulator += delta;
                    // v12.1: escape hatch — if the buffer grew past a wrapper
                    // header without any wrapper key, it was prose starting
                    // with '{' (caught via isTinyJsonFragment). Flush as text.
                    if (jsonAccumulator.length > 40
                        && !/"(tool|response|script|message|mode|success)"\s*:/.test(jsonAccumulator)) {
                      yield { type: 'response_delta', text: jsonAccumulator };
                      isAccumulatingJson = false;
                      jsonAccumulator = '';
                    }
                    jsonAccumulatorLastGrowAt = Date.now(); // v12.0-fix
                    if (isJsonComplete(jsonAccumulator)) {
                      const extracted = extractResponseFromCompleteJson(jsonAccumulator);
                      isAccumulatingJson = false;
                      jsonAccumulator = '';
                      if (extracted) {
                        if (extracted.type === 'response') {
                          yield { type: 'response_delta', text: extracted.text };
                        } else if (extracted.type === 'tool') {
                          const actionEvent = buildJsonBufferAction(extracted.tool, extracted.params);
                          if (actionEvent) yield actionEvent;
                        } else if (extracted.type === 'script') {
                          const actionEvent = buildJsonBufferAction('executeScript', { code: extracted.script, language: extracted.language || 'bash' });
                          if (actionEvent) yield actionEvent;
                        }
                        // v12.3-fix: a complete JSON wrapper NO LONGER ends the stream.
                        // Finishing here truncated Kimi's thinking and accepted echo responses.
                        // Wait for the real completion_candidate (generation stopped + stable).
                      }
                    }
                  }
                  // If chunk looks like start of JSON wrapper, enter accumulation mode
                  else if (looksLikeJsonStart(delta) || isTinyJsonFragment(delta)) {
                    isAccumulatingJson = true;
                    jsonAccumulator = delta;
                    jsonAccumulatorLastGrowAt = Date.now(); // v12.0-fix
                    // If by chance it's already complete (small JSON), process immediately
                    if (isJsonComplete(jsonAccumulator)) {
                      const extracted = extractResponseFromCompleteJson(jsonAccumulator);
                      isAccumulatingJson = false;
                      jsonAccumulator = '';
                      if (extracted) {
                        if (extracted.type === 'response') {
                          yield { type: 'response_delta', text: extracted.text };
                        } else if (extracted.type === 'tool') {
                          const actionEvent = buildJsonBufferAction(extracted.tool, extracted.params);
                          if (actionEvent) yield actionEvent;
                        } else if (extracted.type === 'script') {
                          const actionEvent = buildJsonBufferAction('executeScript', { code: extracted.script, language: extracted.language || 'bash' });
                          if (actionEvent) yield actionEvent;
                        }
                        // v12.3-fix: a complete JSON wrapper NO LONGER ends the stream.
                        // Finishing here truncated Kimi's thinking and accepted echo responses.
                        // Wait for the real completion_candidate (generation stopped + stable).
                      }
                    }
                  }
                  // Plain text — emit normally
                  else {
                    yield { type: 'response_delta', text: delta };
                  }
                } else if (r.length < lastResponse.length) {
                  // DOM shrank — if we were accumulating, discard and reset
                  if (isAccumulatingJson) {
                    isAccumulatingJson = false;
                    jsonAccumulator = '';
                  }
                  const cleanR = extractResponseFromCompleteJson(r);
                  if (cleanR) {
                    if (cleanR.type === 'response') {
                      yield { type: 'response_delta', text: cleanR.text };
                    } else if (cleanR.type === 'tool') {
                      const actionEvent = buildJsonBufferAction(cleanR.tool, cleanR.params);
                      if (actionEvent) yield actionEvent;
                    } else if (cleanR.type === 'script') {
                      const actionEvent = buildJsonBufferAction('executeScript', { code: cleanR.script, language: cleanR.language || 'bash' });
                      if (actionEvent) yield actionEvent;
                    }
                    // v12.3-fix: a complete JSON wrapper NO LONGER ends the stream.
                        // Finishing here truncated Kimi's thinking and accepted echo responses.
                        // Wait for the real completion_candidate (generation stopped + stable).
                  }
                }
                lastResponse = r;
              }

              // Yield steer availability
              if (ev.canSteer !== lastCanSteer) {
                yield { type: 'can_steer', value: ev.canSteer };
                lastCanSteer = ev.canSteer;
              }

              log.info(`[stream] queue poll: thinking=${t.length} response=${r.length} source=${ev.source||'unknown'} canSteer=${ev.canSteer} isGen=${ev.isGenerating}`);
              break;
            }

            case 'action_detected': {
              // FASE B: V2 Authority Gate - skip legacy tool detection if V2 is active
              if (v2AuthorityActive && v2AuthorityType === 'tool' && ev.source !== 'delimited_protocol') {
                log.info(`[V2_AUTHORITY][BLOCKED] time=${Date.now()} reason=legacy_tool_blocked_by_v2 source=${ev.source}`);
                break;
              }
              const dedupKey = this._dedupKeyForAction(ev);
              if (!emittedActionCodes.has(dedupKey)) {
                emittedActionCodes.add(dedupKey);
                domActionsCount++;
                // v14.0: Delimited protocol tools are immediately executable
                // They don't depend on isGenerating or stream_end
                if (ev.source === 'delimited_protocol') {
                  delimitedProtocolActionsCount++;
                  log.info(`[TOOL_PROTOCOL][ACTION_DETECTED] tool=${ev.action?.tool || 'unknown'} toolId=${ev.toolId} source=delimited_protocol count=${delimitedProtocolActionsCount}`);
                  yield {
                    type: 'action_detected',
                    action: ev.action,
                    source: 'delimited_protocol',
                    toolId: ev.toolId,
                    immediate: true, // Flag for immediate execution
                  };
                } else if (ev.source === 'dom_mirror') {
                  log.info(`[DOM MIRROR] Detected ${ev.action?.tool || 'unknown'} block`);
                  yield {
                    type: 'action_detected',
                    action: ev.action,
                    source: ev.source,
                    code: ev.code,
                    kimiResult: ev.kimiResult,
                    kimiImages: ev.kimiImages,
                  };
                } else {
                  log.info(`[JSON STREAM] Action detected: ${ev.action?.tool || 'unknown'}`);
                  yield {
                    type: 'action_detected',
                    action: ev.action,
                    source: ev.source,
                    code: ev.code,
                    kimiResult: ev.kimiResult,
                    kimiImages: ev.kimiImages,
                  };
                }
              }
              break;
            }

            case 'response_detected': {
              const hash = crypto.createHash('sha256').update(ev.response).digest('hex').slice(0, 16);
              if (!emittedResponseHashes.has(hash)) {
                // FASE B: V2 Authority Gate - skip legacy response detection if V2 is active
                if (v2AuthorityActive && v2AuthorityType === 'response' && ev.source !== 'delimited_protocol') {
                  log.info(`[V2_AUTHORITY][BLOCKED] time=${Date.now()} reason=legacy_response_blocked_by_v2 source=${ev.source}`);
                  break;
                }
                emittedResponseHashes.add(hash);
                log.info(`[JSON STREAM] Response detected (${ev.response.length} chars)`);
                // v2.6.13-fix: keep lastResponse in sync with the full answer we just
                // committed, otherwise the final 'done' event may yield a stale response.
                if (ev.response && ev.response.length > lastResponse.length) {
                  lastResponse = ev.response;
                }
                yield { type: 'response_detected', response: ev.response, source: ev.source };
              }
              break;
            }

            // v11.2-fix: chrome_extension can emit an explicit thinking_start —
            // forward it so the frontend creates the bubble immediately.
            case 'thinking_start': {
              if (!responseCursorResetForTurn) {
                responseCursor.startNewTurn(previousTurnFinalResponse);
                responseCursorResetForTurn = true;
                log.info('[sendMessageStream] response cursor startNewTurn on thinking_start (previousResponse=' + previousTurnFinalResponse.length + ' chars)');
              }
              yield { type: 'thinking_start', source: ev.source || 'chrome_extension' };
              break;
            }

            // v11.8-fix: source-of-truth full thinking replacement from the
            // Chrome extension. Pass through as-is so the frontend replaces the
            // entire bubble content with Kimi's current reasoning.
            case 'thinking_update': {
              const fullText = ev.fullText || '';
              log.info(`[sendMessageStream] thinking_update from chrome_extension: ${fullText.length} chars`);
              if (fullText) {
                if (!responseCursorResetForTurn) {
                  responseCursor.startNewTurn(previousTurnFinalResponse);
                  responseCursorResetForTurn = true;
                  log.info('[sendMessageStream] response cursor startNewTurn on thinking_update (previousResponse=' + previousTurnFinalResponse.length + ' chars)');
                }
                lastThinking = fullText;
                yield { type: 'thinking_update', fullText, source: ev.source || 'chrome_extension' };
              }
              break;
            }

            // v8.5-fix: Direct thinking/response deltas from ultra-light observer
            case 'thinking_delta': {
              const t = ev.fullThinking || ev.text || '';
              if (t && t !== lastThinking) {
                const delta = t.slice(lastThinking.length);
                if (delta) {
                  yield { type: 'thinking_delta', text: delta, fullThinking: t };
                }
                lastThinking = t;
              }
              break;
            }
            case 'response_delta': {
              const r = ev.fullResponse || ev.text || '';
              if (r && r !== lastResponse) {
                // v12.3: discard leaked prompt text before it reaches the cursor.
                if (isSystemPromptLeak(r)) {
                  log.info(`[sendMessageStream] dropping response_delta system-prompt leak (${r.length} chars)`);
                  continue;
                }
                // Wave2-fix E: same per-source cursor as the state_change case.
                const { emit, diverged } = responseCursor.next(ev.source, r);
                if (diverged) {
                  const srcKey = ev.source || 'unknown';
                  if (!divergedSourcesLogged.has(srcKey)) {
                    divergedSourcesLogged.add(srcKey);
                    log.warn(`[sendMessageStream] Response source '${srcKey}' diverged from committed text — swallowing chunk to avoid duplicated stream`);
                  }
                  // v2.6.13-fix: do NOT let a discarded divergent response corrupt
                  // lastResponse, otherwise the final 'done' may yield stale text.
                  continue;
                }
                if (emit) {
                  yield { type: 'response_delta', text: emit };
                }
                lastResponse = r;
              }
              break;
            }

            case 'context_limit': {
              // W10-T2: page-level scanner detected Kimi's context-limit
              // notice as a modal/banner outside the response bubbles.
              // End the turn — the final check below yields context_limit
              // instead of done, feeding the soul's auto-compact path.
              log.warn(`[sendMessageStream] Page-level context limit event received (source=${ev.source})`);
              pageContextLimit = ev;
              isComplete = true;
              break;
            }

            case 'completion_candidate': {
              // v12.1: completion grace — if the response text changed in the
              // last 3s the model is still rendering (long tables/JSON pause
              // the DOM and trip the extension's 3s inactivity stream_end).
              // Defer: the DOM poller re-fires completion once stable. Seen
              // live: a long report was cut mid-stream and the done carried
              // the PREVIOUS turn's text.
              if (responseStableSince && Date.now() - responseStableSince < 3000 && !(isAccumulatingJson && Date.now() - jsonAccumulatorLastGrowAt >= 5000)) {
                log.info(`[sendMessageStream] completion deferred — response grew ${Date.now() - responseStableSince}ms ago (len=${lastResponse.length})`);
                break;
              }
              // v12.3: same grace for THINKING — never complete while reasoning is
              // still growing. The DOM poller often reports response=0 and no-generating
              // while Kimi is mid-thought, causing done to fire and truncate thinking.
              if (thinkingStableSince && Date.now() - thinkingStableSince < 3000) {
                log.info(`[sendMessageStream] completion deferred — thinking grew ${Date.now() - thinkingStableSince}ms ago (len=${lastThinking.length})`);
                break;
              }
              // Wave2-fix: right after Enter the PREVIOUS turn's response is still
              // on screen and stable, so the poller can re-fire a stale candidate
              // before any text of this turn has streamed. Ignore it.
              // Assumption: every legit turn streams SOME visible text before
              // completing (tool calls render as code blocks in the polled text).
              // A hypothetical zero-text turn (text-less tool card only) would be
              // ignored until hard-cancel — fails safe vs. the old instant-done
              // with stale content.
              if (isPrematureCompletion({ lastResponse, lastThinking })) {
                log.info(`[sendMessageStream] Ignoring completion candidate — nothing streamed yet this turn (stale)`);
                break;
              }
              log.info(`[sendMessageStream] Completion candidate received (signals=${JSON.stringify(ev.signals)})`);
              // v10.35-fix: For non-Kimi providers, a completion candidate can fire during a
              // transient pause while a long JSON wrapper (e.g., writeFile with HTML content) is
              // still being streamed. If the accumulated response looks like an incomplete JSON
              // object, ignore the candidate and keep waiting for the rest.
              const looksLikeIncompleteJson = lastResponse && lastResponse.includes('{') && !isJsonComplete(lastResponse);
              if ((resolvedProvider !== 'kimi' && looksLikeIncompleteJson) || (isAccumulatingJson && Date.now() - jsonAccumulatorLastGrowAt < 5000)) {
                log.warn(`[sendMessageStream] Ignoring completion candidate — response looks like incomplete JSON (${lastResponse.length} chars)`);
                break;
              }
              // v12.4-fix: never declare completion while the DOM still shows active
              // thinking/loading indicators. The Stop button can disappear transiently
              // during long reasoning, so button-based completion is not enough.
              // v14.0: Delimited protocol tools can complete even with loading indicators
              // because the tool completion is determined by the protocol, not visual state.
              const stillLoading = await this._hasActiveLoadingIndicators(page);
              if (stillLoading && delimitedProtocolActionsCount === 0) {
                log.info(`[sendMessageStream] Ignoring completion candidate — active loading/thinking indicators still visible`);
                break;
              } else if (stillLoading && delimitedProtocolActionsCount > 0) {
                log.info(`[sendMessageStream] Allowing completion despite loading indicators — ${delimitedProtocolActionsCount} tool(s) executed via delimited protocol`);
              }
              // v13.0 (F1.3): consensus-based acceptance. A lone observational
              // signal (one button flicker, one inactivity timeout) is only a
              // CANDIDATE. Completion requires the network source-of-truth
              // (this turn's chat HTTP body fully arrived — F1.1 generation),
              // or ≥2 independent observational signals, or the DOM poller's
              // composite vote sustained across ≥2 emissions.
              const networkDone = !!(interceptor && interceptor.completedGeneration === interceptor._generation);
              const sig = turnEndSignalCounts[ev.signal] !== undefined ? ev.signal : 'unknown';
              turnEndSignalCounts[sig]++;
              const distinctSignals = ['button', 'inactivity', 'dom_vote'].filter(s => turnEndSignalCounts[s] > 0);
              const consensusReached = networkDone
                || distinctSignals.length >= 2
                || turnEndSignalCounts.dom_vote >= 2;
              if (!consensusReached) {
                log.info(`[sendMessageStream] completion deferred — no consensus yet (network=${networkDone}, signals=${JSON.stringify(turnEndSignalCounts)})`);
                break;
              }
              log.info(`[sendMessageStream] completion CONSENSUS (network=${networkDone}, signals=${JSON.stringify(turnEndSignalCounts)})`);
              isComplete = true;
              break;
            }
          }
        }

        if (isComplete) break;

        // Heartbeat
        if (++pollCount % 10 === 0) {
          yield { type: 'waiting', message: 'Processando...' };
        }

        await new Promise(r => setTimeout(r, 100));
      }

      // v13.0 (F1.4): strict turn close — the old post-completion drain is gone.
      // It processed response_delta/thinking_update after stream_end with no
      // timestamp/cursor/guard (stale text appended at turn end) and contained a
      // ReferenceError (`sessionId` is not defined here) that killed the
      // generator before persistence whenever a response_detected was queued.
      // After consensus, the turn's TEXT is immutable. The only events still
      // honored are action_detected, because the extension emits its final
      // tool_call scan at stream_end (F1.5'). Anything else is dropped.
      const toolDrainStart = Date.now();
      while (queue.lastReadIndex < queue.events.length && Date.now() - toolDrainStart < 2000) {
        while (queue.lastReadIndex < queue.events.length) {
          const ev = queue.events[queue.lastReadIndex++];
          if (ev.type === 'action_detected') {
            // FASE B.1: V2 Authority Gate - block legacy tool if V2 is active
            if (v2AuthorityActive && v2AuthorityType === 'tool' && ev.source !== 'delimited_protocol') {
              log.info(`[V2_AUTHORITY][BLOCKED] time=${Date.now()} source=post_close_drain reason=v2_tool_authority`);
              continue;
            }
            const dedupKey = this._dedupKeyForAction(ev);
            if (!emittedActionCodes.has(dedupKey)) {
              emittedActionCodes.add(dedupKey);
              domActionsCount++;
              yield { type: 'action_detected', action: ev.action, source: ev.source, code: ev.code, kimiResult: ev.kimiResult, kimiImages: ev.kimiImages };
            }
          } else if (ev.type === 'response_delta' || ev.type === 'thinking_update' || ev.type === 'response_detected' || ev.type === 'state_change') {
            log.debug(`[sendMessageStream] post-close ${ev.type} discarded (turn text is immutable)`);
          }
        }
        if (queue.lastReadIndex < queue.events.length) continue;
        await new Promise(r => setTimeout(r, 100));
      }

            // v12.0-fix: orphaned JSON accumulator flush. If the stream ended with an
      // incomplete JSON wrapper (truncated tool/response), the accumulator was
      // silently discarded — the tool never executed and the loop fell asleep.
      // Try tolerant extraction; if that fails, surface the raw text as a
      // response so the turn NEVER ends in silence.
      if (isAccumulatingJson && jsonAccumulator && jsonAccumulator.trim()) {
        log.warn(`[sendMessageStream] Flushing orphaned JSON accumulator (${jsonAccumulator.length} chars) at end of stream`);
        const orphanExtracted = extractResponseFromCompleteJson(jsonAccumulator);
        if (orphanExtracted) {
          if (orphanExtracted.type === 'response') {
            yield { type: 'response_delta', text: orphanExtracted.text };
          } else if (orphanExtracted.type === 'tool') {
            const orphanAction = buildJsonBufferAction(orphanExtracted.tool, orphanExtracted.params);
            if (orphanAction) yield orphanAction;
          } else if (orphanExtracted.type === 'script') {
            const orphanAction = buildJsonBufferAction('executeScript', { code: orphanExtracted.script, language: orphanExtracted.language || 'bash' });
            if (orphanAction) yield orphanAction;
          }
        } else {
          yield { type: 'response_delta', text: jsonAccumulator };
        }
        isAccumulatingJson = false;
        jsonAccumulator = '';
      }

// v7.7-INFALÍVEL: Final extraction using snapshot diff (PRIMARY strategy)
      // This captures ALL new content since preSendSnapshot, regardless of how
      // many assistants were created or how the DOM structure changed.

      // v11.9-fix: Final source-of-truth thinking extraction from the Kimi DOM.
      // During streaming we emit whatever the poller/extension sees; once the turn
      // is complete we replace it with the final rendered thinking text so the
      // Luna bubble matches Kimi exactly and never stays truncated.
      try {
        const finalThinking = await this._extractFinalThinking(page, resolvedProvider);
        if (finalThinking && finalThinking.length >= lastThinking.length && finalThinking !== lastThinking) {
          log.info(`[sendMessageStream] Final thinking extraction: ${finalThinking.length} chars (was ${lastThinking.length})`);
          lastThinking = finalThinking;
          yield { type: 'thinking_update', fullText: lastThinking, source: 'final_extraction' };
        }
      } catch (thinkingErr) {
        log.warn(`[sendMessageStream] Final thinking extraction failed: ${thinkingErr.message}`);
      }

      let finalResponse = '';
      let extractionSource = 'none';

      // v13.0 (F1.2): the stream cursor is the PRIMARY source of truth for the
      // final text — it holds exactly what was emitted to the frontend during
      // this turn. DOM re-reads (snapshot-diff / _extractResponse) and the
      // network interceptor are FALLBACKS only: they are the stale-text
      // vectors (snapshot-diff can return the previous bubble's grown tail).
      const committedText = (responseCursor.committed || '').trim();
      if (committedText) {
        finalResponse = committedText;
        extractionSource = 'cursor-committed';
        log.info(`[sendMessageStream] final response from cursor.committed: ${finalResponse.length} chars`);
      }

      if (!finalResponse) try {
        const extracted = await this._extractResponseDiff(page, preSendSnapshot, resolvedProvider);
        if (extracted && extracted.trim().length > 0) {
          finalResponse = extracted.trim();
          extractionSource = 'snapshot-diff';
          log.info(`[sendMessageStream] _extractResponseDiff success: ${finalResponse.length} chars`);
        }
      } catch (e) {
        log.warn(`[sendMessageStream] _extractResponseDiff failed: ${e.message}`);
      }

      // Fallback: if snapshot diff returned nothing or failed, try old strategies
      if (!finalResponse) {
        try {
          const extractOptions = targetAssistantIndex >= 0 ? { preferAssistantIndex: targetAssistantIndex, userId } : { userId };
          const extracted = await this._extractResponse(page, extractOptions);
          if (extracted && extracted.trim().length > 0) {
            finalResponse = extracted.trim();
            extractionSource = 'target-assistant';
            log.info(`[sendMessageStream] _extractResponse fallback success: ${finalResponse.length} chars (assistant ${targetAssistantIndex})`);
          }
        } catch (e) {
          log.warn(`_extractResponse fallback failed: ${e.message}`);
        }
      }

      // Smart fallback: if extracted thinking-like but lastResponse has JSON/code
      const hasJsonOrCode = (text) => text && (text.includes('"tool"') || text.includes('"response"') || text.includes('```'));
      const looksLikeThinking = (text) => text && text.length < 100 && !text.includes('{') && !text.includes('```');

      if (finalResponse && lastResponse && hasJsonOrCode(lastResponse) && looksLikeThinking(finalResponse)) {
        log.warn(`[sendMessageStream] Extracted thinking-like text (${finalResponse.length} chars) but lastResponse has JSON/code (${lastResponse.length} chars). Using lastResponse.`);
        finalResponse = lastResponse;
        extractionSource = 'lastResponse-swap';
      }

      // v10.35-fix: For non-Kimi providers, the DOM-based final extraction often returns a
      // truncated version of a long JSON tool/response, while the streaming poller already
      // saw the complete text. If lastResponse is longer and contains a valid JSON wrapper
      // or tool, prefer it so large HTML games / file writes are not cut off.
      if (lastResponse && lastResponse.length > (finalResponse?.length || 0) && hasJsonOrCode(lastResponse)) {
        try {
          const maybeJson = lastResponse.trim();
          // Accept either a JSON wrapper {"response":"..."} / {"message":"..."} or a tool JSON.
          const isValidWrapper = maybeJson.startsWith('{') && JSON.parse(maybeJson) && (maybeJson.includes('"response"') || maybeJson.includes('"message"') || maybeJson.includes('"tool"'));
          if (isValidWrapper) {
            log.warn(`[sendMessageStream] lastResponse (${lastResponse.length} chars) is longer than extracted (${finalResponse.length} chars) and contains valid JSON. Using lastResponse.`);
            finalResponse = lastResponse;
            extractionSource = 'lastResponse-longer-json';
          }
        } catch {
          // lastResponse is not parseable JSON — keep the extracted finalResponse.
        }
      }

      // v12.1: ANTI-STALE guard — never finish with the PREVIOUS turn's text.
      // If the extracted final equals what was already on screen before this
      // turn (initialText) but the stream saw different content, the extraction
      // grabbed the wrong (previous) segment — trust the stream instead. Seen
      // live: a long report was replaced by the previous turn's "Tudo certo!".
      const _normStale = (s) => (s || '').replace(/\s+/g, ' ').trim();
      if (finalResponse && initialText
          && _normStale(finalResponse) === _normStale(initialText)
          && lastResponse && _normStale(lastResponse) !== _normStale(initialText)) {
        log.warn(`[sendMessageStream] anti-stale: extraction returned the pre-turn text — using streamed lastResponse (${lastResponse.length} chars)`);
        finalResponse = lastResponse;
        extractionSource = 'anti-stale-stream';
      }

      // v12.2: HARD anti-stale — initialText must NEVER be delivered as this
      // turn's response, even when the stream saw nothing (tool-only turns
      // have lastResponse empty). Before this, a tool-only turn re-delivered
      // the previous turn's message to the Luna Web frontend. Blank it and
      // let the final-poll loop below hunt for the real content.
      if (finalResponse && initialText && _normStale(finalResponse) === _normStale(initialText)) {
        log.warn(`[sendMessageStream] anti-stale-hard: extracted response equals pre-turn text and stream saw nothing new — blanking instead of repeating previous message`);
        finalResponse = '';
        extractionSource = 'anti-stale-blank';
      }

      // CRITICAL fallback: only use lastResponse if we actually saw it change during this stream
      if (!finalResponse) {
        const sawResponseDuringStream = lastResponse && lastResponse.length > 0 && lastResponse !== initialText;
        if (sawResponseDuringStream) {
          finalResponse = lastResponse;
          extractionSource = 'lastResponse-fallback';
          log.info(`[sendMessageStream] Using lastResponse as fallback: ${finalResponse.length} chars`);
        } else if (lastThinking && lastThinking.length > 10) {
          // v2.6.7-fix: NEVER use thinking as the chat response. The thinking bubble already
          // shows the reasoning; the response must come from the real response JSON/code block.
          log.warn(`[sendMessageStream] finalResponse empty and no lastResponse seen — leaving response blank (lastThinking=${lastThinking.length})`);
        }
      }

      // v2.6.7-fix: final DOM extraction fallback. The streaming cursor can be left with
      // a placeholder like "..." if the last state_change was stale/short. Re-read the DOM
      // up to 10 times after generation ends, waiting for the real response to land.
      // Use _pollThinkingAndResponse because the live poller sees the rendered response
      // while _extractResponse snapshot may still see a stale JSON placeholder.
      const parsedBeforeExtract = this._extractParsedText(finalResponse);
      let needsFinalExtract = !finalResponse || finalResponse.trim() === '...' || finalResponse.length < 10;
      log.info(`[sendMessageStream] final-extract START initial=${JSON.stringify({ len: finalResponse?.length || 0, source: extractionSource, parsedLen: parsedBeforeExtract?.length || 0, needsFinalExtract })}`);
      if (parsedBeforeExtract && parsedBeforeExtract !== finalResponse) {
        if (parsedBeforeExtract.trim() === '...' || parsedBeforeExtract.length < 10) {
          needsFinalExtract = true;
          log.info(`[sendMessageStream] parsedBeforeExtract still placeholder/short, keep final-extract`);
        } else if (previousTurnFinalResponse && _normStale(parsedBeforeExtract) === _normStale(previousTurnFinalResponse)) {
          log.warn(`[sendMessageStream] parsedBeforeExtract is previous turn's answer -- ignoring`);
          needsFinalExtract = true;
        } else {
          log.info(`[sendMessageStream] using parsedBeforeExtract: ${finalResponse?.length || 0} -> ${parsedBeforeExtract.length} chars`);
          finalResponse = parsedBeforeExtract;
        }
      }
      if (needsFinalExtract) {
        for (let finalAttempt = 0; finalAttempt < 10; finalAttempt++) {
          await new Promise(r => setTimeout(r, 1000));
          let candidate = '';
          let candidateSource = 'none';
          try {
            const poll = await this._pollThinkingAndResponse(page, userId);
            if (poll) {
              candidate = poll.response || '';
              candidateSource = poll.source || 'poll';
              log.info(`[sendMessageStream] final-poll attempt ${finalAttempt + 1}: poll source=${candidateSource} candidate=${candidate.length} thinking=${poll.thinking?.length || 0} isGen=${poll.isGenerating} preview=${JSON.stringify(candidate.slice(0, 120))}`);
            } else {
              log.warn(`[sendMessageStream] final-poll attempt ${finalAttempt + 1}: _pollThinkingAndResponse returned null`);
            }
          } catch (pollErr) {
            log.warn(`[sendMessageStream] final-poll attempt ${finalAttempt + 1}: _pollThinkingAndResponse error: ${pollErr.message}`);
          }

          // Also try snapshot-diff extraction inside the loop, in case the DOM is ahead of the poller.
          try {
            const diffExtract = await this._extractResponseDiff(page, preSendSnapshot, resolvedProvider);
            if (diffExtract && diffExtract.trim().length > candidate.length) {
              log.info(`[sendMessageStream] final-poll attempt ${finalAttempt + 1}: snapshot-diff bigger than poll (${candidate.length} -> ${diffExtract.trim().length})`);
              candidate = diffExtract.trim();
              candidateSource = 'snapshot-diff';
            } else if (diffExtract && diffExtract.trim()) {
              log.info(`[sendMessageStream] final-poll attempt ${finalAttempt + 1}: snapshot-diff=${diffExtract.trim().length} poll=${candidate.length}`);
            }
          } catch (diffErr) {
            log.warn(`[sendMessageStream] final-poll attempt ${finalAttempt + 1}: _extractResponseDiff error: ${diffErr.message}`);
          }

          if (candidate) {
            // v12.5-fix: if the final-poll candidate is a raw tool/script JSON,
            // process it as an action instead of treating it as chat response.
            const toolActions = this._extractJsonToolCalls(candidate);
            if (toolActions.length > 0) {
              for (const action of toolActions) {
                const actionEvent = buildJsonBufferAction(action.tool, action.params);
                if (actionEvent) {
                  log.info(`[sendMessageStream] final-poll attempt ${finalAttempt + 1}: processing candidate as tool action ${action.tool}`);
                  yield actionEvent;
                }
              }
              // Do not adopt the JSON as finalResponse — it is a tool call, not chat text.
              continue;
            }

            const parsedCandidate = this._extractParsedText(candidate);
            const isPlaceholder = (t) => !t || t.trim() === '...' || t.trim().length < 3;
            if (parsedCandidate && parsedCandidate !== candidate && !isPlaceholder(parsedCandidate)) {
              log.info(`[sendMessageStream] final-poll attempt ${finalAttempt + 1}: using parsed candidate ${candidate.length} -> ${parsedCandidate.length}`);
              candidate = parsedCandidate;
            }
            if (!isPlaceholder(candidate)) {
              // v12.3: reject final-poll candidates that are just the previous answer echo.
              if (previousTurnFinalResponse && _normStale(candidate) === _normStale(previousTurnFinalResponse)) {
                log.info(`[sendMessageStream] final-poll attempt ${finalAttempt + 1}: candidate equals previous turn's answer, ignored`);
                continue;
              }
              // v12.2: the DOM may still show the PREVIOUS turn's bubble while
              // this turn rendered only a tool call — never adopt it.
              if (initialText && _normStale(candidate) === _normStale(initialText)) {
                log.info(`[sendMessageStream] final-poll attempt ${finalAttempt + 1}: candidate equals pre-turn text (stale), ignored`);
                continue;
              }
              if (candidate.length > (finalResponse?.length || 0)) {
                log.info(`[sendMessageStream] final-poll attempt ${finalAttempt + 1}: UPDATE response ${finalResponse?.length || 0} -> ${candidate.length} chars (source=${candidateSource})`);
                finalResponse = candidate;
                extractionSource = `final-poll:${candidateSource}`;
              } else {
                log.info(`[sendMessageStream] final-poll attempt ${finalAttempt + 1}: candidate ${candidate.length} not longer than finalResponse ${finalResponse?.length || 0}`);
              }
            } else {
              log.info(`[sendMessageStream] final-poll attempt ${finalAttempt + 1}: candidate is placeholder/short, ignored`);
            }
          } else {
            log.info(`[sendMessageStream] final-poll attempt ${finalAttempt + 1}: no candidate`);
          }

          if (finalResponse && finalResponse.trim() !== '...' && finalResponse.length > 80) {
            log.info(`[sendMessageStream] final-poll: response looks complete (${finalResponse.length} chars), breaking early`);
            break;
          }
        }
        log.info(`[sendMessageStream] final-extract END finalResponse=${finalResponse?.length || 0} source=${extractionSource}`);
      } else {
        log.info(`[sendMessageStream] final-extract skipped, finalResponse already good (${finalResponse?.length || 0} chars)`);
      }

      const parsedText = this._extractParsedText(finalResponse);
      if (parsedText && parsedText !== finalResponse) {
        log.info(`[sendMessageStream] Parsed JSON response: ${finalResponse.length} -> ${parsedText.length} chars`);
        finalResponse = parsedText;
      }
      // v12.3: if the final text (parsed or raw) is exactly the previous turn's
      // answer, the extraction grabbed an echo. Blank it so the soul knows there
      // was no real response text for this turn (the tool/JSON path still works).
      if (finalResponse && previousTurnFinalResponse && _normStale(finalResponse) === _normStale(previousTurnFinalResponse)) {
        log.warn(`[sendMessageStream] anti-stale-prev: final response equals previous turn's answer -- blanking`);
        finalResponse = '';
      }

      // v7.5-fix: Robust late action detection using _extractJsonToolCalls instead of regex.
      // This catches JSON tool calls anywhere in the text, including inside code blocks.
      const lateActions = this._extractJsonToolCalls(finalResponse);
      for (const action of lateActions) {
        const actionHash = this._dedupKeyForAction({ action: { tool: action.tool, params: action.params } });
        if (!emittedActionCodes.has(actionHash)) {
          emittedActionCodes.add(actionHash);
          domActionsCount++;
          log.info(`[JSON STREAM] Late action detected in finalResponse: ${action.tool}`);
          yield {
            type: 'action_detected',
            action: { tool: action.tool, params: action.params },
            source: 'json_block',
          };
        }
      }

      // W10-T2: the page-level scanner's context_limit event (modal/banner
      // outside the bubbles) takes precedence over the text-based check.
      const isContextLimit = !!pageContextLimit || this._isContextLimitResponse(finalResponse);
      // v2.6.13-fix: persist the final answer of this turn so the next turn can
      // distinguish stale DOM leftovers from the real new response.
      if (session) {
        session.lastTurnFinalResponse = finalResponse || '';
        session.lastTurnFinalThinking = lastThinking || '';
        log.info(`[sendMessageStream] persisted lastTurnFinalResponse=${session.lastTurnFinalResponse.length} chars`);
      }
      // v12.2: last-line defense — after all parsing, the pre-turn text must
      // never ship as this turn's response.
      if (finalResponse && initialText && _normStale(finalResponse) === _normStale(initialText)) {
        log.warn(`[sendMessageStream] anti-stale-final: response still equals pre-turn text — delivering blank`);
        finalResponse = '';
      }
      // v13.0: persist the thread URL from the STREAMING path. After the first
      // send, Kimi turns the landing URL into /chat/<id>; only the non-streaming
      // (Telegram) and compaction paths captured it. With nothing persisted,
      // any Chrome/server/page loss made the next message open a NEW chat
      // instead of continuing this thread.
      try {
        const currentThreadUrl = page.url();
        if (session && currentThreadUrl && currentThreadUrl.includes('/chat/') && session.chatUrl !== currentThreadUrl) {
          session.chatUrl = currentThreadUrl;
          this._saveChatUrl(userId, currentThreadUrl, { mode: session.mode, provider: resolvedProvider });
          log.info(`[sendMessageStream] persisted thread URL: ${currentThreadUrl}`);
        }
      } catch {}
      if (isContextLimit) {
        log.warn(`[sendMessageStream] Context limit detected${pageContextLimit ? ' (page-level scanner)' : ''}`);
        yield { type: 'context_limit', response: pageContextLimit?.response || finalResponse, thinking: lastThinking };
      } else {
        yield { type: 'done', response: finalResponse, thinking: lastThinking };
      }
    } catch (err) {
      if (err.message === 'STREAM_CANCELLED') {
        log.info(`[sendMessageStream] Stream cancelled gracefully for user ${hashUserId(userId)}`);
      } else {
        log.error(`[sendMessageStream] Error for user ${hashUserId(userId)} (provider=${resolvedProvider}): ${err.message}`);
        log.error(`[sendMessageStream] Stack: ${err.stack}`);
        // W7-T4: Lexical-safe clear (fill('') leaves desynced text in the box).
        try { await this._fillContentEditable(page.locator('textarea, [contenteditable="true"]').first(), ''); } catch {}
        throw err;
      }
    } finally {
      // Wave2-fix: the DOM poller is now bounded to the active stream.
      // Previously (v7.0) it kept running between turns and fed stale events
      // (old-turn completion_candidate / state_change) into the next message.
      // It is restarted per message at :7249 — _startDomPoller early-returns
      // only while active, so it restarts cleanly after this stop.
      try {
        await this._stopDomPoller(userId);
      } catch (e) {
        log.warn(`[sendMessageStream] _stopDomPoller failed: ${e.message}`);
      }
      if (session) {
        session.processing = false;
        session.softCancelRequested = false; // v7.0: clear soft cancel flag
        session.lastActivity = Date.now();
      }
      this.cancelledStreams.delete(userId);
      this.streamStopFlags.delete(userId);
    }
  }

  /**
   * v7.0: Helper para gerar chave de deduplicação de ação.
   * v10.24-fix: Use tool + normalized params as the single source of truth,
   * independentemente da fonte (extension, network interceptor, DOM observer,
   * snapshot diff). A mesma ação detectada por camadas diferentes deve gerar
   * a MESMA chave, impedindo execução duplicada.
   */
  _dedupKeyForAction(ev) {
    const tool = ev.action?.tool || ev.action?.type || '';
    const params = this._normalizeActionParams(ev.action?.params || {});
    const paramsJson = JSON.stringify(params);
    return crypto.createHash('sha256').update(`${tool}:${paramsJson}`).digest('hex').slice(0, 16);
  }

  /**
   * Normaliza params para deduplicação: ordena chaves de objetos e ignora
   * diferenças irrelevantes (espaços, ordem de chaves).
   */
  _normalizeActionParams(params) {
    if (params === null || typeof params !== 'object') return params;
    if (Array.isArray(params)) {
      return params.map(p => this._normalizeActionParams(p));
    }
    const sorted = {};
    for (const key of Object.keys(params).sort()) {
      sorted[key] = this._normalizeActionParams(params[key]);
    }
    return sorted;
  }

  /**
   * Cancel an active stream for a user.
   * v5.3-fix: Sets cancel flag, clicks stop button on Kimi Web, and forces processing reset.
   * This is the REAL cancellation — unlike the old server-side-only cancel.
   */
  async cancelStream(userId, soft = false) {
    log.info(`[cancelStream] v7.0 ${soft ? 'soft' : 'hard'}-cancel for user ${hashUserId(userId)}`);

    const session = this.userSessions.get(userId);

    if (soft) {
      // v7.0 Opção 2 — STOP KIMI + DRAIN:
      // User clicked red button. We STOP Kimi from generating more text,
      // but let the stream continue to drain any pending tools from the queue.
      // Input is freed immediately so user can type the next message.
      log.info(`[cancelStream] Soft-cancel (stop+drain) for user ${hashUserId(userId)}`);

      // 1. Click stop button on Kimi Web — stop generating more tokens
      await this.abortGeneration(userId);

      // 2. Set flag so sendMessageStream knows to drain and exit gracefully
      if (session) {
        session.softCancelRequested = true;
        session.processing = false; // free input
        session.lastActivity = Date.now();
        log.info(`[cancelStream] Soft-cancel: Kimi stopped, input freed for user ${hashUserId(userId)}, stream will drain pending tools`);
      }

      // 3. Do NOT call stopFn — the stream stays alive to drain the queue
      return true;
    }

    // HARD CANCEL (new message sent, or explicit kill):
    // Stop Kimi generation AND kill the stream.

    // 1. Click stop button on Kimi Web to halt generation
    await this.abortGeneration(userId);

    // 2. Signal the stream to stop consuming NEW events.
    const stopFn = this.streamStopFlags.get(userId);
    if (stopFn) {
      stopFn();
      log.info(`[cancelStream] Hard-cancel signal sent to stream for user ${hashUserId(userId)}`);
    } else {
      // Fallback: if no stream is actively listening, set legacy cancel flag
      this.cancelledStreams.set(userId, true);
    }

    // 3. Tell poller to skip non-critical events so queue drains faster
    if (session) {
      session.domPollerSkipNonCritical = true;
      session.lastActivity = Date.now();
      
      // Wait for stream to drain (max 3s)
      const drainStart = Date.now();
      while (session.processing && Date.now() - drainStart < 3000) {
        await new Promise(r => setTimeout(r, 200));
      }
      if (session.processing) {
        log.warn(`[cancelStream] Stream did not drain in 3s — forcing processing=false`);
        session.processing = false;
      }
      
      // Reset skip flag after drain
      session.domPollerSkipNonCritical = false;
    }

    this.cancelledStreams.delete(userId);
    return true;
  }

  /**
   * Abort current generation by clicking the stop button on Kimi Web.
   * Called when user presses Ctrl+C during processing.
   */
  async abortGeneration(userId) {
    const session = this.userSessions.get(userId);
    if (!session || !session.page || session.page.isClosed()) return false;
    const page = session.page;
    log.info(`Aborting generation for user ${hashUserId(userId)}`);
    try {
      const stopSelectors = [
        '.stop-button-container',
        '[class*="stop"]',
        '[class*="cancel"]',
        '[aria-label*="stop" i]',
        'button svg[class*="stop"]',
      ];
      for (const sel of stopSelectors) {
        const btn = page.locator(sel).first();
        const count = await btn.count();
        if (count > 0) {
          await btn.click();
          log.info('Stop button clicked');
          return true;
        }
      }
      log.warn('No stop button found to abort');
      return false;
    } catch (e) {
      log.warn(`Failed to abort generation: ${e.message}`);
      return false;
    }
  }

  /**
   * Copy last response (clicks copy button on Kimi UI)
   * Uses aria-label/title instead of hardcoded indices.
   */
  async copyLastResponse(userId) {
    const page = await this._getOrCreateUserPage(userId);
    log.info(`Clicking copy button for user ${hashUserId(userId)}`);

    await page.evaluate(() => {
      const container = document.querySelector('.segment-assistant-actions');
      if (!container) return false;
      // Find by aria-label or SVG name
      const btn = container.querySelector('[aria-label="Copy"], button[title="Copy"], .icon-button');
      if (btn) { btn.click(); return true; }
      // Fallback: first icon-button
      const fallback = container.querySelector('.icon-button');
      if (fallback) { fallback.click(); return true; }
      return false;
    }).catch(() => false);

    await page.waitForTimeout(500);
    return true;
  }

  /**
   * Regenerate last response
   */
  async regenerateLastResponse(userId) {
    const page = await this._getOrCreateUserPage(userId);
    log.info(`Clicking regenerate for user ${hashUserId(userId)}`);

    await page.evaluate(() => {
      const container = document.querySelector('.segment-assistant-actions');
      if (!container) return false;
      const btn = container.querySelector('[aria-label="Regenerate"], button[title="Regenerate"], [aria-label="Refresh"]');
      if (btn) { btn.click(); return true; }
      // Fallback: second icon-button
      const buttons = container.querySelectorAll('.icon-button');
      if (buttons.length > 1) { buttons[1].click(); return true; }
      return false;
    }).catch(() => false);

    const session = this.userSessions.get(userId);
    const actualMode = await this._detectActualMode(page, resolvedProvider) || session.mode || 'instant';
    await this._waitForResponse(page, actualMode, null, '', -1, resolvedProvider);
    return this._extractResponse(page, { userId });
  }

  /**
   * Anonymous consultation with Kimi Web — NO LOGIN required.
   * Creates a fresh incognito context, asks Kimi, returns the response text.
   * Used by Luna to consult Kimi as a "second brain" for code review, architecture,
   * and technical decisions without interfering with the user's session.
   */
  async anonymousConsult(prompt, options = {}, provider = 'kimi') {
    await this._ensureConnected();

    const resolvedProvider = provider || 'kimi';
    const providerCfg = this._loadProviderConfig(resolvedProvider);
    const mode = options.mode || 'thinking';
    log.info(`[anonymousConsult] Starting anonymous ${resolvedProvider} consultation (mode=${mode})`);

    let ctx = null;
    let page = null;

    try {
      // Create a completely isolated incognito context
      ctx = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
        locale: 'pt-BR',
      });
      page = await ctx.newPage();
      page._lunaProvider = resolvedProvider;

      // Navigate to provider
      const startUrl = providerCfg.baseUrl;
      log.info(`[anonymousConsult] Navigating to ${startUrl}...`);
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 0 });
      await page.waitForTimeout(2000);

      // Dismiss cookie/terms modals if present
      try {
        const consentBtn = page.locator('button:has-text("Accept"), button:has-text("Agree"), button:has-text("OK"), [class*="consent"] button').first();
        if (await consentBtn.count() > 0) {
          await consentBtn.click();
          await page.waitForTimeout(500);
        }
      } catch {}

      // Find input and send message
      const inputSelector = getProviderInputSelector(providerCfg) || 'textarea, [contenteditable="true"]';
      const inputLocator = page.locator(inputSelector).first();
      await inputLocator.waitFor({ state: 'visible', timeout: 0 });
      // W7-T4: Lexical-safe fill — fill() desyncs the React/Lexical
      // EditorState (visible text, Enter becomes a no-op).
      await this._fillContentEditable(inputLocator, prompt);
      // Capture initial text BEFORE sending — critical for fast responses.
      // v10.18-fix: Use finite timeout — landing page has no markdown yet.
      const responseSelectors = getProviderResponseSelectors(providerCfg);
      const initialText = await page.locator(responseSelectors.container || '.markdown-container').last().innerText({ timeout: 2000 }).catch(() => '');

      await page.waitForTimeout(500);
      // W7-T4: verify-and-retry submit
      await this._submitWithVerification(page, inputLocator, prompt, { provider: resolvedProvider });
      log.info('[anonymousConsult] Message sent, polling for response...');

      let lastResponse = '';
      let lastThinking = '';
      let isComplete = false;
      let buttonsVisible = false;
      let textStableSince = 0;
      let pollCount = 0;
      const pollInterval = 800;

      // Wait for text to start — NO TIMEOUT. Waits forever until Kimi starts.
      let textHasChanged = false;
      while (true) {
        const poll = await this._pollThinkingAndResponse(page, null);
        const combined = poll.thinking + poll.response;
        if (combined !== initialText && combined.length > 0) {
          textHasChanged = true;
          break;
        }
        if (++pollCount % 5 === 0) {
          log.info('[anonymousConsult] Waiting for Kimi to start...');
        }
        await new Promise(r => setTimeout(r, 500));
      }

      // Stream until complete — NO TIMEOUTS, wait forever for Kimi
      let lastTextChangeTime = Date.now();
      const streamStartTime = Date.now();

      while (!isComplete) {
        const poll = await this._pollThinkingAndResponse(page, null);

        const textChanged = poll.thinking !== lastThinking || poll.response !== lastResponse;
        if (textChanged) {
          lastTextChangeTime = Date.now();
          textStableSince = 0;
        }

        if (poll.thinking && poll.thinking !== lastThinking) {
          lastThinking = poll.thinking;
        }
        if (poll.response && poll.response !== lastResponse) {
          lastResponse = poll.response;
        }

        // Check buttons
        try {
          const hasButtons = await page.locator('.segment-assistant-actions .icon-button').count() > 0;
          if (hasButtons) buttonsVisible = true;
        } catch {}

        // Robust completion
        if (buttonsVisible && !poll.isGenerating) {
          if (textChanged) {
            textStableSince = 0;
          } else if (textStableSince === 0) {
            textStableSince = Date.now();
          }

          const stableFor = Date.now() - textStableSince;
          if (textStableSince > 0 && stableFor >= 3000) {
            const hasLoading = await this._hasActiveLoadingIndicators(page);
            if (!hasLoading) {
              await new Promise(r => setTimeout(r, 500));
              const recheck = await this._pollThinkingAndResponse(page, null);
              const recheckLoading = await this._hasActiveLoadingIndicators(page);
              if (!recheck.isGenerating && recheck.response === lastResponse && !recheckLoading) {
                isComplete = true;
                break;
              }
            }
          }
        } else {
          textStableSince = 0;
        }

          // NO FALLBACK TIMEOUTS — wait forever for Kimi to finish
        if (++pollCount % 10 === 0) {
          log.info(`[anonymousConsult] Still processing... response=${lastResponse.length} chars`);
        }
        await new Promise(r => setTimeout(r, pollInterval));
      }

      // Final clean extraction
      let finalResponse = lastResponse;
      try {
        const extracted = await this._extractResponse(page, { userId });
        if (extracted && extracted.trim().length > 50) {
          const ratio = lastResponse.length > 0 ? extracted.length / lastResponse.length : 1;
          if (ratio >= 0.5 || lastResponse.length < 200) {
            finalResponse = extracted.trim();
          } else {
            log.warn(`[anonymousConsult] _extractResponse incomplete (${extracted.length} vs ${lastResponse.length}) — using lastResponse`);
          }
        }
      } catch (e) {
        log.warn(`[anonymousConsult] _extractResponse failed: ${e.message}`);
      }

      log.success(`[anonymousConsult] Done — ${finalResponse.length} chars`);
      return {
        response: finalResponse,
        thinking: lastThinking,
        length: finalResponse.length,
      };

    } catch (err) {
      log.error(`[anonymousConsult] Failed: ${err.message}`);
      throw err;
    } finally {
      // Always clean up the incognito context
      if (ctx) {
        try { await ctx.close(); } catch {}
        log.info('[anonymousConsult] Incognito context closed');
      }
    }
  }
}

// ============================================================
// SINGLETON HELPERS
// ============================================================
let bridgeInstance = null;

async function getKimiBridge(options = {}) {
  if (!bridgeInstance) {
    bridgeInstance = new KimiBridge(options);
    await bridgeInstance.connect();
  }
  return bridgeInstance;
}

async function closeKimiBridge() {
  if (bridgeInstance) {
    await bridgeInstance.disconnect();
    bridgeInstance = null;
  }
}

module.exports = {
  KimiBridge,
  getKimiBridge,
  closeKimiBridge,
  KimiLogger,
  // PDS Fase 0: exported for unit tests (wave11).
  ProviderNetworkInterceptor,
  KimiSessionStore,
  // W6-T9: exported for unit tests. _extractJsonToolCalls is a pure method
  // (verified: no `this` usage in its body), so a prototype-level wrapper is safe.
  extractResponseFromCompleteJson,
  _extractJsonToolCalls: (text) => KimiBridge.prototype._extractJsonToolCalls.call(null, text),
  // W6-T12: pure helper exported for unit tests.
  _shouldForceGenericComplete,
};
