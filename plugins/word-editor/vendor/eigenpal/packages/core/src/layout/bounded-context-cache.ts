// Per-page layout contexts of one header or footer story, bounded and least recently used.

/** A least-recently-used map with a bound that can only grow. */
export function createBoundedContextCache<T>(maxEntries: number): {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  /** Raise the bound; it never shrinks, so entries already held are never dropped by it. */
  growTo(size: number): void;
  readonly size: number;
} {
  let capacity = Math.max(1, Math.floor(maxEntries));
  const entries = new Map<string, T>();
  return {
    growTo(size) {
      if (Number.isFinite(size) && size > capacity) capacity = Math.floor(size);
    },
    get(key) {
      const value = entries.get(key);
      if (value === undefined) return undefined;
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      if (entries.has(key)) entries.delete(key);
      entries.set(key, value);
      while (entries.size > capacity) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },
    get size() {
      return entries.size;
    },
  };
}
