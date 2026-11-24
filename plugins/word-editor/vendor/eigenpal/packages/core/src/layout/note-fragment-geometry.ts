// Fragment geometry for note pagination: story-relative shifts, flow bottoms, and the
// body band a page must keep so its footnote references stay with their first fragment.

import { fragmentOwnsPosition, lineSegments, segmentOwnsAtomOffset } from './line-segments.ts';
import type {
  BlockFragmentRecord,
  PageRecord,
  ParagraphFragmentRecord,
} from './semantic-records.ts';
import { isOutOfFlowFragment } from './fragment-flow.ts';
import { paragraphKeeps } from './pagination-keeps.ts';
import { tableReferenceRowBand } from './note-table-reference-band.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';

/** Translate one paragraph fragment (and every box inside it) by `dy`. */
export function shiftParagraphFragment(
  fragment: ParagraphFragmentRecord,
  dy: number
): ParagraphFragmentRecord {
  if (dy === 0) return fragment;
  return {
    ...fragment,
    box: { ...fragment.box, y: fragment.box.y + dy },
    ...(fragment.shadingBox
      ? { shadingBox: { ...fragment.shadingBox, y: fragment.shadingBox.y + dy } }
      : {}),
    ...(fragment.bottomBorder
      ? {
          bottomBorder: {
            ...fragment.bottomBorder,
            box: { ...fragment.bottomBorder.box, y: fragment.bottomBorder.box.y + dy },
          },
        }
      : {}),
    ...(fragment.borders
      ? {
          borders: fragment.borders.map((stroke) => ({
            ...stroke,
            box: { ...stroke.box, y: stroke.box.y + dy },
          })),
        }
      : {}),
    ...(fragment.marker
      ? {
          marker: {
            ...fragment.marker,
            box: { ...fragment.marker.box, y: fragment.marker.box.y + dy },
            // The picture bullet shares the marker's coordinate space and moves with it.
            ...(fragment.marker.picture
              ? {
                  picture: {
                    ...fragment.marker.picture,
                    box: { ...fragment.marker.picture.box, y: fragment.marker.picture.box.y + dy },
                  },
                }
              : {}),
          },
        }
      : {}),
    lines: fragment.lines.map((line) => ({
      ...line,
      box: { ...line.box, y: line.box.y + dy },
      spans: line.spans.map((span) => ({
        ...span,
        box: { ...span.box, y: span.box.y + dy },
      })),
    })),
  };
}

/** Translate a block list by `dy` (paragraphs deep, other blocks by their outer box). */
export function shiftFragments(
  fragments: readonly BlockFragmentRecord[],
  dy: number
): BlockFragmentRecord[] {
  if (dy === 0) return [...fragments];
  return fragments.map((fragment) => {
    if (fragment.kind === 'paragraph') return shiftParagraphFragment(fragment, dy);
    return {
      ...fragment,
      box: { ...fragment.box, y: fragment.box.y + dy },
    };
  });
}

/** Bottom-most fragment edge of a story-relative block list. */
export function fragmentFlowBottom(fragments: readonly BlockFragmentRecord[]): number {
  let bottom = 0;
  for (const fragment of fragments) {
    if (isOutOfFlowFragment(fragment)) continue;
    bottom = Math.max(bottom, fragment.box.y + fragment.box.height);
  }
  return bottom;
}

/**
 * Body bottom (content-relative pt) the note passes BUDGET against.
 *
 * MINUS each paragraph's trailing after-spacing and its last line's trailing `auto`
 * depth: the page-fit decision admits a line without charging either (the
 * after-spacing moves to the next page with the flow, and the depth below the glyph band
 * may cross the bottom of the text area), but the fragment BOX includes both — so a page
 * whose last line carries either "uses" more height here than the fit rule budgeted, the
 * reserve the reflow settles on under-claims by that amount, and the attach pass splits
 * or carries a note the reserve fit whole. The footnote area rises into that blank band
 * instead. PLACEMENT of an area that hangs off the body keeps {@link fragmentFlowBottom}
 * unless the room is needed.
 *
 * A reference line does not get this allowance: its note must start below the line's
 * full box ({@link noteReferenceLineBandPt}), which both note passes enforce per reference.
 */
export function bodyFitBottomPt(page: PageRecord): number {
  let bottom = 0;
  for (const fragment of page.fragments) {
    bottom = Math.max(bottom, fragmentFitBottomPt(fragment));
  }
  return bottom;
}

/**
 * Body bottom (content-relative pt) where the next body line would start: each fragment's
 * box minus a paragraph's trailing after-spacing, keeping the last line's full box. The
 * hold-out measures pulled lines from here, because a returning line starts below the whole
 * box of the line above it.
 */
export function bodyCursorBottomPt(page: PageRecord): number {
  let bottom = 0;
  for (const fragment of page.fragments) {
    bottom = Math.max(bottom, fragmentCursorBottomPt(fragment));
  }
  return bottom;
}

/** One fragment's {@link bodyCursorBottomPt}: its box minus a paragraph's after-spacing. */
export function fragmentCursorBottomPt(fragment: BlockFragmentRecord): number {
  if (isOutOfFlowFragment(fragment)) return 0;
  const trailingAfter = fragment.kind === 'paragraph' ? fragment.spacing.after : 0;
  return fragment.box.y + fragment.box.height - trailingAfter;
}

/**
 * One fragment's fit-rule bottom — its box minus a paragraph's trailing after-spacing and
 * its last line's trailing depth, which the body fit rule leaves out of the budget.
 */
export function fragmentFitBottomPt(fragment: BlockFragmentRecord): number {
  const bottom = fragmentCursorBottomPt(fragment);
  if (fragment.kind !== 'paragraph') return bottom;
  const last = fragment.lines[fragment.lines.length - 1];
  return bottom - (last ? Math.min(last.trailingSpacing ?? 0, last.box.height) : 0);
}

/**
 * Top (content-relative pt) of the page's topmost body content, or 0 on an empty page.
 *
 * The MINIMUM over every fragment, not the first one's: document order is not y order
 * when a float exclusion zone displaces the first paragraph below a later block, and the
 * eviction guard that reads this must never conclude a page's true first line has content
 * above it.
 */
export function firstBodyContentTopPt(page: PageRecord): number {
  let top = Number.POSITIVE_INFINITY;
  for (const fragment of page.fragments) {
    if (isOutOfFlowFragment(fragment)) continue;
    const fragmentTop =
      fragment.kind === 'paragraph' ? (fragment.lines[0]?.box.y ?? fragment.box.y) : fragment.box.y;
    top = Math.min(top, fragmentTop);
  }
  return Number.isFinite(top) ? top : 0;
}

/**
 * The body band (content-relative pt) of the line on `page` that carries `ref`.
 *
 * `bottom` is the band body text must KEEP for this reference when its footnote reserve is
 * measured. Normally a footnote starts on its reference page; the bounded orphan-pair
 * refinement below permits a whole note to continue instead of leaving one opening line.
 * A reserve capped
 * only by the minimum body band (`MIN_FOOTNOTE_BODY_BAND_PT`) can exceed the room below the
 * referencing line, which evicts that line — and with it the reference — to the next page.
 * The next reserve pass then follows the reference forward, the reflow loop oscillates
 * between the two placements, and the fingerprint lock freezes whichever phase it happens
 * to be in: the referencing page ends with body only, and a later page keeps a reservation
 * nothing fills. Flooring the reserve at this line keeps the reference together with the
 * note's first fragment and gives the loop a fixed point.
 *
 * PER REFERENCE, never the page's lowest reference: notes accumulate top-down, and each
 * note may push body down to ITS OWN reference line. On a page carrying many references, a
 * single floor at the lowest one strangles every note above it to the sliver under that
 * line — and that state is a fixed point, so the reflow loop keeps it. The caller sizes
 * note `i`'s room against reference `i`'s floor; a reference whose note cannot even START
 * in that room moves forward instead: `top` is where the reserve must reach to evict the
 * reference's own line, so the next pass finds the reference — and lays its note whole —
 * on the page the shrunken body pushes it to.
 *
 * A ref inside a body table takes its ROW's band ({@link tableReferenceRowBand}): the row
 * box is in page-content coordinates and the row moves to the next page as one unit, with
 * `blockTop` above it by the header rows that repeat there. The bottom is the lowest legal
 * split that keeps the reference line where the row can continue on the next page below it
 * (`referenceRowCut`), else the row box's bottom. Where the row cannot be proven the band
 * ({@link tableReferenceRowBand} lists the cases), the band is the TABLE fragment's box.
 *
 * `evictable` is false when the geometry cannot support that move: a table ref outside a
 * provably movable row (evicting a whole table for one note is not the conservative
 * reading), and a ref no fragment on this page owns (band zero).
 */
export interface NoteReferenceLineBand {
  /** Top of the referencing line (content-relative pt); reserve past this evicts the line. */
  readonly top: number;
  /** Bottom of the referencing line — the floor a same-page reserve must not rise above. */
  readonly bottom: number;
  /** Top of the owning block's fragment — where the line lands when its block moves whole. */
  readonly blockTop: number;
  /** Whether the reserve may claim the line itself to move the reference forward. */
  readonly evictable: boolean;
  /** Retain the opening orphan pair even when its second line's note must start later. */
  readonly preserveOrphanLine?: boolean;
  /**
   * The band of a body-table row ({@link tableReferenceRowBand}). The row moves only when
   * its note would place fewer than two lines below the reference; otherwise the note splits.
   */
  readonly tableRow?: true;
  /** The referencing row's id when that row ends the page's flow (`endsPage`). */
  readonly endsPageRowId?: string;
  /**
   * The referencing table row is taller than the content band, so it runs past the bottom
   * margin on every page. A row that only ends past the margin (below repeated header rows)
   * does not set it.
   */
  readonly rowOverflowsPage?: true;
}

/**
 * Memoized per fragments-array identity and ref object identity: the reserve pass asks for
 * the same page's bands as `bodyPage` and again as the previous page's hold-out neighbour,
 * every reflow round, and both the fragment arrays and the ref objects are identity-stable
 * across rounds. One memo per cell split rule: table bands read cell widow control and
 * `w:keepLines` only in compatibility mode 15 and later.
 */
const referenceLineBandMemos = [false, true].map(
  () => new WeakMap<readonly BlockFragmentRecord[], WeakMap<object, NoteReferenceLineBand>>()
);

export function noteReferenceLineBandPt(
  page: PageRecord,
  ref: { readonly paragraphId: string; readonly atomOffset: number },
  compatibilityMode?: number
): NoteReferenceLineBand {
  const memos =
    referenceLineBandMemos[hasCompatibilityRule(compatibilityMode, 'noteTableCellKeeps') ? 1 : 0]!;
  let perPage = memos.get(page.fragments);
  if (!perPage) {
    perPage = new WeakMap();
    memos.set(page.fragments, perPage);
  }
  const cached = perPage.get(ref);
  if (cached) return cached;
  const band = computeReferenceLineBand(page, ref, compatibilityMode);
  perPage.set(ref, band);
  return band;
}

/**
 * Does any of `refs` sit on an opening orphan pair on `page`?
 *
 * The reflow loop asks this to decide whether its orphan-refinement phase can move this
 * document at all. A document with no such reference must not pay a second full reserve
 * pass to discover that — cold or on every keystroke. Reads through the band memo, so it
 * is a map lookup wherever the bands were needed anyway.
 */
export function anyOrphanPairBand(
  page: PageRecord,
  refs: readonly { readonly paragraphId: string; readonly atomOffset: number }[],
  compatibilityMode?: number
): boolean {
  for (const ref of refs) {
    const band = noteReferenceLineBandPt(page, ref, compatibilityMode);
    if (band.preserveOrphanLine === true) return true;
  }
  return false;
}

function computeReferenceLineBand(
  page: PageRecord,
  ref: { readonly paragraphId: string; readonly atomOffset: number },
  compatibilityMode: number | undefined
): NoteReferenceLineBand {
  let top = 0;
  let bottom = 0;
  let blockTop = 0;
  let evictable = false;
  let preserveOrphanLine = false;
  let tableRow = false;
  let endsPageRowId: string | undefined;
  let rowTallerThanPage = false;
  for (const block of page.fragments) {
    if (block.kind === 'paragraph') {
      if (!fragmentOwnsPosition(block, ref.paragraphId, ref.atomOffset)) continue;
      const line = referenceLineBand(block, ref);
      const lineTop = line?.top ?? block.box.y;
      const lineBottom = line?.bottom ?? block.box.y + block.box.height;
      if (lineBottom > bottom) {
        top = lineTop;
        bottom = lineBottom;
        blockTop = block.box.y;
        // Only a located LINE may be evicted; an ownership match without a line segment
        // (merged/projected offsets) falls back to the fragment band and stays put.
        evictable = line !== null && !isOutOfFlowFragment(block);
        const keeps = paragraphKeeps(block.props);
        // A split-capable paragraph needs two opening lines on this page. Its note
        // may continue before sacrificing that pair; explicit keepLines and short
        // unsplittable paragraphs still move together with their references.
        tableRow = false;
        endsPageRowId = undefined;
        rowTallerThanPage = false;
        preserveOrphanLine =
          evictable &&
          line?.index === 1 &&
          block.fragmentIndex === 0 &&
          (block.lines.length >= 4 || !block.paragraphEnd) &&
          keeps.widowControl &&
          !keeps.keepLines;
      }
      continue;
    }
    const row = tableReferenceRowBand(page, block, ref, compatibilityMode);
    if (row === null) continue;
    const band =
      row === 'table'
        ? { top: block.box.y, bottom: block.box.y + block.box.height, blockTop, evictable: false }
        : row;
    if (band.bottom > bottom) {
      top = band.top;
      bottom = band.bottom;
      blockTop = band.blockTop;
      evictable = band.evictable;
      preserveOrphanLine = false;
      tableRow = row !== 'table';
      endsPageRowId = row !== 'table' && row.endsPage ? row.row.id : undefined;
      rowTallerThanPage = row !== 'table' && row.row.box.height > page.contentBox.height + 0.001;
    }
  }
  const clamp = (value: number): number => Math.min(Math.max(0, value), page.contentBox.height);
  const clampedTop = clamp(top);
  const clampedBottom = clamp(bottom);
  return {
    top: clampedTop,
    bottom: clampedBottom,
    blockTop: clamp(blockTop),
    // A band the clamp collapsed (a line at or below the content bottom — overflow the
    // body pass tolerated) must not evict: the eviction reserve computed from its top
    // would be zero, and the reference's note would be neither placed nor carried.
    evictable: evictable && clampedBottom > clampedTop,
    ...(preserveOrphanLine ? { preserveOrphanLine: true } : {}),
    ...(tableRow ? { tableRow: true } : {}),
    ...(endsPageRowId !== undefined ? { endsPageRowId } : {}),
    ...(rowTallerThanPage ? { rowOverflowsPage: true } : {}),
  };
}

/** The owning line's band inside a fragment already known to own the ref, or null. */
function referenceLineBand(
  fragment: ParagraphFragmentRecord,
  ref: { readonly paragraphId: string; readonly atomOffset: number }
): { readonly top: number; readonly bottom: number; readonly index: number } | null {
  for (const [index, line] of fragment.lines.entries()) {
    for (const segment of lineSegments(line)) {
      if (!segmentOwnsAtomOffset(segment, ref.paragraphId, ref.atomOffset)) continue;
      // The paragraph's last line carries its space after: a reference there fits only
      // when that space fits above the note area too.
      const after =
        fragment.paragraphEnd && index === fragment.lines.length - 1 ? fragment.spacing.after : 0;
      return { top: line.box.y, bottom: line.box.y + line.box.height + after, index };
    }
  }
  return null;
}

/** Remove note-pass output before recomputing it from canonical references. */
export function bodyOnlyPage(page: PageRecord): PageRecord {
  // IDENTITY WHEN THERE IS NOTHING TO STRIP. The rest-destructure allocates a new object
  // every time, and a page record is what the painter reuses BY IDENTITY — so a document
  // with a notes part and no notes at all handed the painter a whole new set of pages on
  // every pass, and every visible page's DOM was rebuilt on every keystroke. The lane runs
  // for any package that HAS a footnotes or endnotes part, which is nearly every Word file.
  // Its three siblings — `withPageFieldSources`, `attachContentControlBoundaries` and
  // `reprojectBodyNoteMarks` — all return the original page when nothing moved.
  if (
    page.footnotes === undefined &&
    page.endnotes === undefined &&
    page.noteStream === undefined
  ) {
    return page;
  }
  const { footnotes, endnotes, noteStream, ...body } = page;
  void footnotes;
  void endnotes;
  void noteStream;
  return body;
}
