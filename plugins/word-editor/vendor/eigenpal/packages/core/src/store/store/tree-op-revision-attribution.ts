// Who a tracked edit is recorded under, and the one guard that says when it cannot be.
//
// Split out of `tree-op-types.ts` only because that file sits at its line cap: the ops union
// is the thing it exists for, and this is the smallest self-contained neighbour. Re-exported
// from there, so every existing importer keeps its path.

/**
 * How a tracked change is addressed: `@w:id`, `@w:author` and `@w:date` together, within a
 * part.
 *
 * All of them, always. `@w:id` is unique only within a part, so an id alone names two
 * revisions in any package with a header or a comments part — and it is not author-scoped
 * either, so `(part, id)` would merge two authors' distinct revisions. One logical revision is
 * also deliberately many elements sharing an id, as a tracked row insertion is, which no
 * uniqueness rule could express.
 */
export interface RevisionAddress {
  readonly id: string;
  readonly author: string;
  /** Absent when the file wrote no `@w:date`; part of the identity either way. */
  readonly date?: string;
}

/** The author and timestamp a tracked edit is recorded under. */
export interface RevisionAttributionInput {
  readonly author: string;
  /** ISO-8601. Omitted writes no `@w:date`. */
  readonly date?: string;
}

/**
 * Whether an attribution cannot serialize, spelled ONCE for every validator.
 *
 * `CT_TrackChange` makes `@w:author` required, so an absent or whitespace-only author is a
 * proposal no reader can attribute or resolve. Callers whose op makes the attribution
 * OPTIONAL pass `op.revision` and skip the check when it is undefined; callers that require
 * one refuse undefined themselves. The guard used to be copy-pasted per op, and the copies
 * drifted: table rows refused a whitespace-only author while text inserts accepted it.
 */
export function invalidRevisionAttribution(revision: RevisionAttributionInput): boolean {
  return (
    typeof revision.author !== 'string' ||
    revision.author.trim().length === 0 ||
    (revision.date !== undefined && typeof revision.date !== 'string')
  );
}
