// Body wrap around the floating tables of a header or footer.
//
// A top-level `w:tblpPr` table in a header or footer sits outside the story's flow at its
// anchor position. When it reaches into the body area, body text wraps around it as it does
// around a floating body table: beside it when it leaves room, below it when it spans the
// column. The zone belongs to the page's furniture, so every page that shows the variant
// gets it, and a first-page or even-page variant without the table gets none.

import { findNode } from '../store/package/ooxml-edit.ts';
import { WML_NAMESPACE_URI, type OoxmlPart } from '../store/package/ooxml-tree.ts';
import type { ExclusionZone } from './drawing-exclusion.ts';
import { isOutOfFlowFragment } from './fragment-flow.ts';
import type {
  BlockFragmentRecord,
  HeaderFooterStoryRecord,
  LayoutBox,
  TableFragmentRecord,
} from './semantic-records.ts';
import { addFloatingTableExclusions } from './table-float-exclusion.ts';
import { readTableFloatPosition, type TableFloatPosition } from './table-float-properties.ts';

const floats = new WeakMap<OoxmlPart, Map<string, TableFloatPosition | null>>();

function floatOf(part: OoxmlPart, tableId: string): TableFloatPosition | null {
  let byId = floats.get(part);
  if (!byId) {
    byId = new Map();
    floats.set(part, byId);
  }
  const known = byId.get(tableId);
  if (known !== undefined) return known;
  const table = findNode(part, tableId);
  let float: TableFloatPosition | null = null;
  if (table && table.kind === 'table') {
    const properties = table.children.find(
      (child) => child.namespaceUri === WML_NAMESPACE_URI && child.localName === 'tblPr'
    );
    float = readTableFloatPosition(properties) ?? null;
  }
  byId.set(tableId, float);
  return float;
}

/** A story's top-level floating tables: the out-of-flow table fragments of its own flow. */
function floatingTables(fragments: readonly BlockFragmentRecord[]): TableFragmentRecord[] {
  return fragments.filter(
    (fragment): fragment is TableFragmentRecord =>
      fragment.kind === 'table' && isOutOfFlowFragment(fragment)
  );
}

/** Whether a header or footer story holds a floating table that body text may wrap around. */
export function storyHasFloatingTable(story: {
  readonly fragments: readonly BlockFragmentRecord[];
}): boolean {
  return floatingTables(story.fragments).length > 0;
}

/**
 * The body zones of one placed story's floating tables, in the coordinates of `contentBox`.
 * Zones wholly above or below the content box are left out.
 */
export function furnitureTableZones(
  story: HeaderFooterStoryRecord,
  contentBox: LayoutBox
): ExclusionZone[] {
  const part = story.part;
  if (!part) return [];
  const zones: ExclusionZone[] = [];
  for (const table of floatingTables(story.fragments)) {
    const float = floatOf(part, table.tableId);
    if (!float) continue;
    const box = {
      ...table.box,
      x: story.box.x + table.box.x - contentBox.x,
      y: story.box.y + table.box.y - contentBox.y,
    };
    const placed = {
      ...table,
      box,
      floatingWrap: { anchorId: table.tableId, columnIndex: 0, float, sourceOrder: -1 },
    };
    const zone = addFloatingTableExclusions(
      [{ fragments: [placed] }],
      new Map(),
      { columnCount: 1, columnGapPt: 0, contentWidth: contentBox.width },
      false
    ).get(0)?.[0];
    if (
      !zone ||
      zone.verticalBand.y >= contentBox.height ||
      zone.verticalBand.y + zone.verticalBand.height <= 0
    )
      continue;
    zones.push(
      Object.freeze({
        ...zone,
        sourceKind: 'furniture',
        furnitureSource: Object.freeze({
          partName: story.partName,
          kind: 'table' as const,
          nodeId: table.tableId,
        }),
        drawingNodeId: table.tableId,
        // No body paragraph anchors it: the zone reaches every body line on the page.
        anchorParagraphId: '',
      })
    );
  }
  return zones;
}
