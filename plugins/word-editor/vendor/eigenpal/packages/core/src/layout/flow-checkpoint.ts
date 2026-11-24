// Checkpoint lifecycle for one body-flow pass. Placement remains locally mutable; only
// immutable snapshots cross pass boundaries. Solvers and tail-shift policy stay outside.

import type { AnchoredDrawingRecord } from './drawing-layout.ts';
import type { FlowCheckpoint } from './layout-session.ts';
import { samePendingParagraphFrames, type ParagraphFrameFlow } from './paragraph-frame-flow.ts';
import type { BlockFragmentRecord } from './semantic-records.ts';
import { sameHeldTablePages, type TextTableCarry } from './table-text-carry.ts';
import {
  NO_DEFERRED_DRAWINGS,
  NO_DEFER_COUNTS,
  sameAnchoredDrawings,
  sameDeferCounts,
  sameFragments,
} from './semantic-fragment-signature.ts';
import {
  samePositionedTableCheckpoints,
  type positionedTableFlow,
  type PositionedTableAnchorSignal,
} from './table-float-position.ts';

/** Mutable placement values held by the body pass, independent of pending story owners. */
export interface FlowCheckpointPlacement {
  pageCount: number;
  pageFragments: BlockFragmentRecord[];
  pendingAnchoredDrawings: AnchoredDrawingRecord[];
  deferredAnchoredDrawings: AnchoredDrawingRecord[];
  cursorY: number;
  lineCounter: number;
  previousSpaceAfter: number;
  flowColumnIndex: number;
}

interface FlowCheckpointDependencies {
  readonly paragraphFrames: ParagraphFrameFlow;
  readonly positionedFlow: ReturnType<typeof positionedTableFlow>;
  readonly pendingFloatIds: Set<string>;
  readonly floatSignals: PositionedTableAnchorSignal[];
  readonly anchorPageDeferCounts: Map<string, number>;
  /** Fragments of a broken text-anchored table held for later pages (`table-text-carry.ts`). */
  readonly textCarry: TextTableCarry;
}

/** Owns capture, restoration and convergence for one pass's complete checkpoint state. */
export class FlowCheckpointOwner {
  constructor(private readonly dependencies: FlowCheckpointDependencies) {}

  capture(state: FlowCheckpointPlacement): FlowCheckpoint {
    const {
      paragraphFrames,
      positionedFlow,
      pendingFloatIds,
      floatSignals,
      anchorPageDeferCounts,
      textCarry,
    } = this.dependencies;
    const heldTablePages = textCarry.checkpoint();
    return {
      ...(heldTablePages ? { heldTablePages } : {}),
      pageCount: state.pageCount,
      pageFragments: [...state.pageFragments],
      pendingAnchoredDrawings: [...state.pendingAnchoredDrawings],
      pendingParagraphFrames: paragraphFrames.checkpoint(),
      deferredAnchoredDrawings:
        state.deferredAnchoredDrawings.length > 0
          ? [...state.deferredAnchoredDrawings]
          : NO_DEFERRED_DRAWINGS,
      anchorPageDeferCounts:
        anchorPageDeferCounts.size > 0 ? new Map(anchorPageDeferCounts) : NO_DEFER_COUNTS,
      ...positionedFlow.checkpoint(pendingFloatIds, floatSignals),
      cursorY: state.cursorY,
      lineCounter: state.lineCounter,
      previousSpaceAfter: state.previousSpaceAfter,
      flowColumnIndex: state.flowColumnIndex,
    };
  }

  /** Restore pending owners and return fresh mutable collections for resumed placement. */
  restore(checkpoint: FlowCheckpoint): FlowCheckpointPlacement {
    const {
      paragraphFrames,
      positionedFlow,
      pendingFloatIds,
      floatSignals,
      anchorPageDeferCounts,
      textCarry,
    } = this.dependencies;
    textCarry.restore(checkpoint.heldTablePages);
    paragraphFrames.restore(checkpoint.pendingParagraphFrames);
    anchorPageDeferCounts.clear();
    for (const [id, count] of checkpoint.anchorPageDeferCounts)
      anchorPageDeferCounts.set(id, count);
    positionedFlow.restore(checkpoint, pendingFloatIds, floatSignals);
    return {
      pageCount: checkpoint.pageCount,
      pageFragments: [...checkpoint.pageFragments],
      pendingAnchoredDrawings: [...checkpoint.pendingAnchoredDrawings],
      deferredAnchoredDrawings: [...checkpoint.deferredAnchoredDrawings],
      cursorY: checkpoint.cursorY,
      lineCounter: checkpoint.lineCounter,
      previousSpaceAfter: checkpoint.previousSpaceAfter,
      flowColumnIndex: checkpoint.flowColumnIndex,
    };
  }
}

/**
 * Compare in-page flow, reusing the current block's captured snapshot rather than copying
 * prefixes again. Page count is handled by the tail-shift policy; line count is restore-only.
 * Pure comparison also keeps speculative passes independent of the active mutable owners.
 */
export function flowCheckpointsMatch(mark: FlowCheckpoint, current: FlowCheckpoint): boolean {
  return (
    mark.cursorY === current.cursorY &&
    mark.previousSpaceAfter === current.previousSpaceAfter &&
    mark.flowColumnIndex === current.flowColumnIndex &&
    sameFragments(mark.pageFragments, current.pageFragments) &&
    samePendingParagraphFrames(mark.pendingParagraphFrames, current.pendingParagraphFrames) &&
    sameAnchoredDrawings(mark.pendingAnchoredDrawings, current.pendingAnchoredDrawings) &&
    sameAnchoredDrawings(mark.deferredAnchoredDrawings, current.deferredAnchoredDrawings) &&
    sameDeferCounts(mark.anchorPageDeferCounts, current.anchorPageDeferCounts) &&
    samePositionedTableCheckpoints(mark, current) &&
    sameHeldTablePages(mark.heldTablePages, current.heldTablePages)
  );
}
