// The bounded per-root memo evicts by last USE, not by insertion.
//
// Every caller has the same access pattern: a derivation walks the body part and then each
// header, footer and notes part, and only the BODY part is new each revision. Eviction ordered
// by insertion fills the ring with one dead body root per keystroke and drops every furniture
// root inside one typing burst — the memo then works for as many keystrokes as the ring is
// long and re-walks every other story after that.
//
// Asserted on a real ring rather than on timings, because the cost of getting this wrong shows
// up as a slow relayout and never as a failure.

import { describe, expect, test } from 'bun:test';
import { createRecentRootCache } from '../recent-root-cache.ts';

describe('createRecentRootCache', () => {
  test('a root that is still read survives churn that exceeds the limit', () => {
    const cache = createRecentRootCache<string>(4);
    const furniture = { name: 'header1' };
    cache.set(furniture, 'header paragraphs');

    // Far more new roots than the ring holds, each read back the way an edit reads the header.
    const churn: object[] = [];
    for (let revision = 0; revision < 20; revision += 1) {
      const body = { name: `body@${revision}` };
      churn.push(body);
      cache.set(body, `body paragraphs ${revision}`);
      expect(cache.get(furniture), `evicted at revision ${revision}`).toBe('header paragraphs');
    }

    // Still bounded: the oldest body roots are gone, which is the whole point of the ring.
    expect(cache.get(churn[0]!)).toBeUndefined();
    // And the newest are kept.
    expect(cache.get(churn[19]!)).toBe('body paragraphs 19');
  });

  test('a root that is never read is evicted', () => {
    const cache = createRecentRootCache<string>(2);
    const cold = { name: 'cold' };
    cache.set(cold, 'value');
    cache.set({ name: 'a' }, 'a');
    cache.set({ name: 'b' }, 'b');
    expect(cache.get(cold)).toBeUndefined();
  });

  test('re-setting a live root does not drop it', () => {
    const cache = createRecentRootCache<string>(2);
    const root = { name: 'root' };
    cache.set(root, 'first');
    cache.set(root, 'second');
    cache.set({ name: 'other' }, 'other');
    expect(cache.get(root)).toBe('second');
  });
});
