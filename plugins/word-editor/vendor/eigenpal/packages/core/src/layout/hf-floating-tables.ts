// Floating (`w:tblpPr`) tables at the top level of a header or footer story.
//
// Such a table sits at its anchor position, outside the story's text flow: the blocks after
// it start where the table would have started, and wrap around it as they do around a
// floating body table. A narrow table at a `w:tblpX`/`w:tblpY` page position sits beside
// the header text, and the paragraph after it stays at the top of the header. A table as wide as the story moves the blocks after it below it, so the
// story, and the body under a header, grows with it.
//
// Only the top-level table floats. A table inside a cell keeps its `w:tblpPr` ignored, as in
// the body (see `readTableStructure`).

import { WML_NAMESPACE_URI, type OoxmlElement } from '../store/package/ooxml-tree.ts';
import type { ExclusionZone } from './drawing-exclusion.ts';
import type { BlockFragmentRecord, TableFragmentRecord } from './semantic-records.ts';
import type { TableAnchorFrames } from './semantic-table.ts';
import { addFloatingTableExclusions } from './table-float-exclusion.ts';
import { tableFloatOriginY, type TableVerticalAnchorFrames } from './table-float-position.ts';
import { readTableFloatPosition, type TableFloatPosition } from './table-float-properties.ts';
import { tableFloatOriginX } from './table-origin.ts';

export interface FloatingStoryTable {
  readonly table: OoxmlElement;
  readonly float: TableFloatPosition;
  /** The next block that stays in flow, which a `text` anchor measures from. */
  readonly nextBlockId: string | null;
}

/** The story geometry a floating table resolves its anchors against, in story coordinates. */
export interface FloatingStoryTableFrames {
  readonly contentWidth: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly marginLeft: number;
  readonly marginTop: number;
  readonly marginBottom: number;
  /** Page y of the story's top edge. */
  readonly storyTop: number;
}

function tableProperties(table: OoxmlElement): OoxmlElement | undefined {
  for (const child of table.children) {
    if (
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === 'tblPr'
    )
      return child;
  }
  return undefined;
}

/** Split the story's top-level floating tables from the blocks that flow. */
export function splitFloatingStoryTables(blocks: readonly OoxmlElement[]): {
  readonly flowBlocks: readonly OoxmlElement[];
  readonly floating: readonly FloatingStoryTable[];
} {
  const floatOf = (block: OoxmlElement) =>
    block.kind === 'table' ? readTableFloatPosition(tableProperties(block)) : undefined;
  const floating: FloatingStoryTable[] = [];
  const flowBlocks: OoxmlElement[] = [];
  blocks.forEach((block, index) => {
    const float = floatOf(block);
    if (!float) {
      flowBlocks.push(block);
      return;
    }
    const next = blocks.slice(index + 1).find((candidate) => !floatOf(candidate));
    floating.push({ table: block, float, nextBlockId: next?.id ?? null });
  });
  if (floating.length === 0) return { flowBlocks: blocks, floating };
  return { flowBlocks, floating };
}

function fragmentBlockId(fragment: BlockFragmentRecord): string | undefined {
  if (fragment.kind === 'table') return fragment.tableId;
  if (fragment.kind === 'paragraph') return fragment.paragraphId;
  return undefined;
}

/** Placed floating tables and the zones that later story blocks wrap around. */
export interface PlacedFloatingStoryTables {
  /** The table fragments, out of flow, in story coordinates. */
  readonly tables: readonly BlockFragmentRecord[];
  readonly zones: readonly ExclusionZone[];
  /** Whether a table is framed by the page or a margin, so it keeps its page position. */
  readonly pageFramed: boolean;
  /** The whole bands of the page- and margin-framed tables, not cut at their anchors. */
  readonly pageFramedZones: readonly ExclusionZone[];
}

/**
 * The exclusion zone of one placed table. Blocks after the table wrap around it: beside it
 * when it leaves room, below it when it spans the story. A table raised above the block it
 * anchors to never moves the blocks before it, so the zone starts at that block's top.
 */
function storyTableZone(
  table: TableFragmentRecord,
  entry: FloatingStoryTable,
  sourceOrder: number,
  anchorTop: number,
  contentWidth: number
): ExclusionZone | undefined {
  // The zone names the table, not the paragraph it anchors to: that paragraph wraps beside
  // the table like any later one, from its first line.
  const anchorId = `table:${table.tableId}`;
  const zone = addFloatingTableExclusions(
    [
      {
        fragments: [
          { ...table, floatingWrap: { anchorId, columnIndex: 0, float: entry.float, sourceOrder } },
        ],
      },
    ],
    new Map(),
    { columnCount: 1, columnGapPt: 0, contentWidth },
    false
  ).get(0)?.[0];
  if (!zone || zone.verticalBand.y >= anchorTop) return zone;
  const bottom = zone.verticalBand.y + zone.verticalBand.height;
  const bounds = zone.input.contentBounds;
  if (bottom <= anchorTop) return undefined;
  const top = Math.max(bounds.y, anchorTop);
  return {
    ...zone,
    y: Math.max(zone.y, anchorTop),
    verticalBand: { ...zone.verticalBand, y: anchorTop, height: bottom - anchorTop },
    input: {
      ...zone.input,
      contentBounds: { ...bounds, y: top, height: Math.max(0, bounds.y + bounds.height - top) },
      wrapDistances: { ...zone.input.wrapDistances, top: 0 },
    },
  };
}

/**
 * Place each floating table at its anchor position. `layoutAlone` lays one table out on its
 * own with its container's left edge at `left` and its top at `top`. The first call measures
 * it; the second, with `placed`, places it and may publish the drawings inside it.
 *
 * `anchorFragments` and `anchorBottom` are the story flow before any table zone applies: a
 * `text` anchor measures from where the table stood in that flow, so wrapping later blocks
 * around the table never moves the table itself. With `wrap`, each table returns a zone.
 */
export function placeFloatingStoryTables(
  anchorFragments: readonly BlockFragmentRecord[],
  anchorBottom: number,
  floating: readonly FloatingStoryTable[],
  frames: FloatingStoryTableFrames,
  wrap: boolean,
  layoutAlone: (
    table: OoxmlElement,
    left: number,
    top: number,
    placed: boolean
  ) => readonly BlockFragmentRecord[]
): PlacedFloatingStoryTables {
  const tables: BlockFragmentRecord[] = [];
  const zones: ExclusionZone[] = [];
  const pageFramedZones: ExclusionZone[] = [];
  let pageFramed = false;
  const horizontal: TableAnchorFrames = {
    text: { left: 0, width: frames.contentWidth },
    margin: { left: 0, width: frames.contentWidth },
    page: { left: -frames.marginLeft, width: frames.pageWidth },
  };
  for (const [index, entry] of floating.entries()) {
    const measured = layoutAlone(entry.table, 0, 0, false).find(
      (candidate): candidate is TableFragmentRecord => candidate.kind === 'table'
    );
    if (!measured) continue;
    const next = anchorFragments.find(
      (candidate) => fragmentBlockId(candidate) === entry.nextBlockId
    );
    const textTop = next ? next.box.y : anchorBottom;
    const vertical: TableVerticalAnchorFrames = {
      text: { top: textTop, height: Math.max(0, frames.pageHeight - frames.storyTop - textTop) },
      margin: {
        top: frames.marginTop - frames.storyTop,
        height: Math.max(0, frames.pageHeight - frames.marginTop - frames.marginBottom),
      },
      page: { top: -frames.storyTop, height: frames.pageHeight },
    };
    const x = tableFloatOriginX(entry.float, measured.box.width, horizontal);
    const framed = entry.float.vertAnchor !== 'text';
    pageFramed ||= framed;
    // A page- or margin-framed table never passes the sheet's bottom edge: it moves up onto it.
    const y = Math.min(
      tableFloatOriginY(entry.float, measured.box.height, vertical),
      framed ? frames.pageHeight - frames.storyTop - measured.box.height : Number.POSITIVE_INFINITY
    );
    // The alone layout already offset the table by its own indent or alignment.
    for (const fragment of layoutAlone(entry.table, x - measured.box.x, y, true)) {
      tables.push({ ...fragment, outOfFlow: true } as BlockFragmentRecord);
      if (!wrap || fragment.kind !== 'table' || fragment.tableId !== entry.table.id) continue;
      const zone = storyTableZone(fragment, entry, index, textTop, frames.contentWidth);
      if (zone) zones.push(zone);
      // The whole band, before the cut at the anchor: a lift above the table clears all of it.
      const whole = framed
        ? storyTableZone(fragment, entry, index, Number.NEGATIVE_INFINITY, frames.contentWidth)
        : undefined;
      if (whole) pageFramedZones.push(whole);
    }
  }
  return { tables, zones, pageFramed, pageFramedZones };
}

/**
 * How far a footer story rises above its natural top so that its text clears a page-framed
 * table that spans the story. The text then ends where the table starts. It rises when the
 * table reaches past the footer's bottom edge, or when the text moved below the table would
 * end past `pageBottom`, the sheet's bottom edge in story coordinates. Otherwise the text
 * after the table moves below it. `naturalHeight` is the footer's height before wrapping.
 * A `pageBottom` of negative infinity lifts the text above every table it meets, a narrow
 * one included: the last resort that keeps it on the sheet.
 */
export function footerLiftAboveTables(
  tables: PlacedFloatingStoryTables,
  naturalHeight: number,
  pageBottom: number
): number {
  let lift = 0;
  const forced = pageBottom === Number.NEGATIVE_INFINITY;
  for (const zone of tables.pageFramedZones) {
    if (!forced && zone.input.mode !== 'topAndBottom') continue;
    const top = zone.verticalBand.y;
    const bottom = top + zone.verticalBand.height;
    if (top >= naturalHeight || bottom <= 0) continue;
    // Only the text the table meets moves below it; the lines above its top stay.
    if (bottom > naturalHeight || bottom + naturalHeight - Math.max(0, top) > pageBottom)
      lift = Math.max(lift, naturalHeight - top);
  }
  return lift;
}
