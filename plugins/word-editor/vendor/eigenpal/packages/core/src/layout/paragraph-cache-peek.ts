import type { ParagraphLayoutCache } from './layout-cache.ts';

// A side-effect-free view of a paragraph break cache, for speculative layouts.
//
// A probe lays a row out only to learn whether it fits, then discards the result. It must not
// publish or retain anything, so it never writes breaks. Reading them is a different matter:
// a cached break is keyed by every input that decides it, and a probe sends the same inputs a
// placement does, so a hit is exactly the break the probe would measure. Peeking also leaves
// the cache's counters and recency alone, so probes cannot change what a pass reports or
// which entries the budget evicts.

type Peek = (key: string) => unknown;

const peeks = new WeakMap<object, Peek>();
const views = new WeakMap<object, ParagraphLayoutCache<never>>();

/** Internal registration by a cache that supports side-effect-free reads. */
export function registerParagraphCachePeek(cache: object, peek: Peek): void {
  peeks.set(cache, peek);
}

/**
 * A cache that answers from `cache` without touching it and ignores every write, or
 * undefined when `cache` is absent or cannot be read without side effects.
 */
export function readOnlyBreakCache<T>(
  cache: ParagraphLayoutCache<T> | undefined
): ParagraphLayoutCache<T> | undefined {
  if (!cache) return undefined;
  const peek = peeks.get(cache);
  if (!peek) return undefined;
  let view = views.get(cache) as ParagraphLayoutCache<T> | undefined;
  if (!view) {
    const keyFor = cache.keyFor?.bind(cache);
    view = Object.freeze({
      // Misses are discarded: do not freeze copies for a cache that ignores writes.
      retainAcrossPasses: false,
      ...(keyFor ? { keyFor } : {}),
      get: (key: string) => peek(key) as T | undefined,
      set: () => {},
      retain: () => {},
      clear: () => {},
      stats: Object.freeze({ hits: 0, misses: 0, evictions: 0, size: 0 }),
    });
    views.set(cache, view as ParagraphLayoutCache<never>);
  }
  return view;
}
