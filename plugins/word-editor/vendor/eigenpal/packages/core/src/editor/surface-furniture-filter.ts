// Which revision filter each header and footer source was made with.
//
// A furniture source keeps the filter it was created with. The surface's filter moves when an
// author filter or display setting changes, and also when the records the review queue leaves
// out change, so the source has to be remade for those records to paint the way the body does.

import type { RevisionAuthorFilter } from '../layout/revision-projection.ts';

export function createFurnitureFilterMemo(): {
  /** Note that `source` was made with `filter`. */
  record(source: object, filter: RevisionAuthorFilter | undefined): void;
  /** Whether `filter` differs from the one `source` was made with. */
  moved(source: object, filter: RevisionAuthorFilter | undefined): boolean;
} {
  const made = new WeakMap<object, readonly [string | undefined, unknown]>();
  return {
    record(source, filter) {
      made.set(source, [filter?.cacheKey, filter?.unlisted]);
    },
    moved(source, filter) {
      const [key, unlisted] = made.get(source) ?? [];
      return filter?.cacheKey !== key || filter?.unlisted !== unlisted;
    },
  };
}
