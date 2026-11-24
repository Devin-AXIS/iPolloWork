// Hierarchical resource budget tree (document-engine task 0.3 / design D9 / perf
// spec). Each operation owns a root budget; parsers, extensions, workers, layout,
// transport, and output carve child budgets from it. Reservations precede
// allocation and use overflow-safe counters. Every child budget, queue, spill
// file, and worker MUST release before its root budget — `dispose()` refuses
// while children or reservations are outstanding, and runs registered cleanups
// (spill files, worker termination) on the way out, LIFO, even if one throws.

import { BoundedCounter } from './counter.ts';

/** A budget was misused: over-carved, over-reserved, or disposed with children outstanding. */
export class BudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetError';
  }
}

/**
 * Capacity claimed BEFORE it is allocated.
 *
 * Reserve-then-allocate rather than allocate-then-check: discovering the overrun after the
 * allocation has already happened defeats the point of having a budget.
 */
export interface Reservation {
  readonly amount: number;
  readonly released: boolean;
  release(): void;
}

/**
 * One node in the hierarchical resource budget tree.
 *
 * An operation owns a root budget; parsers, extensions, workers, layout, transport and output
 * carve children from it, so no subsystem can consume more than the operation as a whole allows.
 *
 * `dispose()` REFUSES while children or reservations are outstanding, then runs registered
 * cleanups LIFO — spill files, worker termination — even if one throws. A leaked child budget is a
 * leaked worker, so the refusal is the diagnostic.
 */
export class Budget {
  private readonly used: BoundedCounter;
  private readonly children = new Set<Budget>();
  private activeReservations = 0;
  private readonly cleanups: (() => void)[] = [];
  private disposed = false;
  private carveAmount = 0;
  private parent?: Budget;

  constructor(
    readonly label: string,
    readonly capacity: number
  ) {
    this.used = new BoundedCounter(`${label}.budget`, capacity);
  }

  get inUse(): number {
    return this.used.current;
  }
  get available(): number {
    return this.used.remaining;
  }
  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Reserve `amount` from this budget. Throws if it would exceed capacity. */
  reserve(amount: number): Reservation {
    this.assertLive();
    this.used.add(amount); // overflow-safe; throws LimitExceededError past capacity
    this.activeReservations += 1;
    let released = false;
    const self = this;
    return {
      amount,
      get released() {
        return released;
      },
      release() {
        if (released) return;
        released = true;
        self.used.release(amount);
        self.activeReservations -= 1;
      },
    };
  }

  /** Carve a child budget of `capacity` out of this budget's headroom. */
  child(label: string, capacity: number): Budget {
    this.assertLive();
    this.used.add(capacity); // reserve the carve-out from the parent
    const c = new Budget(label, capacity);
    c.parent = this;
    c.carveAmount = capacity;
    this.children.add(c);
    return c;
  }

  /** Register cleanup for a spill file, worker, or queue tied to this budget. */
  onRelease(cleanup: () => void): void {
    this.assertLive();
    this.cleanups.push(cleanup);
  }

  /**
   * Release this budget. Refuses while any child budget or reservation is
   * outstanding (children must finish first). Runs cleanups LIFO, returns the
   * carve-out to the parent, and marks disposed. Cleanup errors are collected and
   * rethrown after every cleanup has run.
   */
  dispose(): void {
    if (this.disposed) return;
    if (this.children.size > 0) {
      throw new BudgetError(
        `${this.label}: cannot release with ${this.children.size} child budget(s) outstanding`
      );
    }
    if (this.activeReservations > 0) {
      throw new BudgetError(
        `${this.label}: cannot release with ${this.activeReservations} reservation(s) outstanding`
      );
    }
    const errors: unknown[] = [];
    for (let i = this.cleanups.length - 1; i >= 0; i--) {
      try {
        this.cleanups[i]();
      } catch (e) {
        errors.push(e);
      }
    }
    this.disposed = true;
    if (this.parent) {
      this.parent.children.delete(this);
      this.parent.used.release(this.carveAmount);
      this.parent = undefined;
    }
    if (errors.length > 0) {
      throw new BudgetError(
        `${this.label}: ${errors.length} cleanup error(s); first: ${String(errors[0])}`
      );
    }
  }

  private assertLive(): void {
    if (this.disposed) throw new BudgetError(`${this.label}: budget already released`);
  }
}
