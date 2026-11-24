import { revisionMarkupStyle, type ResolvedRevisionMarkup } from '../contracts/revision-markup.ts';
import { paintRevisionMarkup } from './revision-markup-paint.ts';
import {
  DEFAULT_RUN_STYLE,
  markRevisionRemovesMark,
  shownMarkRevision,
  type RevisionAttribution,
  type LineRecord,
} from '@docx-editor.dev/core/layout';
import { lineContentEdges } from '../layout/pending-line.ts';
import {
  REVIEW_AUTHOR_SLOTS,
  reviewAuthorSlotColor,
  revisionPresentationOf,
  type RevisionStyleContext,
} from './revision-presentation.ts';

/** Paragraph terminators follow the base direction, outside the physical text band. */
export function lineTerminatorEdge(
  line: LineRecord,
  paragraphRtl = false
): {
  readonly x: number;
  readonly rtl: boolean;
} {
  const base = line.spans.find((span) => span.style.shaping)?.style.shaping?.baseLevel;
  const rtl = base === undefined ? paragraphRtl : base === 1;
  // An inline picture is content: the mark follows a picture that ends the line.
  const edges = lineContentEdges(line.spans, line.drawings ?? []);
  if (!edges) return { x: line.contentX, rtl };
  return { x: rtl ? edges.left : edges.right, rtl };
}

/**
 * Seat a terminator glyph (the pilcrow or the line-break arrow) on its painted line's baseline.
 *
 * The glyph sits in a seat placed at the terminator edge, out of the line's flow. With
 * `line-height: 0` on the seat and the glyph, the seat's one line box runs from the glyph's
 * box down to the shared baseline, and the seat's strut has `font-size: 0`, so nothing hangs
 * below the baseline. The seat's bottom edge is the glyph's baseline whatever its font, so
 * the seat's bottom is placed on the line's published baseline. A top-anchored seat drew the
 * glyph a third of an em low: its line box starts at the glyph's box, not at the baseline. A right-to-left seat reads from its right
 * edge, so its glyph ends at the terminator edge rather than starting there. `at` moves the
 * seat past furniture that occupies the terminator edge, such as a break label.
 */
export function seatTerminatorMark(
  glyph: HTMLElement,
  lineElement: HTMLElement,
  line: LineRecord,
  paragraphRtl: boolean,
  fontSizePt: number,
  scale: number,
  at?: { readonly x: number; readonly rtl: boolean }
): void {
  const edge = at ?? lineTerminatorEdge(line, paragraphRtl);
  const seat = lineElement.ownerDocument.createElement('span');
  seat.className = 'docx-terminator-seat';
  seat.dataset.docxMarker = '';
  seat.setAttribute('aria-hidden', 'true');
  seat.setAttribute('contenteditable', 'false');
  seat.style.position = 'absolute';
  seat.style.left = `${(edge.x - line.contentX) * scale}px`;
  seat.style.bottom = `${Math.max(0, line.box.height - line.baseline) * scale}px`;
  seat.style.width = '0';
  seat.style.fontSize = '0';
  seat.style.lineHeight = '0';
  seat.style.whiteSpace = 'pre';
  seat.style.pointerEvents = 'none';
  seat.style.userSelect = 'none';
  if (edge.rtl) seat.style.direction = 'rtl';
  glyph.style.display = 'inline-block';
  glyph.style.verticalAlign = 'baseline';
  glyph.style.fontSize = `${fontSizePt * scale}px`;
  seat.append(glyph);
  lineElement.append(seat);
}

/**
 * Colour and attribute break furniture from the break character's OWN revision: the revision
 * colour (or author colour), a strike or underline, and the `data-revision-*` attributes review
 * chrome reads. Leaves the element untouched for an unrevised break.
 */
export function applyBreakRevision(
  glyph: HTMLElement,
  revisions: readonly RevisionAttribution[] | undefined,
  colors: RevisionStyleContext | undefined
): void {
  const presentation = revisionPresentationOf(revisions, colors?.authorSlots, colors?.styles);
  if (!presentation) return;
  const { attribution } = presentation;
  const authorStyle = colors?.styles.get(attribution.author);
  const byAuthor = colors && (authorStyle?.color !== undefined || colors.others === 'author');
  glyph.style.color = byAuthor ? presentation.authorColor : presentation.color;
  glyph.dataset.revisionKind = attribution.kind;
  glyph.dataset.revisionId = attribution.id;
  glyph.dataset.reviewAuthor = attribution.author;
  if (colors) {
    glyph.dataset.reviewAuthorSlot = String(
      (colors.authorSlots.get(attribution.author) ?? 0) % REVIEW_AUTHOR_SLOTS
    );
    for (const token of colors.classTokens.get(attribution.author) ?? [])
      glyph.classList.add(token);
  }
  if (presentation.line) {
    glyph.style.textDecorationLine = presentation.line;
    glyph.style.textDecorationStyle = presentation.decorationStyle;
    glyph.style.textDecorationColor = glyph.style.color;
  }
}

/**
 * Manual line-break furniture, seated at the end of `lineElement`. The zero-width model span
 * still owns the newline.
 */
export function paintManualLineBreak(
  document: Document,
  line: LineRecord,
  lineElement: HTMLElement,
  scale: number,
  colors?: RevisionStyleContext,
  paragraphRtl = false
): void {
  const glyph = document.createElement('span');
  const last = line.spans[line.spans.length - 1];
  glyph.className = 'docx-line-break-mark';
  glyph.dataset.docxMarker = '';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.contentEditable = 'false';
  glyph.textContent = '\u21b5';
  glyph.style.pointerEvents = 'none';
  glyph.style.userSelect = 'none';
  glyph.style.color = 'var(--doc-revision-format)';
  // Read the newline's own revision, never the preceding text's attribution.
  applyBreakRevision(glyph, last?.revisions, colors);
  const size = last?.style.fontSizePt ?? DEFAULT_RUN_STYLE.fontSizePt;
  seatTerminatorMark(glyph, lineElement, line, paragraphRtl, size, scale);
}

/**
 * The pilcrow beside a paragraph whose MARK was inserted or deleted.
 *
 * Show/Hide controls its visibility independently of revision selection. A tracked
 * deletion retains its strike and attribution when paragraph marks are visible.
 *
 * Furniture: no model range, `aria-hidden`, not editable, so it can never be selected, copied
 * or counted as text.
 */
export function paintParagraphMark(
  document: Document,
  revisions: readonly RevisionAttribution[],
  colors: RevisionStyleContext | undefined,
  markup?: ResolvedRevisionMarkup,
  kindColors = false
): HTMLElement {
  // ONE glyph however many decisions stand on it: there is one pilcrow, and drawing a second
  // beside it would read as a second paragraph break. A REMOVAL wins the face when a mark
  // carries both — a break proposed and then unproposed ends up removed, and the same rule
  // already decides the colour of a change bar over mixed lines. `moveFrom` counts as a
  // removal, which is what keeps this glyph agreeing with the rule in the margin beside it.
  // Both attributions are published on the element, so review chrome can offer both.
  const shown = shownMarkRevision(revisions);
  if (!shown) {
    const glyph = document.createElement('span');
    glyph.className = 'docx-paragraph-mark';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.contentEditable = 'false';
    glyph.textContent = '\u00b6';
    glyph.style.pointerEvents = 'none';
    glyph.style.color = 'var(--doc-revision-format)';
    return glyph;
  }
  const glyph = document.createElement('span');
  glyph.className = `docx-paragraph-mark docx-revision-pmark docx-revision-pmark-${shown.kind}`;
  glyph.setAttribute('aria-hidden', 'true');
  glyph.contentEditable = 'false';
  glyph.dataset.revisionKind = shown.kind;
  glyph.dataset.revisionId = shown.id;
  if (shown.author !== '') glyph.dataset.reviewAuthor = shown.author;
  // Always, not only for a pair: a consumer reading `data-revision-ids` should not have to
  // fall back to `data-revision-id` for the ordinary case. Kinds ride alongside, because the
  // ids alone cannot say which decision each one is.
  glyph.dataset.revisionIds = revisions.map((revision) => revision.id).join(' ');
  glyph.dataset.revisionKinds = revisions.map((revision) => revision.kind).join(' ');
  glyph.textContent = '\u00b6';
  glyph.style.pointerEvents = 'none';
  const removes = markRevisionRemovesMark(shown);
  // Under author colouring the glyph follows its author, like the spans beside it; the
  // strike still says a removal is a removal.
  const markStyle = colors?.styles.get(shown.author);
  const markSlot = colors ? (colors.authorSlots.get(shown.author) ?? 0) % REVIEW_AUTHOR_SLOTS : 0;
  if (colors) {
    glyph.dataset.reviewAuthorSlot = String(markSlot);
    const tokens = colors.classTokens.get(shown.author);
    if (tokens) for (let i = 0; i < tokens.length; i += 1) glyph.classList.add(tokens[i]!);
  }
  // The same selective rule as the spans, read straight off the maps: building a whole
  // presentation object for one field allocated per paragraph mark, and a heavily revised
  // document has one per paragraph.
  glyph.style.color =
    markStyle?.color ??
    (colors?.others === 'author'
      ? reviewAuthorSlotColor(markSlot)
      : removes
        ? 'var(--doc-revision-deletion)'
        : 'var(--doc-revision-insertion)');
  if (markup) {
    const legacyColor = glyph.style.color;
    glyph.style.color = '';
    const mark = revisionMarkupStyle(markup, shown.kind).mark;
    if (mark === 'hidden') glyph.style.visibility = 'hidden';
    if (mark === 'caret') glyph.textContent = '^';
    if (mark === 'pound') glyph.textContent = '#';
    paintRevisionMarkup(
      glyph,
      markup,
      shown.kind,
      markStyle?.color ?? reviewAuthorSlotColor(markSlot),
      kindColors || colors?.others === 'kind' || markStyle?.color ? legacyColor : undefined,
      markStyle?.background
    );
  } else if (removes) glyph.style.textDecorationLine = 'line-through';
  return glyph;
}
