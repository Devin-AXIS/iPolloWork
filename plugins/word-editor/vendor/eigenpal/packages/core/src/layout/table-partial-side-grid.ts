import type { SemanticTableRow } from './semantic-table.ts';

const cache = new WeakMap<readonly SemanticTableRow[], { columns: number; value: boolean }>();
const mixedCache = new WeakMap<
  readonly SemanticTableRow[],
  { columns: number; value: number | undefined }
>();

/**
 * A complete grid with omitted side rules and one width for every visible simple rule.
 * Its missing frame edges do not define a uniform outer-frame offset, but the remaining
 * rules still share their grid lines with cell margins.
 */
export function hasPartialSimpleSideGrid(
  rows: readonly SemanticTableRow[],
  columns: number
): boolean {
  const known = cache.get(rows);
  if (known?.columns === columns) return known.value;
  const read = () => {
    let width: number | undefined;
    let missing = false;
    for (const row of rows) {
      let next = 0;
      for (const cell of row.cells) {
        if (cell.gridColumn !== next) return false;
        next += cell.gridSpan;
        if (cell.vMergeContinue) continue;
        const borders = cell.contentBorders ?? cell.borders;
        for (const side of [borders.left, borders.right]) {
          if (side.state !== 'edge') {
            missing = true;
            continue;
          }
          if (
            (side.style !== 'single' && side.style !== 'thick') ||
            side.widthPt <= 0 ||
            (width !== undefined && side.widthPt !== width)
          )
            return false;
          width = side.widthPt;
        }
      }
      if (next !== columns) return false;
    }
    return missing && width !== undefined;
  };
  const value = read();
  cache.set(rows, { columns, value });
  return value;
}

/**
 * The leading rule width of a partial grid ({@link hasPartialSimpleSideGrid}) whose every row
 * opens with a simple left rule of that one width, in points; else `undefined`.
 *
 * Mode-15 reference renders of `w:tblBorders` frames without inside rules (ECMA-376
 * §17.4.38) put the outer edge of that leading rule on the aligned edge, as for a complete
 * grid: the grid moves inward by half the rule, at every cell margin and table indent.
 */
export function partialSimpleSideGridLeadPt(
  rows: readonly SemanticTableRow[],
  columns: number
): number | undefined {
  if (!hasPartialSimpleSideGrid(rows, columns)) return undefined;
  let lead: number | undefined;
  for (const row of rows) {
    const first = row.cells[0];
    if (!first || first.gridColumn !== 0 || first.vMergeContinue) return undefined;
    const left = (first.contentBorders ?? first.borders).left;
    if (left.state !== 'edge' || (lead !== undefined && left.widthPt !== lead)) return undefined;
    lead = left.widthPt;
  }
  return lead;
}

/** Carry the answer when a row copy changes only its side-rule layout flags. */
export function carryPartialSimpleSideGrid(
  source: readonly SemanticTableRow[],
  copy: readonly SemanticTableRow[]
): void {
  const known = cache.get(source);
  if (known) cache.set(copy, known);
  const mixed = mixedCache.get(source);
  if (mixed) mixedCache.set(copy, mixed);
}

/**
 * The leading rule width of a complete grid whose every side is a visible simple rule, in
 * points, when those rules do not all share one width; else `undefined`.
 *
 * Every row must open with a leading rule of that same width, so the grid has one outer
 * offset. Rules of other widths inside the grid, or on the trailing edge, are allowed.
 */
export function mixedSimpleSideGridLeadPt(
  rows: readonly SemanticTableRow[],
  columns: number
): number | undefined {
  const known = mixedCache.get(rows);
  if (known?.columns === columns) return known.value;
  const read = (): number | undefined => {
    let lead: number | undefined;
    let first: number | undefined;
    let mixed = false;
    for (const row of rows) {
      let next = 0;
      for (const cell of row.cells) {
        if (cell.gridColumn !== next) return undefined;
        next += cell.gridSpan;
        if (cell.vMergeContinue) continue;
        const borders = cell.contentBorders ?? cell.borders;
        for (const side of [borders.left, borders.right]) {
          if (
            side.state !== 'edge' ||
            (side.style !== 'single' && side.style !== 'thick') ||
            side.widthPt <= 0
          )
            return undefined;
          if (first === undefined) first = side.widthPt;
          else if (side.widthPt !== first) mixed = true;
        }
        if (cell.gridColumn === 0 && borders.left.state === 'edge') {
          if (lead !== undefined && borders.left.widthPt !== lead) return undefined;
          lead = borders.left.widthPt;
        }
      }
      if (next !== columns) return undefined;
    }
    return mixed ? lead : undefined;
  };
  const value = read();
  mixedCache.set(rows, { columns, value });
  return value;
}
