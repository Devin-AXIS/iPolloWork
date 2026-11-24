import type { RevisionStyleContext } from './revision-presentation.ts';
import { reviewAuthorSlotColor } from './revision-presentation.ts';
import { revisionMarkupColor, type ResolvedRevisionMarkup } from '../contracts/revision-markup.ts';
// Change bars: the rule Word draws in the margin beside every line a tracked change touches.
//
// Measured against Word 16 (PDF export of tracked fixtures under 0.5", 1" and 2" margins,
// and screen captures at 100% and 200% zoom), Word's bar is:
//
// - ONE column per page, at half the left margin from the sheet edge. Paragraph indent,
//   list level, table nesting, multi-column flow and a right-to-left paragraph all leave it
//   where it is. Only mirrored margins move it to the outside edge, which the layout does
//   not model, so the left column is the only one painted. A gutter is folded into the
//   content inset here (Word's own placement with a gutter could not be measured: this
//   build does not shift the text for one).
// - Continuous. A changed line owns its whole pitch — from its own top (the paragraph's
//   spacing before, on a first line) to the next line's top (the spacing after, on a last
//   line) — so adjacent changed paragraphs read as one rule with no gap at the boundary.
// - Neutral in All Markup, grey whatever the change was, beside the lines that carry
//   markup. Red and heavier in Simple Markup, beside the lines a resolved change touched —
//   the layout publishes those as change sites, since nothing inline says a thing there.
//   The kind is still published as a class for a host that wants the colour back.
// - A toggle. Word swaps Simple and All Markup on a click, in both directions; the bar is
//   the one piece of furniture on the sheet that takes the pointer.
// - Everywhere. Body, table cells and tracked rows, headers, footers, footnotes, endnotes
//   and the text of an anchored text box all draw in the same column; a run-property, a
//   paragraph-property and a paragraph-mark change draw like an insertion.
// - Furniture. A one-pixel hairline at every zoom in All Markup, heavier in Simple Markup,
//   hidden from assistive technology (the Review menu offers the same toggle), and never a
//   caret target: the press that toggles the view is consumed before the caret sees it.
//
// Kept in its own module so `semantic-paint.ts` stays under the max-lines gate.

import type {
  AnchoredDrawingRecord,
  BlockFragmentRecord,
  PageRecord,
  ParagraphFragmentRecord,
  TableFragmentRecord,
} from '../layout/semantic-records.ts';
import { formatRevisionOf, type RevisionAttribution } from '../layout/revision-projection.ts';
import {
  forEachPageStory,
  forEachStoryParagraphFragment,
  type SemanticRootStoryKind,
} from '../layout/semantic-record-queries.ts';
import { headerFooterAnchoredDrawingOrigin } from '../layout/header-footer-drawing-origin.ts';
import { isCarriedHeadRow } from '../layout/table-carried-head-row.ts';

export const CHANGE_BARS_CLASS = 'docx-change-bars';
const CHANGE_BAR_CLASS = 'docx-change-bar';

/** Which bars a paint draws. @public */
export type ChangeBarsMode = 'all-markup' | 'simple-markup' | 'none';
type DrawnChangeBarsMode = Exclude<ChangeBarsMode, 'none'>;

/** Which story a bar stands beside; the header-editing chrome dims every other story's. */
type BarStory = Exclude<SemanticRootStoryKind, 'note-separator'>;

/** One rule in sheet coordinates (points from the page's top-left corner). */
interface BarRun {
  author?: string;
  color?: string;
  top: number;
  bottom: number;
  story: BarStory;
  insertion: boolean;
  deletion: boolean;
  format: boolean;
}

/** Page change bars in page coordinates. @public */
export interface PageChangeBars {
  readonly mode: ChangeBarsMode;
  readonly color?: string;
  /** Whether the bars take the pointer as Word's toggle. */
  readonly toggle: boolean;
  /** Sheet-relative x of the column, already scaled and snapped to a whole pixel. */
  readonly left: number;
  readonly runs: readonly BarRun[];
  /** Cheap identity of `left` + `runs`, for the block-adoption path to compare. */
  readonly signature: string;
}

/**
 * Touching runs join. The tolerance absorbs the fractional pitch a line-spacing rule leaves
 * between two boxes that the layout treats as adjacent.
 */
const JOIN_TOLERANCE_PT = 0.5;

function markKinds(run: BarRun, revisions: readonly RevisionAttribution[]): void {
  for (const revision of revisions) {
    run.author ??= revision.author;
    switch (revision.kind) {
      case 'insert':
      case 'moveTo':
        run.insertion = true;
        break;
      case 'delete':
      case 'moveFrom':
        run.deletion = true;
        break;
      case 'format':
        run.format = true;
        break;
    }
  }
}

/** Where one story's runs come from and how far down the sheet they may reach. */
interface StoryFrame {
  readonly mode: DrawnChangeBarsMode;
  readonly story: BarStory;
  /** Sheet-relative y to add to the story's own coordinates. */
  readonly dy: number;
  /**
   * Sheet-relative y no rule may pass. The body's last paragraph box on a page keeps its
   * spacing after even when that spacing overhangs the content box, and Word stops the rule
   * at the text; every other story is bounded by the paper.
   */
  readonly limit: number;
}

function collectParagraph(
  fragment: ParagraphFragmentRecord,
  frame: StoryFrame,
  runs: BarRun[]
): void {
  const lines = fragment.lines;
  const last = lines.length - 1;
  // One scratch list for the whole paragraph: most lines carry nothing, and this walk runs
  // on every block adoption, so a clean line must not cost an allocation.
  const revisions: RevisionAttribution[] = [];
  for (let index = 0; index <= last; index += 1) {
    const line = lines[index]!;
    revisions.length = 0;
    if (frame.mode === 'simple-markup') {
      // The resolved projection carries no markup; the layout published where the view
      // answered a change instead, per line and on the mark.
      if (line.changeSites) revisions.push(...line.changeSites);
      if (index === last && fragment.markChangeSites) revisions.push(...fragment.markChangeSites);
      if (revisions.length > 0) pushLine(fragment, lines, index, frame, revisions, runs);
      continue;
    }
    if (line.changeSites) revisions.push(...line.changeSites);
    for (const span of line.spans) {
      if (span.revisions) revisions.push(...span.revisions);
      // A run-property change is a revision with no wrapper: it lives in the run's own
      // properties, and Word draws the rule for it as for any other change.
      const format = formatRevisionOf(span.props);
      if (format) revisions.push(format);
    }
    // Drawings too: a line whose ONLY change is an inserted or deleted picture carries no
    // revision span — an inline atom is projected, not a span, and an anchored drawing
    // paints from the page layer — and without these the margin said nothing had changed
    // on it (#479).
    for (const drawing of line.drawings ?? []) {
      if (drawing.revisions) revisions.push(...drawing.revisions);
    }
    if (line.anchorRevisions) revisions.push(...line.anchorRevisions);
    // The mark belongs to the LAST line, and it is a revision like any other. Reading only
    // the spans left a paragraph whose sole change was its own pilcrow — a split or a merge,
    // the most ordinary tracked edit there is — with a coloured ¶ and no rule in the margin.
    // A tracked paragraph-property change (`w:pPrChange`, in the paragraph's own properties)
    // and a tracked mark-property change live on the mark as well.
    if (index === last) {
      if (fragment.markRevisions) revisions.push(...fragment.markRevisions);
      if (fragment.markFormatRevision) revisions.push(fragment.markFormatRevision);
      const paragraphFormat = formatRevisionOf(fragment.props);
      if (paragraphFormat) revisions.push(paragraphFormat);
    }
    if (revisions.length === 0) continue;
    pushLine(fragment, lines, index, frame, revisions, runs);
  }
}

/** One line's rule, over the line's PITCH. */
function pushLine(
  fragment: ParagraphFragmentRecord,
  lines: ParagraphFragmentRecord['lines'],
  index: number,
  frame: StoryFrame,
  revisions: readonly RevisionAttribution[],
  runs: BarRun[]
): void {
  const line = lines[index]!;
  const last = lines.length - 1;
  // The line's PITCH, not its box: Word's rule runs from the top of the paragraph's own
  // spacing before to the top of whatever comes next, so two changed paragraphs in a row
  // draw one unbroken rule. Line boxes alone left the spacing after as a gap at every
  // paragraph boundary.
  const top = (index === 0 ? fragment.box.y : line.box.y) + frame.dy;
  const bottom = Math.min(
    (index === last ? fragment.box.y + fragment.box.height : lines[index + 1]!.box.y) + frame.dy,
    frame.limit
  );
  if (bottom <= top) return;
  const run: BarRun = {
    top,
    bottom,
    story: frame.story,
    insertion: false,
    deletion: false,
    format: false,
  };
  markKinds(run, revisions);
  runs.push(run);
}

function collectTable(fragment: TableFragmentRecord, frame: StoryFrame, runs: BarRun[]): void {
  for (const row of fragment.rows) {
    // A tracked row is a change even when every cell inside it reads as plain text. All
    // Markup reads the row's own attribution; Simple Markup the site the resolved view kept.
    const rowSites = frame.mode === 'simple-markup' ? row.changeSites : undefined;
    if ((frame.mode === 'all-markup' && row.revisionKind) || (rowSites && rowSites.length > 0)) {
      // A carried head row has no height of its own; its merged text spans the row below.
      const rowBottom = isCarriedHeadRow(row)
        ? Math.max(row.box.y, ...row.cells.map((cell) => cell.box.y + cell.box.height))
        : row.box.y + row.box.height;
      const run: BarRun = {
        top: row.box.y + frame.dy,
        bottom: Math.min(rowBottom + frame.dy, frame.limit),
        story: frame.story,
        author: row.revisionAuthor,
        insertion: row.revisionKind === 'insert',
        deletion: row.revisionKind === 'delete',
        format: false,
      };
      if (rowSites) markKinds(run, rowSites);
      runs.push(run);
    }
    for (const cell of row.cells) {
      if (cell.textDirection === 'btLr') {
        // A rotated cell lays its paragraphs out in a local plane the painter turns by
        // -90°, so their boxes say nothing about the sheet. Its lines all stand vertical
        // across the cell, and the rule beside them is the cell's own height.
        const inner: BarRun[] = [];
        collectBlocks(cell.blocks, frame, inner);
        if (inner.length === 0) continue;
        const run: BarRun = {
          top: cell.box.y + frame.dy,
          bottom: Math.min(cell.box.y + cell.box.height + frame.dy, frame.limit),
          story: frame.story,
          insertion: false,
          deletion: false,
          format: false,
        };
        for (const part of inner) {
          run.insertion ||= part.insertion;
          run.deletion ||= part.deletion;
          run.format ||= part.format;
        }
        if (run.bottom > run.top) runs.push(run);
        continue;
      }
      collectBlocks(cell.blocks, frame, runs);
    }
  }
}

/**
 * Every block's boxes share one coordinate space with the story that holds it: the page's
 * content box for the body (cells and nested tables included), the story box for a header
 * or footer, the note box for a footnote or endnote. `frame.dy` is that story's offset on
 * the sheet.
 */
function collectBlocks(
  blocks: readonly BlockFragmentRecord[],
  frame: StoryFrame,
  runs: BarRun[]
): void {
  for (const block of blocks) {
    if (block.kind === 'table') collectTable(block, frame, runs);
    else collectParagraph(block, frame, runs);
  }
}

function mergeRuns(runs: BarRun[]): BarRun[] {
  runs.sort((a, b) => a.top - b.top || a.bottom - b.bottom);
  const merged: BarRun[] = [];
  for (const run of runs) {
    const previous = merged[merged.length - 1];
    // Never across stories: the header-editing chrome dims by story, and a rule that was
    // half header and half body could be neither.
    if (
      previous &&
      previous.story === run.story &&
      previous.author === run.author &&
      run.top <= previous.bottom + JOIN_TOLERANCE_PT
    ) {
      previous.bottom = Math.max(previous.bottom, run.bottom);
      previous.insertion ||= run.insertion;
      previous.deletion ||= run.deletion;
      previous.format ||= run.format;
      continue;
    }
    merged.push({ ...run });
  }
  return merged;
}

/** How far outside the text a changed-line bar stands, in points. */
const CHANGE_BAR_GAP_PT = 36;

/**
 * The rules one page needs, in sheet coordinates: every root story the page paints, the
 * blocks of each (tracked rows and rotated cells included), and the text-box stories its
 * anchored drawings carry, each at the origin the painter places it at.
 * @public
 */
export function collectPageChangeBars(
  page: PageRecord,
  scale: number,
  mode: ChangeBarsMode,
  toggle = false,
  markup?: ResolvedRevisionMarkup,
  facingPages = false,
  colors?: RevisionStyleContext
): PageChangeBars {
  const runs: BarRun[] = [];
  if (mode === 'none' || markup?.changedLines.mark === 'none')
    return { mode, toggle, left: 0, runs, signature: 'none' };
  const sheetHeight = page.box.height;
  const contentBottom = page.contentBox.y - page.box.y + page.contentBox.height;
  const pageOrigin = { x: page.box.x, y: page.box.y };
  forEachPageStory(page, (root) => {
    if (root.story === 'note-separator') return;
    const frame: StoryFrame = {
      mode,
      story: root.story,
      dy: root.origin.y - page.box.y,
      limit: root.story === 'body' ? contentBottom : sheetHeight,
    };
    collectBlocks(root.host.fragments, frame, runs);
    // Text boxes: a story of their own, placed where the drawing that anchors them lands.
    // The root walk above already covered depth zero, with its rows and rotated cells.
    const rootDrawingOrigin =
      root.story === 'header' || root.story === 'footer'
        ? (drawing: AnchoredDrawingRecord) =>
            headerFooterAnchoredDrawingOrigin(drawing, root.origin, pageOrigin)
        : undefined;
    forEachStoryParagraphFragment(
      root.host,
      (fragment, context) => {
        if (context.textboxDepth === 0) return;
        collectParagraph(
          fragment,
          { mode, story: root.story, dy: context.storyOrigin.y - page.box.y, limit: sheetHeight },
          runs
        );
      },
      root.origin,
      rootDrawingOrigin
    );
  });
  // The column sits half an inch outside the text, whatever the paragraph's indent, but never
  // past the middle of a narrower margin. A sheet with no margin keeps the rule on the paper.
  // Snapped to a whole pixel: a one-pixel rule at a fractional x is two faint ones.
  const right =
    markup?.changedLines.mark === 'rightBorder' ||
    (markup?.changedLines.mark === 'outsideBorder' && facingPages && page.index % 2 === 0);
  const fromEdge = (margin: number) => Math.max(0, margin / 2, margin - CHANGE_BAR_GAP_PT);
  const left = Math.round(
    (right
      ? page.box.width -
        fromEdge(page.box.width - page.contentBox.width - (page.contentBox.x - page.box.x))
      : fromEdge(page.contentBox.x - page.box.x)) * scale
  );
  const color = markup
    ? revisionMarkupColor(
        markup.changedLines.color,
        'var(--doc-review-author-0)',
        mode === 'simple-markup'
          ? 'var(--doc-review-change-bar-simple)'
          : 'var(--doc-review-change-bar)'
      )
    : undefined;
  const merged = mergeRuns(runs);
  if (markup?.changedLines.color === 'byAuthor') {
    for (const run of merged)
      run.color =
        colors?.styles.get(run.author ?? '')?.color ??
        reviewAuthorSlotColor(colors?.authorSlots.get(run.author ?? '') ?? 0);
  }
  let signature = `${mode}|${toggle ? 't' : ''}|${left}|${color ?? ''}`;
  for (const run of merged) {
    signature +=
      `|${run.story}:${run.top.toFixed(3)}-${run.bottom.toFixed(3)}` +
      `${run.insertion ? 'i' : ''}${run.deletion ? 'd' : ''}${run.format ? 'f' : ''}:${run.color ?? ''}`;
  }
  return { mode, toggle, left, runs: merged, signature, ...(color ? { color } : {}) };
}

/**
 * The rules as a single overlay on the sheet, or `null` when nothing on the page is tracked.
 *
 * The overlay is furniture throughout: `aria-hidden`, `contenteditable=false`,
 * `pointer-events: none`, no model range. It sits on the SHEET rather than in the content
 * box so the bar can stand in the margin, outside the dark-mode inversion that the content
 * box applies — which is why the colour token carries its own dark value. Each bar names
 * its story so the header-editing chrome can dim the stories that are not being edited.
 */
export function renderPageChangeBars(
  document: Document,
  bars: PageChangeBars,
  scale: number
): HTMLElement | null {
  if (bars.runs.length === 0) return null;
  const simple = bars.mode === 'simple-markup';
  const overlay = document.createElement('div');
  overlay.className = CHANGE_BARS_CLASS;
  overlay.dataset.docxChangeBars = bars.signature;
  overlay.dataset.docxChangeBarsMode = bars.mode;
  overlay.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('contenteditable', 'false');
  overlay.style.position = 'absolute';
  overlay.style.inset = '0';
  overlay.style.pointerEvents = 'none';
  for (const run of bars.runs) {
    const bar = document.createElement('div');
    bar.className = CHANGE_BAR_CLASS;
    if (run.insertion) bar.classList.add(`${CHANGE_BAR_CLASS}-insertion`);
    if (run.deletion) bar.classList.add(`${CHANGE_BAR_CLASS}-deletion`);
    if (run.format) bar.classList.add(`${CHANGE_BAR_CLASS}-format`);
    bar.dataset.docxStory = run.story;
    bar.style.position = 'absolute';
    bar.style.left = `${bars.left}px`;
    bar.style.top = `${run.top * scale}px`;
    bar.style.height = `${(run.bottom - run.top) * scale}px`;
    // Thickness and ink are the stylesheet's, so a host restyles the rule with two tokens
    // and never fights an inline value. The width does NOT follow the zoom: Word draws a
    // one-pixel hairline at 100% and at 200% alike, and a scaled 0.75pt rule vanishes at
    // 50% and turns into a slab at 400%.
    bar.style.width = simple
      ? 'var(--doc-review-change-bar-simple-width)'
      : 'var(--doc-review-change-bar-width)';
    bar.style.backgroundColor =
      run.color ??
      bars.color ??
      (simple ? 'var(--doc-review-change-bar-simple)' : 'var(--doc-review-change-bar)');
    if (bars.toggle) {
      // Word's toggle: the bar takes the pointer, and the surface swaps the view on a press.
      bar.dataset.docxChangeBarToggle = '';
      bar.style.pointerEvents = 'auto';
      bar.style.cursor = 'pointer';
    } else {
      bar.style.pointerEvents = 'none';
    }
    overlay.append(bar);
  }
  return overlay;
}

/** Collect and render in one step, for a sheet being built from scratch. */
export function paintPageChangeBars(
  document: Document,
  page: PageRecord,
  scale: number,
  mode: ChangeBarsMode,
  toggle = false,
  markup?: ResolvedRevisionMarkup,
  facingPages = false,
  colors?: RevisionStyleContext
): HTMLElement | null {
  return renderPageChangeBars(
    document,
    collectPageChangeBars(page, scale, mode, toggle, markup, facingPages, colors),
    scale
  );
}

/**
 * Bring a retained sheet's overlay up to date after its blocks were adopted: the LAST child
 * of the sheet, as `paintPage` leaves it, and untouched when the rules did not move — a
 * plain keystroke on a redlined page must not rebuild and swap the overlay.
 */
export function reconcilePageChangeBars(
  document: Document,
  sheet: HTMLElement,
  page: PageRecord,
  scale: number,
  mode: ChangeBarsMode,
  toggle = false,
  markup?: ResolvedRevisionMarkup,
  facingPages = false,
  colors?: RevisionStyleContext
): void {
  const previous = sheet.querySelector<HTMLElement>(`:scope > .${CHANGE_BARS_CLASS}`);
  const bars = collectPageChangeBars(page, scale, mode, toggle, markup, facingPages, colors);
  if (previous && previous.dataset.docxChangeBars === bars.signature) return;
  previous?.remove();
  const next = renderPageChangeBars(document, bars, scale);
  if (next) sheet.append(next);
}
