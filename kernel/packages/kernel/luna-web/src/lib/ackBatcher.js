// Wave 4 bug 4: batch event acknowledgements — at most one POST per interval,
// or an immediate flush when the batch fills. One-shot timer (re-armed per
// flush) so reset() has exactly one timer to cancel.
export function createAckBatcher(flushFn, {
  intervalMs = 1000,
  maxBatch = 100,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  let pending = [];
  let timer = null;

  function flush() {
    if (timer) { clearTimeoutFn(timer); timer = null; }
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    flushFn(batch);
  }

  return {
    push(id) {
      if (!id) return;
      pending.push(id);
      if (pending.length >= maxBatch) { flush(); return; }
      if (!timer) timer = setTimeoutFn(flush, intervalMs);
    },
    flush,
    reset() {
      pending = [];
      if (timer) { clearTimeoutFn(timer); timer = null; }
    },
    get size() { return pending.length; },
  };
}
