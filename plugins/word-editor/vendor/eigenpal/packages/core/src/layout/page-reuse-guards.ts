// What keeps each field of a REUSED page current.
//
// A page is reused whole. Convergence appends `previous.pages.slice(...)` and the unchanged
// exit returns the previous pages by identity, so nothing compares a page field by field the
// way `fragmentSignature` compares a fragment. Every field is guarded somewhere else instead,
// and each of those guards is hand-written and lives in a different file.
//
// This is that set, written down and type-checked. A new field on `PageRecord` is a type
// error here until somebody says which mechanism keeps it current, because the failure it
// would otherwise ship is silent: a reused page showing a value the document no longer has.

import type { PageRecord } from './semantic-records.ts';

/** How a page field stays current across a pass that reuses the page it sits on. */
export type PageReuseGuard =
  /** The page's own name in the previous layout; reuse is the point, not a hazard. */
  | 'identity'
  /**
   * Folded into the session `context` string (`semantic-layout.ts`, `const context =`). A
   * change there makes the session incomparable, so the pass cannot resume at all.
   */
  | 'context'
  /**
   * Carried by the flow and compared where a pass may stop early: fragments through
   * `fragmentSignature`, anchored drawings through `sameAnchoredDrawings`, and the blocks
   * that produce both through their per-block keys.
   */
  | 'flow'
  /** Re-derived over the assembled page list every pass, so a reused page is re-annotated. */
  | 'rebuilt'
  /**
   * A pure function of another field that is ALREADY guarded, computed at page build from it,
   * so it cannot be stale unless that field is — and that field's guard already prevents it.
   * The same role `semantic-fragment-signature.ts` calls `covered`. Only a field with that
   * proof gets this; it is not a place to park a field whose mechanism is merely unclear.
   */
  | 'covered';

export const PAGE_REUSE_GUARDS = {
  id: 'identity',
  index: 'identity',
  // Page geometry opens the context string, so a margin or sheet change is a full pass by
  // construction.
  box: 'context',
  // Geometry, and then the SAME furniture argument `header` and `footer` make below, because
  // each page derives this from the variant it shows: `furnitureContext` folds every variant's
  // flow height, so a header edit that moves the push-down invalidates the context. What
  // context cannot answer is a page keeping its box while its INDEX moves — which is why
  // `convergenceTailShiftAllowed` refuses a tail shift across index 0 whenever page 0 resolves
  // a box its neighbours do not (`titlePage`, `continuedInsets`), and why a sheet minted after
  // layout resolves its own index's insets rather than cloning the template's
  // (`page-furniture-insets.ts`, `cloneEmptyOverflowPage`).
  contentBox: 'context',
  fragments: 'flow',
  // Computed in `flushPage` from the page's own fragments — true when any span carries the
  // body page-field marker. A pure function of `fragments` (`flow`), so a reused page whose
  // fragments are unchanged cannot carry a stale flag. It only gates whether the
  // `pageFieldSource`-driven body substitution runs; the value it substitutes is `rebuilt`
  // every pass, so a numbering-only change still re-runs it on a page whose flag stays true.
  hasBodyPageFields: 'covered',
  // `columnsContext` carries `w:cols`. Note that a multi-column section DOES reach reuse: the
  // resume and convergence paths require `resumable`, which is single-column, but the
  // unchanged-document exit gates on `comparable` and returns the previous pages by identity.
  columnSeparators: 'context',
  // A pure function of (`w:pgBorders`, page geometry, SECTION-local page index). The first two
  // are in the context string — `pageBordersContext` folds the frame, which nothing else in
  // that string covers because a frame edit moves no paragraph key. The third is why
  // `convergenceTailShiftAllowed` counts a `firstPage` / `notFirstPage` frame among the
  // reasons index 0 differs from its neighbours: shifting such a tail across page 0 would
  // carry a frame the sheet no longer resolves.
  pageBorders: 'context',
  // Produced by the blocks on the page: the per-block key carries the drawing token, and the
  // open page's pending and deferred lists are compared where a pass may stop early. Their
  // POSITION also depends on the furniture, because a page-frame anchor resolves against the
  // content-box inset a tall header or footer moves (#274) — `furnitureContext` carries each
  // variant's flow height, so that half is `context`.
  anchoredDrawings: 'flow',
  // `furnitureContext` folds each variant's flow height, content key and drawing-resource
  // token, which is what a header or footer edit moves. The PAGE/NUMPAGES/SECTIONPAGES text
  // inside the furniture is the one part a reused sheet can hold stale: finalize strips the
  // story's projector, so `finalizePageFieldProjection` retains it on the side and
  // re-projects a reused story whose page context moved (#441).
  header: 'context',
  footer: 'context',
  // `attachNotesToLayout` rebuilds the note areas over the assembled pages every pass, and
  // the reserves and every derived mark are in the context besides.
  footnotes: 'rebuilt',
  endnotes: 'rebuilt',
  noteStream: 'rebuilt',
  // Minted by the multi-section loop from the section-start parity it re-derives every pass.
  parityBlank: 'rebuilt',
  // Every reuse path revalidates the stamped numbering before returning a prior record: the
  // publish memo keys on (pageNumber, sectionPageCount, format), and the span-identity branch
  // checks the same values against its first page — so a PAGE or SECTIONPAGES move always
  // reaches `withPageFieldSources` for a fresh stamp.
  pageFieldSource: 'rebuilt',
  // `attachContentControlBoundaries`, from `finish()`, rebuilds the per-page boundaries every
  // pass and early-returns only on a matching control-context token.
  contentControls: 'rebuilt',
} as const satisfies Record<keyof PageRecord, PageReuseGuard>;

/**
 * Fields a page actually carries that the table above does not classify.
 *
 * The `satisfies` clause catches a field added to the INTERFACE. This catches the other
 * direction — a record built with a key the interface never declared.
 */
export function unguardedPageFields(page: PageRecord): readonly string[] {
  return Object.keys(page).filter((key) => !(key in PAGE_REUSE_GUARDS));
}

/** What decides whether a convergence tail may move whole sheets and still be reused. */
export interface TailShiftInputs {
  /** Completed pages now minus completed pages at the previous pass's matching checkpoint. */
  readonly delta: number;
  readonly titlePage: boolean;
  readonly evenAndOddHeaders: boolean;
  /** The session read page parity on an earlier pass (inside/outside anchors). */
  readonly parityDependent: boolean;
  /** This pass read page parity while placing the prefix. */
  readonly usedPageParity: boolean;
  /** Completed pages at the previous pass's matching checkpoint. */
  readonly markPageCount: number;
  /**
   * This section's local page 0 is a CONTINUED sheet, flowing against the host's content box.
   *
   * The second reason index 0 differs from every other page in a section: a `continuous`
   * section resumes the previous one's last sheet, so `createPageContentInsets` hands local
   * page 0 the host's box instead of resolving this section's own variant.
   */
  readonly continuedInsets: boolean;
  /**
   * This section's `w:pgBorders` carries `w:display="firstPage"` or `"notFirstPage"`.
   *
   * The third reason index 0 differs from every other page in a section: the frame this page
   * publishes is decided by whether it IS page 0, so a sheet moved across that boundary keeps
   * a frame — or a missing frame — the index it lands on does not resolve to.
   */
  readonly firstPageBorders: boolean;
  /** Per-page-index footnote reserves are in play. */
  readonly hasNoteReserves: boolean;
  /** Per-page-index wrap exclusion zones are in play. */
  readonly hasExclusionZones: boolean;
}

/**
 * Whether a convergence tail whose in-page flow matches may be reused `delta` sheets away.
 *
 * `remapPage` renumbers a shell and moves its boxes but re-picks nothing, so the shift is
 * refused when anything on the tail reads a page's absolute index: an index-0 page that
 * differs from its neighbours, page parity over an odd delta (even/odd headers,
 * inside/outside anchors), per-page-index note reserves, or per-page-index wrap exclusion
 * zones.
 *
 * INDEX 0 is special for three reasons — a `w:titlePg` variant, a continued sheet whose
 * content box comes from the section before it, and a `w:pgBorders` frame filtered to (or away
 * from) the section's first page — and the test has two halves either way. A
 * positive delta must not carry page 0 along inside the tail (`markPageCount > 0` proves the
 * tail starts after it). A negative delta must not land the tail ON index 0 either:
 * `delta + markPageCount` is the number of pages completed before the join, and at zero the
 * tail's first sheet becomes page 0, keeping a header record and a content box that page 0
 * does not resolve to.
 *
 * The `continuedInsets` half is defence in depth rather than a fix for an observed failure.
 * Reaching it needs both flows parked on an EMPTY page at the join — `sameFragments` compares
 * content signatures that include each paragraph's unique id, so two different pages can only
 * agree by being empty — which for a continued section means `flowStartY === 0`, a state the
 * flow does not appear to produce (every `flushPage` is followed by placing the block that
 * forced it, and a section ended by a page break reports `endsOpenPage === false`, which
 * refuses continuation outright). It is stated here anyway, because index 0 IS now different
 * and a guard that depends on an unrelated condition holding is not a guard.
 */
export function convergenceTailShiftAllowed(inputs: TailShiftInputs): boolean {
  if (inputs.delta === 0) return true;
  const parityHolds =
    inputs.delta % 2 === 0 ||
    (!inputs.evenAndOddHeaders && !inputs.parityDependent && !inputs.usedPageParity);
  const indexZeroIsSpecial = inputs.titlePage || inputs.continuedInsets || inputs.firstPageBorders;
  const indexZeroHolds =
    !indexZeroIsSpecial || (inputs.markPageCount > 0 && inputs.delta + inputs.markPageCount > 0);
  return parityHolds && indexZeroHolds && !inputs.hasNoteReserves && !inputs.hasExclusionZones;
}
