// Incremental layout session state (single- and multi-section).
//
// Separate from the paragraph break cache: the cache stores how a paragraph BREAKS; this
// stores where the flow WAS. One survives reflow, the other is invalidated by it.

import type { PendingParagraphFrames } from './paragraph-frame-flow.ts';
import type { AnchoredDrawingRecord } from './drawing-layout.ts';
import type { PageRecord, SemanticLayout } from './semantic-records.ts';
import type { PositionedTableAnchorSignal } from './table-float-position.ts';

/** The flow state as it stood immediately before one block was placed. */
export interface FlowCheckpoint {
  /** Completed pages at this point. The prefix of the previous layout that still stands. */
  readonly pageCount: number;
  /** Fragments already on the page being built. */
  readonly pageFragments: readonly import('./semantic-records.ts').BlockFragmentRecord[];
  /** Anchored drawings already collected for the open page. */
  readonly pendingAnchoredDrawings: readonly AnchoredDrawingRecord[];
  /** Local frame paragraphs waiting for their next regular paragraph anchor. */
  readonly pendingParagraphFrames?: PendingParagraphFrames;
  /**
   * Anchored drawings overlap resolution pushed onto the NEXT page, and how many times each
   * drawing has been pushed.
   *
   * Flow state like the rest of this record, and carried for the same reason: a resume that
   * started with an empty list dropped a drawing that the previous pass had deferred but not
   * yet placed, and a convergence that did not compare them accepted a flow that still owed
   * the next page a drawing as equal to one that owed it nothing.
   */
  readonly deferredAnchoredDrawings: readonly AnchoredDrawingRecord[];
  readonly anchorPageDeferCounts: ReadonlyMap<string, number>;
  /** Sheet-positioned tables and zero-line anchors still owed by the open page. */
  readonly pendingPositionedTableTokens?: import('./table-float-position.ts').PendingPositionedTableTokens;
  readonly positionedTableAnchorSignals?: readonly PositionedTableAnchorSignal[];
  /** Fragments of a broken text-anchored table held for later pages (`table-text-carry.ts`). */
  readonly heldTablePages?: import('./table-text-carry.ts').HeldTablePages;
  readonly cursorY: number;
  readonly lineCounter: number;
  /** Trailing paragraph spacing participating in adjacent-spacing collapse. */
  readonly previousSpaceAfter: number;
  /** Active column index when the section uses multiple columns. */
  readonly flowColumnIndex: number;
}

/**
 * What the last layout pass actually did — the observable evidence that incremental layout is
 * working.
 *
 * `reusedPages` and `fullPasses` are the ones that matter: a typing keystroke that rebuilds every
 * page produces identical output and unusable performance, so the tests assert on these rather
 * than on the rendered result.
 */
export interface LayoutSessionStats {
  /** Paragraphs placed by the last pass, against the number in the document. */
  readonly placed: number;
  readonly total: number;
  /** Pages carried over from the previous layout without being rebuilt. */
  readonly reusedPages: number;
  /** Passes that could not resume and laid the document out from the top. */
  readonly fullPasses: number;
}

/** One section's place on the previous document sheet stack. */
export interface SectionStackSpan {
  readonly startIndex: number;
  readonly pageCount: number;
  readonly sheetY: number;
  /** Remapped pages (projectors intact) from the last pass for this section. */
  readonly remappedPages: readonly PageRecord[];
  /**
   * The section-local pages this span's pass returned — identity evidence for reuse. (On a
   * continuous section the host tail merges instead of remapping, so `remappedPages` covers
   * only the overflow sheets while this list still holds every returned page.)
   *
   * A section can lay out more than once inside one document pass (a reserve re-run, a
   * balancing probe), and the last run then reports "nothing placed" against its OWN session
   * even though an earlier run this pass rebuilt the pages. Counts and stats cannot tell
   * those apart; only these object identities can say the span still describes the pages the
   * section just returned.
   */
  readonly sourcePages: readonly PageRecord[];
  /** The blank parity sheet published in front of the section, kept for identity reuse. */
  readonly paritySheet?: PageRecord;
}

/** Orchestrator state for multi-section incremental layout. */
export interface MultiSectionLayoutState {
  structureKey: string;
  /** Each section's part of {@link structureKey}, so an added section keeps the others. */
  sectionKeys: readonly string[];
  sections: LayoutSession[];
  spans: SectionStackSpan[];
  previousRemapped: readonly PageRecord[];
  previousFinalized: SemanticLayout | null;
  previousPageCount: number;
  /**
   * The PAGEREF assignment token of the pages behind `previousFinalized`. A target can move
   * sheets while the TOC page's own remapped record stays identity-unchanged, so the finalized
   * restore must compare this before handing back a previously substituted sheet.
   */
  previousPageRefToken: string;
}

/**
 * Carried-over state that makes layout incremental.
 *
 * A caller creates one and hands the SAME object back each pass. It holds the previous pages, the
 * per-block cache keys and the flow checkpoints a pass resumes from, so an edit low in a document
 * re-lays only what follows it. A no-change pass returns the previous pages by identity.
 */
export interface LayoutSession {
  /** @internal Mutable across passes; a caller only creates one and passes it back. */
  previous: SemanticLayout | null;
  checkpoints: FlowCheckpoint[];
  keys: string[];
  /** Geometry and flow context of the previous pass; a change forces a full pass. */
  context: string;
  /**
   * Producer of the previous pass, compared beside {@link context} rather than embedded in
   * it: the producer carries the content-control token, which runs to kilobytes on a
   * control-heavy document, and embedding it copied that token into every section's context
   * string on every pass. Identity-stable when unchanged, so the comparison is a pointer
   * check.
   *
   * Optional so a session literal built before this field existed still type-checks; an
   * absent producer never matches and forces a conservative full pass.
   */
  producer?: string;
  /**
   * Whether the previous pass read page PARITY: even/odd header variants, or an anchored
   * drawing positioned against an inside/outside frame or alignment.
   *
   * The document page index is not part of {@link context} — page numbers re-project at
   * finalize and page shells renumber at remap — so parity is the only page-position input
   * that can invalidate a section's layout. Tracked separately so the common document pays
   * nothing for a start-index shift.
   */
  parityDependent: boolean;
  /** Parity (0/1) of the document page index this session's layout started on. */
  startPageParity: number;
  /**
   * The section's memoized prepass (prepared blocks, cache keys, flow keys, document
   * order), reused verbatim while its inputs are unchanged. Opaque here: the shape is
   * owned by `semantic-layout.ts`, which is the only reader and writer.
   */
  prepass: unknown;
  /**
   * The notes pass's memoized state (reference hits, mark contexts, per-page attach
   * results), reused while its inputs are unchanged. Opaque here: the shape is owned by
   * `note-pagination.ts`, which is the only reader and writer.
   */
  notes: unknown;
  /** Line counter at the start of the previous pass, for translating reused section counts. */
  startLineCounter: number;
  /**
   * Line counter after the last block of the previous pass.
   *
   * Multi-section orchestration threads a global line counter across sections; early-exit
   * paths (unchanged / converged) must report this rather than the resume cursor.
   */
  endLineCounter: number;
  /**
   * Flow state after the last block of the previous pass, for a section that CONTINUES
   * onto this one's last sheet (`w:type="continuous"`).
   *
   * `endCursorY` is the used height of that sheet's content column; `endSpaceAfter` is the
   * trailing paragraph spacing still eligible for adjacent-spacing collapse. Reported by
   * the early-exit paths (unchanged / converged) for the same reason as
   * {@link endLineCounter}: the resume cursor is not the end of the flow.
   */
  endCursorY: number;
  endSpaceAfter: number;
  /** Whether the last page of that pass was still open (no trailing page break). */
  endsOpenPage: boolean;
  stats: LayoutSessionStats;
  /**
   * Column-height limit chosen by the last balanced multi-column pass, or null when the
   * last pass did not balance.
   *
   * Lets the next pass try the remembered limit FIRST: an unchanged balanced section
   * early-exits on that single attempt instead of re-running the natural pass and the
   * whole balance search every time.
   */
  balanceLimit: number | null;
  /** Present when the last pass was multi-section; child sessions live here. */
  multi: MultiSectionLayoutState | null;
  /**
   * Page-bottom footnote reserves from the last published notes layout.
   *
   * Seeded into the next {@link layoutSemanticDocumentWithNotesSteps} call so the first body
   * pass already matches the reserved context key — without this, every notes document
   * starts empty, mismatches, and throws away the session on reflow.
   */
  notePageBottomReserves: ReadonlyMap<number, number> | null;
}

/**
 * A layout session, retained across revisions by the caller.
 */
export function createLayoutSession(): LayoutSession {
  return {
    previous: null,
    checkpoints: [],
    keys: [],
    context: '',
    producer: '',
    parityDependent: false,
    startPageParity: 0,
    prepass: null,
    startLineCounter: 0,
    endLineCounter: 0,
    endCursorY: 0,
    endSpaceAfter: 0,
    endsOpenPage: true,
    stats: { placed: 0, total: 0, reusedPages: 0, fullPasses: 0 },
    balanceLimit: null,
    multi: null,
    notePageBottomReserves: null,
    notes: null,
  };
}

/** Replace retained incremental state while making new fields an exhaustive compile-time gate. */
export function replaceLayoutSession(target: LayoutSession, source: LayoutSession): void {
  const replacement = {
    previous: source.previous,
    checkpoints: source.checkpoints,
    keys: source.keys,
    context: source.context,
    producer: source.producer,
    parityDependent: source.parityDependent,
    startPageParity: source.startPageParity,
    prepass: source.prepass,
    notes: source.notes,
    startLineCounter: source.startLineCounter,
    endLineCounter: source.endLineCounter,
    endCursorY: source.endCursorY,
    endSpaceAfter: source.endSpaceAfter,
    endsOpenPage: source.endsOpenPage,
    stats: source.stats,
    balanceLimit: source.balanceLimit,
    multi: source.multi,
    notePageBottomReserves: source.notePageBottomReserves,
  } satisfies LayoutSession & Record<keyof LayoutSession, unknown>;
  Object.assign(target, replacement);
}

/**
 * The checkpoints a converged pass leaves. It stops early, so the tail's checkpoints were never
 * recomputed. The previous pass's remain valid because the flow matched at the join, with their
 * completed-page counts moved by however many sheets the reused tail moved.
 */
export function convergedCheckpoints(
  fresh: readonly FlowCheckpoint[],
  previous: readonly FlowCheckpoint[],
  join: { readonly at: number; readonly removedBlocks: number; readonly pageDelta: number }
): FlowCheckpoint[] {
  const tail = previous.slice(join.at + join.removedBlocks);
  return [
    ...fresh.slice(0, join.at),
    ...(join.pageDelta === 0
      ? tail
      : tail.map((checkpoint) => ({
          ...checkpoint,
          pageCount: checkpoint.pageCount + join.pageDelta,
        }))),
  ];
}

/**
 * Whether the session's layout depends on page parity after a pass. Sticky whenever any part of
 * the previous layout was reused: a resumed pass never re-places the prefix and a converged pass
 * never re-places the tail, so their parity-reading anchors could not report this pass. Only a
 * pass that placed everything (`placedAll`: full start, no convergence) may clear it.
 */
export function nextParityDependent(
  previous: boolean,
  thisPass: boolean,
  placedAll: boolean
): boolean {
  return placedAll ? thisPass : previous || thisPass;
}
