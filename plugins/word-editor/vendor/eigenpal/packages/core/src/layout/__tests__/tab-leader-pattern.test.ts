import { expect, test } from 'bun:test';
import { MAX_TAB_LEADER_GLYPHS, tabLeaderPattern } from '../tab-leader-pattern.ts';

test('different labels share leader columns and paint only full advances', () => {
  for (const start of [72, 73.1, 101.9, -7]) {
    const width = 48.2;
    const advance = 3.056;
    const pattern = tabLeaderPattern(start, width, advance);
    const first = start + pattern.offsetPt;
    expect(first / advance).toBeCloseTo(Math.round(first / advance), 8);
    expect(first).toBeGreaterThanOrEqual(start);
    expect(first + pattern.count * advance).toBeLessThanOrEqual(start + width + 1e-8);
    expect(first + (pattern.count + 1) * advance).toBeGreaterThan(start + width);
  }
});

test('invalid or too narrow gaps paint nothing and oversized repetition is bounded', () => {
  expect(tabLeaderPattern(1, 1, 3).count).toBe(0);
  for (const bad of [NaN, Infinity, -Infinity]) {
    expect(tabLeaderPattern(bad, 20, 3).count).toBe(0);
    expect(tabLeaderPattern(0, bad, 3).count).toBe(0);
    expect(tabLeaderPattern(0, 20, bad).count).toBe(0);
  }
  expect(tabLeaderPattern(0, 20, 0).count).toBe(0);
  expect(tabLeaderPattern(0, 1e6, 0.001).count).toBe(MAX_TAB_LEADER_GLYPHS);
  expect(tabLeaderPattern(0.1 + 0.2, 0.6, 0.3)).toEqual({ offsetPt: 0, count: 2 });
});
