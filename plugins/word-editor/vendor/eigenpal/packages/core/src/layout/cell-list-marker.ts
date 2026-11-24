// The list marker of a paragraph inside a table cell takes the table style's run formatting.
import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core/store';
import type { ResolvedListItem } from './list-resolve.ts';
import { markerMeasureToken } from './list-marker-measure-key.ts';
import { bulletMarkerStyle } from './marker-symbol-face.ts';
import { resolveRunStyle, runStylesEqual } from './run-style.ts';
import {
  cascadeParagraphFormatting,
  cascadeRunProperties,
  type StyleCascadeTable,
  type TableCellStyleFormatting,
} from './style-cascade.ts';

interface MarkerSource {
  /** The level's own `w:rPr` (17.9.6). */
  readonly level: readonly OoxmlProperty[];
  /** The marker text before symbol mapping, which picks a bullet's face. */
  readonly markerText: string;
}

/** What a resolved item's marker was built from; the item type is public, so a side channel. */
const markerSources = new WeakMap<ResolvedListItem, MarkerSource>();

/** Record the numbering level run properties and raw marker text of a resolved item. */
export function withListMarkerSource(item: ResolvedListItem, source: MarkerSource): void {
  markerSources.set(item, source);
}

const cellItems = new WeakMap<
  ResolvedListItem,
  WeakMap<TableCellStyleFormatting, ResolvedListItem>
>();

/**
 * The list item a cell paragraph's marker is measured and painted with.
 *
 * The marker takes the paragraph mark's run formatting, then the level's `w:rPr` (17.9.6).
 * In a table cell the mark's formatting includes the table style's run properties (17.7.6),
 * as the cell's text does, so a table style size or color reaches the marker. The level's
 * own properties and the paragraph style still win over the table style. Returns `item`
 * itself when the table style changes nothing, or for a picture marker.
 */
export function cellListItem(
  item: ResolvedListItem | undefined,
  paragraph: OoxmlElement,
  styleCascade: StyleCascadeTable | undefined,
  cellStyle: TableCellStyleFormatting | undefined
): ResolvedListItem | undefined {
  if (!item || !styleCascade || !cellStyle || item.picBullet) return item;
  if (cellStyle.runProperties.length === 0 && !cellStyle.statesTypography) return item;
  const source = markerSources.get(item);
  if (!source) return item;
  let byStyle = cellItems.get(item);
  const cached = byStyle?.get(cellStyle);
  if (cached) return cached;
  const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties');
  // The number takes the mark's formatting except its underline, as outside a table.
  const mark = cascadeParagraphFormatting(styleCascade, pPr, cellStyle).markRunProperties.filter(
    (property) => property.localName !== 'u'
  );
  const resolved = {
    ...resolveRunStyle(
      cascadeRunProperties(mark, source.level, styleCascade),
      styleCascade.themeFonts
    ),
    smallCaps: false,
  };
  const markerStyle =
    item.numFmt === 'bullet' ? bulletMarkerStyle(resolved, source.markerText) : resolved;
  const result = runStylesEqual(markerStyle, item.markerStyle)
    ? item
    : { ...item, markerStyle, cacheToken: `${item.cacheToken}|${markerMeasureToken(markerStyle)}` };
  if (!byStyle) cellItems.set(item, (byStyle = new WeakMap()));
  byStyle.set(cellStyle, result);
  return result;
}
