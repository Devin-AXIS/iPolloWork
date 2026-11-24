// What convergence does with each field of a FLOW CHECKPOINT.
//
// A resumed pass converges when the in-page flow returns to exactly the state the previous
// pass recorded at the same paragraph (`flowCheckpointsMatch` in `flow-checkpoint.ts`). That
// comparison is explicit: a field captured and restored by `FlowCheckpointOwner` but
// missing from the comparison converges a MISMATCHED flow, and ships the silent failure this
// lane has been bitten by before — `deferredAnchoredDrawings` was exactly that field once
// (see the comment on it in `layout-session.ts`).
//
// This is `PAGE_REUSE_GUARDS` for the checkpoint: the set, written down and type-checked. A
// new `FlowCheckpoint` field is a type error here until somebody says what convergence does
// with it, and the companion test changes every field to verify its declared convergence behavior.

import type { FlowCheckpoint } from './layout-session.ts';

/** What convergence does with a checkpoint field. */
export type FlowCheckpointGuard =
  /** Compared at every paragraph of the unchanged tail; a mismatch keeps laying out. */
  | 'compared'
  /**
   * Not an equality: convergence computes the whole-sheet shift from it (`pages.length -
   * mark.pageCount`), and `convergenceTailShiftAllowed` decides whether that shift is
   * reusable.
   */
  | 'delta'
  /**
   * Restored on resume, deliberately NEVER compared by convergence. Only `lineCounter`
   * holds this role: line ids are paragraph-local, so a changed line count before the join
   * cannot invalidate the tail — the terminal count is still carried forward so a
   * multi-section orchestrator receives the correct number for the revision. Promoting a
   * field to this role needs that same argument, written where the field is declared.
   */
  | 'restore-only';

export const FLOW_CHECKPOINT_GUARDS = {
  pageCount: 'delta',
  pageFragments: 'compared', // sameFragments — structural, via the fragment signature
  pendingParagraphFrames: 'compared', // ParagraphFrameFlow.same
  pendingAnchoredDrawings: 'compared', // sameAnchoredDrawings — reference per record
  // A flow that still owes the next page a drawing is not one that owes it nothing.
  deferredAnchoredDrawings: 'compared', // sameAnchoredDrawings
  anchorPageDeferCounts: 'compared', // sameDeferCounts
  pendingPositionedTableTokens: 'compared',
  positionedTableAnchorSignals: 'compared',
  // A flow that still owes later pages table fragments is not one that owes them nothing.
  heldTablePages: 'compared', // sameHeldTablePages
  cursorY: 'compared',
  lineCounter: 'restore-only',
  previousSpaceAfter: 'compared',
  flowColumnIndex: 'compared',
} as const satisfies Record<keyof FlowCheckpoint, FlowCheckpointGuard>;

/**
 * Fields a checkpoint actually carries that the table above does not classify.
 *
 * The `satisfies` clause catches a field added to the INTERFACE. This catches the other
 * direction — a checkpoint built by `FlowCheckpointOwner.capture` with a key the interface never declared.
 */
export function unguardedCheckpointFields(checkpoint: FlowCheckpoint): readonly string[] {
  return Object.keys(checkpoint).filter((key) => !(key in FLOW_CHECKPOINT_GUARDS));
}
