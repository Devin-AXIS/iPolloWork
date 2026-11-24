import { PAGE_BREAK_CHAR } from '../store/package/hard-break.ts';
import { lineSegmentFor } from './line-segments.ts';
import { clipParagraphBox } from './paragraph-frame-clip.ts';
import { caretBoxOnLine } from './semantic-hit-test.ts';
import { bottomToTopCaretInLayout } from './table-cell-text-direction.ts';
import type { PlacedLine } from './paragraph-lines.ts';
import type { SemanticLayout } from './semantic-records.ts';
import type { CaretAtOptions, CaretGeometry, SemanticPosition } from './semantic-interaction.ts';

/** Resolve a local visual preference without changing the model boundary. */
export function preferredLineCaret(
  layout: SemanticLayout,
  position: SemanticPosition,
  catalog: readonly PlacedLine[],
  options: CaretAtOptions
): CaretGeometry | null {
  if (options.preferredLineId === undefined) return null;
  for (const { line, pageIndex, clipBox } of catalog) {
    if (
      line.id !== options.preferredLineId ||
      (options.preferredPageIndex !== undefined && pageIndex !== options.preferredPageIndex)
    )
      continue;
    const segment = lineSegmentFor(line, position.paragraphId);
    if (!segment || position.offset < segment.start || position.offset > segment.end) continue;
    const visibleSegment = {
      ...segment,
      // Break markers have no published advance, including empty field-result lines.
      spans: segment.spans.filter(
        (span) => (span.text !== '\n' && span.text !== PAGE_BREAK_CHAR) || span.box.width !== 0
      ),
    };
    const box = clipParagraphBox(
      { ...caretBoxOnLine(line, position.offset, options.measurer, visibleSegment), width: 0 },
      clipBox
    );
    if (!box) continue;
    return bottomToTopCaretInLayout(layout, {
      position,
      x: box.x,
      y: box.y,
      height: box.height,
      lineId: line.id,
      pageIndex,
    });
  }
  return null;
}
