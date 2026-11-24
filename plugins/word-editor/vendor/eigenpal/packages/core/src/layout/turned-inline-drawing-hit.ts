// The inline shapes a press can reach outside their own line: a turned shape, which turns
// about the centre of its extent, and a shape that paints past its box, such as a callout's
// tail. Either paints over the lines around it, so a press on that painted part is on the
// shape, though the line under the pointer is another one.

import type { InlineDrawingRecord } from './drawing-layout.ts';
import { drawingPaintsPastBox } from './vector-shape-hit.ts';
import type {
  BlockFragmentRecord,
  LineRecord,
  TableCellFragmentRecord,
  TableFragmentRecord,
  TableRowFragmentRecord,
  LayoutBox,
} from './semantic-records.ts';

/** A turned or overflowing inline shape, its line, and the innermost cell holding it. */
export interface TurnedInlineDrawing {
  readonly drawing: InlineDrawingRecord;
  readonly line: LineRecord;
  readonly cell: {
    readonly table: TableFragmentRecord;
    readonly row: TableRowFragmentRecord;
    readonly cell: TableCellFragmentRecord;
  } | null;
  /** The box its paragraph clips its paint to, such as an exact-height row's; absent if none. */
  readonly clip?: LayoutBox;
}

/** Fragment lists are immutable records, so one walk per published page list serves every press. */
const turnedCache = new WeakMap<readonly BlockFragmentRecord[], readonly TurnedInlineDrawing[]>();

/** Every turned or overflowing inline shape on `fragments`, in paint order (later on top). */
export function turnedInlineDrawings(
  fragments: readonly BlockFragmentRecord[]
): readonly TurnedInlineDrawing[] {
  const cached = turnedCache.get(fragments);
  if (cached) return cached;
  const found: TurnedInlineDrawing[] = [];
  const walk = (blocks: readonly BlockFragmentRecord[], cell: TurnedInlineDrawing['cell']) => {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        for (const line of block.lines) {
          for (const drawing of line.drawings ?? []) {
            if (drawing.vectorShape?.rotationDegrees || drawingPaintsPastBox(drawing))
              found.push({ drawing, line, cell, ...(block.clipToBox ? { clip: block.box } : {}) });
          }
        }
        continue;
      }
      for (const row of block.rows) {
        for (const inner of row.cells) walk(inner.blocks, { table: block, row, cell: inner });
      }
    }
  };
  walk(fragments, null);
  const frozen = Object.freeze(found);
  turnedCache.set(fragments, frozen);
  return frozen;
}

/**
 * The topmost turned inline shape whose painted geometry `reaches` `point`, if any. A shape
 * whose paragraph clips its paint reaches no point outside that clip.
 */
export function turnedInlineDrawingAt(
  fragments: readonly BlockFragmentRecord[],
  point: Readonly<{ x: number; y: number }>,
  reaches: (drawing: InlineDrawingRecord) => boolean
): TurnedInlineDrawing | null {
  const drawings = turnedInlineDrawings(fragments);
  for (let index = drawings.length - 1; index >= 0; index -= 1) {
    const { drawing, clip } = drawings[index]!;
    if (
      clip &&
      (point.x < clip.x ||
        point.x > clip.x + clip.width ||
        point.y < clip.y ||
        point.y > clip.y + clip.height)
    )
      continue;
    if (reaches(drawing)) return drawings[index]!;
  }
  return null;
}
