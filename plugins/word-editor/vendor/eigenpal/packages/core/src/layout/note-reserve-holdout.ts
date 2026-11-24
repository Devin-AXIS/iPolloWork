import {
  noteReferenceOpeningBottom,
  paragraphNoteSplitsAllowed,
} from './note-reference-opening.ts';
import { footnoteContinuationNotice } from './note-continuation-notice.ts';
// The hold-out reserve — the fixed point of a footnote eviction. Full account on
// {@link holdOutReserveNeed}.

import { splitNoteHead, splitNoteKeepsParagraphReference } from './note-eviction-guard.ts';
import { isOutOfFlowFragment } from './fragment-flow.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import {
  chargedSpaceAfterPt,
  pageCitesFootnote,
  rejoinPoint,
  type RejoinPoint,
} from './note-area-fit.ts';
import { collapsingSpaceAfter } from './adjacent-paragraph-spacing.ts';
import { collapsedSpaceBefore } from './paragraph-style.ts';
import { fragmentOwnsPosition } from './line-segments.ts';
import {
  bodyCursorBottomPt,
  firstBodyContentTopPt,
  fragmentFlowBottom,
  fragmentCursorBottomPt,
  noteReferenceLineBandPt,
  type NoteReferenceLineBand,
} from './note-fragment-geometry.ts';
import { splitNoteFragments } from './note-splitting.ts';
import {
  layoutNoteCached,
  type LayoutNoteStoryOptions,
  type NoteStoryLayoutCache,
} from './note-layout.ts';
import {
  HELD_RESERVE_TOLERANCE_PT,
  noteColumnBudgetPt,
  RESERVE_BOUNDARY_BACKOFF_PT,
} from './note-reserves.ts';
import { MAX_NOTE_KEEP_SCAN, paragraphKeeps } from './pagination-keeps.ts';
import { tableRowHoldOutNeed } from './note-table-row-holdout.ts';
import type { PageRecord, ParagraphFragmentRecord } from './semantic-records.ts';
import { PAGE_BREAK_CHAR, type OoxmlPart } from '@docx-editor.dev/core/store';

/**
 * Bound the note-reserve recovery scan on the next page. This scan is separate from
 * paragraph keep-chain membership; references beyond this window retain normal placement.
 */
const MAX_HOLD_OUT_SCAN_BLOCKS = MAX_NOTE_KEEP_SCAN + 1;

/** A page-bottom footnote reference site, pre-filtered by the caller. */
export interface HoldOutRef {
  readonly noteId: number;
  readonly paragraphId: string;
  readonly atomOffset: number;
}

export interface HoldOutArgs {
  readonly allowOrphanDeferral?: boolean;
  readonly bodyPage: PageRecord;
  readonly nextPage: PageRecord | undefined;
  /** Height of `bodyPage`'s existing note area (0 when it has none). */
  readonly existingAreaHeight: number;
  readonly existingNoticeHeight?: number;
  /**
   * The reserve `bodyPage` needs for its own references, eviction included (defaults to
   * `existingAreaHeight`). A released hold leaves the page this reserve.
   */
  readonly ownReservePt?: number;
  /** The reserve `bodyPage` was laid under (for the observed-refusal test), if known. */
  readonly usedReservePt: number | undefined;
  /**
   * Page-bottom footnote references painted on a page. The caller supplies the memoized
   * page-refs filter so merged-paragraph ownership is answered by ONE implementation.
   */
  readonly pageBottomRefsOf: (page: PageRecord) => readonly HoldOutRef[];
  readonly footnotesPart: OoxmlPart | null;
  readonly opts: LayoutNoteStoryOptions;
  /** Height of the plain (non-continuation) footnote separator at this page's width. */
  readonly plainSeparatorHeight: number;
  readonly noteLayoutCache: NoteStoryLayoutCache;
}

/**
 * Reserve (pt) `bodyPage` must keep so the opening lines of `nextPage` stay put.
 *
 * This is the fixed point of an eviction: once the body pass has pushed a reference line
 * forward, the source page's recomputed reserve no longer sees that reference — the
 * note-stack height alone under-claims, the next round pulls the line back, and the
 * reflow loop orbits the two placements. A legal split opening can release the reference.
 * Otherwise the reserve retains enough room to keep an unsatisfied reference out.
 *
 * Zero when there is nothing to hold out: no next page, a source page whose body ends with a
 * manual page break (nothing after the break can return across it), a next page in different
 * section geometry (a pull-back across a page-size change cannot be reasoned about here), a slack
 * too small to seat even the pulled line, a table ahead of the reference (a next page that
 * OPENS with a table continuation takes the row hold-out, {@link tableRowHoldOutNeed}), the
 * reference deeper than {@link MAX_HOLD_OUT_SCAN_BLOCKS} paragraphs, no page-bottom
 * footnote reference at all, or a pulled band whose notes would fit back — then the lines
 * SHOULD return; a deleted note must release its room. A note the eviction guard would
 * refuse to keep whole (taller than the note column minus the content above its line in
 * its own block — the guard's exact complement) never blocks the pull-back on its own: its
 * line may legitimately return with a split head, so it is excluded from the demand rather
 * than aborting the hold. Otherwise the answer claims the page's remaining slack, which
 * reproduces the current body end exactly and gives the reflow loop its fixed point.
 *
 * The reference may open the next page behind a heading or a sibling line: the eviction
 * reserve names the reference's line, but widow/orphan control and `w:keepNext` move
 * companions with it, and the companions can only return together. A block ahead of that
 * `w:keepNext` group is no companion: it returns on its own, so the hold releases and lets
 * it back. Holding would freeze the page at whatever height an earlier round left it, and
 * content an upstream page pushes forward would pile up in front of the reference. If the
 * reference line then returns too, the page's own eviction moves it out again, and the
 * next round finds the group at the page top. The release applies only when the block's
 * smallest movable head fits beside the page's own reserve: a release nothing can use
 * changes no body line, but it drops a hold the reflow loop may need to settle an orbit
 * further down. It also does not apply when the reference sits on the second line of an
 * opening pair that could follow the block back while its note could not start there: the
 * orphan-pair phase would keep that pair with its eviction off, and the note would move to
 * a later page without a head. The release applies only where both pages
 * stack their blocks in one column; lines returning to a multi-column page may change
 * column, which this test cannot predict, so those pages keep the hold. The demand charges
 * every pulled reference in the OWNING BLOCK, not just the frontier line's — a
 * citation-dense paragraph pulls all of its notes back together.
 *
 * The pull-back fit starts the pulled band below the closing paragraph's space after, where
 * the body pass places a returning paragraph, plus any space before the band kept at the page
 * top.
 *
 * Known approximation: the pull-back fit charges the pulled band's page-top geometry plus
 * one reference-line of headroom (the split tail wraps from the split offset, so the
 * reference sits up to one line higher here than the joined re-wrap a pull-back
 * produces). A space before that the page top suppressed is not published, so it is not
 * charged: it widens the gap by its excess over the closing paragraph's space after, or by
 * all of it where the two add up (`w:doNotUseHTMLParagraphAutoSpacing`). One larger than that
 * headroom can still release early; the loop then degrades to the pre-eviction
 * envelope/exhaustion exit rather than diverging.
 */
export function holdOutReserveNeed(args: HoldOutArgs): number {
  const { bodyPage, nextPage } = args;
  if (!nextPage || endsWithPageBreak(bodyPage)) return 0;
  if (
    nextPage.contentBox.width !== bodyPage.contentBox.width ||
    nextPage.contentBox.height !== bodyPage.contentBox.height
  ) {
    return 0;
  }
  // The next page is read as-is: every consumer below touches only `fragments` and
  // `contentBox`, which carried note areas do not change, so stripping would just clone.
  const nextBody = nextPage;
  const candidates = args.pageBottomRefsOf(nextBody);
  if (candidates.length === 0) return 0;
  const opening = nextBody.fragments[0];
  if (opening?.kind === 'table') {
    return tableRowHoldOutNeed(args, bodyPage, nextBody, opening, candidates);
  }

  // The EARLIEST reference line on the next page is the pull-back frontier.
  let frontier: NoteReferenceLineBand | undefined;
  let frontierRef: HoldOutRef | undefined;
  for (const ref of candidates) {
    const band = noteReferenceLineBandPt(nextBody, ref, args.opts.compatibilityMode);
    if (band.bottom <= band.top) continue;
    if (!frontier || band.bottom < frontier.bottom - 0.001) {
      frontier = band;
      frontierRef = ref;
    }
  }
  if (!frontier || !frontierRef) return 0;

  const refLineHeight = frontier.bottom - frontier.top;

  // The closing paragraph's charged space after belongs to the body end here.
  const bodyBottom = bodyCursorBottomPt(bodyPage) + chargedSpaceAfterPt(bodyPage, args.opts);
  // Where the pulled band would start: below the closing paragraph's space after, which the
  // page charges once the band's reference returns to it. A release measured from the bare
  // body end lets the band back, the band lands lower than measured, and the page's own
  // eviction pushes it out again: the reflow loop orbits the two placements.
  // A next page that opens a continuous section keeps its first paragraph's space before at
  // the page top; on return that space collapses against the rejoin point's space after, as
  // the body pass collapses them. Elsewhere a page-top paragraph publishes no space before.
  const rejoin = rejoinPoint(bodyPage, bodyBottom);
  const returnTop = rejoin.bottom + returningSpaceBeforePt(nextBody, rejoin, args.opts);
  const contentHeight = bodyPage.contentBox.height;
  // A slack that cannot seat even the pulled line where it would return needs no reserve to
  // stay out — and publishing one for every naturally full page would churn the reserve
  // fingerprints the reflow loop converges on.
  if (contentHeight - returnTop < refLineHeight - 0.001) return 0;

  // The pulled band spans from the page's first content to the reference paragraph's
  // fragment. A table anywhere in that opening run, or a reference deeper than the scan
  // window, is a pull-back this reserve cannot reason about — fail open.
  let owningBlock: ParagraphFragmentRecord | undefined;
  let owningAt = 0;
  for (const [index, block] of nextBody.fragments.entries()) {
    if (block.kind !== 'paragraph') return 0;
    if (index >= MAX_HOLD_OUT_SCAN_BLOCKS) return 0;
    if (fragmentOwnsPosition(block, frontierRef.paragraphId, frontierRef.atomOffset)) {
      owningBlock = block;
      owningAt = index;
      break;
    }
  }
  if (!owningBlock) return 0;
  const independentAhead = opensWithIndependentBlock(nextBody.fragments, owningAt);
  const orphanPairFrontier = noteReferenceLineBandPt(
    nextBody,
    frontierRef,
    args.opts.compatibilityMode
  ).preserveOrphanLine;
  const ownReserve = args.ownReservePt ?? args.existingAreaHeight;
  const flowBottom = fragmentFlowBottom(bodyPage.fragments);
  const strandsOrphanNote =
    independentAhead &&
    orphanPairFrontier === true &&
    orphanPairNoteStrands(args, owningBlock, nextBody, frontierRef, flowBottom, ownReserve);
  // A `w:keepNext` group ahead returns with the owning block's opening lines when those
  // lines end above the reference line. That head returns alone: the hold shrinks to
  // admit exactly it, so the reference line cannot follow and reopen the eviction.
  if (
    (independentAhead || (owningAt > 0 && ownReserve > 0)) &&
    !strandsOrphanNote &&
    stacksInOneColumn(bodyPage) &&
    stacksInOneColumn(nextBody)
  ) {
    const head = independentHeadHeight(
      nextBody.fragments,
      owningAt,
      frontier.top,
      pageCitesFootnote(bodyPage) &&
        hasCompatibilityRule(args.opts.compatibilityMode, 'noteAreaHoldsLineSpacing')
    );
    if (head !== null && flowBottom + head + ownReserve <= contentHeight + 0.001) {
      if (independentAhead) return 0;
      return Math.max(0, contentHeight - flowBottom - head - RESERVE_BOUNDARY_BACKOFF_PT);
    }
  }
  // Release a settled hold only when the preceding body plus this opening pair
  // actually fits beside its existing notes. The incoming second-line note can
  // continue, but this policy must never reclaim space occupied by earlier notes.
  // With an independent block ahead, the release also pulls that block, and a note the
  // strict placement kept whole beside its reference would start on a later page; the
  // hold stays when the note could not start beside the returning pair.
  //
  // DELIBERATELY the painted flow bottom ({@link fragmentFlowBottom}), not the fit-rule
  // bottom every other budget in this file uses, and DELIBERATELY without
  // {@link RESERVE_BOUNDARY_BACKOFF_PT}. Both make this test stricter than the body pass
  // that has to honour it, and this one may only FAIL CLOSED: a release the body then
  // refuses re-demands the hold on the next round and costs the reflow loop an orbit,
  // while a release withheld just leaves the pre-existing strict placement in place. Do
  // not "correct" either to match the neighbours without re-measuring the corpus.
  if (
    args.allowOrphanDeferral &&
    orphanPairFrontier &&
    !strandsOrphanNote &&
    fragmentFlowBottom(bodyPage.fragments) +
      frontier.bottom -
      firstBodyContentTopPt(nextBody) +
      args.existingAreaHeight <=
      contentHeight + 0.001
  ) {
    return 0;
  }
  const held = heldOpening(nextBody.fragments, owningAt, owningBlock, frontier.bottom);
  const pulled = candidates.filter((ref) =>
    held.blocks.some(
      ({ block, bottom }) =>
        fragmentOwnsPosition(block, ref.paragraphId, ref.atomOffset) &&
        (block === owningBlock ||
          noteReferenceLineBandPt(nextBody, ref, args.opts.compatibilityMode).bottom <=
            bottom + 0.001)
    )
  );
  if (pulled.length === 0) return 0;

  const firstContentTop = firstBodyContentTopPt(nextBody);
  // Two pull-back quanta: the OPTIMISTIC one ends at the reference's line (a splittable
  // paragraph returns just its opening lines), the WHOLE-BLOCK one at the reference
  // paragraph's fit bottom (a `w:keepLines`/keep-with-next group returns only as one
  // piece). Which quantum the body pass actually uses is not readable off the fragments.
  // A successor without a pulled reference adds no note demand. Keep the existing
  // frontier fit in that case; the body pass already enforces its paragraph keeps.
  const referenceOwner = owningBlock;
  const pullsSuccessorReference = pulled.some(
    (ref) => !fragmentOwnsPosition(referenceOwner, ref.paragraphId, ref.atomOffset)
  );
  const lineBandHeight = Math.max(
    0,
    (pullsSuccessorReference ? held.lineBottom : frontier.bottom) - firstContentTop
  );
  const blockBandHeight = Math.max(
    0,
    (pullsSuccessorReference ? held.blockBottom : fragmentCursorBottomPt(owningBlock)) -
      firstContentTop
  );

  const contentWidth = bodyPage.contentBox.width;
  const columnBudget = noteColumnBudgetPt(contentHeight, args.plainSeparatorHeight);
  // A returning continuation rejoins the fragment already on this page. The eviction
  // guard then measures its reference from that earlier fragment's top, not page two's top.
  const previous = bodyPage.fragments.at(-1);
  const returningPrefix =
    owningAt === 0 &&
    stacksInOneColumn(bodyPage) &&
    stacksInOneColumn(nextBody) &&
    previous?.kind === 'paragraph' &&
    previous.paragraphId === owningBlock.paragraphId &&
    previous.range.end === owningBlock.range.start &&
    previous.box.x === owningBlock.box.x &&
    !previous.paragraphEnd
      ? Math.max(0, bodyBottom - previous.box.y)
      : 0;
  const paragraphSplitsAllowed =
    paragraphNoteSplitsAllowed(bodyPage) && paragraphNoteSplitsAllowed(nextBody);
  // A splittable continuation can return only its required opening. Later references
  // in that paragraph do not require their notes until their own body lines return.
  // Price complete notes here; split notes and kept successors retain the existing policy.
  const keeps = paragraphKeeps(owningBlock.props);
  if (returningPrefix > 0 && paragraphSplitsAllowed && !keeps.keepLines && !keeps.keepNext) {
    const openingBottom = noteReferenceOpeningBottom(nextBody, frontierRef, frontier);
    let demand = args.existingAreaHeight > 0 ? args.existingAreaHeight : args.plainSeparatorHeight;
    let complete = true;
    let count = 0;
    for (const ref of pulled) {
      const band = noteReferenceLineBandPt(nextBody, ref, args.opts.compatibilityMode);
      if (band.bottom > openingBottom + 0.001) continue;
      const joinedOffset = band.bottom - band.blockTop + returningPrefix;
      const laid = layoutNoteCached(
        args.footnotesPart,
        ref.noteId,
        contentWidth,
        args.opts,
        args.noteLayoutCache
      );
      if (
        !band.evictable ||
        !laid ||
        joinedOffset >= columnBudget ||
        laid.flowHeight > columnBudget - joinedOffset + 0.001
      ) {
        complete = false;
        break;
      }
      demand += laid.flowHeight;
      count++;
    }
    if (
      complete &&
      count > 0 &&
      Math.max(bodyBottom, fragmentFlowBottom(bodyPage.fragments)) +
        openingBottom -
        firstContentTop +
        demand <=
        contentHeight + 0.001
    ) {
      return 0;
    }
  }
  let pulledNotesHeight = 0;
  let admitsSplit = false;
  let splitOpeningHeight = lineBandHeight;
  const existingArea =
    args.existingAreaHeight > 0 ? args.existingAreaHeight : args.plainSeparatorHeight;
  for (const ref of pulled) {
    const laid = layoutNoteCached(
      args.footnotesPart,
      ref.noteId,
      contentWidth,
      args.opts,
      args.noteLayoutCache
    );
    if (!laid) continue;
    // The eviction guard's exact complement: a note is kept whole only when it fits the
    // column MINUS the content above its own line within its block (that block opens the
    // destination page whole). A note the guard would split anyway does not hold. The
    // offset applies only to a LINE-precise band — a fallback fragment band (merged or
    // projected offsets, `evictable: false`) spans the whole block and would over-subtract
    // it; the guard never evicts those, so the bare column is their complement.
    const band = noteReferenceLineBandPt(nextBody, ref, args.opts.compatibilityMode);
    const blockOffset = band.bottom - band.blockTop;
    const joinedOffset =
      blockOffset + (ref.paragraphId === owningBlock.paragraphId ? returningPrefix : 0);
    // A reference beyond the note column cannot start a note on this page. Keep its
    // unjoined demand rather than treating a negative note budget as permission to split.
    const inBlockOffset = band.evictable
      ? joinedOffset < columnBudget
        ? joinedOffset
        : blockOffset
      : 0;
    if (laid.flowHeight > columnBudget - inBlockOffset + 0.001) continue;
    const referenceOpening = Math.max(
      lineBandHeight,
      noteReferenceOpeningBottom(nextBody, ref, band) - firstContentTop
    );
    const remaining =
      contentHeight - returnTop - referenceOpening - existingArea - pulledNotesHeight;
    const noticeHeight =
      admitsSplit || (args.existingNoticeHeight ?? 0) > 0
        ? 0
        : (footnoteContinuationNotice(
            args.footnotesPart,
            contentWidth,
            contentHeight,
            args.opts,
            args.noteLayoutCache
          )?.flowHeight ?? 0);
    const room = remaining - noticeHeight;
    if (
      paragraphSplitsAllowed &&
      band.evictable &&
      band.tableRow !== true &&
      joinedOffset < columnBudget &&
      laid.flowHeight > remaining + 0.001 &&
      splitNoteKeepsParagraphReference(laid, room, columnBudget - noticeHeight)
    ) {
      pulledNotesHeight +=
        splitNoteHead(laid, room, columnBudget - noticeHeight).height + noticeHeight;
      admitsSplit = true;
      splitOpeningHeight = Math.max(splitOpeningHeight, referenceOpening);
    } else {
      pulledNotesHeight += laid.flowHeight;
    }
  }
  if (pulledNotesHeight <= 0) return 0;

  const areaWithPulled = existingArea + pulledNotesHeight;
  // A legal split consumes the measured remaining room. Extra speculative line headroom
  // would reject every such split, including a valid single-line opening without widows.
  // A reference on the closing line of its paragraph has no later line to bring back, so it
  // needs no headroom either, unless the paragraph keeps with the next one or returns a
  // successor's reference. A one-line paragraph keeps the headroom.
  const closesParagraph =
    owningBlock.paragraphEnd === true &&
    !keeps.keepNext &&
    !pullsSuccessorReference &&
    frontier.bottom >=
      owningBlock.box.y + owningBlock.box.height - owningBlock.spacing.after - 0.001 &&
    frontier.top > owningBlock.lines[0]!.box.y + 0.001;
  const headroom = admitsSplit || closesParagraph ? 0 : refLineHeight;
  // Backed off by half a point like the eviction reserve: the last kept body line's bottom
  // is exactly `bodyBottom`, and a budget equal to it flips on float drift.
  const hold = leadingLinesHold(
    args,
    nextBody,
    owningAt,
    owningBlock,
    frontier,
    returnTop,
    Math.max(0, contentHeight - bodyBottom - RESERVE_BOUNDARY_BACKOFF_PT)
  );
  const fitsLineQuantum =
    returnTop + splitOpeningHeight + headroom + areaWithPulled <= contentHeight + 0.001;
  if (!fitsLineQuantum) return hold;
  const fitsWholeBlock =
    returnTop + blockBandHeight + headroom + areaWithPulled <= contentHeight + 0.001;
  if (fitsWholeBlock) return 0;
  // The optimistic quantum fits but the whole block does not. Whether releasing is safe
  // depends on whether the block can SPLIT, which the body pass has already answered:
  // when the used reserve left room for the line quantum and the body still declined it,
  // the block only moves whole (`w:keepLines` and friends). A page already held at this
  // value keeps the hold — a held page offers no gap, so the refusal cannot be
  // re-observed there; upstream shrinkage releases through the whole-block test above,
  // and a vanished note releases through the pulled scan. Release only a page that was
  // offered the room and refused nothing — or whose lay-down reserve is unknown (a caller
  // outside the reflow loop must not manufacture holds the loop never observed).
  const { usedReservePt } = args;
  if (usedReservePt === undefined) return 0;
  const offeredGap = Math.max(0, contentHeight - usedReservePt - returnTop);
  const neverOfferedTheRoom = lineBandHeight + refLineHeight > offeredGap + 0.001;
  const alreadyHeldHere = Math.abs(usedReservePt - hold) <= HELD_RESERVE_TOLERANCE_PT;
  return neverOfferedTheRoom && !alreadyHeldHere ? 0 : hold;
}

/**
 * The hold, reduced so the lines ahead of the reference line can return without it.
 *
 * The reserve keeps the reference line out, not the whole opening. When the owning paragraph
 * opens the next page and splits, the lines before the reference carry no note and return
 * like any other line, as far as the slack and the paragraph's widow/orphan control allow:
 * at least two lines stay with the reference when the paragraph ends there, and a paragraph
 * that starts there returns at least two. The answer stops the body just below the last line
 * that may return, so the reference line stays out. Without such lines it is `fullHold`.
 */
function leadingLinesHold(
  args: HoldOutArgs,
  nextBody: PageRecord,
  owningAt: number,
  owner: ParagraphFragmentRecord,
  frontier: NoteReferenceLineBand,
  /** Where the returning paragraph's first line starts ({@link holdOutReserveNeed}). */
  returnTop: number,
  fullHold: number
): number {
  if (owningAt !== 0 || !stacksInOneColumn(args.bodyPage) || !stacksInOneColumn(nextBody)) {
    return fullHold;
  }
  const keeps = paragraphKeeps(owner.props);
  if (keeps.keepLines || owner.positionedFrame || owner.outOfFlow) return fullHold;
  // Only a paragraph whose one footnote reference on this page is the frontier. With more,
  // the returning lines move the later references' notes as well, and the reflow loop's
  // settled answer for them is the full hold.
  const cited = args
    .pageBottomRefsOf(nextBody)
    .filter((ref) => fragmentOwnsPosition(owner, ref.paragraphId, ref.atomOffset));
  if (cited.length !== 1) return fullHold;
  const lines = owner.lines;
  const referenceLine = lines.findIndex(
    (line) => line.box.y + line.box.height > frontier.top + 0.001
  );
  let most = referenceLine < 0 ? 0 : referenceLine;
  if (keeps.widowControl && owner.paragraphEnd) most = Math.min(most, lines.length - 2);
  const least = keeps.widowControl && owner.fragmentIndex === 0 ? 2 : 1;
  const contentHeight = args.bodyPage.contentBox.height;
  const ownReserve = args.ownReservePt ?? args.existingAreaHeight;
  for (let count = most; count >= least; count -= 1) {
    const last = lines[count - 1]!;
    const bottom = returnTop + last.box.y + last.box.height - lines[0]!.box.y;
    const reserve = contentHeight - bottom - RESERVE_BOUNDARY_BACKOFF_PT;
    if (reserve >= ownReserve - 0.001) return Math.min(fullHold, Math.max(0, reserve));
  }
  return fullHold;
}

/**
 * The space before the next page's first paragraph keeps when it returns below `rejoin`: the
 * space it kept at the page top, collapsed against the space after there, or added to it
 * where the document adds the two (`w:doNotUseHTMLParagraphAutoSpacing`).
 */
function returningSpaceBeforePt(
  nextBody: PageRecord,
  rejoin: RejoinPoint,
  opts: LayoutNoteStoryOptions
): number {
  const first = nextBody.fragments[0];
  if (first?.kind !== 'paragraph' || first.fragmentIndex !== 0 || first.spacing.before <= 0) {
    return 0;
  }
  return collapsedSpaceBefore(
    first.spacing.before,
    collapsingSpaceAfter(rejoin.spaceAfter, opts.styleCascade)
  );
}

/** The body opening that must return with a frontier reference. */
function heldOpening(
  fragments: PageRecord['fragments'],
  owningAt: number,
  owner: ParagraphFragmentRecord,
  frontierBottom: number
): {
  readonly blocks: readonly { block: ParagraphFragmentRecord; bottom: number }[];
  readonly lineBottom: number;
  readonly blockBottom: number;
} {
  const blocks = [{ block: owner, bottom: fragmentCursorBottomPt(owner) }];
  let lineBottom = frontierBottom;
  let blockBottom = blocks[0]!.bottom;
  let previous = owner;
  // Completing a kept paragraph also returns its successor's opening. A long successor
  // may split, so references beyond that opening must not hold this group off the page.
  const last = owner.lines.at(-1);
  const ownerKeeps = paragraphKeeps(owner.props);
  const wholeOwner = owner.fragmentIndex === 0 && owner.paragraphEnd === true;
  let completes =
    owner.paragraphEnd === true &&
    ((wholeOwner && ownerKeeps.keepLines) ||
      (wholeOwner && ownerKeeps.widowControl && owner.lines.length < 4) ||
      (last !== undefined &&
        frontierBottom >= last.box.y + (ownerKeeps.widowControl ? 0 : last.box.height) - 0.001));
  for (
    let at = owningAt + 1;
    at < fragments.length && at - owningAt < MAX_HOLD_OUT_SCAN_BLOCKS;
    at++
  ) {
    if (!completes || !paragraphKeeps(previous.props).keepNext) break;
    const block = fragments[at]!;
    if (block.kind !== 'paragraph' || block.positionedFrame || block.outOfFlow) break;
    const count = block.lines.length;
    if (count === 0) break;
    const keeps = paragraphKeeps(block.props);
    const whole = block.fragmentIndex === 0 && block.paragraphEnd === true;
    const take =
      keeps.keepLines && whole
        ? count
        : keeps.widowControl && block.fragmentIndex === 0
          ? whole && count < 4
            ? count
            : Math.min(2, count)
          : keeps.widowControl && block.paragraphEnd && count < 3
            ? count
            : 1;
    const end = block.lines[take - 1]!;
    const bottom = end.box.y + end.box.height;
    blocks.push({ block, bottom });
    lineBottom = Math.max(lineBottom, bottom);
    blockBottom = Math.max(blockBottom, bottom);
    previous = block;
    completes = take === count && block.paragraphEnd === true;
  }
  return { blocks, lineBottom, blockBottom };
}

/**
 * Whether an in-flow block ahead of the owning block's `w:keepNext` group opens the page.
 * Such a block is not tied to the reference: it can return to the previous page without
 * the reference line, so a hold there would strand it on this page for nothing. The
 * fragments before `owningAt` are paragraphs (the caller fails open on tables). Text
 * frames and collapsed section marks take no flow height, so they neither return nor
 * break a chain.
 */
function opensWithIndependentBlock(fragments: PageRecord['fragments'], owningAt: number): boolean {
  for (let index = owningAt - 1; index >= 0; index -= 1) {
    const block = fragments[index]!;
    if (block.kind !== 'paragraph' || block.positionedFrame || block.outOfFlow) continue;
    if (!paragraphKeeps(block.props).keepNext) return true;
  }
  return false;
}

/**
 * Whether the opening pair of the owning block could follow the blocks ahead of it back to
 * the previous page while its second-line note could not start there. The pair returns when
 * everything above it, down to the glyph band of its second line, fits beside the page's own
 * reserve. The orphan-pair phase then keeps the pair with its eviction off, and a note with
 * no room below the reference line's full box moves to a later page without a head.
 */
function orphanPairNoteStrands(
  args: HoldOutArgs,
  owningBlock: ParagraphFragmentRecord,
  nextBody: PageRecord,
  frontierRef: HoldOutRef,
  flowBottom: number,
  ownReserve: number
): boolean {
  const line = owningBlock.lines[1];
  if (!line) return false;
  const contentHeight = args.bodyPage.contentBox.height;
  const shift = flowBottom - firstBodyContentTopPt(nextBody);
  // The pair cites the note, so the whole line box must fit above the footnote area. Legacy
  // modes let the spacing below the glyph band cross it.
  const trailing = hasCompatibilityRule(args.opts.compatibilityMode, 'noteAreaHoldsLineSpacing')
    ? 0
    : Math.min(line.trailingSpacing ?? 0, line.box.height);
  if (shift + line.box.y + line.box.height - trailing + ownReserve > contentHeight + 0.001) {
    return false;
  }
  const laid = layoutNoteCached(
    args.footnotesPart,
    frontierRef.noteId,
    args.bodyPage.contentBox.width,
    args.opts,
    args.noteLayoutCache
  );
  if (!laid) return false;
  const area = Math.max(args.existingAreaHeight, args.plainSeparatorHeight);
  const room = contentHeight - (shift + line.box.y + line.box.height) - area;
  return splitNoteFragments(laid, Math.max(0, room)).head.length === 0;
}

/**
 * Height (pt) the next page's opening blocks need on the previous page before any of them
 * can return there: the first block's smallest head that may move, from the page's first
 * line plus its applied before-spacing down to the head's last line. That line's trailing
 * depth counts only when the page cites a footnote (`chargesTrailing`), as in the body fit
 * rule; elsewhere it may cross the reserve. The head is one line;
 * under widow control it is the opening pair of a paragraph that starts here (the whole
 * paragraph when it has fewer than four lines) and it leaves at least two lines of a
 * paragraph that ends here; under `w:keepLines` it is the whole paragraph when the paragraph
 * sits whole on the page (one that already splits returns line by line). A head that
 * completes a `w:keepNext` paragraph takes the next block's head as well. A head that reaches
 * the owning block ends there only when those opening lines end above the reference line
 * (`frontierTop`); otherwise it is null, because those lines return only with the reference.
 */
function independentHeadHeight(
  fragments: PageRecord['fragments'],
  owningAt: number,
  frontierTop: number,
  chargesTrailing: boolean
): number | null {
  let top: number | undefined;
  for (let index = 0; index <= owningAt; index += 1) {
    const block = fragments[index]!;
    if (block.kind !== 'paragraph' || block.positionedFrame || block.outOfFlow) continue;
    const lines = block.lines;
    if (lines.length === 0) continue;
    top ??= lines[0]!.box.y - (block.fragmentIndex === 0 ? block.spacing.before : 0);
    const keeps = paragraphKeeps(block.props);
    const count = lines.length;
    let take = 1;
    const whole = block.fragmentIndex === 0 && block.paragraphEnd === true;
    if (keeps.keepLines && whole) take = count;
    else if (keeps.widowControl && block.fragmentIndex === 0) {
      take = whole && count < 4 ? count : Math.min(2, count);
    } else if (keeps.widowControl && block.paragraphEnd && count < 3) take = count;
    const last = lines[take - 1]!;
    if (index === owningAt) {
      const citesInHead = take === count || last.box.y + last.box.height > frontierTop + 0.001;
      if (citesInHead) return null;
    }
    if (take < count || !block.paragraphEnd || !keeps.keepNext) {
      const trailing = chargesTrailing ? 0 : Math.min(last.trailingSpacing ?? 0, last.box.height);
      return last.box.y + last.box.height - trailing - top;
    }
  }
  return null;
}

/**
 * Whether the page's body blocks stack in document order, as one column does. A block that
 * starts above its predecessor's bottom sits in another column or beside a float; lines
 * returning to such a page may change column, so the release above cannot predict them.
 * A section that continues onto the next page fills every column of the earlier page, so
 * checking both pages catches a next page that fills only its first column.
 */
function stacksInOneColumn(page: PageRecord): boolean {
  let previousBottom = Number.NEGATIVE_INFINITY;
  for (const fragment of page.fragments) {
    if (isOutOfFlowFragment(fragment)) continue;
    if (fragment.kind === 'paragraph' && fragment.positionedFrame) continue;
    if (fragment.box.y < previousBottom - 0.001) return false;
    previousBottom = fragment.box.y + fragment.box.height;
  }
  return true;
}

/**
 * Whether the page's body ends with a manual page break: its last paragraph line, the kept
 * empty line of a leading break included. Text frames and collapsed section marks sit
 * outside the flow and do not end it; a page break a frame holds opens no page.
 */
function endsWithPageBreak(page: PageRecord): boolean {
  let ends = pageBreakEnds.get(page);
  if (ends === undefined) {
    ends = false;
    for (let index = page.fragments.length - 1; index >= 0; index -= 1) {
      const fragment = page.fragments[index]!;
      if (fragment.kind !== 'paragraph') break;
      const last = fragment.lines[fragment.lines.length - 1];
      const breaks = last?.spans.some((span) => span.text === PAGE_BREAK_CHAR) ?? false;
      if (fragment.positionedFrame || (!breaks && fragment.outOfFlow)) continue;
      ends = breaks;
      break;
    }
    pageBreakEnds.set(page, ends);
  }
  return ends;
}
/** Per page: each pass asks for every page, and a page an edit left alone keeps its object. */
const pageBreakEnds = new WeakMap<PageRecord, boolean>();
