// Cancellation with an explicit point of no return (document-engine task 0.3 /
// design D9 / perf spec "Budget and cancellation lifecycle is hierarchical").
//
// Canonical publication is the point of no return. Cancelling BEFORE publication
// means the whole operation rolls back (canonical/backend/journal/history/
// revision/notification). Cancelling AFTER publication means the commit stands
// and only derived work (layout, export, caches) is cancelled. The controller
// tracks the phase; cooperative work calls `checkpoint()` at declared intervals
// to unwind promptly.

/**
 * Which side of the point of no return an operation is on.
 *
 * Canonical publication is that point. Cancelling BEFORE it rolls the whole operation back;
 * cancelling after it leaves the commit standing and cancels only derived work — layout, export,
 * caches.
 */
export type CancellationPhase = 'pre-publication' | 'post-publication';

/** Thrown from a `checkpoint()` when the operation has been cancelled. */
export class CancellationError extends Error {
  constructor(
    /** True when the commit is already published and only derived work is cancelled. */
    readonly derivedOnly: boolean,
    reason?: string
  ) {
    super(reason ? `cancelled: ${reason}` : 'cancelled');
    this.name = 'CancellationError';
  }
}

/**
 * The read side of cancellation, handed to cooperative work.
 *
 * Cooperative rather than pre-emptive: long work calls `checkpoint()` at declared intervals, which
 * is what lets an operation unwind promptly without the engine having to interrupt it mid-mutation.
 */
export interface CancellationToken {
  readonly isCancelled: boolean;
  readonly phase: CancellationPhase;
  /** True only when cancelled AND the commit is already published. */
  readonly derivedOnly: boolean;
  /** Throws CancellationError if cancelled; call at declared checkpoint intervals. */
  checkpoint(): void;
}

/**
 * The write side of cancellation, and the owner of the phase.
 *
 * Whoever starts an operation holds this; everything it calls gets only the token.
 */
export class CancellationController {
  private _cancelled = false;
  private _phase: CancellationPhase = 'pre-publication';
  private _reason?: string;

  cancel(reason?: string): void {
    this._cancelled = true;
    if (reason !== undefined) this._reason = reason;
  }

  /** Mark canonical publication — the point of no return. */
  markPublished(): void {
    this._phase = 'post-publication';
  }

  get isCancelled(): boolean {
    return this._cancelled;
  }
  get phase(): CancellationPhase {
    return this._phase;
  }
  get isPublished(): boolean {
    return this._phase === 'post-publication';
  }
  /** Cancelled after publication -> full rollback is no longer possible. */
  get derivedOnly(): boolean {
    return this._cancelled && this._phase === 'post-publication';
  }

  get token(): CancellationToken {
    const self = this;
    return {
      get isCancelled() {
        return self._cancelled;
      },
      get phase() {
        return self._phase;
      },
      get derivedOnly() {
        return self.derivedOnly;
      },
      checkpoint() {
        if (self._cancelled) throw new CancellationError(self.derivedOnly, self._reason);
      },
    };
  }
}
