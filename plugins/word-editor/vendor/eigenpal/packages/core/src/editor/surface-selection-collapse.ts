import type { SemanticLayout, TextMeasurer } from '../layout/semantic-records.ts';
import { caretAt, type SemanticPosition } from '../layout/semantic-interaction.ts';
import { paragraphLinesFor } from '../layout/paragraph-lines.ts';
import { bidiDirectionOfStop } from '../layout/visual-caret-navigation.ts';

/** Collapse onto the outermost canonical endpoint or run boundary within the selection. */
export function collapseHorizontalSelection(
  layout: SemanticLayout,
  range: { readonly from: SemanticPosition; readonly to: SemanticPosition },
  order: readonly string[],
  command: 'left' | 'right',
  measurer?: TextMeasurer
): SemanticPosition {
  const direction = command === 'left' ? -1 : 1;
  const from = caretAt(layout, range.from, measurer);
  const to = caretAt(layout, range.to, measurer);
  const base = from ? (bidiDirectionOfStop(layout, from) ?? 1) : 1;
  const fallback = direction * base === -1 ? range.from : range.to;
  // Across lines, preserve the selected logical endpoint in the paragraph's reading direction.
  if (!from || !to || from.lineId !== to.lineId || from.pageIndex !== to.pageIndex) return fallback;
  const line = paragraphLinesFor(layout, range.from.paragraphId)?.find(
    ({ line }) => line.id === from.lineId
  )?.line;
  if (!line?.spans.some((span) => span.style.shaping)) return fallback;
  const startIndex = order.indexOf(range.from.paragraphId),
    endIndex = order.indexOf(range.to.paragraphId);
  let selected: { readonly position: SemanticPosition; readonly x: number } | undefined;
  for (const span of line.spans) {
    const paragraphId = span.range.paragraphId;
    const index = order.indexOf(paragraphId);
    if (index < startIndex || index > endIndex) continue;
    const start = Math.max(
      span.range.start,
      paragraphId === range.from.paragraphId ? range.from.offset : 0
    );
    const end = Math.min(
      span.range.end,
      paragraphId === range.to.paragraphId ? range.to.offset : Infinity
    );
    if (start >= end) continue;
    for (const offset of [start, end]) {
      const position = { paragraphId, offset };
      const caret = caretAt(layout, position, measurer);
      if (!caret || caret.lineId !== from.lineId || caret.pageIndex !== from.pageIndex) continue;
      // A bidi seam has one canonical affinity. Its upstream ink edge may have no caret.
      const x = caret.x;
      if (!selected || (x - selected.x) * direction > 0) selected = { position, x };
    }
  }
  return selected?.position ?? fallback;
}
