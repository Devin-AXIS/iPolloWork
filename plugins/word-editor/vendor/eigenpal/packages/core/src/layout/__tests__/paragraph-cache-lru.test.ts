import { expect, test } from 'bun:test';
import { ParagraphCacheLru } from '../paragraph-cache-lru.ts';

test('cache recency matches a map model across touches, replacements, and deletions', () => {
  const cache = new ParagraphCacheLru<number>();
  const model = new Map<string, number>();
  let random = 7;
  for (let step = 0; step < 2000; step++) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const key = String(random % 23);
    const operation = (random >>> 8) % 5;
    if (operation === 0) {
      expect(cache.delete(key)).toBe(model.delete(key));
    } else if (operation === 1) {
      const value = model.get(key);
      expect(cache.get(key, true)).toBe(value);
      if (value !== undefined) {
        model.delete(key);
        model.set(key, value);
      }
    } else if (operation === 2) {
      expect(cache.get(key)).toBe(model.get(key));
    } else {
      cache.set(key, step);
      model.delete(key);
      model.set(key, step);
    }
    expect(cache.size).toBe(model.size);
    const first = model.entries().next().value;
    if (first) expect(cache.oldest()).toMatchObject({ key: first[0], value: first[1] });
    else expect(cache.oldest()).toBeUndefined();
  }
  cache.clear();
  expect(cache.size).toBe(0);
  expect(cache.oldest()).toBeUndefined();
  cache.set('fresh', 1);
  expect(cache.oldest()).toMatchObject({ key: 'fresh', value: 1 });
});

test('weights follow sets, overwrites and deletions; oldest-first iteration survives deletes', () => {
  const cache = new ParagraphCacheLru<string>();
  cache.set('a', 'a', 10);
  cache.set('b', 'b', 20);
  cache.set('c', 'c', 30);
  cache.set('a', 'a2', 5);
  expect(cache.bytes).toBe(55);
  expect([...cache.fromOldest()].map((entry) => entry.key)).toEqual(['b', 'c', 'a']);
  for (const entry of cache.fromOldest()) if (entry.key !== 'c') cache.delete(entry.key);
  expect(cache.bytes).toBe(30);
  expect([...cache.fromOldest()].map((entry) => entry.key)).toEqual(['c']);
  expect(cache.entry('c')).toMatchObject({ value: 'c', bytes: 30, touched: 0, named: -1 });
  cache.clear();
  expect(cache.bytes).toBe(0);
});
