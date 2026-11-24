// N/N+1 boundary coverage for EVERY resource limit plus the deterministic memory
// substitute (document-engine task 2.1).

import { describe, expect, test } from 'bun:test';
import {
  resolveLimits,
  LIMIT_SPECS,
  LIMIT_KEYS,
  makeLimitCounter,
  DeterministicMemoryMeter,
  assertLimitInvariants,
  LimitExceededError,
} from '../runtime/index.ts';

describe('limit specs', () => {
  test('every limit declares a unit and phase, and invariants hold', () => {
    expect(() => assertLimitInvariants()).not.toThrow();
    for (const key of LIMIT_KEYS) {
      expect(LIMIT_SPECS[key].unit).toBeTruthy();
      expect(LIMIT_SPECS[key].phase).toBeTruthy();
    }
  });
});

describe('N / N+1 for every limit', () => {
  // A small explicit limit per key so the boundary is cheap to exercise.
  const smallLimits = resolveLimits(Object.fromEntries(LIMIT_KEYS.map((k) => [k, 3])));

  for (const key of LIMIT_KEYS) {
    test(`${key}: N units follow policy, N+1 fails before over-allocation`, () => {
      const limit = smallLimits[key];
      // N: consume exactly the limit.
      const atN = makeLimitCounter(smallLimits, key);
      for (let i = 0; i < limit; i++) atN.add(1);
      expect(atN.current).toBe(limit);
      // N+1: the next unit must fail closed.
      expect(() => atN.add(1)).toThrow(LimitExceededError);
      expect(atN.current).toBe(limit); // unchanged on rejection
    });
  }
});

describe('deterministic memory meter', () => {
  test('tracks current/peak and fails closed past the ceiling', () => {
    const m = new DeterministicMemoryMeter(100);
    m.allocate(60);
    m.allocate(30);
    expect(m.currentBytes).toBe(90);
    expect(m.peakBytes).toBe(90);
    m.free(50);
    expect(m.currentBytes).toBe(40);
    expect(m.peakBytes).toBe(90); // peak retained
    expect(() => m.allocate(70)).toThrow(LimitExceededError); // 40+70 > 100
    expect(m.currentBytes).toBe(40);
  });
  test('reset releases everything (cancellation/cleanup path)', () => {
    const m = new DeterministicMemoryMeter(100);
    m.allocate(80);
    m.reset();
    expect(m.currentBytes).toBe(0);
    expect(() => m.allocate(100)).not.toThrow();
  });
});
