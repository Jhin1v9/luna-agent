// Wave 4 bug 8: trailing-edge debounce with an immediate-flush escape hatch.
// Timer functions are injectable so the policy is testable under node --test.
export function createDebouncedScheduler(fn, waitMs, { setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
  let timer = null;
  return {
    schedule(immediate = false) {
      if (immediate) {
        if (timer) { clearTimeoutFn(timer); timer = null; }
        fn();
        return;
      }
      if (timer) return; // a run is already armed — it will pick up the latest state
      timer = setTimeoutFn(() => { timer = null; fn(); }, waitMs);
    },
    cancel() {
      if (timer) { clearTimeoutFn(timer); timer = null; }
    },
    get pending() { return timer !== null; },
  };
}
