// `w:contextualSpacing` (17.3.1.9) at the edges of a table cell. The property compares a
// paragraph with the paragraph before and after it in document order, and a cell edge does
// not stop that walk:
//
// - the first paragraph of a cell compares with the last paragraph of the cell before it in
//   the row (its cell end mark);
// - the first paragraph of a row's first cell compares with the end mark of the row above
//   (17.4.78 `w:tr`), which carries the default paragraph style (17.7.4.17 `w:default`);
// - in the first row of a body table, it compares with the paragraph before the table, and
//   with no paragraph there (the table opens the story, or follows another table) nothing
//   matches. The first row of any other table (nested, or in a header or footer) takes the
//   row end mark rule;
// - the last paragraph of a cell compares with the first paragraph of the next cell, and in
//   the row's last cell with the row end mark, so in the default style.

import { flattenContentControls, type OoxmlElement } from '@docx-editor.dev/core/store';
import { neighbourParagraphStyle } from './contextual-paragraph-spacing.ts';
import { extendedFlowKey } from './flow-key-intern.ts';
import type { SemanticTableCell, SemanticTableRow } from './semantic-table.ts';
import type { PreparedBlock } from './section-prepass-types.ts';
import type { StyleCascadeTable } from './style-cascade.ts';

/** The paragraph a cell edge compares with; `style: undefined` never matches. */
export interface EdgeNeighbour {
  readonly style: string | null | undefined;
}

/** What one cell-edge paragraph compares with, on each side that is a cell edge. */
export interface CellEdgeNeighbours {
  readonly previous?: EdgeNeighbour;
  readonly next?: EdgeNeighbour;
}

const NONE: EdgeNeighbour = { style: undefined };

/** The style of the block before a body table, as the prepass resolved it. */
function leadOf(previous: PreparedBlock | undefined): string | null | undefined {
  return previous?.kind === 'paragraph' ? previous.styleId : undefined;
}

function firstRowId(table: OoxmlElement): string | undefined {
  return flattenContentControls(table.children).find((node) => node.kind === 'tableRow')?.id;
}

/** Each body table's first row id, mapped to the block before the table. */
export function tableTopLeads(
  prepared: readonly PreparedBlock[]
): ReadonlyMap<string, EdgeNeighbour> {
  const leads = new Map<string, EdgeNeighbour>();
  prepared.forEach((entry, index) => {
    const id = entry.kind === 'table' ? firstRowId(entry.table) : undefined;
    if (id !== undefined) leads.set(id, { style: leadOf(prepared[index - 1]) });
  });
  return leads;
}

/**
 * Flow keys that carry each body table's lead style, so an edit that restyles the paragraph
 * before a table re-places the table whose first row reads it.
 */
export function tableLeadFlowKeys(keys: string[], prepared: readonly PreparedBlock[]): string[] {
  let flow = keys;
  prepared.forEach((entry, index) => {
    if (entry.kind !== 'table' || flow[index] === undefined) return;
    const style = leadOf(prepared[index - 1]);
    if (flow === keys) flow = [...keys];
    flow[index] = extendedFlowKey(flow[index]!, '~tl~', style === undefined ? '-' : `=${style}`);
  });
  return flow;
}

function edgeParagraph(cell: SemanticTableCell | undefined, side: 'first' | 'last') {
  const block = side === 'first' ? cell?.blocks[0] : cell?.blocks.at(-1);
  return block?.kind === 'paragraph' ? block : undefined;
}

const memo = new WeakMap<
  SemanticTableRow,
  {
    readonly styles: StyleCascadeTable | undefined;
    readonly lead: EdgeNeighbour | undefined;
    readonly edges: ReadonlyMap<string, CellEdgeNeighbours>;
  }
>();

/**
 * The cell-edge paragraphs of one row, by paragraph id. `lead` is the row's entry in
 * {@link tableTopLeads}: present only for the first row of a body table.
 */
export function cellEdgeNeighbours(
  row: SemanticTableRow,
  styles: StyleCascadeTable | undefined,
  lead: EdgeNeighbour | undefined
): ReadonlyMap<string, CellEdgeNeighbours> {
  const cached = memo.get(row);
  if (cached && cached.styles === styles && cached.lead === lead) return cached.edges;
  const rowEnd: EdgeNeighbour = { style: styles?.defaultParagraphStyleId ?? undefined };
  const styleOf = (cell: SemanticTableCell | undefined, side: 'first' | 'last') => {
    const paragraph = edgeParagraph(cell, side);
    return paragraph
      ? { style: neighbourParagraphStyle(paragraph, styles, cell!.styleFormatting) }
      : NONE;
  };
  const edges = new Map<string, CellEdgeNeighbours>();
  row.cells.forEach((cell, index) => {
    const before = index > 0 ? styleOf(row.cells[index - 1], 'last') : (lead ?? rowEnd);
    const after = index < row.cells.length - 1 ? styleOf(row.cells[index + 1], 'first') : rowEnd;
    const first = edgeParagraph(cell, 'first');
    const last = edgeParagraph(cell, 'last');
    if (first) edges.set(first.id, { previous: before });
    if (last) edges.set(last.id, { ...edges.get(last.id), next: after });
  });
  memo.set(row, { styles, lead, edges });
  return edges;
}
