// Reuse table layout's conditional-style selection for font writes.
import type { FormattingRevisionAuthorFilter } from '../store/store/formattable-runs.ts';
import { parentNodeOf } from '../store/package/ooxml-edit.ts';
import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';
import { readTableStructure } from './semantic-table.ts';
import type { StyleCascadeTable, TableCellStyleFormatting } from './style-cascade.ts';

const filters = new WeakMap<FormattingRevisionAuthorFilter, RevisionAuthorFilter>();
let filterId = 0;
function layoutFilter(
  filter: FormattingRevisionAuthorFilter | undefined
): RevisionAuthorFilter | undefined {
  if (!filter) return undefined;
  let resolved = filters.get(filter);
  if (!resolved) {
    resolved = { ...filter, cacheKey: `formatting-${++filterId}` };
    filters.set(filter, resolved);
  }
  return resolved;
}

export function createFormattingCellStyles(cascade: StyleCascadeTable) {
  // Keyed by the table's `w:tblPr`, which survives edits, so only the latest table revision
  // keeps a map. Keyed by the table node, every revision the undo history holds kept one.
  const tables = new WeakMap<
    OoxmlNode,
    {
      table: OoxmlNode;
      mode: RevisionDisplayMode;
      filter: RevisionAuthorFilter | undefined;
      cells: ReadonlyMap<string, TableCellStyleFormatting>;
    }
  >();
  return (
    part: OoxmlPart,
    paragraph: OoxmlNode,
    mode: RevisionDisplayMode,
    filter?: FormattingRevisionAuthorFilter
  ) => {
    const viewFilter = layoutFilter(filter);
    let owner = parentNodeOf(part, paragraph.id);
    let cellId: string | undefined;
    // The canonical parser bounds depth. Stop at a table so nested cells use their own style.
    while (owner && owner.kind !== 'table') {
      if (owner.localName === 'txbxContent') return undefined;
      if (owner.kind === 'tableCell') cellId = owner.id;
      owner = parentNodeOf(part, owner.id);
    }
    if (!owner || !cellId) return undefined;
    const table = owner;
    const key =
      table.kind === 'table'
        ? (table.children.find((child) => child.localName === 'tblPr') ?? table)
        : table;
    let indexed = tables.get(key);
    if (
      !indexed ||
      indexed.table !== table ||
      indexed.mode !== mode ||
      indexed.filter !== viewFilter
    ) {
      const cells = new Map<string, TableCellStyleFormatting>();
      // Width does not select conditional styles. No measuring or pagination occurs here.
      const structure = readTableStructure(owner, 1, 0, cascade, mode, viewFilter);
      for (const row of structure?.rows ?? []) {
        for (const cell of row.cells) cells.set(cell.id, cell.styleFormatting);
      }
      indexed = { table, mode, filter: viewFilter, cells };
      tables.set(key, indexed);
    }
    return indexed.cells.get(cellId);
  };
}
