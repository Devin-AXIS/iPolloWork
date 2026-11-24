// A weak reference, for caches that remember the last revision of something without keeping a
// closed or reloaded document alive.
//
// `WeakRef` is ES2021 and the workspace tsconfigs pin `lib` at ES2020, so the global is declared
// here once, as `recent-root-cache.ts` declares its own.

/** A weak reference to `T`: `deref()` answers it, or undefined once it was collected. */
export interface WeakRefOf<T extends object> {
  deref(): T | undefined;
}

declare const WeakRef: new <T extends object>(target: T) => WeakRefOf<T>;

/** A weak reference to `target`. */
export function weakRefOf<T extends object>(target: T): WeakRefOf<T> {
  return new WeakRef(target);
}
