// Which span owns the gap alignment opens after it.
//
// Justified lines open gaps after spaces, and distributed and East Asian justified lines split
// a span into one span per character and move them apart. Screen paint draws a gap the span
// before it owns inside that span, as `word-spacing` or `letter-spacing`, because the browser
// decorates and highlights both but never a margin: underline, strike, highlight, shading, and
// revision marks then run on across the gap. The PDF writer extends the same marks over the
// same gaps, so both outputs read one rule, {@link followingGapPaint}.
import { segmentGraphemes } from '../layout/grapheme.ts';
import type { StyleSpanRecord } from '../layout/semantic-records.ts';
import { syntheticBoldAdvancePt, unspacedBlankRuns } from '../layout/synthetic-bold.ts';
import { withoutTrailingZeroWidthSpaces } from '../layout/trailing-spaces.ts';
import { browserBoldWideningPx } from './synthetic-bold-widening.ts';

/**
 * The fields of a laid span that decide whether it owns the gap after it. A
 * `StyleSpanRecord` is one.
 *
 * @internal
 */
export interface GapSpan {
  readonly text: string;
  readonly range: { readonly paragraphId: string; readonly start: number; readonly end: number };
  readonly style: { readonly horizontalScalePercent: number };
  readonly link?: { readonly id: string };
  readonly fieldAtom?: { readonly resultStart?: number };
  readonly wrapAdvanceBefore?: number;
  readonly glyphOffsetPt?: number;
  readonly projected?: boolean;
  readonly equation?: unknown;
  readonly unsupported?: unknown;
}

/**
 * How a span paints the gap after it, before `next`: `'wordSpacing'` stretches its trailing
 * space, `'letterSpacing'` widens its one character, and null leaves the gap a margin on
 * `next`, which marks do not cover. A span that owns the gap draws its marks across it.
 *
 * @internal
 */
export function followingGapPaint(
  span: GapSpan,
  next: GapSpan
): 'wordSpacing' | 'letterSpacing' | null {
  if (absorbsFollowingGap(span, next)) return 'wordSpacing';
  return sharesAnchor(span, next) && absorbsLetterGap(span, next) ? 'letterSpacing' : null;
}

/**
 * Whether the gap between `span` and `next` can paint as letter spacing on `span`: `span` is
 * one visible character whose source range `next` continues, at full horizontal scale, and no
 * float advance separates them. The caller also checks that both share one anchor.
 *
 * A span whose painted box has a fixed width cannot grow with letter spacing, so its gap stays
 * a margin on the next span. Compressed East Asian punctuation is such a span: it carries
 * `glyphOffsetPt` and paints its published width (`prepareTextPaintHost`).
 */
export function absorbsLetterGap(span: GapSpan, next: GapSpan): boolean {
  if (span.projected || span.equation || span.unsupported || next.projected) return false;
  if (span.glyphOffsetPt !== undefined) return false;
  if (span.range.paragraphId !== next.range.paragraphId) return false;
  if (span.range.end !== next.range.start || span.range.end - span.range.start !== span.text.length)
    return false;
  if (span.style.horizontalScalePercent !== 100) return false;
  if ((next.wrapAdvanceBefore ?? 0) > 0.001) return false;
  if (span.text.trim() === '' || segmentGraphemes(span.text).length !== 1) return false;
  return true;
}

/**
 * The `letter-spacing` that paints `gap` after the character of `span`, painted in `element`:
 * its own spacing plus the gap.
 */
export function letterGapSpacing(
  element: HTMLElement,
  span: StyleSpanRecord,
  gap: number,
  scale: number
): string {
  return `${paintedLetterSpacingPx(element, span, scale) + gap * scale}px`;
}

/**
 * Scripts whose letters join. Letter spacing breaks the joins, so a span in one of them keeps
 * the box that layout gave it and draws its synthesized bold at the face's own advances.
 */
const JOINING_SCRIPTS: ReadonlySet<string> = new Set([
  'Adlm',
  'Arab',
  'Chrs',
  'Mand',
  'Mani',
  'Mong',
  'Nkoo',
  'Ougr',
  'Phag',
  'Phlp',
  'Rohg',
  'Sogd',
  'Syrc',
]);

/**
 * The advance screen paint adds after each character of a span whose bold is synthesized, in
 * points.
 *
 * Layout gives each widened character of such a span extra advance, but a browser draws a
 * synthesized bold at the face's own advances. Paint adds the extra as letter spacing and takes
 * it back from spaces with word spacing, so each glyph stays where layout put it. A span in a
 * joining script gets none: it keeps the box that layout gave it.
 *
 * @internal
 */
export function syntheticBoldSpacingPt(span: StyleSpanRecord): number {
  if (!span.syntheticBold) return 0;
  const script = span.style.shaping?.script;
  return script !== undefined && JOINING_SCRIPTS.has(script)
    ? 0
    : syntheticBoldAdvancePt(span.style);
}

/**
 * The letter spacing paint gives each character of `span`, in CSS pixels in the coordinates of
 * `element`, which carries the span's font: the span's own character spacing, plus
 * {@link syntheticBoldSpacingPt} less the widening the browser gives a synthesized bold itself
 * ({@link browserBoldWideningPx}).
 *
 * `horizontalFactor` is the horizontal scale of an element whose own transform scales its
 * glyphs. Layout scales the extra advance of synthesized bold with the glyphs, but not the
 * character spacing, so only the character spacing is divided by it.
 *
 * @internal
 */
export function paintedLetterSpacingPx(
  element: HTMLElement,
  span: StyleSpanRecord,
  scale: number,
  horizontalFactor = 1
): number {
  const own = (span.style.characterSpacingPt * scale) / horizontalFactor;
  const bold = syntheticBoldSpacingPt(span);
  return bold === 0 ? own : own + bold * scale - browserBoldWideningPx(element, span);
}

/**
 * Apply {@link syntheticBoldSpacingPt} to a painted span. Word spacing takes the whole extra
 * back from each space: letter spacing and the browser's own widening together add exactly that
 * extra to every character. @internal
 */
export function applySyntheticBoldSpacing(
  element: HTMLElement,
  span: StyleSpanRecord,
  scale: number
): void {
  const spacing = syntheticBoldSpacingPt(span);
  if (spacing === 0) return;
  element.style.letterSpacing = `${paintedLetterSpacingPx(element, span, scale)}px`;
  element.style.wordSpacing = `${-spacing * scale}px`;
}

/**
 * Keep the blanks of a synthesized-bold span that cannot split at their own advance.
 *
 * Layout cuts U+3000 and the other blanks that word spacing cannot reach into spans of their
 * own. A field result or other projected span stays whole, so paint draws each such blank in a
 * child that drops the extra letter spacing. Selection never maps into projected text, so the
 * extra text nodes cost nothing there. `element` carries the span's font, and `host` holds
 * the span's text as one text node.
 *
 * @internal
 */
export function paintUnspacedBlanks(
  document: Document,
  element: HTMLElement,
  host: HTMLElement,
  span: StyleSpanRecord,
  scale: number
): void {
  if (!span.projected || syntheticBoldSpacingPt(span) === 0) return;
  const text = host.textContent ?? '';
  const blanks = unspacedBlankRuns(text);
  if (blanks.length === 0) return;
  // The browser widens a blank of a synthesized bold too; the child takes that back.
  const widening = browserBoldWideningPx(element, span);
  const nodes: Node[] = [];
  let from = 0;
  for (const blank of blanks) {
    if (blank.from > from) nodes.push(document.createTextNode(text.slice(from, blank.from)));
    const child = document.createElement('span');
    child.style.letterSpacing = `${span.style.characterSpacingPt * scale - widening}px`;
    child.textContent = text.slice(blank.from, blank.to); // SAFE: textContent, never innerHTML
    nodes.push(child);
    from = blank.to;
  }
  if (from < text.length) nodes.push(document.createTextNode(text.slice(from)));
  host.replaceChildren(...nodes);
}

/**
 * Every character an engine's `word-spacing` may move. U+0020 and NBSP expand in Chromium,
 * WebKit and Gecko alike; a tab expands in Chromium and Gecko (fourfold — it is four
 * advances). The rest is the CSS Text 3 word-separator list, kept in case an engine starts
 * honouring it; U+3000 is deliberately absent — no engine expands it, and refusing it would
 * forfeit the stretch on CJK text for nothing.
 */
const WORD_SEPARATOR = /[\t\n\r \u00A0\u1361\u{10100}-\u{10102}\u{1039F}\u{1091F}]/u;

/**
 * Whether the justify gap AFTER this span can be painted as `word-spacing` on the span
 * itself, stretching its trailing space, instead of as a margin on the next span.
 *
 * The stretch must move ONLY the trailing space. Layout puts justify slack after expandable
 * U+0020s (and any U+200B after) and word-breaks after each, so an ordinary span qualifies —
 * including a projected field result, whose box was reserved from the drawn text like any
 * other. A span carrying any OTHER word separator keeps the margin, whose only cost is a
 * seam in the native selection band. A span with a forced width (`w:w` horizontal scaling)
 * cannot grow its box, so it keeps the margin too.
 *
 * The stretch also lives inside the span's ANCHOR and on its side of a float. A link's last
 * span stretching over the gap would extend the `<a>` hit target across blank slack — a
 * click there would follow the link — so both spans must share one anchor, or have none.
 * And a wrap advance is painted BETWEEN the spans, so stretching across it would draw the
 * slack (and this span's underline and shading) inside the float's exclusion zone.
 */
function absorbsFollowingGap(span: GapSpan, next: GapSpan): boolean {
  const text = withoutTrailingZeroWidthSpaces(span.text);
  if (!text.endsWith(' ')) return false;
  if (span.style.horizontalScalePercent !== 100) return false;
  if (!sharesAnchor(span, next)) return false;
  if ((next.wrapAdvanceBefore ?? 0) > 0.001) return false;
  return !WORD_SEPARATOR.test(text.slice(0, -1));
}

/**
 * Whether two adjacent spans land in the same painted anchor, mirroring the anchor-opening
 * rules in {@link paintLine}: both linkless, or the same link id — and for field atoms the
 * same field (same model start), because two discrete fields share a content-keyed id.
 */
export function sharesAnchor(a: GapSpan, b: GapSpan): boolean {
  if (!a.link && !b.link) return true;
  if (!a.link || !b.link || a.link.id !== b.link.id) return false;
  if (Boolean(a.fieldAtom) !== Boolean(b.fieldAtom)) return false;
  return !a.fieldAtom || fieldAnchorStart(a) === fieldAnchorStart(b);
}

/** The model offset that identifies a field's link anchor: its result's start, or its unit. */
export function fieldAnchorStart(span: GapSpan): number {
  return span.fieldAtom?.resultStart ?? span.range.start;
}

/**
 * The gap paint draws between `span` and the `next` span, in points: the stretch alignment
 * opens, or a negative gap after a trailing space that a line shrank. Layout shrinks a space by
 * moving the later spans left, so the space keeps its natural box and the next span starts
 * inside it. Zero for any other overlap, and for a gap below 0.001 pt.
 *
 * @internal
 */
export function paintedGapBetween(span: PlacedSpan, next: PlacedSpan): number {
  const step = next.box.x - (span.box.x + span.box.width);
  const wrap = next.wrapAdvanceBefore ?? 0;
  if (step - wrap > 0.001) return step - wrap;
  // Bidi reorders right-to-left spans, and a line it reorders carries a shrink in its styles.
  const leftToRight = !(
    (span.style.shaping?.level ?? 0) % 2 || (next.style.shaping?.level ?? 0) % 2
  );
  const shrunk =
    step < -0.001 &&
    wrap <= 0.001 &&
    leftToRight &&
    withoutTrailingZeroWidthSpaces(span.text).endsWith(' ');
  return shrunk ? step : 0;
}

/**
 * The fields of a laid span that {@link paintedGapBetween} reads. A `StyleSpanRecord` is one.
 *
 * @internal
 */
export interface PlacedSpan {
  readonly text: string;
  readonly box: { readonly x: number; readonly width: number };
  readonly style: { readonly shaping?: { readonly level?: number } | null };
  readonly wrapAdvanceBefore?: number;
}
