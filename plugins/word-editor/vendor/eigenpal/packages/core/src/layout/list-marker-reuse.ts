// Reusing layout across a renumbering edit.
//
// Inserting a list item renumbers every later item of the list. When each new number is as
// wide as the old one ("[0003]" for "[0002]"), nothing a line break or a placement reads has
// moved: the marker occupies the same slot and the first line starts at the same place. Only
// the label differs. Keying those blocks on the marker TEXT made every later item a changed
// block, so a single Enter near the top of a long numbered list laid the rest of the list out
// again.
//
// For the editor's body lists, the layout keys therefore read the marker's measured GEOMETRY
// instead of its text, and the published records get their labels from the current list
// items afterwards. A number whose width moves still changes the key and is laid out again.

import { carryPageOrder } from './document-order.ts';
import { framedTokenJoin } from './framed-token.ts';
import { rtlListMarkerPieces } from './list-marker-bidi.ts';
import { listMarkerAscent, listMarkerWidth } from './list-marker-geometry.ts';
import { carryPageLines } from './paragraph-lines.ts';
import { carryPagePlacedIds } from './paragraph-range-rects.ts';
import { carryPageTableContributions } from './table-caret-context.ts';
import type { ResolvedListItem } from './list-resolve.ts';
import type {
  BlockFragmentRecord,
  ListMarkerRecord,
  PageRecord,
  SemanticLayout,
  TextMeasurer,
  TableFragmentRecord,
} from './semantic-records.ts';

/** Each item's `cacheToken` without its marker text; recorded where the token is built. */
const shapeTokens = new WeakMap<ResolvedListItem, string>();

/** Record the parts of `item`'s cache token that are not the marker text. */
export function rememberListItemShape(item: ResolvedListItem, shapeToken: string): void {
  shapeTokens.set(item, shapeToken);
}

const geometryTokens = new WeakMap<
  ResolvedListItem,
  { readonly measurer: TextMeasurer; readonly token: string }
>();

/**
 * Key every item of `listItems` on its marker geometry under `measurer`.
 *
 * Called once per layout pass, before anything reads {@link listLayoutToken}, so a token
 * always describes the measurer of the pass that reads it. A picture marker keeps its text
 * token: its slot comes from the image, and nothing here relabels one.
 */
export function registerListGeometry(
  listItems: ReadonlyMap<string, ResolvedListItem> | undefined,
  measurer: TextMeasurer | undefined
): void {
  if (!listItems || !measurer) return;
  for (const item of listItems.values()) {
    if (item.picBullet || geometryTokens.get(item)?.measurer === measurer) continue;
    const shape = shapeTokens.get(item);
    if (shape === undefined) continue;
    const ascent = listMarkerAscent(item, measurer);
    const width = listMarkerWidth(item, measurer);
    geometryTokens.set(item, {
      measurer,
      token: framedTokenJoin(['geometry', shape, String(width), String(ascent)]),
    });
  }
}

/** The token layout keys read for `item`: its geometry when registered, else `cacheToken`. */
export function listLayoutToken(item: ResolvedListItem): string {
  return geometryTokens.get(item)?.token ?? item.cacheToken;
}

/** The marker part of a block's flow key: its {@link listLayoutToken}, or none. */
export function markerFlowToken(item: ResolvedListItem | undefined): string | undefined {
  return item && listLayoutToken(item);
}

/** {@link listLayoutToken}, or `''` for a paragraph with no list item. */
export function listItemToken(item: ResolvedListItem | undefined): string {
  return item ? listLayoutToken(item) : '';
}

function relabeledMarker(
  marker: ListMarkerRecord,
  item: ResolvedListItem,
  measurer: TextMeasurer
): ListMarkerRecord {
  if (marker.picture || (marker.text === item.markerText && marker.ordinal === item.ordinal)) {
    return marker;
  }
  const { ordinal: _ordinal, pieces, ...rest } = marker;
  const nextPieces = pieces
    ? rtlListMarkerPieces(item.markerText, item.markerStyle, marker.box, measurer)
    : undefined;
  return {
    ...rest,
    text: item.markerText,
    ...(item.ordinal === undefined ? {} : { ordinal: item.ordinal }),
    ...(nextPieces ? { pieces: nextPieces } : {}),
  };
}

const tablesWithoutMarkers = new WeakSet<TableFragmentRecord>();

/** The caller proves no paragraph at any depth publishes a list marker. */
export function markTableWithoutListMarkers(table: TableFragmentRecord): void {
  tablesWithoutMarkers.add(table);
}

function relabeledBlocks(
  blocks: readonly BlockFragmentRecord[],
  listItems: ReadonlyMap<string, ResolvedListItem>,
  measurer: TextMeasurer
): readonly BlockFragmentRecord[] {
  let next: BlockFragmentRecord[] | null = null;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    let replaced: BlockFragmentRecord = block;
    if (block.kind === 'paragraph') {
      const item = block.marker ? listItems.get(block.paragraphId) : undefined;
      const marker = item && block.marker ? relabeledMarker(block.marker, item, measurer) : null;
      if (marker && marker !== block.marker) replaced = { ...block, marker };
    } else if (!tablesWithoutMarkers.has(block)) {
      let rows: (typeof block.rows)[number][] | null = null;
      for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex += 1) {
        const row = block.rows[rowIndex]!;
        let cells: (typeof row.cells)[number][] | null = null;
        for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex += 1) {
          const cell = row.cells[cellIndex]!;
          const cellBlocks = relabeledBlocks(cell.blocks, listItems, measurer);
          if (cellBlocks === cell.blocks) continue;
          cells ??= [...row.cells];
          cells[cellIndex] = { ...cell, blocks: cellBlocks };
        }
        if (!cells) continue;
        rows ??= [...block.rows];
        rows[rowIndex] = { ...row, cells };
      }
      if (rows) replaced = { ...block, rows };
    }
    if (replaced === block) continue;
    next ??= [...blocks];
    next[index] = replaced;
  }
  return next ?? blocks;
}

/**
 * Per list item map, then per page object: the page relabelled against that map. Both keys
 * are weak, so a map a later pass replaced is collected with its items — a page entry that
 * held its map strongly kept one superseded map alive per page.
 */
const relabeledPages = new WeakMap<
  ReadonlyMap<string, ResolvedListItem>,
  WeakMap<PageRecord, PageRecord>
>();

/**
 * `layout` with every body list marker labelled from `listItems`.
 *
 * Returns `layout` itself when no label moved. A page that needs no change keeps its identity,
 * and a page already checked against the same list items is not walked again, so an edit that
 * renumbers nothing costs one lookup per page.
 */
export function relabelListMarkers(
  layout: SemanticLayout,
  listItems: ReadonlyMap<string, ResolvedListItem> | undefined,
  measurer: TextMeasurer | undefined
): SemanticLayout {
  if (!listItems || listItems.size === 0 || !measurer) return layout;
  let checked = relabeledPages.get(listItems);
  if (!checked) relabeledPages.set(listItems, (checked = new WeakMap()));
  let pages: PageRecord[] | null = null;
  for (let index = 0; index < layout.pages.length; index += 1) {
    const page = layout.pages[index]!;
    let next = checked.get(page);
    if (next === undefined) {
      const fragments = relabeledBlocks(page.fragments, listItems, measurer);
      next = fragments === page.fragments ? page : { ...page, fragments };
      checked.set(page, next);
      if (next !== page) {
        checked.set(next, next);
        // Lines, boxes, and ids are the same objects. A caret read, an order walk, or a
        // table lookup on the relabelled page reuses what the old page already answered.
        carryPageLines(page, next);
        carryPageOrder(page, next);
        carryPagePlacedIds(page, next);
        carryPageTableContributions(page, next);
      }
    }
    if (next === page) continue;
    pages ??= [...layout.pages];
    pages[index] = next;
  }
  return pages ? { ...layout, pages } : layout;
}
