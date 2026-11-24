// Adversarial tests for runtime ports, budgets, cancellation, and per-operation
// snapshots (document-engine task 0.3). Covers N/N+1 overflow boundaries,
// non-disableable hard ceilings, hierarchical child-before-parent release, spill
// cleanup, cancellation point-of-no-return, and typed port resolution.

import { describe, expect, test } from 'bun:test';
import {
  resolveLimits,
  HARD_CEILINGS,
  DEFAULT_LIMITS,
  BoundedCounter,
  LimitExceededError,
  Budget,
  BudgetError,
  CancellationController,
  CancellationError,
  PortRegistry,
  PortResolutionError,
  DeterministicClock,
  SequentialIdentity,
  beginOperation,
  endOperation,
} from '../runtime/index.ts';
import { RUNTIME_PORT_IDS } from '../registry/frozen-ids.ts';

describe('resource limits', () => {
  test('override above ceiling clamps to the hard ceiling', () => {
    const l = resolveLimits({ maxRecursionDepth: 10_000 });
    expect(l.maxRecursionDepth).toBe(HARD_CEILINGS.maxRecursionDepth);
  });
  test('Infinity/0/negative/NaN cannot disable a limit', () => {
    for (const bad of [Infinity, 0, -5, NaN]) {
      const l = resolveLimits({ maxElementCount: bad });
      expect(Number.isFinite(l.maxElementCount)).toBe(true);
      expect(l.maxElementCount).toBeGreaterThan(0);
      expect(l.maxElementCount).toBeLessThanOrEqual(HARD_CEILINGS.maxElementCount);
    }
  });
  test('unspecified keys use finite defaults; result is frozen', () => {
    const l = resolveLimits();
    expect(l.maxPartCount).toBe(DEFAULT_LIMITS.maxPartCount);
    expect(Object.isFrozen(l)).toBe(true);
  });
  test('every default is <= its ceiling', () => {
    for (const k of Object.keys(HARD_CEILINGS) as (keyof typeof HARD_CEILINGS)[]) {
      expect(DEFAULT_LIMITS[k]).toBeLessThanOrEqual(HARD_CEILINGS[k]);
    }
  });
});

describe('overflow-safe counter', () => {
  test('accepts up to the limit (N) and rejects N+1', () => {
    const c = new BoundedCounter('c', 3);
    c.add(1);
    c.add(2); // now 3 == limit, allowed
    expect(c.current).toBe(3);
    expect(() => c.add(1)).toThrow(LimitExceededError);
    expect(c.current).toBe(3); // unchanged on rejection
  });
  test('rejects increments that would exceed MAX_SAFE_INTEGER', () => {
    const c = new BoundedCounter('c', Number.MAX_SAFE_INTEGER);
    c.add(Number.MAX_SAFE_INTEGER - 1);
    expect(() => c.add(5)).toThrow(LimitExceededError);
  });
  test('canAdd predicts acceptance without mutating', () => {
    const c = new BoundedCounter('c', 2);
    expect(c.canAdd(2)).toBe(true);
    expect(c.canAdd(3)).toBe(false);
    expect(c.current).toBe(0);
  });
});

describe('hierarchical budget', () => {
  test('reservations respect capacity and release back', () => {
    const b = new Budget('root', 100);
    const r = b.reserve(40);
    expect(b.inUse).toBe(40);
    expect(() => b.reserve(70)).toThrow(); // 40+70 > 100
    r.release();
    expect(b.inUse).toBe(0);
  });
  test('child budget carves from parent and returns on dispose', () => {
    const root = new Budget('root', 100);
    const child = root.child('parser', 30);
    expect(root.inUse).toBe(30);
    child.reserve(10);
    // parent cannot be released while a child is outstanding
    expect(() => root.dispose()).toThrow(BudgetError);
    // child cannot be released while it holds a reservation
    expect(() => child.dispose()).toThrow(BudgetError);
  });
  test('child released before parent; root then disposes cleanly', () => {
    const root = new Budget('root', 100);
    const child = root.child('parser', 30);
    const r = child.reserve(10);
    r.release();
    child.dispose();
    expect(root.inUse).toBe(0);
    expect(() => root.dispose()).not.toThrow();
  });
  test('cleanups (spill/worker) run LIFO on dispose', () => {
    const order: number[] = [];
    const b = new Budget('root', 10);
    b.onRelease(() => order.push(1));
    b.onRelease(() => order.push(2));
    b.dispose();
    expect(order).toEqual([2, 1]);
  });
});

describe('cancellation point of no return', () => {
  test('checkpoint throws once cancelled', () => {
    const c = new CancellationController();
    const t = c.token;
    t.checkpoint(); // fine
    c.cancel('user abort');
    expect(() => t.checkpoint()).toThrow(CancellationError);
  });
  test('cancel before publication is full rollback; after is derived-only', () => {
    const pre = new CancellationController();
    pre.cancel();
    expect(pre.derivedOnly).toBe(false); // full rollback

    const post = new CancellationController();
    post.markPublished();
    post.cancel();
    expect(post.derivedOnly).toBe(true); // commit stands, cancel derived work
    try {
      post.token.checkpoint();
      throw new Error('expected cancellation');
    } catch (e) {
      expect(e).toBeInstanceOf(CancellationError);
      expect((e as CancellationError).derivedOnly).toBe(true);
    }
  });
});

describe('port registry', () => {
  test('resolves provided ports and reports missing typed', () => {
    const reg = new PortRegistry()
      .provide(RUNTIME_PORT_IDS.clock, new DeterministicClock(1000, 5))
      .provide(RUNTIME_PORT_IDS.identity, new SequentialIdentity('sess'));
    expect(reg.clock().now()).toBe(1000);
    expect(reg.clock().now()).toBe(1005);
    expect(reg.identity().newId()).toBe('sess-1');
    expect(() => reg.resolve(RUNTIME_PORT_IDS.shaping)).toThrow(PortResolutionError);
    expect(reg.missing([RUNTIME_PORT_IDS.shaping, RUNTIME_PORT_IDS.clock])).toEqual([
      RUNTIME_PORT_IDS.shaping,
    ]);
  });
});

describe('operation snapshot', () => {
  test('captures frozen, immutable limits/config and disposes its budget', () => {
    const ports = new PortRegistry().provide(RUNTIME_PORT_IDS.clock, new DeterministicClock());
    const ctx = beginOperation({
      ports,
      limits: { maxPaginationPasses: 5 },
      config: { mode: 'strict' },
      capacity: 1000,
      id: 'op-1',
    });
    expect(ctx.limits.maxPaginationPasses).toBe(5);
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.config)).toBe(true);
    expect(() => {
      (ctx.config as Record<string, unknown>).mode = 'loose';
    }).toThrow();

    const r = ctx.budget.reserve(100);
    expect(ctx.budget.inUse).toBe(100);
    r.release();
    endOperation(ctx);
    expect(ctx.budget.isDisposed).toBe(true);
  });
});
