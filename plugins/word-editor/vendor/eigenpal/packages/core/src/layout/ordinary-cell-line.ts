import { OVERFLOW_TOLERANCE_PT, SLACK_RESIDUE_PT } from './paragraph-alignment-tolerance.ts';
import { tokenLineMovable } from './paragraph-cache-width-reuse.ts';
import type { PendingLine } from './pending-line.ts';
import type { Alignment } from './paragraph-alignment.ts';
import type { StyleSpanRecord } from './semantic-records.ts';

function ordinaryShaping(span: StyleSpanRecord): boolean {
  const shaping = span.style.shaping;
  return (
    !span.wrapAdvanceBefore &&
    (!shaping ||
      ((shaping.level ?? 0) === 0 &&
        (shaping.baseLevel ?? 0) === 0 &&
        shaping.runDirection !== 'rtl'))
  );
}

/** Whether placement can use ordinary left-to-right span arithmetic. */
export function ordinaryCellLineEligible(line: PendingLine): boolean {
  return (
    tokenLineMovable(line) &&
    !line.compressesSpaces &&
    !line.wrapMirrored &&
    line.spans.every(ordinaryShaping)
  );
}

/** Place an ordinary left-to-right line without an intermediate copy of every span. */
export function placeOrdinaryCellLine(
  line: PendingLine,
  paragraphId: string,
  penX: number,
  y: number,
  indent: number,
  available: number,
  alignment: Alignment
): { readonly spans: readonly StyleSpanRecord[]; readonly offset: number } | null {
  if (
    alignment === 'both' ||
    !Number.isFinite(penX) ||
    !Number.isFinite(y) ||
    !Number.isFinite(indent) ||
    !Number.isFinite(available) ||
    !ordinaryCellLineEligible(line)
  )
    return null;
  let offset = 0;
  if (alignment !== 'left') {
    // Keep the same arithmetic as visibleTextEnd and alignLogicalSpans. The ordinary
    // proof excludes trailing spaces, breaks, bidi runs, tabs, pictures, and compression.
    let end = -Infinity;
    for (const span of line.spans) end = Math.max(end, span.box.x + penX + span.box.width);
    const last = line.spans[line.spans.length - 1]!;
    const visible = last.box.x + penX - indent + last.box.width;
    const used =
      line.width > end - indent + OVERFLOW_TOLERANCE_PT
        ? line.width
        : Math.min(line.width, visible);
    const slack = available - used;
    if (slack > SLACK_RESIDUE_PT) offset = alignment === 'center' ? slack / 2 : slack;
  }
  const spans = line.spans.map((span) => {
    const x = span.box.x + penX;
    return {
      ...span,
      range: span.range.paragraphId === paragraphId ? span.range : { ...span.range, paragraphId },
      box: { ...span.box, x: offset === 0 ? x : x + offset, y },
    };
  });
  return {
    spans,
    // Placement reports the actual subtraction, including its rounding at large origins.
    offset: spans[0]!.box.x - (line.spans[0]!.box.x + penX),
  };
}
