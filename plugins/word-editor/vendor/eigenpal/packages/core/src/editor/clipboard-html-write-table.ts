// The interop-HTML table renderer — split from clipboard-html-write.ts at the
// max-lines cap. The block renderer and field-state advance are injected, so the
// runtime dependency stays one-way.

import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
} from '../store/package/ooxml-tree.ts';
import {
  attrOf,
  escapeAttr,
  isElement,
  parseIntValue,
  parseTwipsValue,
  ptFromTwips,
  wmlChild,
  wmlVal,
} from './clipboard-html-write-tree.ts';
import { tableSide } from './clipboard-table-direction.ts';
import { styleChain, toggleOn } from './clipboard-html-write-cascade.ts';
import {
  conditionalCellFormat,
  tableConditionalFormats,
  wordTableCellCss,
} from './clipboard-html-write-table-styles.ts';
import { wordBorderCss, wordTableRowCss } from './clipboard-html-word-elements.ts';
import type { FieldState, RenderContext } from './clipboard-html-write.ts';

export interface TableRenderDeps {
  readonly renderBlocks: (
    ctx: RenderContext,
    children: readonly OoxmlNode[],
    sharedFields?: FieldState
  ) => string;
  readonly advanceFieldState: (node: OoxmlElement, fields: FieldState) => void;
}

interface CellPlacement {
  readonly cell: OoxmlElement;
  readonly startColumn: number;
  readonly span: number;
  readonly vMerge: 'restart' | 'continue' | null;
}

/** A typed cell, or a `w:tc` the canonical tree demoted to generic — both occupy a column. */
function isRowCell(child: OoxmlElement): boolean {
  if (child.kind === 'tableCell') return true;
  return child.localName === 'tc' && child.namespaceUri === WML_NAMESPACE_URI;
}

/** A `w:customXml` wrapper — legal around rows and cells per EG_ContentRowContent
 *  and EG_ContentCellContent; the canonical tree types it generic. */
function isCustomXmlWrapper(child: OoxmlElement): boolean {
  return child.localName === 'customXml' && child.namespaceUri === WML_NAMESPACE_URI;
}

/** One row entry in DOCUMENT ORDER: a placed cell, or a child the render skips.
 *  Skips still advance the shared field state — fldChar transitions are not
 *  commutative, so the advance must happen exactly where the balance probe saw
 *  the node, not before or after the row's cells. */
type RowItem = { readonly placement: CellPlacement } | { readonly skip: OoxmlElement };

interface TableRows {
  readonly rows: OoxmlElement[];
  readonly tableItems: Array<{ readonly row: number } | { readonly skip: OoxmlElement }>;
}

function tableRowsOf(table: OoxmlElement): TableRows {
  const rows: OoxmlElement[] = [];
  const tableItems: Array<{ readonly row: number } | { readonly skip: OoxmlElement }> = [];
  const collect = (children: readonly OoxmlNode[]): void => {
    for (const child of children) {
      if (!isElement(child)) continue;
      if (
        child.kind === 'tableRow' ||
        (child.localName === 'tr' && child.namespaceUri === WML_NAMESPACE_URI)
      ) {
        tableItems.push({ row: rows.length });
        rows.push(child);
        continue;
      }
      if (child.kind === 'contentControl') {
        const content = child.children.find((inner) => inner.kind === 'contentControlContent');
        if (content && isElement(content)) collect(content.children);
        continue;
      }
      if (isCustomXmlWrapper(child)) {
        collect(child.children);
        continue;
      }
      tableItems.push({ skip: child });
    }
  };
  collect(table.children);
  return { rows, tableItems };
}

/** Placements (for vMerge lookahead) plus the per-row document-order item list.
 *  SDT- and customXml-wrapped cells unwrap in place. */
function cellPlacementsOf(rows: readonly OoxmlElement[]): {
  placements: CellPlacement[][];
  items: RowItem[][];
} {
  const placements: CellPlacement[][] = [];
  const items: RowItem[][] = [];
  // A continuation only continues a cell above it that carries `w:vMerge`. Otherwise it
  // starts its own merge, so its content is copied instead of dropped.
  let mergedAbove = new Set<number>();
  for (const row of rows) {
    const mergedHere = new Set<number>();
    const rowPlacements: CellPlacement[] = [];
    const rowItems: RowItem[] = [];
    let column = 0;
    const collect = (children: readonly OoxmlNode[]): void => {
      for (const child of children) {
        if (!isElement(child)) continue;
        if (isRowCell(child)) {
          const tcPr = wmlChild(child, 'tcPr');
          const span = Math.min(
            Math.max(parseIntValue(wmlVal(wmlChild(tcPr, 'gridSpan'))) ?? 1, 1),
            63
          );
          const vMergeNode = wmlChild(tcPr, 'vMerge');
          const marked =
            vMergeNode === null ? null : wmlVal(vMergeNode) === 'restart' ? 'restart' : 'continue';
          // Keyed like the rowspan lookahead below, so the two agree on every chain.
          const vMerge = marked === 'continue' && !mergedAbove.has(column) ? 'restart' : marked;
          if (marked !== null) mergedHere.add(column);
          const placement: CellPlacement = { cell: child, startColumn: column, span, vMerge };
          rowPlacements.push(placement);
          rowItems.push({ placement });
          column += span;
          continue;
        }
        if (child.kind === 'contentControl') {
          const content = child.children.find((inner) => inner.kind === 'contentControlContent');
          if (content && isElement(content)) collect(content.children);
          continue;
        }
        if (isCustomXmlWrapper(child)) {
          collect(child.children);
          continue;
        }
        rowItems.push({ skip: child });
      }
    };
    collect(row.children);
    mergedAbove = mergedHere;
    placements.push(rowPlacements);
    items.push(rowItems);
  }
  return { placements, items };
}

function gridColumnCount(placements: readonly (readonly CellPlacement[])[]): number {
  let count = 1;
  for (const rowCells of placements) {
    for (const placement of rowCells) {
      count = Math.max(count, placement.startColumn + placement.span);
    }
  }
  return count;
}

function cellContextsOf(
  ctx: RenderContext,
  conditionalFormats: ReturnType<typeof tableConditionalFormats>,
  placements: readonly (readonly CellPlacement[])[],
  gridColumns: number
): ReadonlyMap<OoxmlElement, RenderContext> {
  const contexts = new Map<OoxmlElement, RenderContext>();
  const wholeTable = conditionalFormats.byType.get('wholeTable') ?? null;
  for (let rowIndex = 0; rowIndex < placements.length; rowIndex += 1) {
    for (const placement of placements[rowIndex] ?? []) {
      if (placement.vMerge === 'continue') continue;
      const conditional = conditionalCellFormat(
        conditionalFormats,
        rowIndex,
        placements.length,
        placement.startColumn === 0,
        placement.startColumn + placement.span >= gridColumns,
        placement.startColumn
      );
      const tableRPr: OoxmlElement[] = [];
      const tablePPr: OoxmlElement[] = [];
      if (wholeTable?.rPr) tableRPr.push(wholeTable.rPr);
      if (wholeTable?.pPr) tablePPr.push(wholeTable.pPr);
      if (conditional?.rPr) tableRPr.push(conditional.rPr);
      if (conditional?.pPr) tablePPr.push(conditional.pPr);
      contexts.set(
        placement.cell,
        tableRPr.length > 0 || tablePPr.length > 0 ? { ...ctx, tableRPr, tablePPr } : ctx
      );
    }
  }
  return contexts;
}

function resolvedTableStyleChain(
  ctx: RenderContext,
  properties: OoxmlElement | null
): OoxmlElement[] {
  const named = styleChain(ctx.styles, wmlVal(wmlChild(properties, 'tblStyle')), 'table');
  return named.length > 0
    ? named
    : styleChain(ctx.styles, ctx.styles.defaultTableStyleId ?? undefined, 'table');
}

/** Per-cell contexts for the cells that the table renderer emits. */
export function renderedTableCellContexts(
  ctx: RenderContext,
  table: OoxmlElement
): ReadonlyMap<OoxmlElement, RenderContext> {
  const tblPr = table.children.find((child) => child.kind === 'tableProperties');
  const ownTblPr = tblPr && isElement(tblPr) ? tblPr : null;
  const chain = resolvedTableStyleChain(ctx, ownTblPr);
  const conditionalFormats = tableConditionalFormats(chain, wmlChild(ownTblPr, 'tblLook'));
  const { rows } = tableRowsOf(table);
  const { placements } = cellPlacementsOf(rows);
  return cellContextsOf(ctx, conditionalFormats, placements, gridColumnCount(placements));
}

export function renderHtmlTable(
  ctx: RenderContext,
  table: OoxmlElement,
  fields: FieldState,
  deps: TableRenderDeps
): string {
  const tblPr = table.children.find((child) => child.kind === 'tableProperties');
  const ownTblPr = tblPr && isElement(tblPr) ? tblPr : null;
  let tblBorders: OoxmlElement | null = null;
  const tableStyleChain = resolvedTableStyleChain(ctx, ownTblPr);
  for (const style of tableStyleChain) {
    const styleBorders = wmlChild(wmlChild(style, 'tblPr'), 'tblBorders');
    if (styleBorders) tblBorders = styleBorders;
  }
  const propertySources = tableStyleChain
    .map((style) => wmlChild(style, 'tblPr'))
    .filter((node): node is OoxmlElement => node !== null);
  if (ownTblPr) propertySources.push(ownTblPr);
  const rtl = toggleOn(propertySources, 'bidiVisual');
  const tableMargins: OoxmlElement[] = [];
  let tableJc: string | undefined;
  for (const source of propertySources) {
    const margins = wmlChild(source, 'tblCellMar');
    if (margins) tableMargins.unshift(margins);
    tableJc = wmlVal(wmlChild(source, 'jc')) ?? tableJc;
  }
  const ownBorders = wmlChild(ownTblPr, 'tblBorders');
  if (ownBorders) tblBorders = ownBorders;
  const conditionalFormats = tableConditionalFormats(
    tableStyleChain,
    wmlChild(ownTblPr, 'tblLook')
  );

  // A typed row, or a `w:tr` demoted to generic, or a row inside a row-level SDT
  // or `w:customXml` wrapper. The item list keeps DOCUMENT ORDER so skipped
  // children advance the shared field state exactly where the probe saw them.
  const { rows, tableItems } = tableRowsOf(table);
  const { placements, items: itemsByRow } = cellPlacementsOf(rows);
  const gridColumns = gridColumnCount(placements);
  const cellContexts = cellContextsOf(ctx, conditionalFormats, placements, gridColumns);

  const tableRules = ['border-collapse:collapse'];
  const tableWidth = wmlChild(ownTblPr, 'tblW');
  const width = parseTwipsValue(attrOf(tableWidth, 'w', WML_NAMESPACE_URI));
  if (width !== null && width > 0 && attrOf(tableWidth, 'type', WML_NAMESPACE_URI) === 'dxa') {
    tableRules.push(`width:${ptFromTwips(width)}`);
  }
  const alignment = tableSide(
    tableJc === 'right' || tableJc === 'end' ? 'right' : tableJc === 'center' ? 'center' : 'left',
    rtl
  );
  if (alignment === 'center') tableRules.push('margin-left:auto', 'margin-right:auto');
  else if (alignment === 'right') tableRules.push('margin-left:auto', 'margin-right:0');
  else tableRules.push('margin-left:0', 'margin-right:auto');
  for (const [xmlName, cssName] of [
    ['insideH', 'insideh'],
    ['insideV', 'insidev'],
  ] as const) {
    const border = wordBorderCss(wmlChild(tblBorders, xmlName));
    if (border) tableRules.push(`mso-border-${cssName}-alt:${border}`);
  }
  // Outer-vs-inside edges classify by GRID COLUMN, not placement index: a ragged
  // short row's last cell sits mid-grid and must take the inside border.
  let out = `<table dir="${rtl ? 'rtl' : 'ltr'}" align="${alignment}" style="${tableRules.join(';')}">`;
  for (const item of tableItems) {
    if ('skip' in item) {
      // Skipped table children never render, but their fldChars still drive the
      // state, in document order — the same order the balance probe walked.
      deps.advanceFieldState(item.skip, fields);
      continue;
    }
    const rowIndex = item.row;
    const height = wmlChild(wmlChild(rows[rowIndex] ?? null, 'trPr'), 'trHeight');
    const heightValue = parseTwipsValue(attrOf(height, 'val', WML_NAMESPACE_URI));
    const rowCss = wordTableRowCss(heightValue, attrOf(height, 'hRule', WML_NAMESPACE_URI));
    const rowStyle = rowCss === '' ? '' : ` style="${rowCss}"`;
    out += `<tr${rowStyle}>`;
    for (const rowItem of itemsByRow[rowIndex] ?? []) {
      if ('skip' in rowItem) {
        deps.advanceFieldState(rowItem.skip, fields);
        continue;
      }
      const placement = rowItem.placement;
      if (placement.vMerge === 'continue') {
        // The continuation cell renders nothing, but its fldChars still drive the
        // shared field state — the same rule as tracked deletions.
        deps.advanceFieldState(placement.cell, fields);
        continue;
      }
      let rowSpan = 1;
      if (placement.vMerge === 'restart') {
        for (let below = rowIndex + 1; below < placements.length; below += 1) {
          const continuation = placements[below]!.find(
            (candidate) =>
              candidate.startColumn === placement.startColumn && candidate.vMerge === 'continue'
          );
          if (!continuation) break;
          rowSpan += 1;
        }
      }
      const tcPr = wmlChild(placement.cell, 'tcPr');
      const lastGridColumn = placement.startColumn + placement.span >= gridColumns;
      const conditional = conditionalCellFormat(
        conditionalFormats,
        rowIndex,
        placements.length,
        placement.startColumn === 0,
        lastGridColumn,
        placement.startColumn
      );
      const css = wordTableCellCss(
        tcPr,
        tblBorders,
        rowIndex,
        placements.length,
        rowSpan,
        placement.startColumn === 0,
        lastGridColumn,
        // A condition's stated `auto` fill hides the style's own; a `wholeTable` condition's
        // fill paints nothing in reference renderings, so it never reaches the cell.
        conditional?.fill !== undefined ? conditional.fill : conditionalFormats.styleFill,
        rtl,
        tableMargins
      );
      const attrs =
        (placement.span > 1 ? ` colspan="${placement.span}"` : '') +
        (rowSpan > 1 ? ` rowspan="${rowSpan}"` : '') +
        (css === '' ? '' : ` style="${escapeAttr(css)}"`);
      // The condition's rPr/pPr layer under the cell's own styles, so a styled
      // header row keeps its bold and text color in the copied HTML.
      const cellCtx = cellContexts.get(placement.cell) ?? ctx;
      out += `<td dir="ltr"${attrs}>${deps.renderBlocks(cellCtx, placement.cell.children, fields)}</td>`;
    }
    out += '</tr>';
  }
  return `${out}</table>`;
}
