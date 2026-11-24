import { WML_NAMESPACE_URI, type OoxmlElement } from '../store/package/ooxml-tree.ts';
import { attributeValueOf } from '../store/store/tree-op-nodes.ts';
import { readTwipsMeasure } from '../store/units.ts';
import { wordBorderCss } from './clipboard-html-word-elements.ts';
import { tableSide } from './clipboard-table-direction.ts';
import { cssShading, wmlChild } from './clipboard-html-write-tree.ts';
import { tableLookOf } from '../layout/table-conditional-formats.ts';

function twipsAttribute(element: OoxmlElement | null, name: string): number | null {
  if (element === null) return null;
  return readTwipsMeasure(attributeValueOf(element, name, WML_NAMESPACE_URI));
}

/** A `w:tcPr`'s stated fill (null for no colour), or undefined when it states no shading. */
function statedShading(tcPr: OoxmlElement | null): string | null | undefined {
  return cssShading(wmlChild(tcPr, 'shd'));
}

function pointsFromTwips(value: number): string {
  return `${Math.round((value / 20) * 100) / 100}pt`;
}

/** One `w:tblStylePr` condition's formatting: the cell fill plus the run and
 *  paragraph properties, so a styled header row keeps its bold/white text in the
 *  copied HTML, not just its fill. */
export interface TableConditionalFormat {
  /** The condition's cell fill: null when it states no colour, undefined when it states none. */
  readonly fill: string | null | undefined;
  readonly rPr: OoxmlElement | null;
  readonly pPr: OoxmlElement | null;
}

const CONDITION_TYPES = [
  'wholeTable',
  'firstRow',
  'lastRow',
  'firstCol',
  'lastCol',
  'band1Horz',
  'band2Horz',
  'band1Vert',
  'band2Vert',
  'nwCell',
  'neCell',
  'swCell',
  'seCell',
] as const;
type ConditionType = (typeof CONDITION_TYPES)[number];

export interface TableConditionalFormats {
  readonly byType: ReadonlyMap<ConditionType, TableConditionalFormat>;
  /** The style's own whole-table `w:tcPr` fill, the derived style's over its base's. */
  readonly styleFill: string | null;
  readonly firstRowEnabled: boolean;
  readonly lastRowEnabled: boolean;
  readonly firstColumnEnabled: boolean;
  readonly lastColumnEnabled: boolean;
  readonly hBandingEnabled: boolean;
  readonly vBandingEnabled: boolean;
}

/**
 * The `w:tblStylePr` formatting a table style declares for the whole table, the
 * first row/column and the horizontal bands, gated by `w:tblLook` — Word's
 * conditional table formatting, so a styled built-in table does not copy as a
 * plain grid that loses its header's fill, bold and text color.
 */
export function tableConditionalFormats(
  chain: readonly OoxmlElement[],
  tblLook: OoxmlElement | null
): TableConditionalFormats {
  const byType = new Map<ConditionType, TableConditionalFormat>();
  const known = new Set<string>(CONDITION_TYPES);
  let styleFill: string | null = null;
  for (const style of chain) {
    const ownShading = statedShading(wmlChild(style, 'tcPr'));
    if (ownShading !== undefined) styleFill = ownShading;
    for (const child of style.children) {
      if (
        child.kind === 'textValue' ||
        child.localName !== 'tblStylePr' ||
        child.namespaceUri !== WML_NAMESPACE_URI
      ) {
        continue;
      }
      const type = attributeValueOf(child, 'type', WML_NAMESPACE_URI);
      if (type === undefined || !known.has(type)) continue;
      // Later chain entries (the derived style) override the base's condition.
      byType.set(type as ConditionType, {
        fill: statedShading(wmlChild(child, 'tcPr')),
        rPr: wmlChild(child, 'rPr'),
        pPr: wmlChild(child, 'pPr'),
      });
    }
  }
  // The same reading of `w:tblLook` (ECMA-376 Part 1 §17.4.55) the painter uses.
  const look = tableLookOf(tblLook);
  return {
    byType,
    styleFill,
    firstRowEnabled: look.firstRow,
    lastRowEnabled: look.lastRow,
    firstColumnEnabled: look.firstColumn,
    lastColumnEnabled: look.lastColumn,
    hBandingEnabled: look.rowBanding,
    vBandingEnabled: look.columnBanding,
  };
}

/** The strongest applicable condition for one cell, or null. §17.7.6.6 order,
 *  weakest to strongest: horizontal bands, vertical bands, firstCol, lastCol,
 *  firstRow, lastRow, corners — resolved strongest-first below. `wholeTable` is
 *  NOT resolved here; it layers under the result. */
export function conditionalCellFormat(
  formats: TableConditionalFormats,
  rowIndex: number,
  rowCount: number,
  firstGridColumn: boolean,
  lastGridColumn: boolean,
  gridColumn: number
): TableConditionalFormat | null {
  const firstRow = formats.firstRowEnabled && rowIndex === 0;
  // The header row format, where it covers the last row, takes it from the last row format.
  const lastRow = formats.lastRowEnabled && rowIndex === rowCount - 1 && !firstRow;
  const firstCol = formats.firstColumnEnabled && firstGridColumn;
  const lastCol = formats.lastColumnEnabled && lastGridColumn;
  const pick = (type: ConditionType): TableConditionalFormat | null =>
    formats.byType.get(type) ?? null;
  if (lastRow && firstCol && pick('swCell')) return pick('swCell');
  if (lastRow && lastCol && pick('seCell')) return pick('seCell');
  if (firstRow && firstCol && pick('nwCell')) return pick('nwCell');
  if (firstRow && lastCol && pick('neCell')) return pick('neCell');
  if (lastRow && pick('lastRow')) return pick('lastRow');
  if (firstRow && pick('firstRow')) return pick('firstRow');
  if (lastCol && pick('lastCol')) return pick('lastCol');
  if (firstCol && pick('firstCol')) return pick('firstCol');
  if (formats.vBandingEnabled) {
    const bandIndex = gridColumn - (formats.firstColumnEnabled ? 1 : 0);
    if (bandIndex >= 0) {
      const band = pick(bandIndex % 2 === 0 ? 'band1Vert' : 'band2Vert');
      if (band) return band;
    }
  }
  if (formats.hBandingEnabled) {
    // A header row without its own firstRow format is NOT part of the banding.
    const bandIndex = rowIndex - (formats.firstRowEnabled ? 1 : 0);
    if (bandIndex >= 0) {
      const band = pick(bandIndex % 2 === 0 ? 'band1Horz' : 'band2Horz');
      if (band) return band;
    }
  }
  return null;
}

export function wordTableCellCss(
  tcPr: OoxmlElement | null,
  tblBorders: OoxmlElement | null,
  rowIndex: number,
  rowCount: number,
  rowSpan: number,
  firstGridColumn: boolean,
  lastGridColumn: boolean,
  conditionalFill: string | null,
  rtl = false,
  tableMargins: readonly OoxmlElement[] = []
): string {
  const rules: string[] = [];
  const tcBorders = wmlChild(tcPr, 'tcBorders');
  const tableEdges = {
    top: rowIndex === 0 ? 'top' : 'insideH',
    bottom: rowIndex + rowSpan >= rowCount ? 'bottom' : 'insideH',
    left: firstGridColumn ? 'left' : 'insideV',
    right: lastGridColumn ? 'right' : 'insideV',
  } as const;
  for (const edge of ['top', 'left', 'bottom', 'right'] as const) {
    // An explicit cell `nil`/`none` SUPPRESSES the edge; only an absent cell border
    // falls back to the table grid.
    const relative = edge === 'left' ? 'start' : edge === 'right' ? 'end' : edge;
    const cellEdge = wmlChild(tcBorders, edge) ?? wmlChild(tcBorders, relative);
    const tableEdge = tableEdges[edge];
    const tableRelative =
      tableEdge === 'left' ? 'start' : tableEdge === 'right' ? 'end' : tableEdge;
    const border =
      cellEdge !== null
        ? wordBorderCss(cellEdge)
        : wordBorderCss(wmlChild(tblBorders, tableEdge) ?? wmlChild(tblBorders, tableRelative));
    if (border) rules.push(`border-${tableSide(edge, rtl)}:${border}`);
  }
  // A cell's own `w:shd` wins even with an `auto` fill, which paints no colour; `nil` states none.
  const own = statedShading(tcPr);
  const fill = own !== undefined ? own : conditionalFill;
  if (fill) rules.push(`background-color:${fill}`);
  const vAlignNode = wmlChild(tcPr, 'vAlign');
  const vAlign =
    vAlignNode === null ? undefined : attributeValueOf(vAlignNode, 'val', WML_NAMESPACE_URI);
  if (vAlign === 'center') rules.push('vertical-align:middle');
  else if (vAlign === 'bottom' || vAlign === 'top') rules.push(`vertical-align:${vAlign}`);
  const tcW = wmlChild(tcPr, 'tcW');
  const width = twipsAttribute(tcW, 'w');
  const widthType = tcW === null ? undefined : attributeValueOf(tcW, 'type', WML_NAMESPACE_URI);
  if (width !== null && width > 0 && (widthType === undefined || widthType === 'dxa')) {
    rules.push(`width:${pointsFromTwips(width)}`);
  }
  const margins = wmlChild(tcPr, 'tcMar');
  for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
    const relative = edge === 'left' ? 'start' : edge === 'right' ? 'end' : edge;
    const margin =
      wmlChild(margins, edge) ??
      wmlChild(margins, relative) ??
      tableMargins
        .map((container) => wmlChild(container, edge) ?? wmlChild(container, relative))
        .find((value) => value !== null) ??
      null;
    const value = twipsAttribute(margin, 'w');
    const type = margin === null ? undefined : attributeValueOf(margin, 'type', WML_NAMESPACE_URI);
    if (value !== null && value >= 0 && (type === undefined || type === 'dxa')) {
      rules.push(`padding-${tableSide(edge, rtl)}:${pointsFromTwips(value)}`);
    }
  }
  return rules.join(';');
}
