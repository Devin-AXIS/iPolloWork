import { trustedFontBytes, type ResolvedFont } from './font-resource.ts';
import { segmentGraphemes } from './grapheme.ts';
import { layoutRunHalfPointsOf } from './layout-run-shape.ts';
import { glyphSizeFactorOf, type ResolvedRunStyle } from './run-style.ts';
import { HEAD_TAG, OS2_TAG, tableDirectoryBase, tableOffset } from './sfnt-tables.ts';
import type { ShapedRun } from './shaped-run.ts';

/**
 * Extra advance of each inked glyph when bold is synthesized, as a fraction of the font size.
 *
 * A face without a bold style draws bold by thickening its outlines, and each glyph that has
 * ink then advances 1/50 em further. Blank glyphs such as spaces keep their advance. Measured
 * on Arabic text at 10, 20, 30, and 36 pt: the extra width matched this rule to the pixel.
 *
 * @public
 */
export const SYNTHETIC_BOLD_ADVANCE_EM = 1 / 50;

/**
 * Whether a face draws bold by itself: an `OS/2` weight class of 600 or more, or the bold bit
 * of `OS/2.fsSelection` or `head.macStyle`. A face without readable tables is not bold.
 *
 * The weight a face was REGISTERED under does not answer this. A document embeds the face that
 * draws bold text in the font's bold slot. For a family without a bold face, that slot holds a
 * copy of the regular face, and bold text in it draws with a synthesized bold.
 */
export function sfntFaceIsBold(bytes: Uint8Array, faceIndex: number): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const base = tableDirectoryBase(view, bytes.byteLength, faceIndex);
  if (base === null) return false;
  // `usWeightClass` is at 4 and `fsSelection` at 62 in every OS/2 version; bit 5 is BOLD.
  const os2 = tableOffset(view, bytes.byteLength, base, OS2_TAG, 64);
  if (os2 !== null && (view.getUint16(os2 + 4) >= 600 || (view.getUint16(os2 + 62) & 0x20) !== 0))
    return true;
  // `macStyle` is at 44; bit 0 is bold.
  const head = tableOffset(view, bytes.byteLength, base, HEAD_TAG, 54);
  return head !== null && (view.getUint16(head + 44) & 0x01) !== 0;
}

const boldFaces = new WeakMap<ResolvedFont, boolean>();

/** Whether a bold run is drawn with a face that has no bold style. */
export function isSyntheticBold(style: ResolvedRunStyle, font: ResolvedFont): boolean {
  if (style.bold !== true) return false;
  let bold = boldFaces.get(font);
  if (bold === undefined) {
    bold = sfntFaceIsBold(trustedFontBytes(font), font.faceIndex);
    boldFaces.set(font, bold);
  }
  return !bold;
}

/**
 * Extra advance of each inked glyph of a synthesized-bold run, in points at the drawn size,
 * before horizontal scaling.
 */
export function syntheticBoldAdvancePt(style: ResolvedRunStyle): number {
  return (layoutRunHalfPointsOf(style) / 2) * glyphSizeFactorOf(style) * SYNTHETIC_BOLD_ADVANCE_EM;
}

/** Whether a shaped glyph draws ink and advances: the glyphs synthesized bold widens. */
function inked(glyph: ShapedRun['glyphs'][number]): boolean {
  return glyph.advanceX > 0 && glyph.outline.path.length > 0;
}

/** How many glyphs of a run synthesized bold widens. */
export function syntheticBoldGlyphCount(run: ShapedRun): number {
  let count = 0;
  for (const glyph of run.glyphs) if (inked(glyph)) count++;
  return count;
}

/** The UTF-16 offsets where the clusters of the glyphs that synthesized bold widens start. */
export function syntheticBoldGlyphStarts(run: ShapedRun): number[] {
  const starts: number[] = [];
  for (const glyph of run.glyphs) if (inked(glyph)) starts.push(glyph.cluster);
  return starts;
}

/**
 * A character that draws ink and opens a cluster. Spaces, format characters, and combining
 * marks do not.
 */
const WIDENED_CHARACTER = /[^\p{White_Space}\p{Default_Ignorable_Code_Point}\p{M}]/u;

/**
 * The UTF-16 offsets where the graphemes of `text` that synthesized bold widens start: each
 * grapheme that holds a {@link WIDENED_CHARACTER}.
 *
 * Text that the face cannot shape, because the face lacks a glyph or small capitals, measures
 * on the fallback, so layout has no glyphs to count. A substitute face without bold widens its
 * glyphs as the face does. An emoji sequence, a flag, or a letter with combining marks draws as
 * one glyph and widens once. Paint adds the extra as letter spacing, which a browser gives once
 * to each grapheme, so layout counts graphemes.
 */
export function syntheticBoldGraphemeStarts(text: string): number[] {
  const starts: number[] = [];
  for (const segment of segmentGraphemes(text))
    if (WIDENED_CHARACTER.test(segment.text)) starts.push(segment.utf16From);
  return starts;
}

/**
 * Blanks that paint cannot keep at their own advance in a span whose bold is synthesized.
 * Synthesized bold leaves the advance of a blank alone. Paint adds the extra advance after
 * each character as `letter-spacing`, but `word-spacing` takes it back only from U+0020 and
 * U+00A0, never from U+3000 and the other spaces here.
 */
const UNSPACED_BLANKS = /[\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu;

/** The UTF-16 ranges of the runs of {@link UNSPACED_BLANKS} in `text`. */
export function unspacedBlankRuns(text: string): { readonly from: number; readonly to: number }[] {
  const runs: { from: number; to: number }[] = [];
  for (const match of text.matchAll(UNSPACED_BLANKS))
    runs.push({ from: match.index, to: match.index + match[0].length });
  return runs;
}

/**
 * The parts of a synthesized-bold span's text, cut around the blanks of
 * {@link UNSPACED_BLANKS}, and whether synthesized bold widens each part. A blank part lays out
 * as a span of its own that paint does not widen. Text without such blanks is one part.
 */
export function syntheticBoldParts(
  text: string
): { readonly from: number; readonly to: number; readonly widened: boolean }[] {
  const parts: { from: number; to: number; widened: boolean }[] = [];
  let from = 0;
  const cut = (to: number): void => {
    // `search` ignores the global flag and leaves `lastIndex` alone.
    if (to > from)
      parts.push({ from, to, widened: text.slice(from, to).search(WIDENED_CHARACTER) >= 0 });
    from = to;
  };
  for (const blank of unspacedBlankRuns(text)) {
    cut(blank.from);
    cut(blank.to);
  }
  cut(text.length);
  return parts;
}

/**
 * Caret advances with the synthesized bold extra added: the advance at each UTF-16 offset
 * grows by `extraPt` for every widened cluster that starts before that offset. `starts` holds
 * the UTF-16 offsets where the widened clusters start.
 */
export function withSyntheticBoldCaretAdvances(
  advances: readonly number[],
  starts: readonly number[],
  extraPt: number
): readonly number[] {
  if (extraPt <= 0 || starts.length === 0) return advances;
  const perOffset = new Array<number>(advances.length).fill(0);
  for (const start of starts) {
    const at = Math.min(Math.max(start + 1, 1), advances.length - 1);
    perOffset[at]! += extraPt;
  }
  let added = 0;
  return advances.map((advance, offset) => {
    added += perOffset[offset]!;
    return advance + added;
  });
}
