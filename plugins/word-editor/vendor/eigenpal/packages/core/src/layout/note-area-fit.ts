// Body fit above a footnote area: a paragraph's space after must fit there too.
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import { isOutOfFlowFragment } from './fragment-flow.ts';
import { fragmentCursorBottomPt } from './note-fragment-geometry.ts';
import type {
  BlockFragmentRecord,
  LineRecord,
  PageRecord,
  ParagraphFragmentRecord,
} from './semantic-records.ts';
import type { KeepNextLine, KeepNoteClosing } from './pagination-keeps.ts';

type SpannedLine = Pick<LineRecord, 'spans'>;

function citesFootnote(line: SpannedLine): boolean {
  return line.spans.some(
    (span) => span.noteNav?.direction === 'to-note' && span.noteNav.scopeId.startsWith('footnote:')
  );
}

/**
 * Whether the page being filled has a footnote area: a footnote reference is already on
 * it, or is on the paragraph line being placed.
 *
 * At the bottom of a plain page a paragraph's space after may cross the text margin. Above
 * a footnote area it must fit, so the body pass charges the closing line with it. A note
 * reserve alone does not prove an area: an eviction hold-out reserves room on a page
 * whose own text cites nothing.
 */
export function pageHoldsFootnoteReference(
  fragments: readonly BlockFragmentRecord[],
  pending: readonly SpannedLine[],
  line: SpannedLine
): boolean {
  if (citesFootnote(line) || pending.some(citesFootnote)) return true;
  return fragments.some(fragmentCitesFootnote);
}

/**
 * What a keep group priced before placement needs to charge closing space after as
 * {@link closingSpaceAfterPt} does: undefined without a note reserve, else whether the page
 * already cites a footnote and how to tell when a member's lines cite one. In legacy modes
 * only a member's own citation counts.
 */
export function keepNoteClosing(
  reservePt: number | undefined,
  fragments: readonly BlockFragmentRecord[],
  layout: CompatibilityLayout
): KeepNoteClosing | undefined {
  if ((reservePt ?? 0) <= 0) return undefined;
  const cited = pageAreaHoldsSpaceAfter(layout) && fragments.some(fragmentCitesFootnote);
  return { cited, cites: linesCiteFootnote };
}

const linesCiteFootnote = (lines: readonly KeepNextLine[]): boolean =>
  lines.some((line) => 'spans' in line && citesFootnote(line as SpannedLine));

/** Fragments are immutable records, so each is scanned once per pass however often asked. */
const fragmentCitations = new WeakMap<BlockFragmentRecord, boolean>();
function fragmentCitesFootnote(fragment: BlockFragmentRecord): boolean {
  let cites = fragmentCitations.get(fragment);
  if (cites === undefined) {
    cites = fragment.kind === 'paragraph' && fragment.lines.some(citesFootnote);
    fragmentCitations.set(fragment, cites);
  }
  return cites;
}

/**
 * The space after the body pass charges to a paragraph's closing line: the paragraph's
 * space after on a page that has a note reserve and cites a footnote, else 0. Legacy modes
 * let it cross the area as it crosses a bottom margin, unless the paragraph's own lines on
 * the page cite a footnote.
 */
export function closingSpaceAfterPt(
  reservePt: number | undefined,
  fragments: readonly BlockFragmentRecord[],
  pending: readonly SpannedLine[],
  line: SpannedLine,
  spaceAfterPt: number,
  layout: CompatibilityLayout
): number {
  if (spaceAfterPt <= 0 || (reservePt ?? 0) <= 0) return 0;
  if (!pageAreaHoldsSpaceAfter(layout)) {
    return citesFootnote(line) || pending.some(citesFootnote) ? spaceAfterPt : 0;
  }
  return pageHoldsFootnoteReference(fragments, pending, line) ? spaceAfterPt : 0;
}

type CompatibilityLayout = { readonly compatibilityMode?: number | undefined };

/** Whether any citation on the page makes a closing paragraph's space after count. */
function pageAreaHoldsSpaceAfter(layout: CompatibilityLayout): boolean {
  return hasCompatibilityRule(layout.compatibilityMode, 'noteAreaHoldsSpaceAfter');
}

/**
 * The auto line spacing below a line's glyph band that the body pass leaves out of the
 * budget. At the bottom of a plain page it may cross the text margin. Above a footnote
 * area it must fit, the same as {@link closingSpaceAfterPt}, so none of it is dropped. Legacy
 * modes drop it there too.
 */
export function droppableSpacingPt(
  reservePt: number | undefined,
  fragments: readonly BlockFragmentRecord[],
  pending: readonly SpannedLine[],
  line: SpannedLine & { readonly trailingSpacing: number },
  layout: CompatibilityLayout
): number {
  if (line.trailingSpacing <= 0 || (reservePt ?? 0) <= 0) return line.trailingSpacing;
  if (!hasCompatibilityRule(layout.compatibilityMode, 'noteAreaHoldsLineSpacing')) {
    return line.trailingSpacing;
  }
  return pageHoldsFootnoteReference(fragments, pending, line) ? 0 : line.trailingSpacing;
}

/**
 * The space after that the body pass charges below the page's last line: the closing
 * paragraph's space after when the page cites a footnote, else 0. In legacy modes the closing
 * paragraph must cite one itself ({@link closingSpaceAfterPt}). A reserve that holds the
 * body end in place must leave this room, or it pushes that paragraph out.
 */
export function chargedSpaceAfterPt(page: PageRecord, layout: CompatibilityLayout): number {
  // No reserve check: this answer only matters while a hold-out sizes this page's reserve,
  // and a page it holds always has one.
  const last = closingParagraphOf(page);
  if (!last) return 0;
  const cites = pageAreaHoldsSpaceAfter(layout)
    ? pageCitesFootnote(page)
    : fragmentCitesFootnote(last);
  return cites ? last.spacing.after : 0;
}

/** Where lines that return from the next page start on a page. */
export interface RejoinPoint {
  /** The top of the returning lines, content-relative; never above the given body bottom. */
  readonly bottom: number;
  /** The space after that `bottom` includes. A returning space before collapses with it. */
  readonly spaceAfter: number;
}

/**
 * Where the next page's opening lines start when they return to `page`. They rejoin the column
 * that the last fragment in flow order ends, as a new paragraph below that paragraph's space
 * after. The space after counts whether or not the page cites a footnote yet;
 * {@link chargedSpaceAfterPt} counts it only once the page does. The published space after
 * already reflects contextual spacing, and the returning paragraph's own space before can only
 * widen the gap, so this is the least gap there is. A last fragment that is a table, or a
 * paragraph that continues on the next page, adds no gap.
 */
export function rejoinPoint(page: PageRecord, bodyBottom: number): RejoinPoint {
  let last: BlockFragmentRecord | undefined;
  for (let at = page.fragments.length - 1; at >= 0 && !last; at -= 1) {
    const fragment = page.fragments[at]!;
    if (isOutOfFlowFragment(fragment)) continue;
    if (fragment.kind === 'paragraph' && fragment.positionedFrame) continue;
    last = fragment;
  }
  if (last?.kind !== 'paragraph' || !last.paragraphEnd || last.spacing.after <= 0) {
    return { bottom: bodyBottom, spaceAfter: 0 };
  }
  const bottom = fragmentCursorBottomPt(last) + last.spacing.after;
  // Lines returning to a shorter last column land at that column's end. The answer keeps the
  // lower body end instead, a conservative bound the pull-back fit already used there, and
  // that end holds none of this paragraph's space after.
  return bottom >= bodyBottom - 0.001
    ? { bottom: Math.max(bottom, bodyBottom), spaceAfter: last.spacing.after }
    : { bottom: bodyBottom, spaceAfter: 0 };
}

/** The paragraph that ends on the page and closes its body, if one does. */
function closingParagraphOf(page: PageRecord): ParagraphFragmentRecord | undefined {
  let last: BlockFragmentRecord | undefined;
  let lastBottom = -Infinity;
  for (const fragment of page.fragments) {
    const bottom = fragmentCursorBottomPt(fragment);
    if (bottom > lastBottom) {
      last = fragment;
      lastBottom = bottom;
    }
  }
  return last?.kind === 'paragraph' && last.paragraphEnd ? last : undefined;
}

/**
 * Whether a laid page cites a footnote, so its body must fit whole above the footnote
 * area: no spacing below a line's glyph band may cross into it.
 */
export function pageCitesFootnote(page: PageRecord): boolean {
  return page.fragments.some(fragmentCitesFootnote);
}
