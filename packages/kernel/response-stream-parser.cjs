/**
 * ResponseStreamParser — Parser incremental de streaming da Kimi
 * Detecta tags [[response]], code blocks JSON, e thinking em tempo real.
 * @module response-stream-parser
 */

const { EventEmitter } = require("events");

// ─── Constants ───────────────────────────────────────────────────────────────

const TAG_OPEN_RESPONSE = "[[response]]";
const TAG_CLOSE_RESPONSE = "[[/response]]";
const TAG_OPEN_ACTION = "[[action]]";
const TAG_CLOSE_ACTION = "[[/action]]";

const CB_OPEN = "```json";
const CB_OPEN_GENERIC = "```";
const CB_CLOSE = "```";

// ─── Helper: safe JSON parse with graceful degradation ───────────────────────
const { jsonrepair } = require('jsonrepair');

function safeJsonParse(text, fallback = null) {
  if (!text || typeof text !== 'string') return fallback;
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  try {
    return JSON.parse(trimmed);
  } catch {}
  // v11.0-fix: repair common LLM JSON errors (unescaped quotes, missing escapes,
  // trailing commas, markdown artifacts like "json\nCopy\nDownload\n{...}").
  try {
    const repaired = jsonrepair(trimmed);
    if (repaired && repaired !== trimmed) {
      return JSON.parse(repaired);
    }
  } catch {}
  // Fallback: extract first JSON object if wrapped in noise
  const match = trimmed.match(/\{[\s\S]*?\}(?=\s*$)/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }
  return fallback;
}

// ─── Helper: brace balance checker (ignores braces inside strings) ───────────

function isBalancedBraces(text) {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth < 0) return false;
  }

  return depth === 0 && !inString;
}

// ─── Main Class ──────────────────────────────────────────────────────────────

class ResponseStreamParser extends EventEmitter {
  constructor(options = {}) {
    super();

    this.buffer = "";
    this.inResponse = false;
    this.inAction = false;
    this.inCodeBlock = false;
    this.codeBlockLang = null;
    this.codeBlockBuffer = "";

    this.responseAccumulator = "";
    this.thinkingAccumulator = "";
    this.rawAccumulator = "";

    this.options = {
      maxResponseLength: options.maxResponseLength || 100_000,
      maxCodeBlockLength: options.maxCodeBlockLength || 500_000,
      maxBufferLength: options.maxBufferLength || 1_000_000,
      emitRawByDefault: options.emitRawByDefault !== false,
      ...options,
    };
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Feed a text chunk into the parser.
   * @param {string} chunk
   */
  write(chunk) {
    if (!chunk || typeof chunk !== "string") return;

    this.buffer += chunk;

    // Safety valve: prevent infinite growth
    if (this.buffer.length > this.options.maxBufferLength) {
      this._flushAsRaw();
      this.buffer = this.buffer.slice(-this.options.maxBufferLength / 2);
    }

    this._processBuffer();
  }

  /**
   * Signal end of stream. Flush any remaining content.
   */
  end() {
    this._processBuffer(true);
    this._flushRemaining();
    this.emit("end");
  }

  /**
   * Reset parser state for a new message.
   */
  reset() {
    this.buffer = "";
    this.inResponse = false;
    this.inAction = false;
    this.inCodeBlock = false;
    this.codeBlockLang = null;
    this.codeBlockBuffer = "";
    this.responseAccumulator = "";
    this.thinkingAccumulator = "";
    this.rawAccumulator = "";
  }

  // ─── Internal Processing ───────────────────────────────────────────────────

  _processBuffer(isEnd = false) {
    let processed = 0;

    while (this.buffer.length > processed) {
      const remaining = this.buffer.slice(processed);

      // 1. Check for response tag close (highest priority)
      if (this.inResponse) {
        const closeIdx = remaining.indexOf(TAG_CLOSE_RESPONSE);
        if (closeIdx !== -1) {
          const content = remaining.slice(0, closeIdx);
          this.responseAccumulator += content;
          this._emitResponseDelta(this.responseAccumulator, true);
          this.responseAccumulator = "";
          this.inResponse = false;
          processed += closeIdx + TAG_CLOSE_RESPONSE.length;
          continue;
        } else if (isEnd) {
          // Unclosed response at end — emit what we have as partial
          this.responseAccumulator += remaining;
          this._emitResponseDelta(this.responseAccumulator, true);
          this.inResponse = false;
          processed = this.buffer.length;
          break;
        }
      }

      // 2. Check for action tag close
      if (this.inAction) {
        const closeIdx = remaining.indexOf(TAG_CLOSE_ACTION);
        if (closeIdx !== -1) {
          const content = remaining.slice(0, closeIdx).trim();
          this._tryEmitAction(content, "tag");
          this.inAction = false;
          processed += closeIdx + TAG_CLOSE_ACTION.length;
          continue;
        } else if (isEnd) {
          const content = remaining.trim();
          this._tryEmitAction(content, "tag");
          this.inAction = false;
          processed = this.buffer.length;
          break;
        }
      }

      // 3. Check for code block close
      if (this.inCodeBlock) {
        const closeIdx = remaining.indexOf(CB_CLOSE);
        if (closeIdx !== -1) {
          const beforeClose = remaining.slice(0, closeIdx);
          this.codeBlockBuffer += beforeClose;
          this._processCodeBlock(this.codeBlockBuffer, this.codeBlockLang);
          this.inCodeBlock = false;
          this.codeBlockLang = null;
          this.codeBlockBuffer = "";
          processed += closeIdx + CB_CLOSE.length;
          continue;
        } else {
          // Accumulate everything up to last newline (keep partial line in buffer)
          const lastNl = remaining.lastIndexOf("\n");
          if (lastNl !== -1 && !isEnd) {
            this.codeBlockBuffer += remaining.slice(0, lastNl + 1);
            processed += lastNl + 1;
          } else if (isEnd) {
            this.codeBlockBuffer += remaining;
            this._processCodeBlock(this.codeBlockBuffer, this.codeBlockLang);
            this.inCodeBlock = false;
            this.codeBlockLang = null;
            this.codeBlockBuffer = "";
            processed = this.buffer.length;
          }
          break;
        }
      }

      // 4. Look for opening patterns
      const respOpenIdx = remaining.indexOf(TAG_OPEN_RESPONSE);
      const actionOpenIdx = remaining.indexOf(TAG_OPEN_ACTION);
      const cbJsonIdx = remaining.indexOf(CB_OPEN);
      const cbGenericIdx = remaining.indexOf(CB_OPEN_GENERIC);

      // Find the earliest opening tag
      const candidates = [];
      if (respOpenIdx !== -1) candidates.push({ idx: respOpenIdx, type: "response", len: TAG_OPEN_RESPONSE.length });
      if (actionOpenIdx !== -1) candidates.push({ idx: actionOpenIdx, type: "action", len: TAG_OPEN_ACTION.length });
      if (cbJsonIdx !== -1) candidates.push({ idx: cbJsonIdx, type: "codeblock_json", len: CB_OPEN.length });
      if (cbGenericIdx !== -1 && cbGenericIdx !== cbJsonIdx) {
        candidates.push({ idx: cbGenericIdx, type: "codeblock_generic", len: CB_OPEN_GENERIC.length });
      }

      if (candidates.length === 0) {
        // No opening tags found — flush as thinking/raw
        if (isEnd) {
          this._emitThinking(remaining);
          processed = this.buffer.length;
        } else {
          // Keep last 100 chars in buffer (might be start of a tag)
          const keep = Math.min(remaining.length, 100);
          const emitLen = remaining.length - keep;
          if (emitLen > 0) {
            this._emitThinking(remaining.slice(0, emitLen));
          }
          processed += emitLen;
        }
        break;
      }

      candidates.sort((a, b) => a.idx - b.idx);
      const first = candidates[0];

      // Emit text before the tag as thinking
      if (first.idx > 0) {
        this._emitThinking(remaining.slice(0, first.idx));
      }

      // Enter the appropriate mode
      if (first.type === "response") {
        this.inResponse = true;
        processed += first.idx + first.len;
      } else if (first.type === "action") {
        this.inAction = true;
        processed += first.idx + first.len;
      } else if (first.type === "codeblock_json") {
        this.inCodeBlock = true;
        this.codeBlockLang = "json";
        processed += first.idx + first.len;
      } else if (first.type === "codeblock_generic") {
        this.inCodeBlock = true;
        this.codeBlockLang = "generic";
        processed += first.idx + first.len;
      }
    }

    // Trim processed content from buffer
    if (processed > 0) {
      this.buffer = this.buffer.slice(processed);
    }
  }

  _processCodeBlock(content, lang) {
    const trimmed = content.trim();

    if (lang === "json" || (lang === "generic" && trimmed.startsWith("{"))) {
      // Validate braces are balanced before emitting
      if (isBalancedBraces(trimmed)) {
        const parsed = safeJsonParse(trimmed);
        // v4.1: Support {"response":...} as chat response format
        if (parsed && parsed.response !== undefined && !parsed.tool && !parsed.action && !parsed.type) {
          this._emitResponseDelta(parsed.response, true);
          return;
        }
        if (parsed && (parsed.tool || parsed.action || parsed.type)) {
          this._emitAction(parsed, "codeblock");
          return;
        }
      } else {
        // Unbalanced — might be incomplete, emit as thinking unless end() called
        this._emitThinking("```json\n" + content + "\n```");
        return;
      }
    }

    // Not a recognized action — emit as raw/thinking
    this._emitThinking("```" + (lang || "") + "\n" + content + "\n```");
  }

  _tryEmitAction(content, source) {
    const parsed = safeJsonParse(content);
    if (parsed && (parsed.tool || parsed.action || parsed.type)) {
      this._emitAction(parsed, source);
    } else {
      this._emitThinking(TAG_OPEN_ACTION + content + TAG_CLOSE_ACTION);
    }
  }

  _emitResponseDelta(text, isFinal = false) {
    if (!text) return;
    const truncated = text.slice(0, this.options.maxResponseLength);
    this.emit("response_delta", truncated, isFinal);
  }

  _emitAction(action, source) {
    const normalized = this._normalizeAction(action);
    this.emit("action_detected", normalized, source);
  }

  _emitThinking(text) {
    if (!text) return;
    this.thinkingAccumulator += text;
    this.emit("thinking_delta", text);
    if (this.options.emitRawByDefault) {
      this.emit("raw_delta", text);
    }
  }

  _flushAsRaw() {
    if (this.buffer) {
      this._emitThinking(this.buffer);
      this.buffer = "";
    }
  }

  _flushRemaining() {
    if (this.inResponse && this.responseAccumulator) {
      this._emitResponseDelta(this.responseAccumulator, true);
      this.responseAccumulator = "";
      this.inResponse = false;
    }
    if (this.inAction) {
      this._tryEmitAction(this.buffer.trim(), "tag");
      this.inAction = false;
    }
    if (this.inCodeBlock && this.codeBlockBuffer) {
      this._processCodeBlock(this.codeBlockBuffer, this.codeBlockLang);
      this.inCodeBlock = false;
      this.codeBlockLang = null;
      this.codeBlockBuffer = "";
    }
    if (this.buffer) {
      this._emitThinking(this.buffer);
      this.buffer = "";
    }
  }

  _normalizeAction(action) {
    // Normalize various action formats to standard { tool, params }
    if (action.tool && action.params) return action;
    if (action.action && action.parameters) {
      return { tool: action.action, params: action.parameters };
    }
    if (action.type && action.args) {
      return { tool: action.type, params: action.args };
    }
    if (action.tool && !action.params) {
      return { tool: action.tool, params: action };
    }
    return action;
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  ResponseStreamParser,
  safeJsonParse,
  isBalancedBraces,
};