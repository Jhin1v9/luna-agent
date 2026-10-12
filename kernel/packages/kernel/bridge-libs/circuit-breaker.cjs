/**
 * CircuitBreaker — prevents infinite retry loops on consecutive failures.
 * States: CLOSED (normal) -> OPEN (fast-fail) -> HALF_OPEN (test 1 request)
 */
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.recoveryTimeout = options.recoveryTimeout || 30000;
    this.halfOpenMaxCalls = options.halfOpenMaxCalls || 1;
    this._state = 'CLOSED';
    this._failures = 0;
    this._successes = 0;
    this._lastFailureTime = null;
    this._halfOpenCalls = 0;
    this._name = options.name || 'circuit';
  }

  get state() { return this._state; }

  async execute(fn) {
    if (this._state === 'OPEN') {
      if (Date.now() - this._lastFailureTime > this.recoveryTimeout) {
        this._state = 'HALF_OPEN';
        this._halfOpenCalls = 0;
      } else {
        throw new Error(`CircuitBreaker [${this._name}] is OPEN — too many consecutive failures`);
      }
    }

    if (this._state === 'HALF_OPEN' && this._halfOpenCalls >= this.halfOpenMaxCalls) {
      throw new Error(`CircuitBreaker [${this._name}] is HALF_OPEN — test call limit reached`);
    }

    if (this._state === 'HALF_OPEN') this._halfOpenCalls++;

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure();
      throw err;
    }
  }

  _onSuccess() {
    this._failures = 0;
    if (this._state === 'HALF_OPEN') {
      this._successes++;
      if (this._successes >= this.halfOpenMaxCalls) {
        this._state = 'CLOSED';
        this._successes = 0;
        this._halfOpenCalls = 0;
      }
    }
  }

  _onFailure() {
    this._failures++;
    this._lastFailureTime = Date.now();
    if (this._failures >= this.failureThreshold) {
      this._state = 'OPEN';
    }
  }
}

module.exports = { CircuitBreaker };
