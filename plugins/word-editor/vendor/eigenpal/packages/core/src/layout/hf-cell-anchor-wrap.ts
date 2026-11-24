// Which anchored objects of a header or footer story its own text wraps around.
//
// An object that a table cell of the story anchors, but that lays out against the page
// (`layoutInCell="0"`, §20.4.2.3, where the compatibility mode still reads it), wraps no text
// of the story at all: not its own cell, not the other cells of its table, and not the
// paragraphs after the table. Its wrap still applies to the body text of the page, which reads
// the published object, not these zones. Every other anchored object keeps its wrap.

import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { collectExclusionZonesFromDrawings, type ExclusionZone } from './drawing-exclusion.ts';
import type { AnchoredDrawingRecord, InlineDrawingLayoutContext } from './drawing-layout.ts';

const cellParagraphsBySource = new WeakMap<readonly OoxmlNode[], ReadonlySet<string>>();

/** The ids of every paragraph inside a table of `blocks`, nested tables included. */
function tableCellParagraphIds(blocks: readonly OoxmlNode[]): ReadonlySet<string> {
  const cached = cellParagraphsBySource.get(blocks);
  if (cached) return cached;
  const ids = new Set<string>();
  const visit = (node: OoxmlNode, inTable: boolean): void => {
    if (node.kind === 'paragraph' && inTable) ids.add(node.id);
    if (!('children' in node) || !Array.isArray(node.children)) return;
    const nested = inTable || node.kind === 'table';
    for (const child of node.children as readonly OoxmlNode[]) visit(child, nested);
  };
  for (const block of blocks) visit(block, false);
  cellParagraphsBySource.set(blocks, ids);
  return ids;
}

/** The wrap zones the story's own flow lays out under, from the drawings it published. */
export function storyDrawingWrapZones(
  drawings: readonly AnchoredDrawingRecord[],
  drawingLayout: InlineDrawingLayoutContext,
  contentWidth: number,
  source: readonly OoxmlNode[]
): readonly ExclusionZone[] {
  if (drawings.some((drawing) => !drawing.layoutInCell)) {
    const cellParagraphs = tableCellParagraphIds(source);
    drawings = drawings.filter(
      (drawing) => drawing.layoutInCell || !cellParagraphs.has(drawing.anchorParagraphId)
    );
  }
  return collectExclusionZonesFromDrawings(drawings, drawingLayout, 0, contentWidth);
}
