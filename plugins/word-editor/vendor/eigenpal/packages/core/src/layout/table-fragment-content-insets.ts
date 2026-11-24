// A new fragment has no preceding cell. Do not carry a shared border from the previous page.
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import { effectiveBorderSide } from './table-border-cascade.ts';
import { withExactOpeningExtension } from './table-exact-terminal-border.ts';
import {
  borderContentInset,
  cellContentInsets,
  ownTopBandWidthPt,
  simpleBandWidthPt,
} from './table-cell-geometry.ts';
import type { SemanticTableRow, SemanticTableStructure } from './semantic-table.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';

export function firstRowContentDeps(
  structure: SemanticTableStructure,
  row: SemanticTableRow,
  deps: TableFlowDeps
): TableFlowDeps {
  // A spaced table's cells keep their borders inside; a row below its first opens the
  // fragment at a page break (`rowOpeningGapPt`).
  if (structure.cellSpacingPt > 0)
    return row.spacingFrame && !row.spacingFrame.first ? { ...deps, opensTableBreak: true } : deps;
  const insets = new Map(deps.cellContentInsets);
  const minimumInsets = new Map(deps.cellMinimumContentInsets);
  const own = row.cells.map((cell) =>
    borderContentInset(
      cell.margins.top,
      effectiveBorderSide(cell.borders.top, (cell.rowTableBorders ?? structure.tableBorders).top)
    )
  );
  // One boundary carries one content band: the row's widest top rule moves every cell down.
  let band = 0;
  for (const [index, cell] of row.cells.entries())
    band = Math.max(band, own[index]! - cell.margins.top);
  let extension = 0;
  for (const [index, cell] of row.cells.entries()) {
    const top = Math.max(own[index]!, cell.margins.top + band);
    const before = insets.get(cell.id) ?? cellContentInsets(cell, true);
    extension = Math.max(extension, top - before.top);
    // There is no cell above a fragment's first row to share this stroke.
    insets.set(cell.id, { ...before, top });
    const minimum = minimumInsets.get(cell.id) ?? cell.minimumContentInsets;
    if (minimum) minimumInsets.set(cell.id, { ...minimum, top });
  }
  const opened = {
    ...deps,
    cellContentInsets: insets,
    ...(minimumInsets.size ? { cellMinimumContentInsets: minimumInsets } : {}),
  };
  return withExactOpeningExtension(structure, row, opened, extension);
}

/** The last row uses its own outer edge, without the next page's neighbor. */
export function lastRowContentDeps(
  structure: SemanticTableStructure,
  row: SemanticTableRow,
  deps: TableFlowDeps
): TableFlowDeps {
  return closingRowContentDeps(structure, row, deps, 'bottom');
}

/**
 * A row split at the end of its fragment closes the fragment with the inside rule it would share
 * with the row below, not with the table's outer bottom edge.
 */
export function cutRowContentDeps(
  structure: SemanticTableStructure,
  row: SemanticTableRow,
  deps: TableFlowDeps
): TableFlowDeps {
  return closingRowContentDeps(structure, row, deps, 'insideH');
}

function closingRowContentDeps(
  structure: SemanticTableStructure,
  row: SemanticTableRow,
  deps: TableFlowDeps,
  edge: 'bottom' | 'insideH'
): TableFlowDeps {
  if (structure.cellSpacingPt > 0) return deps;
  const insets = new Map(deps.cellContentInsets);
  const minimumInsets = new Map(deps.cellMinimumContentInsets);
  let changed = false;
  for (const cell of row.cells) {
    const before = insets.get(cell.id) ?? cellContentInsets(cell, true);
    const bottom = borderContentInset(
      cell.margins.bottom,
      effectiveBorderSide(
        cell.borders.bottom,
        (cell.rowTableBorders ?? structure.tableBorders)[edge]
      )
    );
    if (before.bottom !== bottom) changed = true;
    insets.set(cell.id, { ...before, bottom });
    const minimum = minimumInsets.get(cell.id) ?? cell.minimumContentInsets;
    if (minimum) {
      if (minimum.bottom !== bottom) changed = true;
      minimumInsets.set(cell.id, { ...minimum, bottom });
    }
  }
  return changed
    ? {
        ...deps,
        cellContentInsets: insets,
        ...(minimumInsets.size ? { cellMinimumContentInsets: minimumInsets } : {}),
      }
    : deps;
}

/**
 * A split row continued below a repeated header reserves its own authored top rule, as a
 * body row does beside a repeat, rather than the band of the row it was authored under.
 */
export function repeatedHeaderContinuationDeps(
  structure: SemanticTableStructure,
  row: SemanticTableRow,
  deps: TableFlowDeps
): TableFlowDeps {
  if (structure.cellSpacingPt > 0) return deps;
  const reserve = row.cells.reduce(
    (widest, cell) =>
      cell.borders.top.state === 'edge'
        ? Math.max(widest, simpleBandWidthPt(cell.borders.top))
        : widest,
    -1
  );
  if (reserve < 0) return deps;
  const insets = new Map(deps.cellContentInsets);
  for (const cell of row.cells) {
    const before = insets.get(cell.id) ?? cellContentInsets(cell, true);
    insets.set(cell.id, { ...before, top: cell.margins.top + reserve });
  }
  return { ...deps, cellContentInsets: insets };
}

const isCompound = (side: SemanticTableRow['cells'][number]['borders']['top']): boolean =>
  side.state === 'edge' && simpleBandWidthPt(side) === 0;

/**
 * The top band, in points, that a complete body row reserves directly below a repeated
 * header, or undefined when the row keeps the band of the row it was authored under.
 *
 * Before mode 15 (`repeatBoundaryUsesHeaderRule`) the row meets the repeated header, not its
 * authored neighbor: the band is the wider of the row's own top rule and the bottom rule of
 * the last header row above its columns. From mode 15 the row keeps its authored band, also
 * where the row above it on the original page has the wider rule. Compound rules keep their
 * own extent geometry, so they also answer undefined.
 */
export function repeatBoundaryBandPt(
  structure: SemanticTableStructure,
  row: SemanticTableRow,
  deps: TableFlowDeps
): number | undefined {
  if (
    structure.cellSpacingPt > 0 ||
    !hasCompatibilityRule(deps.compatibilityMode, 'repeatBoundaryUsesHeaderRule')
  )
    return undefined;
  let header: SemanticTableRow | undefined;
  for (const candidate of structure.rows) {
    if (!candidate.isHeader) break;
    header = candidate;
  }
  if (!header) return undefined;
  let widest = 0;
  for (const cell of row.cells) {
    const own = effectiveBorderSide(
      cell.borders.top,
      (cell.rowTableBorders ?? structure.tableBorders).insideH
    );
    if (isCompound(own)) return undefined;
    let headerBand = 0;
    for (const above of header.cells) {
      if (above.gridColumn + above.gridSpan <= cell.gridColumn) continue;
      if (above.gridColumn >= cell.gridColumn + cell.gridSpan) continue;
      const bottom = effectiveBorderSide(
        above.borders.bottom,
        (above.rowTableBorders ?? structure.tableBorders).insideH
      );
      if (isCompound(bottom)) return undefined;
      headerBand = Math.max(headerBand, simpleBandWidthPt(bottom));
    }
    widest = Math.max(
      widest,
      ownTopBandWidthPt(
        cell.borders.top,
        (cell.rowTableBorders ?? structure.tableBorders).insideH,
        headerBand
      )
    );
  }
  return widest;
}

/** A complete body row directly below a repeated header reserves the boundary's band. */
function rowBelowRepeatContentDeps(
  structure: SemanticTableStructure,
  row: SemanticTableRow,
  deps: TableFlowDeps
): TableFlowDeps {
  const band = repeatBoundaryBandPt(structure, row, deps);
  if (band === undefined) return deps;
  const insets = new Map(deps.cellContentInsets);
  const minimumInsets = new Map(deps.cellMinimumContentInsets);
  for (const cell of row.cells) {
    const top = cell.margins.top + band;
    const before = insets.get(cell.id) ?? cellContentInsets(cell, true);
    insets.set(cell.id, { ...before, top });
    const minimum = minimumInsets.get(cell.id) ?? cell.minimumContentInsets;
    if (minimum) minimumInsets.set(cell.id, { ...minimum, top });
  }
  return {
    ...deps,
    cellContentInsets: insets,
    ...(minimumInsets.size ? { cellMinimumContentInsets: minimumInsets } : {}),
  };
}

/** Content deps for a row about to open, continue in, or follow rows of one fragment. */
export function fragmentRowContentDeps(
  structure: SemanticTableStructure,
  row: SemanticTableRow,
  deps: TableFlowDeps,
  placed: readonly { readonly isHeaderRepeat?: boolean }[],
  isContinuation: boolean
): TableFlowDeps {
  if (placed.length === 0) return firstRowContentDeps(structure, row, deps);
  if (!placed.every((item) => item.isHeaderRepeat)) return deps;
  return isContinuation
    ? repeatedHeaderContinuationDeps(structure, row, deps)
    : rowBelowRepeatContentDeps(structure, row, deps);
}
