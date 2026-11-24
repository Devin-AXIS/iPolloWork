// Where the raised floating tables of a balanced section stand.
//
// Before mode 15, a text-anchored table with a negative `w:tblpY` in a section whose columns
// balance keeps the place it had in the unbalanced layout, where its anchor followed the text
// down the first column (ECMA-376 Part 1, 17.4.57 tblpPr, 17.6.4 cols). Balancing then moves
// the text, not the table: the text in every column it crosses wraps around it there. Since
// mode 15 the table follows its anchor into the balanced column.

import type { PageRecord } from './semantic-records.ts';

/**
 * The unpushed anchor top of each raised text-anchored table on `page`: the table's top less
 * its offset, so the table lays out where it stood.
 */
export function raisedFloatAnchors(
  page: Pick<PageRecord, 'fragments'> | undefined
): ReadonlyMap<string, number> | undefined {
  let anchors: Map<string, number> | undefined;
  for (const fragment of page?.fragments ?? []) {
    if (fragment.kind !== 'table' || !fragment.floatingWrap) continue;
    const float = fragment.floatingWrap.float;
    if (float.vertAnchor !== 'text' || float.ySpec || float.yPt >= -0.051) continue;
    anchors ??= new Map();
    if (!anchors.has(fragment.tableId)) anchors.set(fragment.tableId, fragment.box.y - float.yPt);
  }
  return anchors;
}

/** The kept anchor top of `tableId` when `page` is the balanced page of the section. */
export function keptFloatAnchor(
  options: {
    readonly columnRegionPage?: number;
    readonly raisedFloatAnchors?: ReadonlyMap<string, number>;
  },
  page: number,
  tableId: string
): number | undefined {
  return page === (options.columnRegionPage ?? 0)
    ? options.raisedFloatAnchors?.get(tableId)
    : undefined;
}
