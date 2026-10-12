'use strict';

/**
 * v12.0: Unified tolerant parser for Kimi/Luna tool-JSON wrappers.
 *
 * Single source of truth for turning the model's streamed text into a
 * structured action. Used by kimi-bridge.cjs (streaming accumulator, late
 * scans, orphan flush) and luna-soul.cjs (final-response parse). The Chrome
 * extension carries a ported mini-version (it has no bundler).
 *
 * Design rule — NEVER SILENT: every non-empty input produces a result.
 * Only truly empty/whitespace input returns null.
 *
 * Pipeline:
 *   1. strict JSON.parse            (clean wrappers)
 *   2. jsonrepair                   (truncated, missing commas/quotes/braces)
 *   3. pre-escaped newlines + parse (literal control chars inside strings)
 *   4. regex field extraction       (malformed but recognizable fields)
 *   5. generic tool-field rescue    ({"tool":"name" with broken params body)
 *   6. intent fallback              (no usable JSON at all → prose, never drop)
 *
 * Return shapes:
 *   { kind: 'tool',     tool, params, repaired, rescued }
 *   { kind: 'script',   script, language, repaired, rescued }
 *   { kind: 'response', text, repaired, rescued }
 *   { kind: 'prose',    text }                       — no wrapper, but visible text
 *   null                                             — empty input only
 */

const { jsonrepair } = require('jsonrepair');

/** Strip markdown fences and Kimi DOM code-block headers ("JSON Copy" etc). */
function cleanWrapperText(text) {
  return String(text)
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .replace(/^\s*JSON\s*(?:Copy|复制|複製)\s*/i, '')
    .replace(/^\s*json\s*(?:Copy|复制|複製)\s*/i, '')
    .trim();
}

/** Map a parsed object to a result kind, or null if it has no usable field. */
function mapParsedObject(parsed, meta) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.response !== undefined && typeof parsed.response === 'string') {
    return { kind: 'response', text: parsed.response, ...meta };
  }
  // v12.1: tool/script names must be non-empty strings — jsonrepair can turn a
  // fragment like `{"tool": "` into {"tool": null} and the null used to flow
  // to dispatch as "Ferramenta desconhecida: undefined".
  if (parsed.tool !== undefined) {
    if (typeof parsed.tool !== 'string' || !parsed.tool.trim()) return null;
    return { kind: 'tool', tool: parsed.tool, params: parsed.params || {}, ...meta };
  }
  if (parsed.script !== undefined) {
    if (typeof parsed.script !== 'string' || !parsed.script.trim()) return null;
    return { kind: 'script', script: parsed.script, language: parsed.language, ...meta };
  }
  // Malformed wrappers: {"success":true,"mode":"RESPONSE","message":"..."}
  if (parsed.message !== undefined && typeof parsed.message === 'string' && !parsed.tool && !parsed.script) {
    return { kind: 'response', text: parsed.message, ...meta };
  }
  return null;
}

/**
 * v12.1: string-aware balance check. False means the text was cut mid-JSON
 * (stream truncation) — anything repaired/rescued from it carries PARTIAL
 * params and must never be auto-executed (a truncated deleteFile path nearly
 * deleted the wrong directory in production).
 */
function isBalancedJson(text) {
  let depth = 0;
  let inString = false;
  let escape = false;
  let foundBrace = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') {
      if (inString) {
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j++;
        if (j >= text.length || text[j] === ',' || text[j] === ':' || text[j] === '}' || text[j] === ']') {
          inString = false;
        }
      } else {
        inString = true;
      }
      continue;
    }
    if (!inString) {
      if (c === '{') { depth++; foundBrace = true; }
      else if (c === '}') depth--;
    }
  }
  return foundBrace && depth === 0 && !inString;
}

/** Escape literal control characters inside JSON string values. */
function preEscapeJsonStringNewlines(text) {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escape) { out += c; escape = false; continue; }
    if (c === '\\') { out += c; escape = true; continue; }
    if (c === '"') { inString = !inString; out += c; continue; }
    if (inString && (c === '\n' || c === '\t' || c === '\r')) {
      out += c === '\n' ? '\\n' : c === '\t' ? '\\t' : '\\r';
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * String-aware extraction of a single "key": "value" field, tolerating
 * unescaped quotes inside the value (a closing quote is only real when the
 * next significant char is , } ] or end-of-text).
 */
function extractStringField(text, key) {
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
        case 'u': {
          if (i + 5 < text.length) {
            const code = parseInt(text.slice(i + 2, i + 6), 16);
            if (!isNaN(code)) { val += String.fromCharCode(code); i += 4; break; }
          }
          val += next;
          break;
        }
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
  return val; // truncated string — return what we have rather than nothing
}

/** Scalar (non-string) field: "key": 123 | true | false | null */
function extractScalarField(text, key) {
  const m = text.match(new RegExp(`"${key}"\\s*:\\s*(-?[0-9]+(?:\\.[0-9]+)?|true|false|null)`));
  if (!m) return undefined;
  if (m[1] === 'true') return true;
  if (m[1] === 'false') return false;
  if (m[1] === 'null') return null;
  return Number(m[1]);
}

// Known param keys across Luna tools (luna-tools.cjs / tool-registry.cjs).
// Unknown keys are still captured when they look like simple string fields.
const KNOWN_PARAM_KEYS = [
  'filePath', 'path', 'content', 'command', 'pattern', 'source', 'destination',
  'url', 'query', 'code', 'language', 'search', 'replacement', 'args', 'text',
  'directory', 'filename', 'name', 'message', 'timeout', 'packages', 'script',
];

/**
 * Best-effort rescue of {"tool": "name", "params": {…broken…}}.
 * Extracts the tool name and as many params as survive field-by-field
 * extraction. Returns null when not even a tool name is recognizable.
 */
function rescueToolCall(cleaned) {
  const toolMatch = cleaned.match(/"tool"\s*:\s*"([A-Za-z][A-Za-z0-9_-]*)"/);
  if (!toolMatch) return null;
  const tool = toolMatch[1];
  const params = {};
  // Scope param extraction to the params object when its start is locatable.
  const paramsStart = cleaned.search(/"params"\s*:\s*\{/);
  const scope = paramsStart >= 0 ? cleaned.slice(paramsStart) : cleaned;
  for (const key of KNOWN_PARAM_KEYS) {
    if (params[key] !== undefined) continue;
    const strVal = extractStringField(scope, key);
    if (strVal !== null) { params[key] = strVal; continue; }
    const scalar = extractScalarField(scope, key);
    if (scalar !== undefined) params[key] = scalar;
  }
  return { kind: 'tool', tool, params, rescued: true };
}

/**
 * Intent fallback for text with NO parseable wrapper at all. Never executes
 * anything — just classifies so the caller can surface SOMETHING visible.
 */
function detectIntent(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;
  // Fenced code block without any JSON wrapper: show it as response text
  // (auto-executing unmarked code would be unsafe), but flag the suspicion.
  const fenced = text.match(/```(?:bash|sh|shell|zsh)?\s*\n([\s\S]*?)(?:```|$)/i);
  // cleanWrapperText may already have stripped the fences, leaving a bare
  // language tag on the first line ("bash\nnpm install …").
  const langTag = !fenced && text.match(/^(?:bash|sh|shell|zsh)\s*\n([\s\S]+)$/i);
  const block = fenced || langTag;
  if (block && !text.includes('"response"')) {
    return { kind: 'prose', text, suspectedTool: 'executeShell', suspectedParams: { command: block[1].trim() } };
  }
  return { kind: 'prose', text };
}

/**
 * Main entry. See header for the pipeline and return shapes.
 */
function parseToolJson(rawText) {
  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) return null;
  const cleaned = cleanWrapperText(rawText);
  if (!cleaned) return null;

  // v12.1: if the wrapper start is visible but the JSON is unbalanced, the
  // text was CUT mid-stream — any repair/rescue below would carry partial
  // params. Mark it so callers NEVER auto-execute it.
  const truncated = cleaned.includes('{') && !isBalancedJson(cleaned);
  const meta = truncated ? { truncated: true } : {};

  // 1. strict
  try {
    const mapped = mapParsedObject(JSON.parse(cleaned), { repaired: false });
    if (mapped) return mapped;
  } catch {}

  // 2. jsonrepair — fixes missing commas/quotes/braces, single quotes.
  //    On truncated input it auto-closes strings/braces → partial values!
  try {
    const mapped = mapParsedObject(JSON.parse(jsonrepair(cleaned)), { repaired: true, ...meta });
    if (mapped) return mapped;
  } catch {}

  // 3. literal control chars inside strings
  try {
    const mapped = mapParsedObject(JSON.parse(preEscapeJsonStringNewlines(cleaned)), { repaired: true, ...meta });
    if (mapped) return mapped;
  } catch {}

  // 4. regex field extraction (response/message/script)
  try {
    const unescape = (s) => s.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    const respMatch = cleaned.match(/"response"\s*:\s*"([\s\S]*?)"\s*[,}]/);
    if (respMatch) return { kind: 'response', text: unescape(respMatch[1]), rescued: true, ...meta };
    const msgMatch = cleaned.match(/"message"\s*:\s*"([\s\S]*?)"\s*[,}]/);
    if (msgMatch) return { kind: 'response', text: unescape(msgMatch[1]), rescued: true, ...meta };
    const scriptMatch = cleaned.match(/"script"\s*:\s*"([\s\S]*?)"\s*[,}]/);
    if (scriptMatch) {
      const langMatch = cleaned.match(/"language"\s*:\s*"([^"]*)"/);
      const result = { kind: 'script', script: unescape(scriptMatch[1]), rescued: true, ...meta };
      if (langMatch) result.language = langMatch[1];
      return result;
    }
  } catch {}

  // 5. generic tool rescue — {"tool": "name"} with a broken params body
  const rescued = rescueToolCall(cleaned);
  if (rescued) return { ...rescued, ...meta };

  // 6. intent fallback — never silence non-empty text
  return detectIntent(cleaned);
}

/**
 * v13.0 (P1): string-aware extraction of every balanced top-level JSON object
 * in an arbitrary text. Fences (```), "JSON Copy" artifacts and prose are just
 * noise to this scanner — a ``` INSIDE a JSON string no longer truncates the
 * object (the non-greedy fence regex used to reject valid responses as
 * "corrupted" and dump raw JSON into the chat).
 * Quote heuristic matches isBalancedJson: a quote closes a string only when the
 * next significant char is , : } ] or end-of-text (tolerates unescaped quotes
 * inside values).
 */
function extractBalancedJsonObjects(text) {
  const results = [];
  if (!text) return results;
  const n = text.length;
  let i = 0;
  while (i < n) {
    if (text[i] !== '{') { i++; continue; }
    let depth = 0, inString = false, escape = false, j = i, closed = false;
    for (; j < n; j++) {
      const c = text[j];
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') {
        if (inString) {
          let k = j + 1;
          while (k < n && /\s/.test(text[k])) k++;
          if (k >= n || text[k] === ',' || text[k] === ':' || text[k] === '}' || text[k] === ']') {
            inString = false;
          }
        } else {
          inString = true;
        }
        continue;
      }
      if (!inString) {
        if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          if (depth === 0) { closed = true; break; }
        }
      }
    }
    if (closed) {
      results.push(text.slice(i, j + 1));
      i = j + 1;
    } else {
      i++; // no balanced object starting here — keep scanning
    }
  }
  return results;
}

module.exports = {
  parseToolJson,
  detectIntent,
  cleanWrapperText,
  extractStringField,
  rescueToolCall,
  isBalancedJson,
  extractBalancedJsonObjects,
};
