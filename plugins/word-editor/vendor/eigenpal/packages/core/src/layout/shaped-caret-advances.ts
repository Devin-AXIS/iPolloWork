import { displayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';
import { segmentGraphemes } from './grapheme.ts';
import type { ShapedRun } from './shaped-run.ts';

/** Bound the optional eager vector; larger spans use the caller's lazy proportional fallback. */
export const MAX_CARET_ADVANCE_UTF16 = 65_536;

/** Uniform grapheme edges when the whole-span fallback has no cluster information. */
export function fallbackCaretAdvances(text: string, width: number): readonly number[] | undefined {
  if (text.length > MAX_CARET_ADVANCE_UTF16) return undefined;
  const advances = new Array<number>(text.length + 1).fill(0);
  const clusters = segmentGraphemes(text);
  const total = Math.max(0, width);
  for (const [index, cluster] of clusters.entries()) {
    const before = (total * index) / clusters.length;
    for (let offset = cluster.utf16From; offset < cluster.utf16To; offset++)
      advances[offset] = before;
    advances[cluster.utf16To] = (total * (index + 1)) / clusters.length;
  }
  return advances;
}

/** Logical advances from one complete shaping operation, never independently shaped prefixes. */
export function shapedCaretAdvances(
  text: string,
  run: ShapedRun,
  scale: number,
  tracking: number,
  wordSpacing: number
): readonly number[] | undefined {
  if (text.length > MAX_CARET_ADVANCE_UTF16 || run.text !== text) return undefined;
  const advances = new Array<number>(text.length + 1).fill(0);
  const clusters = [...run.clusters].sort((a, b) => a.textStart - b.textStart);
  if (clusters.length === 0 && text.length > 0) return undefined;
  let pen = 0;
  let cursor = 0;
  const total = Math.max(
    0,
    run.glyphs.reduce((sum, glyph) => sum + glyph.advanceX * scale, 0) +
      text.length * tracking +
      countAsciiSpaces(text) * wordSpacing
  );
  for (const cluster of clusters) {
    if (
      cluster.textStart !== cursor ||
      cluster.textEnd <= cursor ||
      cluster.textEnd > text.length ||
      !Number.isInteger(cluster.textEnd)
    )
      return undefined;
    // Ligatures expose cluster edges only. Interior code units retain the leading edge.
    for (let offset = cluster.textStart; offset < cluster.textEnd; offset++) advances[offset] = pen;
    const extra =
      (cluster.textEnd - cluster.textStart) * tracking +
      countAsciiSpaces(text.slice(cluster.textStart, cluster.textEnd)) * wordSpacing;
    pen = Math.max(pen, Math.min(total, pen + cluster.advance * scale + extra));
    advances[cluster.textEnd] = pen;
    cursor = cluster.textEnd;
  }
  if (cursor !== text.length) return undefined;
  advances[text.length] = total;
  return advances;
}

export function countAsciiSpaces(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index++) if (text[index] === ' ') count++;
  return count;
}

const fullSpanCaretCache = new WeakMap<
  TextMeasurer,
  WeakMap<StyleSpanRecord, readonly number[] | null>
>();

export function bidiPrefixWidth(
  span: StyleSpanRecord,
  utf16: number,
  measurer: TextMeasurer
): number {
  let spans = fullSpanCaretCache.get(measurer);
  if (!spans) {
    spans = new WeakMap();
    fullSpanCaretCache.set(measurer, spans);
  }
  let advances = spans.get(span);
  const style = styleForFontSlot(span.style, span.fontSlot);
  const text = displayText(span.text, style);
  const total = Math.max(0, span.box.width);
  if (advances === undefined) {
    advances = null;
    try {
      const source = measurer.caretAdvances?.(text, style);
      if (source && source.length === text.length + 1) {
        let previous = 0;
        advances = source.map((value, index) => {
          if (index === 0) return 0;
          previous = Math.max(previous, Math.min(total, Number.isFinite(value) ? value : previous));
          return index === text.length ? total : previous;
        });
      }
    } catch {
      /* A host measurer without usable cluster geometry uses the bounded fallback. */
    }
    spans.set(span, advances);
  }
  const offset = Math.max(0, Math.min(utf16, span.text.length));
  if (offset === 0) return 0;
  if (offset === span.text.length) return total;
  const prefix = displayText(span.text.slice(0, offset), style);
  if (advances) return advances[prefix.length] ?? total;
  // Keep one width source for the WHOLE span. Independent prefixes change Arabic
  // joining and can switch away from a missing-glyph fallback to the primary face.
  const wordSpacing = style.shaping?.wordSpacingPt ?? 0;
  const naturalWidth = Math.max(0, total - countAsciiSpaces(text) * wordSpacing);
  return Math.max(
    0,
    Math.min(
      total,
      (naturalWidth * prefix.length) / Math.max(1, text.length) +
        countAsciiSpaces(prefix) * wordSpacing
    )
  );
}
