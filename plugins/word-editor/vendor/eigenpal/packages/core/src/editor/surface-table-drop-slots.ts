// Where a dragged table can land: before each of its siblings, at the top of that block's
// first painted fragment.

import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import { parentOf } from '../store/store/tree-op-nodes.ts';
import type { BlockFragmentRecord, LayoutBox, SemanticLayout } from '../layout/semantic-records.ts';

export interface TableDropSlot {
  readonly beforeBlockId: string;
  /** The table's own place: above it, or above the block after it. Dropping here does nothing. */
  readonly stays: boolean;
  readonly pageIndex: number;
  /** Story-local coordinates of the drop line, relative to `origin`. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly origin: LayoutBox;
}

/** Every slot the table could move to, including the two that leave it where it is. */
export function tableDropSlots(
  layout: SemanticLayout,
  part: OoxmlPart,
  tableId: string
): TableDropSlot[] {
  const parent = parentOf(part, tableId);
  if (!parent) return [];
  const blocks = parent.children.filter(
    (child) => child.kind === 'paragraph' || child.kind === 'table'
  );
  const index = blocks.findIndex((block) => block.id === tableId);
  const stays = new Map(blocks.map((block, at) => [block.id, at === index || at === index + 1]));
  const slots: TableDropSlot[] = [];
  const visit = (
    fragments: readonly BlockFragmentRecord[],
    pageIndex: number,
    origin: LayoutBox
  ): void => {
    for (const fragment of fragments) {
      const id = fragment.kind === 'paragraph' ? fragment.paragraphId : fragment.tableId;
      const staysHere = stays.get(id);
      if (fragment.fragmentIndex === 0 && staysHere !== undefined) {
        const { x, y, width } = fragment.box;
        slots.push({ beforeBlockId: id, stays: staysHere, pageIndex, x, y, width, origin });
      }
      if (fragment.kind === 'table') {
        for (const row of fragment.rows) {
          for (const cell of row.cells) visit(cell.blocks, pageIndex, origin);
        }
      }
    }
  };
  layout.pages.forEach((page, pageIndex) => {
    visit(page.fragments, pageIndex, page.contentBox);
    for (const story of [page.header, page.footer]) {
      if (story) visit(story.fragments, pageIndex, story.box);
    }
  });
  return slots;
}

/**
 * The slot nearest a sheet-space point. Slots whose line spans the pointer's x come first, so
 * in a multi-column section the drop stays in the column under the pointer.
 */
export function nearestTableDropSlot(
  slots: readonly TableDropSlot[],
  sheetX: number,
  sheetY: number,
  pageOffsetX: (pageIndex: number) => number
): TableDropSlot | null {
  const left = (slot: TableDropSlot) => slot.origin.x + slot.x + pageOffsetX(slot.pageIndex);
  /** Out of column ranks after every in-column slot; within a rank, nearer wins. */
  const rank = (slot: TableDropSlot): readonly [number, number] => {
    const dy = Math.abs(slot.origin.y + slot.y - sheetY);
    const from = left(slot);
    if (sheetX >= from && sheetX <= from + slot.width) return [0, dy];
    const dx = Math.min(Math.abs(sheetX - from), Math.abs(sheetX - from - slot.width));
    return [1, Math.hypot(dx, dy)];
  };
  let best: TableDropSlot | null = null;
  let bestRank: readonly [number, number] = [2, 0];
  for (const slot of slots) {
    const [tier, distance] = rank(slot);
    if (tier < bestRank[0] || (tier === bestRank[0] && distance < bestRank[1])) {
      best = slot;
      bestRank = [tier, distance];
    }
  }
  return best;
}
