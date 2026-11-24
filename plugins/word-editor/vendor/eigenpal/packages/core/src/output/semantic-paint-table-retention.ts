import type {
  BlockFragmentRecord,
  LayoutBox,
  TableCellFragmentRecord,
  TableFragmentRecord,
  TableRowFragmentRecord,
} from '../layout/semantic-records.ts';
import type { ResolvedCellBorders, TableBorderStrokeRecord } from '../layout/table-borders.ts';
import {
  moveRelativeBox,
  reflowParagraph,
  type ParagraphReflowPaint,
} from './semantic-paint-paragraph-reflow.ts';
import { sameRecordExcept } from './semantic-paint-record-equality.ts';

const tables = new WeakMap<
  HTMLElement,
  {
    fragment: TableFragmentRecord;
    rows: ReadonlyMap<TableRowFragmentRecord, HTMLElement>;
  }
>();

/**
 * What one painted cell was built from, with direct handles to the elements a geometry
 * change can move: its published border strokes in record order (absent when it painted
 * none) and its block elements in record order, all children of `host`.
 */
interface PaintedCell {
  readonly cell: TableCellFragmentRecord;
  readonly host: HTMLElement;
  readonly strokes: readonly HTMLElement[] | undefined;
  readonly blocks: readonly HTMLElement[];
}

const cells = new WeakMap<HTMLElement, PaintedCell>();

export function rememberPaintedTable(
  element: HTMLElement,
  fragment: TableFragmentRecord,
  rows: ReadonlyMap<TableRowFragmentRecord, HTMLElement>
): void {
  tables.set(element, { fragment, rows });
}

export function rememberPaintedCell(
  element: HTMLElement,
  cell: TableCellFragmentRecord,
  host: HTMLElement,
  strokes: readonly HTMLElement[] | undefined,
  blocks: readonly HTMLElement[]
): void {
  cells.set(element, { cell, host, strokes, blocks });
}

export function previousTableElement(
  blocks: ReadonlyMap<BlockFragmentRecord, HTMLElement>,
  fragment: TableFragmentRecord
): HTMLElement | undefined {
  for (const [previous, element] of blocks)
    if (
      previous.kind === 'table' &&
      previous.tableId === fragment.tableId &&
      previous.fragmentIndex === fragment.fragmentIndex
    )
      return element;
  return undefined;
}

/** Cold painters for the parts of a table reuse cannot keep, plus the paragraph paint rules. */
export interface TableRepaint extends ParagraphReflowPaint {
  row(row: TableRowFragmentRecord): HTMLElement;
  cell(cell: TableCellFragmentRecord, rowBox: LayoutBox): HTMLElement;
  /** A nested table receives its previous element, so it can be reused in turn. */
  block(block: BlockFragmentRecord, previous?: HTMLElement): HTMLElement;
  /**
   * Layers painted under the rows, such as gap shading; they replace the old ones. Called only
   * once reuse is accepted, so a refusal paints nothing and leaves the element as it was.
   */
  leading?(): readonly HTMLElement[];
}

const TABLE_GEOMETRY: ReadonlySet<string> = new Set(['rows', 'box', 'columnEdges']);
// Gap bands and the frame paint from `spacingShading` and `spacingFrame` as the fragment's
// leading layers, not the row.
const ROW_GEOMETRY: ReadonlySet<string> = new Set([
  'box',
  'cells',
  'spacingShading',
  'spacingFrame',
]);
const CELL_GEOMETRY: ReadonlySet<string> = new Set(['box', 'blocks', 'borders']);
// Paint draws the per-side edges and the stroke records; edge segments are not painted.
const BORDER_GEOMETRY: ReadonlySet<string> = new Set(['strokes', 'edgeSegments']);
const NO_STROKES: readonly TableBorderStrokeRecord[] = [];

/**
 * Put `children` in order after the first `preserved` element children of `parent`, removing
 * every other child after them. Children already in place are not moved.
 */
function reconcileChildren(
  parent: HTMLElement,
  children: readonly HTMLElement[],
  preserved: number
): void {
  let cursor: Element | null = parent.children[preserved] ?? null;
  let inPlace = 0;
  while (inPlace < children.length && cursor === children[inPlace]) {
    cursor = cursor.nextElementSibling;
    inPlace += 1;
  }
  if (inPlace === children.length && cursor === null) return;
  const kept = new Set<Element>(children);
  while (cursor) {
    const next: Element | null = cursor.nextElementSibling;
    if (!kept.has(cursor)) cursor.remove();
    cursor = next;
  }
  cursor = parent.children[preserved + inPlace] ?? null;
  for (let index = inPlace; index < children.length; index += 1) {
    const child = children[index]!;
    if (child === cursor) cursor = cursor.nextElementSibling;
    else parent.insertBefore(child, cursor);
  }
}

/** True when the strokes painted for `before` can be moved to `after`'s geometry. */
function sameBorderPaint(
  before: ResolvedCellBorders | undefined,
  after: ResolvedCellBorders | undefined,
  painted: readonly HTMLElement[] | undefined
): boolean {
  if (before === after) return true;
  if (
    before?.diagonals !== after?.diagonals &&
    ((before?.diagonals?.length ?? 0) > 0 || (after?.diagonals?.length ?? 0) > 0)
  )
    return false;
  if (!before || !after || !sameRecordExcept(before, after, BORDER_GEOMETRY)) return false;
  const a = before.strokes ?? NO_STROKES;
  const b = after.strokes ?? NO_STROKES;
  if (a.length !== b.length) return false;
  if (b.length > 0 && painted?.length !== b.length) return false;
  for (let index = 0; index < b.length; index += 1) {
    const x = a[index]!;
    const y = b[index]!;
    if (x.side !== y.side || x.role !== y.role || x.color !== y.color) return false;
    if (x.cssStyle !== y.cssStyle) return false;
    // A patterned stroke paints its thickness into a border declaration; keep it fixed.
    const horizontal = y.side === 'top' || y.side === 'bottom';
    if (y.cssStyle !== 'solid' && (horizontal ? x.height !== y.height : x.width !== y.width)) {
      return false;
    }
  }
  return true;
}

function moveStrokes(
  painted: readonly HTMLElement[] | undefined,
  before: ResolvedCellBorders | undefined,
  after: ResolvedCellBorders | undefined,
  scale: number
): void {
  const a = before?.strokes ?? NO_STROKES;
  const b = after?.strokes ?? NO_STROKES;
  if (a === b || !painted) return;
  for (let index = 0; index < b.length; index += 1) {
    const x = a[index]!;
    const y = b[index]!;
    const style = painted[index]!.style;
    if (x.x !== y.x) style.left = `${y.x * scale}px`;
    if (x.y !== y.y) style.top = `${y.y * scale}px`;
    if (x.width !== y.width) style.width = `${y.width * scale}px`;
    if (x.height !== y.height) style.height = `${y.height * scale}px`;
  }
}

function blockIndex(blocks: readonly BlockFragmentRecord[], id: string, hint: number): number {
  if (blocks[hint]?.id === id) return hint;
  return blocks.findIndex((block) => block.id === id);
}

/** The cell's block elements for `after`, reusing or moving what `before` painted. */
function reflowBlocks(
  painted: PaintedCell,
  after: TableCellFragmentRecord,
  repaint: TableRepaint
): HTMLElement[] {
  const before = painted.cell;
  const scale = repaint.scale;
  const used = new Set<number>();
  const blocks: HTMLElement[] = [];
  for (let index = 0; index < after.blocks.length; index += 1) {
    const block = after.blocks[index]!;
    const found = blockIndex(before.blocks, block.id, index);
    const prior = found < 0 || used.has(found) ? undefined : before.blocks[found];
    const element = prior ? painted.blocks[found] : undefined;
    if (prior) used.add(found);
    if (
      prior &&
      element &&
      (prior === block ||
        (prior.kind === 'paragraph' &&
          block.kind === 'paragraph' &&
          reflowParagraph(element, prior, block, repaint)))
    ) {
      moveRelativeBox(element.style, prior.box, before.box, block.box, after.box, scale);
      blocks.push(element);
      continue;
    }
    // A nested table goes back through its own painter with its previous element, which
    // positions it for the page; the cell then places it like a fresh block.
    const fresh =
      block.kind === 'table' && prior?.kind === 'table'
        ? repaint.block(block, element)
        : repaint.block(block);
    fresh.style.left = `${(block.box.x - after.box.x) * scale}px`;
    fresh.style.top = `${(block.box.y - after.box.y) * scale}px`;
    blocks.push(fresh);
  }
  return blocks;
}

/** Reuse a painted cell for `after`, or refuse with nothing changed. */
function reflowCell(
  element: HTMLElement,
  before: TableCellFragmentRecord,
  beforeRow: LayoutBox,
  after: TableCellFragmentRecord,
  afterRow: LayoutBox,
  repaint: TableRepaint
): HTMLElement | null {
  const painted = cells.get(element);
  if (!painted || painted.cell !== before) return null;
  if (before !== after) {
    if (!sameRecordExcept(before, after, CELL_GEOMETRY)) return null;
    const inert = after.paintInert || after.vMergeContinue;
    if (!inert) {
      if (
        after.textDirection === 'btLr' &&
        (before.box.width !== after.box.width || before.box.height !== after.box.height)
      ) {
        return null;
      }
      if (!sameBorderPaint(before.borders, after.borders, painted.strokes)) return null;
      const host = painted.host;
      const preserved = host.children.length - painted.blocks.length;
      if (preserved < 0) return null;
      for (const block of painted.blocks) if (block.parentElement !== host) return null;
      moveStrokes(painted.strokes, before.borders, after.borders, repaint.scale);
      const blocks = reflowBlocks(painted, after, repaint);
      reconcileChildren(host, blocks, preserved);
      cells.set(element, { cell: after, host, strokes: painted.strokes, blocks });
    } else {
      cells.set(element, { ...painted, cell: after });
    }
  }
  moveRelativeBox(element.style, before.box, beforeRow, after.box, afterRow, repaint.scale);
  return element;
}

/** Reuse a painted row for `after`, or refuse with nothing changed. */
function reflowRow(
  element: HTMLElement,
  before: TableRowFragmentRecord,
  beforeTable: LayoutBox,
  after: TableRowFragmentRecord,
  afterTable: LayoutBox,
  repaint: TableRepaint
): HTMLElement | null {
  if (before !== after) {
    if (!sameRecordExcept(before, after, ROW_GEOMETRY)) return null;
    const painted = element.children;
    if (painted.length !== before.cells.length) return null;
    const used = new Set<number>();
    const cellElements: HTMLElement[] = [];
    for (let index = 0; index < after.cells.length; index += 1) {
      const cell = after.cells[index]!;
      const found =
        before.cells[index]?.id === cell.id
          ? index
          : before.cells.findIndex((candidate) => candidate.id === cell.id);
      const reused =
        found >= 0 && !used.has(found)
          ? reflowCell(
              painted[found] as HTMLElement,
              before.cells[found]!,
              before.box,
              cell,
              after.box,
              repaint
            )
          : null;
      if (reused) used.add(found);
      cellElements.push(reused ?? repaint.cell(cell, after.box));
    }
    reconcileChildren(element, cellElements, 0);
  }
  moveRelativeBox(element.style, before.box, beforeTable, after.box, afterTable, repaint.scale);
  return element;
}

function rowKey(row: TableRowFragmentRecord): string {
  return `${row.id}\u0000${row.isHeaderRepeat ? 1 : 0}${row.isContinuation ? 1 : 0}`;
}

/**
 * Repaint a table fragment into the element painted for its previous record.
 *
 * Rows, cells and cell paragraphs are kept by identity; an unchanged one stays as it is, one
 * whose geometry moved is updated in place, and anything else is painted fresh. This is what
 * keeps typing that widens a column from rebuilding every visible cell. Refuses, returning
 * null with nothing changed, when the element has no retained record or a table-level paint
 * input changed.
 */
export function reflowTableFragment(
  element: HTMLElement,
  fragment: TableFragmentRecord,
  repaint: TableRepaint
): HTMLElement | null {
  const previous = tables.get(element);
  if (!previous) return null;
  const before = previous.fragment;
  if (!sameRecordExcept(before, fragment, TABLE_GEOMETRY)) return null;
  // A key two old rows share names neither: both repaint rather than guess.
  const candidates = new Map<string, readonly [TableRowFragmentRecord, HTMLElement] | null>();
  for (const [record, row] of previous.rows) {
    const key = rowKey(record);
    candidates.set(key, candidates.has(key) ? null : [record, row]);
  }
  const rows = new Map<TableRowFragmentRecord, HTMLElement>();
  for (const row of fragment.rows) {
    const key = rowKey(row);
    const candidate = candidates.get(key);
    candidates.delete(key);
    const reused = candidate
      ? reflowRow(candidate[1], candidate[0], before.box, row, fragment.box, repaint)
      : null;
    rows.set(row, reused ?? repaint.row(row));
  }
  const scale = repaint.scale;
  const style = element.style;
  if (before.box.x !== fragment.box.x) style.left = `${fragment.box.x * scale}px`;
  if (before.box.y !== fragment.box.y) style.top = `${fragment.box.y * scale}px`;
  if (before.box.width !== fragment.box.width) style.width = `${fragment.box.width * scale}px`;
  if (before.box.height !== fragment.box.height) style.height = `${fragment.box.height * scale}px`;
  reconcileChildren(element, [...(repaint.leading?.() ?? []), ...rows.values()], 0);
  tables.set(element, { fragment, rows });
  return element;
}
