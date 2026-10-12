// Wave 10 T1: pure tool-card dedup decisions, extracted from ChatArea.svelte
// so the rules are unit-testable. Two independent defenses:
//   H2 — the soul's cached-result replay (W6-T5) re-emits action_start with
//        cached:true and a FRESH toolInstanceId. The original card already
//        shows that execution; a second card would be a pure duplicate. The
//        replayed action_end still carries the result text, so nothing is lost
//        by skipping the card.
//   H4 — no card may be created when one with the same backendToolId already
//        exists (duplicate detection, SSE ledger replay after reconnect).

/**
 * Decide whether an action_start event should create a NEW tool card.
 * Cached replays never create one; neither does an event whose backendToolId
 * is already rendered (including cards rebuilt from persisted history, which
 * also carry backendToolId).
 */
export function shouldCreateToolCard(existingMessages, event) {
  if (!event || event.cached === true) return false;
  const backendToolId = event.toolInstanceId || event.id;
  if (!backendToolId) return true;
  return !existingMessages.some(m => m.type === 'tool' && m.backendToolId === backendToolId);
}

/**
 * Collision-free tool card id (H3): Date.now() alone collided within the same
 * millisecond and broke the keyed {#each} in MessagesList. `seq` is a
 * monotonically increasing per-component counter.
 */
export function makeToolCardId(seq) {
  return `tool-${Date.now()}-${seq}`;
}
