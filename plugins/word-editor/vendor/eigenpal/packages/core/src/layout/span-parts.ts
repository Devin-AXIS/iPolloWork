// Splitting one laid span into adjacent parts, for alignment that puts space between them.
//
// Each part becomes a span of its own with its own source range, so paint, PDF export, the
// caret and hit testing all read the gaps from the same boxes.
import { measureDisplayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';

/** A UTF-16 slice `[from, to)` of a span's text. */
export interface SpanPart {
  readonly from: number;
  readonly to: number;
}

/**
 * Whether a span can be split into parts. Projected text, equations, and spans whose text
 * does not map one to one onto their source range stay whole.
 */
export function isSplittableSpan(span: StyleSpanRecord): boolean {
  return (
    !span.projected && !span.equation && span.range.end - span.range.start === span.text.length
  );
}

/**
 * Split `span` into `parts`, which must cover its text in order. The parts share the span's
 * width in proportion to their measured widths, so they still end where the span ended.
 * Per-character caret edges do not survive the split; each part measures its own.
 */
export function splitSpanParts(
  span: StyleSpanRecord,
  parts: readonly SpanPart[],
  measurer: TextMeasurer
): StyleSpanRecord[] {
  // Published caret edges already hold each boundary's advance; measure only without them.
  const edges = span.caretEdges?.length === span.text.length + 1 ? span.caretEdges : undefined;
  const style = styleForFontSlot(span.style, span.fontSlot);
  const widths = parts.map((part) =>
    edges
      ? edges[part.to]! - edges[part.from]!
      : measureDisplayText(span.text.slice(part.from, part.to), style, measurer)
  );
  const total = widths.reduce((sum, value) => sum + value, 0);
  const { caretEdges: _edges, ...rest } = span;
  const split: StyleSpanRecord[] = [];
  let x = span.box.x;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    const width = total > 0 ? (widths[index]! * span.box.width) / total : 0;
    split.push({
      ...rest,
      text: span.text.slice(part.from, part.to),
      range: {
        ...span.range,
        start: span.range.start + part.from,
        end: span.range.start + part.to,
      },
      box: { ...span.box, x, width },
    });
    x += width;
  }
  return split;
}
