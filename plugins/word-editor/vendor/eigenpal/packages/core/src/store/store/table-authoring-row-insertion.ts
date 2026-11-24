// Admit only ordinary source rows whose insertion boundary does not cross a vertical merge.
import type { EditableTableTopology } from './tree-op-table-topology.ts';
import { isWmlElement, wmlAttributeValue, wmlChildNamed } from './tree-op-table-shared.ts';
import { rowHidesCellInWrapper, tableHidesRowBetween } from './tree-op-table-vmerge.ts';

export function safeRowInsertion(
  topology: EditableTableTopology,
  sourceIndex: number,
  before: boolean,
  columns: number
): boolean {
  const source = topology.rows[sourceIndex];
  if (!source || columns < 1 || source.cells.length !== columns) return false;
  // Without a grid, a merged row cannot establish the number of logical columns.
  if (topology.hasMerge && topology.gridColumns.length === 0) return false;
  if (rowHidesCellInWrapper(source.row)) return false;
  const rowProperties = wmlChildNamed(source.row, 'trPr');
  if (
    rowProperties &&
    (wmlChildNamed(rowProperties, 'gridBefore') || wmlChildNamed(rowProperties, 'gridAfter'))
  )
    return false;
  for (const cell of source.cells) {
    const properties = wmlChildNamed(cell, 'tcPr');
    if (!properties) continue;
    const span = wmlChildNamed(properties, 'gridSpan');
    if (span) return false;
    if (wmlChildNamed(properties, 'hMerge') || wmlChildNamed(properties, 'vMerge')) return false;
  }
  const boundary = sourceIndex + (before ? 0 : 1);
  const upper = topology.rows[boundary - 1];
  const lower = topology.rows[boundary];
  if (upper && lower) {
    if (tableHidesRowBetween(topology.table, upper.row.id, lower.row.id)) return false;
    if (rowHidesCellInWrapper(lower.row)) return false;
    // Even an orphaned continuation must not acquire a different preceding row.
    for (const cell of lower.cells) {
      const properties = wmlChildNamed(cell, 'tcPr');
      if (
        properties?.children.some(
          (child) => isWmlElement(child, 'vMerge') && wmlAttributeValue(child, 'val') !== 'restart'
        )
      )
        return false;
    }
  }
  return true;
}
