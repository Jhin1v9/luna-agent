/**
 * AsyncMutex — per-key async lock with FIFO queue.
 * Replaces manual boolean flags (session.processing) to prevent race conditions.
 */
class AsyncMutex {
  constructor() {
    this._locks = new Map(); // key -> { promise, resolve }
    this._queues = new Map(); // key -> Array<resolve>
  }

  async acquire(key) {
    if (!this._locks.has(key)) {
      this._locks.set(key, true);
      return () => this._release(key);
    }
    return new Promise((resolve) => {
      if (!this._queues.has(key)) this._queues.set(key, []);
      this._queues.get(key).push(resolve);
    });
  }

  _release(key) {
    const queue = this._queues.get(key);
    if (queue && queue.length > 0) {
      const next = queue.shift();
      next(() => this._release(key));
    } else {
      this._locks.delete(key);
    }
  }

  isLocked(key) {
    return this._locks.has(key);
  }
}

module.exports = { AsyncMutex };
