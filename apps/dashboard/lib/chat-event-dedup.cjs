'use strict';

/**
 * Wave 11 Fix: dedup by event identity, never by content.
 * Content-based dedup was swallowing thinking updates, duplicate responses,
 * and any event whose text repeated. Every persisted event now has a unique
 * id; the frontend also deduplicates by id. Fall back to type+timestamp+seq
 * only when no id is present.
 */
let _fallbackSeq = 0;

function makeEventDedupKey(ev, _content) {
  if (ev && ev.id) {
    return `${ev.type}:${ev.id}`;
  }
  return `${ev?.type || 'unknown'}:fallback:${Date.now()}:${++_fallbackSeq}`;
}

module.exports = { makeEventDedupKey };
