// Wave 4 bug 7: bounded-set eviction policy.
// The old inline code deleted exactly ONE oldest entry when the set exceeded
// the cap, so a set at 5001 entries stayed ~5000 forever (one add, one delete
// per event — the cap never actually shrank the working set and every event
// paid a delete). Trim to 80% of the cap in one pass instead.
export function evictOldestEntries(set, maxSize, trimTo = Math.floor(maxSize * 0.8)) {
  if (set.size <= maxSize) return 0;
  const excess = set.size - trimTo;
  let removed = 0;
  const iter = set.values(); // insertion order — oldest first
  for (let i = 0; i < excess; i++) {
    const { value, done } = iter.next();
    if (done) break;
    set.delete(value);
    removed++;
  }
  return removed;
}
