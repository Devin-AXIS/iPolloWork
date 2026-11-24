import type { ReviewWriteIntent } from './paginated-surface-contract.ts';

/**
 * The review writes a replica admits, and nothing else.
 *
 * FAIL CLOSED, including for an unnamed intent. Review writes reach the store directly instead of
 * through `applyTreeOps`, and the ones that graft a package and swap the shell record no primitive
 * effects, so they replicate as nothing at all — the peer keeps a `commentReference` naming a
 * comment it never got, which is a corrupt document produced silently. A refusal the user can see
 * is the better failure. Add an intent here only with a two-replica test behind it.
 *
 * Every admitted intent has two-replica coverage. The set stays fail-closed so each new
 * review write declares itself before a replica carries it.
 */
export const REPLICABLE_REVIEW_WRITES: ReadonlySet<ReviewWriteIntent> = new Set<ReviewWriteIntent>([
  'comment-add',
  'comment-delete',
  'comment-reply',
  'comment-resolve',
  'comment-edit',
  'package-scoped',
  'revision-resolve',
  'revision-attribution',
]);
