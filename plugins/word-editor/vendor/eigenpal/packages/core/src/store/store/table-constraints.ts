// Store-owned table editing bounds — shared authority for topology validation and resize.

/** Far above anything Word authors (its UI caps at 63) while keeping allocation bounded. */
export const MAX_TABLE_COLUMNS = 1024;

/** Minimum grid column width in twips (~0.21") for column resize operations. */
export const MIN_TABLE_COLUMN_WIDTH_TWIPS = 300;

/**
 * Minimum row height in twips (8pt) for row resize drags. A row divider is hit within 4pt of
 * its edge, so a row needs 8pt before some point inside it is nearer only its own bottom
 * divider than the divider above. A shorter row is hard to grab and drag back out.
 */
export const MIN_TABLE_ROW_HEIGHT_TWIPS = 160;

/** Maximum grid column width in twips (~22", widest page). */
export const MAX_TABLE_COLUMN_WIDTH_TWIPS = 31_680;

/** Maximum table width in twips for outer-right resize commits. */
export const MAX_TABLE_WIDTH_TWIPS = 31_680;

/**
 * Bounds on a WHOLE-table insert, which is the one table gesture that allocates its
 * topology from numbers rather than copying one that already exists. The row and column
 * caps match Word's own Insert Table dialog; the cell cap is the allocation bound, and it
 * binds first — 63 columns of 32767 rows is not a table anyone asked for.
 */
export const MAX_INSERT_TABLE_ROWS = 32_767;
export const MAX_INSERT_TABLE_COLUMNS = 63;
export const MAX_INSERT_TABLE_CELLS = 20_000;

/** Minimum table border thickness in eighths of a point. */
export const MIN_TABLE_BORDER_SIZE_EIGHTHS = 1;

/** Soft ceiling on border thickness in eighths of a point (12pt). */
export const MAX_TABLE_BORDER_SIZE_EIGHTHS = 96;

/** Hostile selected-cell id lists are rejected before allocating patch plans. */
export const MAX_TABLE_CELL_SELECTION_COUNT = 65_536;

/** Default row ceiling for topology reads; callers may lower it, never raise above this. */
export const MAX_TABLE_TOPOLOGY_ROWS = 10_000;

/** Node visits allowed while locating a table id in a part root. */
export const DEFAULT_TABLE_TOPOLOGY_TRAVERSAL_BUDGET = 1_000_000;

export interface TableTopologyLimits {
  readonly maxRows: number;
  readonly maxColumns: number;
  readonly maxTraversalNodes: number;
}

export const DEFAULT_TABLE_TOPOLOGY_LIMITS: TableTopologyLimits = Object.freeze({
  maxRows: MAX_TABLE_TOPOLOGY_ROWS,
  maxColumns: MAX_TABLE_COLUMNS,
  maxTraversalNodes: DEFAULT_TABLE_TOPOLOGY_TRAVERSAL_BUDGET,
});

function clampPositiveInt(raw: number | undefined, fallback: number, ceiling: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1) return fallback;
  const integral = Math.floor(raw);
  if (integral < 1) return fallback;
  return Math.min(integral, ceiling);
}

/**
 * Resolve caller limits into a finite, integral bound set. `maxColumns` never exceeds
 * {@link MAX_TABLE_COLUMNS}; hostile values such as `Infinity` or `2048` clamp down.
 */
export function resolveTableTopologyLimits(
  overrides?: Partial<TableTopologyLimits>
): TableTopologyLimits {
  return Object.freeze({
    maxRows: clampPositiveInt(overrides?.maxRows, MAX_TABLE_TOPOLOGY_ROWS, MAX_TABLE_TOPOLOGY_ROWS),
    maxColumns: clampPositiveInt(overrides?.maxColumns, MAX_TABLE_COLUMNS, MAX_TABLE_COLUMNS),
    maxTraversalNodes: clampPositiveInt(
      overrides?.maxTraversalNodes,
      DEFAULT_TABLE_TOPOLOGY_TRAVERSAL_BUDGET,
      DEFAULT_TABLE_TOPOLOGY_TRAVERSAL_BUDGET
    ),
  });
}
