// Diagonals are cell-owned: never collapsed against neighbouring cells or tblBorders.
// Coordinates refer to the final physical cell occurrence, including a merged/repeated box.
import type { CellBorderBox } from './table-borders.ts';
import {
  COMPOUND_BORDER_MIN_GAP_PT,
  COMPOUND_BORDER_MIN_STROKE_PT,
  computeDoubleBorderMetricsPt,
} from './border-metrics.ts';

/** One layout-owned diagonal stroke, clipped to its cell-local rectangle. */
export interface TableCellDiagonalRecord {
  readonly direction: 'tl2br' | 'tr2bl';
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly widthPt: number;
  readonly color: string | null;
  readonly cssStyle: 'solid' | 'dashed' | 'dotted';
  readonly clipWidth: number;
  readonly clipHeight: number;
}

/** At most six strokes. Missing/none diagonals have no table-border fallback. */
export function cellDiagonalRecords(
  borders: CellBorderBox,
  width: number,
  height: number
): readonly TableCellDiagonalRecord[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];
  const records: TableCellDiagonalRecord[] = [];
  const length = Math.hypot(width, height);
  for (const direction of ['tl2br', 'tr2bl'] as const) {
    const side = borders[direction];
    if (side?.state !== 'edge') continue;
    const down = direction === 'tl2br';
    const nx = (down ? -height : height) / length;
    const ny = width / length;
    let thickness = side.widthPt;
    let offsets = [0];
    if (side.style === 'double') {
      const metrics = computeDoubleBorderMetricsPt(thickness);
      thickness = metrics.strokePt;
      offsets = [-(metrics.strokePt + metrics.gapPt) / 2, (metrics.strokePt + metrics.gapPt) / 2];
    } else if (side.style === 'triple') {
      thickness = Math.max(COMPOUND_BORDER_MIN_STROKE_PT, thickness);
      const separation = thickness + Math.max(COMPOUND_BORDER_MIN_GAP_PT, thickness);
      offsets = [-separation, 0, separation];
    }
    for (const offset of offsets)
      records.push({
        direction,
        x1: offset * nx,
        y1: (down ? 0 : height) + offset * ny,
        x2: width + offset * nx,
        y2: (down ? height : 0) + offset * ny,
        widthPt: thickness,
        color: side.color,
        cssStyle: side.style === 'dashed' || side.style === 'dotted' ? side.style : 'solid',
        clipWidth: width,
        clipHeight: height,
      });
  }
  return records;
}
