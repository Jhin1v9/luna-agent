// Wave 4 bugs 1+2: one registry owns every per-tool UI interval (the 100ms
// duration ticker) and watchdog timeout (TOOL_TIMEOUT_MS). The old code kept
// bare interval ids in a Map that was REPLACED on reconnect without clearing —
// every reconnect leaked all running intervals — and TOOL_TIMEOUT_MS was dead
// code, so a tool whose action_end never arrived spun "running" forever.
export function createToolTimerRegistry({
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  nowFn = Date.now,
} = {}) {
  const intervals = new Map(); // toolId -> { intervalId, startTime }
  const timeouts = new Map();  // toolId -> timeoutId

  function stop(toolId) {
    const t = intervals.get(toolId);
    if (t) { clearIntervalFn(t.intervalId); intervals.delete(toolId); }
    const to = timeouts.get(toolId);
    if (to) { clearTimeoutFn(to); timeouts.delete(toolId); }
    return t ? (nowFn() - t.startTime) / 1000 : null;
  }

  function start(toolId, { onTick, onTimeout, intervalMs = 100, timeoutMs = 60000 } = {}) {
    stop(toolId); // never stack two lifecycles on the same card
    const startTime = nowFn();
    const intervalId = setIntervalFn(() => {
      if (onTick) onTick((nowFn() - startTime) / 1000);
    }, intervalMs);
    const timeoutId = setTimeoutFn(() => {
      // watchdog wins: kill the UI ticker, then report the stuck tool
      const t = intervals.get(toolId);
      if (t) { clearIntervalFn(t.intervalId); intervals.delete(toolId); }
      timeouts.delete(toolId);
      if (onTimeout) onTimeout(toolId);
    }, timeoutMs);
    intervals.set(toolId, { intervalId, startTime });
    timeouts.set(toolId, timeoutId);
    return startTime;
  }

  function clearAll() {
    for (const { intervalId } of intervals.values()) clearIntervalFn(intervalId);
    for (const timeoutId of timeouts.values()) clearTimeoutFn(timeoutId);
    intervals.clear();
    timeouts.clear();
  }

  return {
    start,
    stop,
    clearAll,
    has: (toolId) => intervals.has(toolId) || timeouts.has(toolId),
    get size() { return intervals.size; },
  };
}
