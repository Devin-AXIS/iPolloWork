// A compatibility projection, not a rewrite of authored table XML. Older layouts align the
// CONTENT of a top-level percentage-width table with the text margins: the percentage is a
// share of the text column plus the outer cell margins, and the table's outer grid edges
// extend past the aligned edge by those margins. This holds for every alignment, indent,
// layout and direction, whatever the authored grid states. Floating, nested and separated
// tables, and tables with uneven outer margins, keep the ordinary geometry.
import {
  readTwipsMeasure,
  WML_NAMESPACE_URI,
  type OoxmlElement,
} from '@docx-editor.dev/core/store';
import type { SemanticTableRow } from './semantic-table.ts';
import {
  MAX_TABLE_COLUMNS,
  wrappedTablePercentUnits,
  type CellWidthClaim,
  type PreferredWidth,
} from './table-widths.ts';
import { hasSupportedLegacyTableMargins } from './legacy-table-margins.ts';
import { hasUnsupportedRowGeometry } from './legacy-fixed-table-content.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';

const MAX_WIDTH_PT = 31_680 / 20;
const EPSILON_PT = 0.001;

/** Reconcile the precision of legacy fiftieth-percent preferences with a verified twip grid. */
export function legacyRoundedCellClaims(
  claims: readonly CellWidthClaim[],
  gridCols: readonly OoxmlElement[],
  tableWidthPt: number
): readonly CellWidthClaim[] {
  // A rounded fiftieth-percent can exceed the same width rounded to a twip by this
  // amount. Growing that column and then rescaling the whole table steals space from
  // unrelated columns. Only suppress that representational difference, not a wider
  // cell preference. This runs only AFTER the complete legacy grid has been verified.
  const tolerance = tableWidthPt / 10_000 + 0.025;
  return claims.map((claim) => {
    if (claim.span !== 1 || claim.preferred.type !== 'pct') return claim;
    const units = claim.preferred.value * 50;
    if (Math.abs(units - Math.round(units)) > 1e-8) return claim;
    const raw = readTwipsMeasure(attr(gridCols[claim.start], 'w'));
    if (raw === null || raw < 0) return claim;
    const gridWidth = raw / 20;
    const delta = (tableWidthPt * claim.preferred.value) / 100 - gridWidth;
    return delta > 0 && delta <= tolerance + EPSILON_PT
      ? { ...claim, preferred: { type: 'dxa', value: gridWidth } }
      : claim;
  });
}

function child(node: OoxmlElement, name: string): OoxmlElement | undefined {
  let found: OoxmlElement | undefined;
  for (const item of node.children) {
    if (item.kind === 'textValue' || item.localName !== name) continue;
    if (found || item.namespaceUri !== WML_NAMESPACE_URI) return undefined;
    found = item;
  }
  return found;
}

function attr(node: OoxmlElement | undefined, name: string): string | undefined {
  const matches = node?.attributes.filter((item) => item.localName === name);
  return matches?.length === 1 && matches[0]!.namespaceUri === WML_NAMESPACE_URI
    ? matches[0]!.value
    : undefined;
}

/** The legacy reference box of a percentage-width table. */
export interface LegacyTableContentWidth {
  /** The text column plus the outer content insets: what the percentage is a share of. */
  readonly widthPt: number;
  /** The authored grid states the resolved width, so its rounding can be reconciled. */
  readonly gridConfirmed: boolean;
  /** The outer trailing edge, not the trailing content edge, meets the trailing text edge. */
  readonly trailingOuterEdge?: true;
}

/**
 * How much wider than its room a text box's percentage reference box is: a top-level
 * percentage table in a text box takes its share of the room plus 15 twips. Measured on
 * reference renderings of inline text boxes 2880 and 4320 twips wide, with insets of 0, 144
 * and 288 twips, cell margins of 0, 108 and 216 twips, with and without a 0.75pt outline, at
 * 50%, 100% and 150%: the implied share was the room plus 0.69 to 0.97pt, at the renderer's
 * 0.24pt position resolution. The outline narrows the room, not the extra.
 */
const TEXT_BOX_PERCENT_EXTRA_PT = 0.75;

/**
 * The reference box of a top-level table in a text box. Its leading content still meets the
 * leading text edge, but its outer trailing edge meets the trailing one.
 */
export function textBoxLegacyContentWidth(
  legacy: LegacyTableContentWidth,
  tableWidth: PreferredWidth
): LegacyTableContentWidth {
  return tableWidth.type === 'pct'
    ? {
        widthPt: legacy.widthPt + TEXT_BOX_PERCENT_EXTRA_PT,
        gridConfirmed: false,
        trailingOuterEdge: true,
      }
    : { ...legacy, trailingOuterEdge: true };
}

export function legacyTableContentWidth(input: {
  readonly table: OoxmlElement;
  readonly propertyNodes: readonly OoxmlElement[];
  readonly rows: readonly SemanticTableRow[];
  readonly columnCount: number;
  readonly contentWidthPt: number;
  readonly compatibilityMode: number | undefined;
  readonly depth: number;
  readonly tableWidth: PreferredWidth;
  readonly cellSpacingPt: number;
  readonly floating: boolean;
  /** Painted widths of the simple outer side rules of a left-to-right table. */
  readonly outerRulesPt?: { readonly left: number; readonly right: number };
}): LegacyTableContentWidth | undefined {
  const { compatibilityMode, contentWidthPt, table, rows, columnCount } = input;
  if (
    !hasCompatibilityRule(compatibilityMode, 'legacyPercentTableContentWidth') ||
    input.depth !== 0 ||
    input.floating ||
    input.cellSpacingPt !== 0 ||
    (input.tableWidth.type !== 'auto' &&
      input.tableWidth.type !== 'nil' &&
      (input.tableWidth.type !== 'pct' || input.tableWidth.value <= 0)) ||
    !Number.isFinite(contentWidthPt) ||
    contentWidthPt <= 0 ||
    contentWidthPt > MAX_WIDTH_PT ||
    columnCount < 1 ||
    columnCount > MAX_TABLE_COLUMNS
  )
    return undefined;

  const properties = child(table, 'tblPr');
  if (!properties) return undefined;
  const width = child(properties, 'tblW');
  // A missing width permits automatic geometry; an ambiguous or foreign width does not.
  if (
    !width &&
    properties.children.some((item) => item.kind !== 'textValue' && item.localName === 'tblW')
  )
    return undefined;
  const rawWidth = attr(width, 'w');
  // A percentage above 100 extends the same reference box past the text column. A table
  // without a usable width (none, auto, or a count past its range) shares the same box, and
  // so does a percentage stated past its range, which lays the table out at its narrowest.
  const automatic =
    (input.tableWidth.type === 'nil' && attr(width, 'type') === 'nil') ||
    (input.tableWidth.type === 'auto' &&
      (!width ||
        attr(width, 'type') === 'auto' ||
        (attr(width, 'type') === 'pct' &&
          /^\d{1,9}$/.test(rawWidth ?? '') &&
          wrappedTablePercentUnits(Number(rawWidth)) === undefined)));
  if (
    !automatic &&
    (attr(width, 'type') !== 'pct' ||
      rawWidth === undefined ||
      ((!/^\d{1,9}$/.test(rawWidth) || wrappedTablePercentUnits(Number(rawWidth)) === undefined) &&
        !/^\d{1,7}(?:\.\d{1,4})?%$/.test(rawWidth)))
  )
    return undefined;

  for (const node of [...input.propertyNodes, properties]) {
    for (const item of node.children) {
      if (item.kind === 'textValue') continue;
      if (
        ['jc', 'tblCellSpacing'].includes(item.localName) &&
        item.namespaceUri !== WML_NAMESPACE_URI
      )
        return undefined;
      // Reject ambiguous/unsupported placement rather than treating invalid values as left.
      if (item.localName === 'tblpPr') return undefined;
      if (
        item.localName === 'jc' &&
        !['left', 'start', 'center', 'right', 'end'].includes(attr(item, 'val') ?? '')
      ) {
        return undefined;
      }
      if (
        item.localName === 'tblCellSpacing' &&
        (attr(item, 'type') !== 'dxa' || attr(item, 'w') !== '0')
      )
        return undefined;
    }
  }

  const first = rows[0]?.cells[0];
  const last = rows[0]?.cells.at(-1);
  if (!first || !last) return undefined;
  if (!hasSupportedLegacyTableMargins(table, input.propertyNodes)) return undefined;
  if (hasUnsupportedRowGeometry(table, true)) return undefined;
  // A fallback margin alone is no evidence for moving the table into the margin.
  if (!statesOuterMargins([properties, ...input.propertyNodes])) return undefined;
  const left = first.margins.left;
  const right = last.margins.right;
  // Content starts at the margin, or at a centred side rule's inner half where the margin is
  // narrower than that half, with or without a percentage width.
  const insetLeft = Math.max(left, (input.outerRulesPt?.left ?? 0) / 2);
  const insetRight = Math.max(right, (input.outerRulesPt?.right ?? 0) / 2);
  const target = contentWidthPt + insetLeft + insetRight;
  if (
    !Number.isFinite(target) ||
    left < 0 ||
    right < 0 ||
    insetLeft + insetRight <= 0 ||
    target > MAX_WIDTH_PT
  )
    return undefined;
  // Rows that skip grid columns (`w:gridBefore`, `w:gridAfter`) follow the grid: the cells on
  // each outer grid edge must agree, and some row must reach both edges.
  let reachesBoth = false;
  for (const row of rows) {
    const leading = row.cells[0];
    const trailing = row.cells.at(-1);
    if (!leading || !trailing) return undefined;
    const atLeft = leading.gridColumn === 0;
    const atRight = trailing.gridColumn + trailing.gridSpan === columnCount;
    if ((atLeft && leading.margins.left !== left) || (atRight && trailing.margins.right !== right))
      return undefined;
    reachesBoth ||= atLeft && atRight;
  }
  if (!reachesBoth) return undefined;

  return { widthPt: target, gridConfirmed: gridConfirms(table, columnCount, target, input) };
}

/** Whether a table-level margin box states both outer side margins. */
function statesOuterMargins(nodes: readonly OoxmlElement[]): boolean {
  let left = false;
  let right = false;
  for (const node of nodes) {
    const box = child(node, 'tblCellMar');
    if (!box) continue;
    left ||= Boolean(child(box, 'left') ?? child(box, 'start'));
    right ||= Boolean(child(box, 'right') ?? child(box, 'end'));
  }
  return left && right;
}

/** Whether the complete authored grid states the resolved width, to the nearest twip. */
function gridConfirms(
  table: OoxmlElement,
  columnCount: number,
  target: number,
  input: { readonly tableWidth: PreferredWidth }
): boolean {
  const grid = child(table, 'tblGrid');
  if (!grid) return false;
  let count = 0;
  let total = 0;
  for (const col of grid.children) {
    if (col.kind === 'textValue') continue;
    if (col.localName !== 'gridCol' || col.namespaceUri !== WML_NAMESPACE_URI) return false;
    const raw = readTwipsMeasure(attr(col, 'w'));
    if (raw === null || raw < 0) return false;
    const pt = raw / 20;
    if (pt < 1 || pt > MAX_WIDTH_PT || ++count > MAX_TABLE_COLUMNS) return false;
    total += pt;
  }
  return (
    count === columnCount &&
    Math.abs(total - (target * input.tableWidth.value) / 100) <= 0.025 + EPSILON_PT
  );
}

/**
 * The room a nested AutoFit table without a usable width fits in the older modes: the content
 * width of the cell that holds it plus the table's own stated outer cell margins. The table
 * keeps its ordinary alignment in the cell; only its room grows.
 */
export function legacyNestedAutoRoomPt(input: {
  readonly table: OoxmlElement;
  readonly propertyNodes: readonly OoxmlElement[];
  readonly rows: readonly SemanticTableRow[];
  readonly contentWidthPt: number;
  readonly compatibilityMode: number | undefined;
  readonly depth: number;
  readonly tableWidth: PreferredWidth;
  readonly cellSpacingPt: number;
  readonly layoutFixed: boolean;
}): number | undefined {
  const { contentWidthPt, rows } = input;
  if (
    !hasCompatibilityRule(input.compatibilityMode, 'legacyPercentTableContentWidth') ||
    input.depth === 0 ||
    input.layoutFixed ||
    input.tableWidth.type !== 'auto' ||
    input.cellSpacingPt !== 0 ||
    !Number.isFinite(contentWidthPt) ||
    contentWidthPt <= 0
  )
    return undefined;
  const properties = child(input.table, 'tblPr');
  if (!properties || !statesOuterMargins([properties, ...input.propertyNodes])) return undefined;
  const left = rows[0]?.cells[0]?.margins.left ?? 0;
  const right = rows[0]?.cells.at(-1)?.margins.right ?? 0;
  const room = contentWidthPt + left + right;
  return left >= 0 && right >= 0 && Number.isFinite(room) && room <= MAX_WIDTH_PT
    ? room
    : undefined;
}
