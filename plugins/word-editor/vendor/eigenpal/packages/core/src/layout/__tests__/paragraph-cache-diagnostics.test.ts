import { expect, test } from 'bun:test';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import {
  paragraphBreakPayload,
  paragraphCacheDiagnostics,
} from '../paragraph-cache-diagnostics.ts';
import type { PendingLine } from '../pending-line.ts';

const snapshot = (cache: object) => paragraphCacheDiagnostics(cache)!;

test('diagnostic reads do not count as hits or change LRU, and limits have distinct causes', () => {
  const cache = createParagraphLayoutCache<number>({ maxEntries: 1 });
  cache.set('old', 1);
  cache.retain(new Set());
  const before = cache.stats;
  expect(snapshot(cache).keyTextBytes).toBe(6);
  expect(cache.stats).toEqual(before);
  cache.set('new', 2);
  expect(snapshot(cache).softLimitEvictions).toBe(1);
  for (let i = 0; i < 8; i++) cache.set(`key${i}`, i);
  const current = snapshot(cache);
  expect(current.size).toBe(8);
  expect(current.hardLimitEvictions).toBe(1);
  expect(current.evictions).toBe(
    current.softLimitEvictions + current.hardLimitEvictions + current.staleEvictions
  );
  expect(Object.isFrozen(current)).toBe(true);
});

test('retention, overwrite, one-shot release and clear report their own lifetimes', () => {
  const cache = createParagraphLayoutCache<number>({ retainAcrossPasses: false });
  cache.set('same', 1);
  cache.set('same', 2);
  expect(snapshot(cache).keyTextBytes).toBe(8);
  cache.release!('same');
  cache.release!('same');
  expect(snapshot(cache).releasedEntries).toBe(1);
  expect(snapshot(cache).keyTextBytes).toBe(0);
  cache.set('stale', 1);
  for (let i = 0; i < 9; i++) cache.retain(new Set());
  expect(snapshot(cache).staleEvictions).toBe(1);
  cache.set('clear', 1);
  cache.clear();
  expect(snapshot(cache).clearedEntries).toBe(1);
  expect(snapshot(cache).size).toBe(0);
  expect(snapshot(cache).keyTextBytes).toBe(0);
});

test('live release is a no-op, separate caches stay separate, custom caches are unsupported', () => {
  const live = createParagraphLayoutCache<number>();
  live.set('x', 1);
  live.release!('x');
  expect(snapshot(live).releasedEntries).toBe(0);
  expect(snapshot(live).size).toBe(1);
  expect(snapshot(createParagraphLayoutCache()).size).toBe(0);
  expect(paragraphCacheDiagnostics({})).toBeUndefined();
});

test('broken-line payloads deduplicate shared records and vanish after clear', () => {
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  const span = { text: 'a😀' } as PendingLine['spans'][number];
  const line = { spans: [span], drawings: [] } as unknown as PendingLine;
  const second = { spans: [span], drawings: [] } as unknown as PendingLine;
  cache.set('a', [line, second]);
  cache.set('b', [line]);
  const payload = paragraphBreakPayload(cache)!;
  expect(payload).toEqual({ uniqueLines: 2, uniqueSpans: 1, spanTextBytes: 6, uniqueDrawings: 0 });
  expect(Object.isFrozen(payload)).toBe(true);
  expect(cache.stats.hits).toBe(0);
  cache.clear();
  expect(paragraphBreakPayload(cache)!.uniqueLines).toBe(0);
  expect(payload.uniqueLines).toBe(2);
});
