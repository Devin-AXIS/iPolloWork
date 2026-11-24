// Overflow-safe bounded accounting (document-engine task 0.3 / design D9).
// A counter never silently wraps: it rejects the increment that would cross its
// limit (the N -> N+1 boundary) and rejects any arithmetic that would exceed
// Number.MAX_SAFE_INTEGER, so a file-supplied count can never be trusted into an
// allocation.

/**
 * A counter's limit was reached. Carries the label, the limit, and what was attempted.
 *
 * Thrown at the N → N+1 boundary, so the increment that would have crossed the limit never
 * happens rather than being detected afterwards.
 */
export class LimitExceededError extends Error {
  constructor(
    readonly label: string,
    readonly limit: number,
    readonly attempted: number
  ) {
    super(`${label}: attempted ${attempted} exceeds limit ${limit}`);
    this.name = 'LimitExceededError';
  }
}

/**
 * Overflow-safe counting against a fixed limit.
 *
 * Never silently wraps: it rejects the increment that would cross its limit AND any arithmetic
 * that would exceed `Number.MAX_SAFE_INTEGER`. That second guard is the point — a file-supplied
 * count must never be trusted into an allocation, and a wrapped counter reads as small.
 */
export class BoundedCounter {
  private value = 0;

  constructor(
    readonly label: string,
    readonly limit: number
  ) {
    if (!Number.isFinite(limit) || limit < 0) {
      throw new Error(`BoundedCounter limit must be a finite non-negative number, got ${limit}`);
    }
  }

  get current(): number {
    return this.value;
  }

  /** Remaining headroom before the limit. */
  get remaining(): number {
    return this.limit - this.value;
  }

  /**
   * Add `n` (default 1). Throws LimitExceededError if the result would exceed the
   * limit (so `limit` itself is reachable but `limit + 1` is not) or overflow the
   * safe-integer range. On rejection the counter is unchanged.
   */
  add(n = 1): number {
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`${this.label}: increment must be a finite non-negative number, got ${n}`);
    }
    // Overflow-safe: check before adding.
    if (n > Number.MAX_SAFE_INTEGER - this.value || this.value + n > this.limit) {
      throw new LimitExceededError(this.label, this.limit, this.value + n);
    }
    this.value += n;
    return this.value;
  }

  /** Whether adding `n` would be accepted, without mutating. */
  canAdd(n = 1): boolean {
    return (
      Number.isFinite(n) &&
      n >= 0 &&
      n <= Number.MAX_SAFE_INTEGER - this.value &&
      this.value + n <= this.limit
    );
  }

  release(n: number): void {
    if (!Number.isFinite(n) || n < 0) throw new Error(`${this.label}: release must be finite >= 0`);
    this.value = Math.max(0, this.value - n);
  }
}
