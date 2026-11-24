import { fragmentParagraphs } from './line-segments.ts';
import type { BlockFragmentRecord, PageRecord, SemanticLayout } from './semantic-records.ts';
import type { TableCellContext } from './semantic-cell-selection.ts';

type Location = { tableId: string; rowId: string; columnIndex: number };
type TableSummary = { rows: Set<string>; columns: number };
type Contribution = {
  paragraphs: Map<string, Location>;
  tables: Map<string, TableSummary>;
};
const pageContributions = new WeakMap<PageRecord, Contribution>();

/** @internal Both pages have identical paragraph membership in tables, rows, and columns. */
export function carryPageTableContributions(from: PageRecord, to: PageRecord): void {
  const known = pageContributions.get(from);
  if (known) pageContributions.set(to, known);
}
const layoutSummaries = new WeakMap<
  SemanticLayout,
  Map<string, { rows: Map<string, number>; columns: number }>
>();
const answers = new WeakMap<SemanticLayout, Map<string, TableCellContext | null>>();

/** Only for updates that preserve every paragraph's table, row, and column membership. */
export function carryTableCaretContexts(before: SemanticLayout, after: SemanticLayout): void {
  const known = answers.get(before);
  if (known) answers.set(after, new Map(known));
  const summary = layoutSummaries.get(before);
  if (summary) layoutSummaries.set(after, summary);
}

function contribution(page: PageRecord): Contribution {
  const cached = pageContributions.get(page);
  if (cached) return cached;
  const result: Contribution = { paragraphs: new Map(), tables: new Map() };
  const visit = (blocks: readonly BlockFragmentRecord[], parent?: Location): void => {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        if (parent) {
          for (const paragraphId of fragmentParagraphs(block)) {
            const previous = result.paragraphs.get(paragraphId);
            if (!previous || previous.tableId.length < parent.tableId.length)
              result.paragraphs.set(paragraphId, parent);
          }
        }
        continue;
      }
      let table = result.tables.get(block.tableId);
      if (!table) {
        table = { rows: new Set(), columns: 0 };
        result.tables.set(block.tableId, table);
      }
      table.columns = Math.max(table.columns, (block.columnEdges?.length ?? 1) - 1);
      for (const row of block.rows) {
        table.rows.add(row.id);
        for (const cell of row.cells) {
          table.columns = Math.max(table.columns, cell.gridColumn + Math.max(1, cell.gridSpan));
          visit(
            cell.blocks,
            row.isHeaderRepeat
              ? undefined
              : {
                  tableId: block.tableId,
                  rowId: row.id,
                  columnIndex: cell.logicalGridColumn ?? cell.gridColumn,
                }
          );
        }
      }
    }
  };
  visit(page.fragments);
  for (const story of [page.header, page.footer]) if (story) visit(story.fragments);
  for (const area of [page.footnotes, page.endnotes])
    if (area) for (const note of area.notes) visit(note.fragments);
  pageContributions.set(page, result);
  return result;
}

/** Reused pages keep their caret lookup data without rebuilding every placed cell. */
export function tableCaretContext(
  layout: SemanticLayout,
  paragraphId: string
): TableCellContext | null {
  let known = answers.get(layout);
  if (!known) answers.set(layout, (known = new Map()));
  if (known.has(paragraphId)) return known.get(paragraphId)!;
  const result = readTableCaretContext(layout, paragraphId);
  // Toolbar reads touch few paragraphs; bulk callers must not retain an unbounded answer map.
  if (known.size >= 32) known.delete(known.keys().next().value!);
  known.set(paragraphId, result);
  return result;
}

function readTableCaretContext(
  layout: SemanticLayout,
  paragraphId: string
): TableCellContext | null {
  let summary = layoutSummaries.get(layout);
  if (!summary) {
    summary = new Map();
    for (const page of layout.pages) {
      for (const [id, part] of contribution(page).tables) {
        let table = summary.get(id);
        if (!table) {
          table = { rows: new Map(), columns: 0 };
          summary.set(id, table);
        }
        table.columns = Math.max(table.columns, part.columns);
        for (const row of part.rows) if (!table.rows.has(row)) table.rows.set(row, table.rows.size);
      }
    }
    layoutSummaries.set(layout, summary);
  }
  let location: Location | undefined;
  for (const page of layout.pages) {
    const candidate = contribution(page).paragraphs.get(paragraphId);
    if (candidate && (!location || location.tableId.length < candidate.tableId.length))
      location = candidate;
  }
  if (!location) return null;
  const table = summary.get(location.tableId)!;
  return {
    tableId: location.tableId,
    rows: table.rows.size,
    columns: table.columns,
    rowIndex: table.rows.get(location.rowId)!,
    columnIndex: location.columnIndex,
  };
}
