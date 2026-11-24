/**
 * Which review write is being committed through `commitReviewOps`.
 *
 * The callback that performs the write is opaque, so a lane deciding whether to allow it cannot
 * tell an Accept from a comment delete. That mattered once a replica was attached: these paths
 * reach the store directly rather than through `applyTreeOps`, and the ones that graft a package
 * and swap the shell record no primitive effects — they replicate as NOTHING, leaving the peer a
 * `commentReference` naming a comment it never received. Naming the write lets each be admitted
 * only once a two-replica test proves it arrives whole.
 */
export type ReviewWriteIntent =
  | 'revision-resolve'
  | 'revision-attribution'
  | 'comment-add'
  | 'comment-reply'
  | 'comment-resolve'
  | 'comment-edit'
  | 'comment-delete'
  | 'package-scoped';
