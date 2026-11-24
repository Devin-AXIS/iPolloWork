import {
  flattenContentControls,
  type OoxmlElement,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import { collectFlowBlocks } from '../store/package/content-control-walk.ts';
import { readGridSkip, readGridSpan, readVMerge } from './table-row-properties.ts';

/** One cached row walk: its depth budget, the mode and skipped columns, and its paragraphs. */
interface RowParagraphs {
  readonly remaining: number;
  readonly skipped: string;
  readonly paragraphs: readonly OoxmlElement[];
}
// Numbering skips merged continuations; other readers include them. Keep each mode's
// latest answer so alternating readers do not discard every unchanged row's walk.
const rowParagraphs = new WeakMap<OoxmlNode, { plain?: RowParagraphs; merged?: RowParagraphs }>();

const NO_COLUMNS: ReadonlySet<number> = new Set();

/**
 * Collect story paragraphs, preserving table depth limits across immutable row reuse.
 *
 * `skipMergedCells` leaves out the paragraphs of a cell that continues a vertical merge from
 * the cell above it in the same grid column (`w:vMerge` without `restart`). Such a cell shows
 * nothing, so list numbering skips it; a continuation with no merged cell above it starts its
 * own merge and keeps its paragraphs.
 */
export function walkStoryParagraphs(
  blocks: readonly OoxmlElement[],
  maxTableDepth = 8,
  skipMergedCells = false
): OoxmlElement[] {
  const out: OoxmlElement[] = [];
  pushStoryParagraphs(blocks, maxTableDepth, out, skipMergedCells);
  return out;
}

/**
 * The paragraphs `walkStoryParagraphs` collects for one table row, where `remaining` is the
 * table depth still allowed at the row's table (its walk's `maxTableDepth` minus the depth).
 */
export function storyRowParagraphs(row: OoxmlElement, remaining: number): readonly OoxmlElement[] {
  const cached = rowParagraphs.get(row)?.plain;
  if (cached?.remaining === remaining && cached.skipped === '0|') return cached.paragraphs;
  const out: OoxmlElement[] = [];
  pushRowParagraphs(row, remaining, NO_COLUMNS, out, false);
  return out;
}

function pushStoryParagraphs(
  blocks: readonly OoxmlElement[],
  maxTableDepth: number,
  out: OoxmlElement[],
  skipMergedCells: boolean
): void {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      out.push(block);
      continue;
    }
    if (block.kind !== 'table' || maxTableDepth <= 0) continue;
    // Grid columns where the previous row has a `w:vMerge` cell, when merged cells are skipped.
    let mergedAbove = NO_COLUMNS;
    for (const row of flattenContentControls(block.children)) {
      if (row.kind !== 'tableRow') continue;
      const merged = pushRowParagraphs(row, maxTableDepth, mergedAbove, out, skipMergedCells);
      mergedAbove = skipMergedCells ? merged : NO_COLUMNS;
    }
  }
}

/** A row's cells with their grid columns, and the columns that hold a `w:vMerge` cell. */
interface RowMergePlan {
  readonly cells: readonly { cell: OoxmlElement; column: number; continues: boolean }[];
  readonly merged: ReadonlySet<number>;
}

const rowMergePlans = new WeakMap<OoxmlNode, RowMergePlan>();

function elementNamed(nodes: readonly OoxmlNode[], localName: string): OoxmlElement | undefined {
  for (const node of nodes) {
    if (node.kind !== 'textValue' && node.localName === localName) return node;
  }
  return undefined;
}

function rowMergePlan(row: OoxmlElement): RowMergePlan {
  const known = rowMergePlans.get(row);
  if (known) return known;
  const children = flattenContentControls(row.children);
  const rowProperties = elementNamed(children, 'trPr');
  let column = readGridSkip(rowProperties, 'gridBefore');
  const cells: { cell: OoxmlElement; column: number; continues: boolean }[] = [];
  const merged = new Set<number>();
  for (const cell of children) {
    if (cell.kind !== 'tableCell') continue;
    const cellProperties = elementNamed(cell.children, 'tcPr');
    const vMerge = readVMerge(cellProperties);
    if (vMerge !== 'none') merged.add(column);
    cells.push({ cell, column, continues: vMerge === 'continue' });
    column += readGridSpan(cellProperties);
  }
  const plan = { cells, merged };
  rowMergePlans.set(row, plan);
  return plan;
}

/** Push one row's paragraphs; returns the grid columns where this row has a `w:vMerge` cell. */
function pushRowParagraphs(
  row: OoxmlElement,
  remaining: number,
  mergedAbove: ReadonlySet<number>,
  out: OoxmlElement[],
  skipMergedCells: boolean
): ReadonlySet<number> {
  const plan = rowMergePlan(row);
  // The mode is part of the key: nested tables inside the row walk in the same mode.
  let key = skipMergedCells ? '1|' : '0|';
  for (const entry of plan.cells) {
    if (entry.continues && mergedAbove.has(entry.column)) key += `${entry.column},`;
  }
  const entries = rowParagraphs.get(row);
  const mode = skipMergedCells ? 'merged' : 'plain';
  const cached = entries?.[mode];
  if (cached?.remaining === remaining && cached.skipped === key) {
    for (const paragraph of cached.paragraphs) out.push(paragraph);
    return plan.merged;
  }
  const start = out.length;
  for (const entry of plan.cells) {
    if (entry.continues && mergedAbove.has(entry.column)) continue;
    // Flatten cell SDTs under the shared content-control budget; table nesting still
    // uses the remaining depth for the table walk itself.
    pushStoryParagraphs(
      collectFlowBlocks(entry.cell.children),
      remaining - 1,
      out,
      skipMergedCells
    );
  }
  if (out.length - start <= 256)
    rowParagraphs.set(row, {
      ...entries,
      [mode]: { remaining, skipped: key, paragraphs: out.slice(start) },
    });
  return plan.merged;
}
