import {
  growLineMetrics,
  lineBandText,
  positionedRunMetrics,
  type PendingLine,
} from './pending-line.ts';
import { PAGE_BREAK_CHAR } from '@docx-editor.dev/core/store';
import { styleForFontSlot } from './script-itemization.ts';
import type { TextMeasurer } from './semantic-records.ts';
import { borderStrokeWidthPt } from './border-metrics.ts';
import { baselineShiftPtOf } from './run-style.ts';
import type { ParagraphBorderEdge } from './paragraph-style.ts';
import type { LayoutBox, LineRecord, ParagraphBorderStrokeRecord } from './semantic-records.ts';

function sameEdge(a: ParagraphBorderEdge, b: ParagraphBorderEdge): boolean {
  return (
    a.val === b.val &&
    a.color === b.color &&
    a.widthPt === b.widthPt &&
    a.spacePt === b.spacePt &&
    a.shadow === b.shadow
  );
}

/** Character border geometry from placed spans, shared by screen and export painters. */
export function runBorderStrokesForLine(line: LineRecord): readonly ParagraphBorderStrokeRecord[] {
  if (!line.spans.some((span) => span.style.border)) return [];
  const strokes: ParagraphBorderStrokeRecord[] = [];
  let group:
    | {
        box: LayoutBox;
        edge: ParagraphBorderEdge;
        paragraphId: string;
        start: number;
        end: number;
        wrapBefore: number;
      }
    | undefined;
  const flush = () => {
    if (!group) return;
    const { box, edge } = group;
    const width = borderStrokeWidthPt(edge.val, edge.widthPt);
    const x = box.x - edge.spacePt - width;
    const y = box.y - edge.spacePt - width;
    const outerWidth = box.width + 2 * (edge.spacePt + width);
    const outerHeight = box.height + 2 * (edge.spacePt + width);
    strokes.push(
      { side: 'top', edge, box: { x, y, width: outerWidth, height: width } },
      {
        side: 'bottom',
        edge,
        box: { x, y: y + outerHeight - width, width: outerWidth, height: width },
      },
      { side: 'left', edge, box: { x, y, width, height: outerHeight } },
      { side: 'right', edge, box: { x: x + outerWidth - width, y, width, height: outerHeight } }
    );
    group = undefined;
  };
  // Physical adjacency matters after bidi placement; a wrap exclusion may split one
  // logical run into separate passages on the same line.
  for (const span of [...line.spans].sort((a, b) => a.box.x - b.box.x)) {
    const edge = span.style.border;
    if (!edge || span.style.hidden || !span.text || /^[\r\n\f]+$/.test(span.text)) {
      flush();
      continue;
    }
    const faceTop =
      span.borderBaselinePt === undefined
        ? span.box.y + (line.leading ?? 0)
        : line.box.y + line.baseline - span.borderBaselinePt;
    const box = { ...span.box, y: faceTop - baselineShiftPtOf(span.style) };
    if (
      group &&
      sameEdge(group.edge, edge) &&
      group.paragraphId === span.range.paragraphId &&
      (group.end === span.range.start || group.start === span.range.end) &&
      (group.end === span.range.start ? (span.wrapAdvanceBefore ?? 0) : group.wrapBefore) <= 0.001
    ) {
      const bottom = Math.max(group.box.y + group.box.height, box.y + box.height);
      group.box = {
        x: group.box.x,
        y: Math.min(group.box.y, box.y),
        width: box.x + box.width - group.box.x,
        height: bottom - Math.min(group.box.y, box.y),
      };
      if (span.range.start < group.start) group.wrapBefore = span.wrapAdvanceBefore ?? 0;
      group.start = Math.min(group.start, span.range.start);
      group.end = Math.max(group.end, span.range.end);
    } else {
      flush();
      group = {
        box,
        edge,
        paragraphId: span.range.paragraphId,
        start: span.range.start,
        end: span.range.end,
        wrapBefore: span.wrapAdvanceBefore ?? 0,
      };
    }
  }
  flush();
  return strokes;
}

/** Reserve character borders around each face before paragraph spacing and pagination. */
export function growRunBorderLineMetrics(
  line: Pick<PendingLine, 'spans' | 'height' | 'baseline'>,
  measurer: TextMeasurer
): void {
  // Per-face maxima let a small bordered run fit inside a taller unbordered face.
  for (let index = 0; index < line.spans.length; index++) {
    const span = line.spans[index]!;
    const edge = span.style.border;
    if (!edge || span.style.hidden || !span.text || /^[\r\n\f]+$/.test(span.text)) continue;
    const metrics = measurer.lineMetrics(
      styleForFontSlot(span.style, span.fontSlot),
      lineBandText(span, span.text)
    );
    if (span.borderBaselinePt !== metrics.baseline)
      line.spans[index] = { ...span, borderBaselinePt: metrics.baseline };
    const inset = edge.spacePt + borderStrokeWidthPt(edge.val, edge.widthPt);
    growLineMetrics(line, {
      height: metrics.height + 2 * inset,
      baseline: positionedRunMetrics(metrics, span.style).baseline + inset,
    });
  }
}

/**
 * Natural text band for automatic spacing when an unscaled image shares the line. An ignored
 * cell page break adds no height here, as it adds none when first placed.
 */
export function textBandHeightWithBorders(
  spans: PendingLine['spans'],
  measurer: TextMeasurer,
  fallback: number,
  pageBreaksIgnored = false
): number {
  const band = textBandWithBorders(spans, measurer, pageBreaksIgnored);
  return band.height > 0 ? band.height : fallback;
}

/** {@link textBandHeightWithBorders} with its baseline; zero height for a line without text. */
export function textBandWithBorders(
  spans: PendingLine['spans'],
  measurer: TextMeasurer,
  pageBreaksIgnored = false
): { readonly height: number; readonly baseline: number } {
  const band = { height: 0, baseline: 0, spans };
  for (const span of spans) {
    if (pageBreaksIgnored && span.text === PAGE_BREAK_CHAR) continue;
    growLineMetrics(
      band,
      positionedRunMetrics(
        measurer.lineMetrics(
          styleForFontSlot(span.style, span.fontSlot),
          lineBandText(span, span.text)
        ),
        span.style
      )
    );
  }
  growRunBorderLineMetrics(band, measurer);
  return { height: band.height, baseline: band.baseline };
}
