// A WeakMap memo for values derived per part ROOT, bounded to the most recently USED roots.
//
// Why not a plain WeakMap: the undo history retains up to 200 package snapshots by
// reference, and every root it keeps alive would keep its O(document) derived map alive
// with it — an accept/reject-heavy session on a long document would hold hundreds of full
// site indexes that were transient before memoization. The ring holds WeakRefs, so it
// never extends a root's lifetime; it only decides how many still-living roots keep their
// derived value. An evicted root that comes back (an undo past the window) simply
// recomputes.
//
// Recently USED, not recently ADDED. Eviction ordered by insertion alone is wrong for the
// access pattern every caller has: a derivation walks the body part and then each header,
// footer and notes part, and only the BODY part is new each revision. So a plain queue fills
// with one dead body root per keystroke and evicts every furniture root within a burst — the
// memo then works for as many keystrokes as the ring is long, and re-walks every other story
// after that. Refreshing on `get` keeps a root that is still being read, which is the one
// worth keeping.

interface RecentRootCache<V> {
  get(root: object): V | undefined;
  set(root: object, value: V): void;
}

/**
 * `WeakRef` is ES2021 and the workspace tsconfigs pin `lib` at ES2020, so the global is
 * declared here rather than raising every package's lib: every supported runtime (Node
 * 14.6+, all evergreen browsers) ships it.
 */
interface RootWeakRef {
  deref(): object | undefined;
}
declare const WeakRef: new (target: object) => RootWeakRef;

export function createRecentRootCache<V>(limit: number): RecentRootCache<V> {
  const values = new WeakMap<object, V>();
  const recent: RootWeakRef[] = [];

  /** Moves a root's newest ring slot to the back, so eviction sees it as freshly used. */
  const touch = (root: object): void => {
    for (let index = recent.length - 1; index >= 0; index -= 1) {
      if (recent[index]!.deref() !== root) continue;
      // Reuse the existing `WeakRef` rather than minting one: the ring can hold a root twice
      // after a re-cache, and the older slot is left alone for `set`'s eviction guard.
      const [ref] = recent.splice(index, 1);
      recent.push(ref!);
      return;
    }
  };

  return {
    get(root) {
      const value = values.get(root);
      if (value !== undefined) touch(root);
      return value;
    },
    set(root, value) {
      if (!values.has(root)) {
        recent.push(new WeakRef(root));
        while (recent.length > limit) {
          const evicted = recent.shift()!.deref();
          // Evict only when no fresher ring slot names the same root — a root re-cached
          // after eviction sits in the ring twice, and deleting on the stale slot would
          // drop a live entry.
          if (evicted && !recent.some((ref) => ref.deref() === evicted)) {
            values.delete(evicted);
          }
        }
      } else touch(root);
      values.set(root, value);
    },
  };
}
