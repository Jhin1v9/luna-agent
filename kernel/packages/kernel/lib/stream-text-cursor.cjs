'use strict';
// Per-source cumulative-text cursor with cross-source divergence guard.
// Each producer (chrome_extension, dom-structure poll, dom_observer) gets
// its own cursor; deltas are only emitted when the incoming full text is
// consistent with everything already committed to the frontend.
function createResponseCursor() {
  const bySource = new Map(); // source -> last full text seen from that source
  let committed = '';         // text already emitted downstream
  let previousTurnResponse = '';
  let inTurnGuard = false;    // true right after startNewTurn until a real new response arrives

  // Normalize a response string so JSON wrappers and plain-text renderings of
  // the same answer compare equal. This prevents a stale dom-structure text
  // rendering from overwriting a fresh JSON-wrapped response (or vice versa).
  function normalizeGuardText(text) {
    if (!text) return '';
    const cleaned = text
      .replace(/^\s*```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .replace(/^\s*JSON\s*(?:Copy|复制|複製)\s*/i, '')
      .replace(/^\s*json\s*(?:Copy|复制|複製)\s*/i, '')
      .trim();
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed.response === 'string') return parsed.response;
    } catch {}
    return text;
  }

  return {
    // Returns { emit: string|null, diverged: boolean, stale?: boolean }
    next(source, full) {
      if (!full) return { emit: null, diverged: false };
      const key = source || 'unknown';

      // Turn guard: right after a new turn starts, producers may still be
      // reporting the previous turn's final response (DomPoller lag, batching,
      // etc.). Swallow anything that looks like that stale answer so it cannot
      // overwrite the new turn's real response.
      if (inTurnGuard && previousTurnResponse) {
        const normFull = normalizeGuardText(full);
        const normPrev = normalizeGuardText(previousTurnResponse);
        if (normFull === normPrev ||
            normFull.startsWith(normPrev) ||
            normPrev.startsWith(normFull)) {
          return { emit: null, diverged: false, stale: true };
        }
        inTurnGuard = false; // first real response of the new turn seen
      }

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
    reset() {
      bySource.clear();
      committed = '';
      previousTurnResponse = '';
      inTurnGuard = false;
    },
    // Called at the very start of a new turn. previousResponse is the final
    // response text committed in the previous turn; any producer that still
    // reports it will be ignored until something different arrives.
    startNewTurn(previousResponse) {
      bySource.clear();
      committed = '';
      previousTurnResponse = previousResponse || '';
      inTurnGuard = true;
    },
    get committed() { return committed; },
  };
}
module.exports = { createResponseCursor };
