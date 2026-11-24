// What a batch planner needs from its host, and what it gives back. `plan.ts` implements it.
import type { FormattingDisplayMode } from '../store/store/formattable-runs.ts';
import type { StoryScope } from '../store/store/tree-package-store.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation, AutomationSelectionMode } from './operations.ts';
import type { PlannedOperation } from './plan-types.ts';
import type { AutomationCapabilities } from './protocol.ts';
import type { AutomationPackageReads } from './reads.ts';
import type { ResolvedRange } from './spans.ts';
import type { AutomationStoryId } from './stories.ts';

export interface BatchPlannerHost {
  readonly collaborative?: boolean;
  /** The host's document compare engine, when a review module provides one. */
  readonly compareDocuments?: import('../contracts/document-compare.ts').CompareDocumentsEngine;
  /** See `AutomationDocumentPort.setupOutsideUndo`. */
  readonly setupOutsideUndo?: boolean;
  readonly trackedRangeReplacement?: boolean;
  readonly fieldPageContext?: (
    story: AutomationStoryId,
    paragraphId: string,
    fieldNodeId: string
  ) => { pageNumber: number; pageNumberText?: string; pageCount: number } | null;
  readonly handles: AutomationHandleTable;
  readonly reads: AutomationPackageReads;
  readonly capabilities: AutomationCapabilities;
  /** The reader's view — see `AutomationDocumentPort.revisionDisplayMode`. */
  readonly displayMode?: FormattingDisplayMode;
  /** Where a tracked replacement lands — see `AutomationDocumentPort.replacementLanding`. */
  readonly replacementLanding?: (paragraphId: string, start: number, end: number) => number | null;
  /** Moves a reader's caret. Only called when `capabilities.selection` is true. */
  readonly select?: (range: ResolvedRange, mode: AutomationSelectionMode) => boolean;
  /** Why the host cannot select there now — see `AutomationDocumentPort.selectRefusal`. */
  readonly selectRefusal?: (story: AutomationStoryId, paragraphId: string) => string | null;
}

export interface BatchPlanner {
  plan(operation: AutomationOperation, trackingAuthor?: string): PlannedOperation;
  /** Whether any planned operation writes. */
  readonly hasCommands: boolean;
  /**
   * The transaction scope this batch's commands commit through, or null for a read-only batch.
   *
   * ONE scope, because one batch is one transaction and a transaction belongs to one story. A
   * batch mixing two stories' writes is refused while planning rather than split into two
   * commits: two commits are two revisions, two undo units and a window where half the caller's
   * request is published — which is the partial application the batch rule exists to prevent.
   */
  readonly writeScope: StoryScope | null;
  /**
   * Bind created paragraphs and re-aim moved identities against the committed state.
   *
   * Runs before any command answers, and only when a transaction committed. A mismatch here
   * means the planner's picture of what the ops would do disagrees with what they did, which
   * is a bug in the planner rather than in the caller's request — it is reported rather than
   * papered over, because binding a slot to the wrong paragraph would hand back a handle that
   * names the wrong thing forever.
   */
  settle(
    post: AutomationPackageReads
  ):
    | { readonly ok: true }
    | { readonly ok: false; readonly detail: string; readonly selection?: number };
}
