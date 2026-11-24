import { weakRefOf, type WeakRefOf } from '../store/package/weak-ref.ts';
import type { SemanticTableCell, SemanticTableRow, TableAlignment } from './semantic-table.ts';
import type { PreferredWidthType } from './table-widths.ts';
import type { TableBorderSide } from './table-borders.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import { shareRowFacts } from './table-row-facts.ts';
import {
  carryPartialSimpleSideGrid,
  hasPartialSimpleSideGrid,
  mixedSimpleSideGridLeadPt,
  partialSimpleSideGridLeadPt,
} from './table-partial-side-grid.ts';
import { carryWidenedCellContentInsets } from './cell-content-insets-memo.ts';

const SIMPLE_SIDE_STYLES = ['single', 'thick'];

/** True when the edge is a rule of a style other than the simple ones. */
function compoundSideRule(edge: TableBorderSide): boolean {
  return edge.state === 'edge' && !SIMPLE_SIDE_STYLES.includes(edge.style);
}

/** The width of a simple, visible side rule; else `undefined`. */
function simpleSideRuleWidth(edge: TableBorderSide): number | undefined {
  return edge.state === 'edge' && SIMPLE_SIDE_STYLES.includes(edge.style) && edge.widthPt > 0
    ? edge.widthPt
    : undefined;
}

/**
 * Mode-15 table width types that take one side-rule geometry.
 *
 * Captured left, right and centred fixed-layout controls, and centred autofit controls,
 * drawn with `w:tblW w:type="auto"` put every stroke and text edge where the matching `dxa`
 * control does. A wrapped cell line in an `auto` table confirms the reclaimed content width.
 * A `pct` table takes it only with one simple rule width on every cell side
 * (`modernPercentRulePt`).
 */
const MODERN_GRID_WIDTH_TYPES: readonly PreferredWidthType[] = ['dxa', 'auto'];

/**
 * True when a cell's authored side rules are the shared-grid-line shape.
 *
 * ONE qualifying side is enough. Requiring both made the rule depend on whether the cell
 * happened to own the opposite edge, which `w:insideV` never gives the first or last column:
 * a captured control at `w:sz="24"` over columns at 72/192/312/432 shows the reference
 * centring EVERY vertical rule on its line — 70.56, 190.56, 310.56, 430.56, each exactly half
 * a width left of its boundary — while we drew the first one flush at 192.00 and only the
 * interior one centred, so a table disagreed with itself. See `.cache/pdf/claude-vrule/`.
 *
 * Both sides still have to agree when both are present; a cell whose two edges differ in
 * width is not the shared-line shape this describes.
 */
function sharesSideRuleGridLine(
  cell: SemanticTableCell,
  simpleSidesOnly = false,
  unequalSides = false
): boolean {
  const { left, right } = cell.contentBorders ?? cell.borders;
  // Modern admission does not extend the simple-rule controls to an opposite compound rule.
  if (simpleSidesOnly && (compoundSideRule(left) || compoundSideRule(right))) return false;
  const leftRule = left.state === 'edge' && SIMPLE_SIDE_STYLES.includes(left.style);
  const rightRule = right.state === 'edge' && SIMPLE_SIDE_STYLES.includes(right.style);
  if (!leftRule && !rightRule) return false;
  if (!unequalSides && leftRule && rightRule && left.widthPt !== right.widthPt) return false;
  return true;
}

type SideRuleFlag = 'centeredSideRules' | 'centeredSidePaint';

// One variant per immutable source row. A mode change replaces the entry instead of
// retaining every flag combination or an earlier table revision. Weak values also prevent
// chained flag transformations from keeping old row copies alive through their sources.
const mappedSideRuleRows = new WeakMap<
  SemanticTableRow,
  {
    readonly flag: SideRuleFlag;
    readonly simpleSidesOnly: boolean;
    readonly unequalSides: boolean;
    readonly row: WeakRefOf<SemanticTableRow>;
  }
>();

function mapCells(
  rows: readonly SemanticTableRow[],
  flag: SideRuleFlag,
  simpleSidesOnly = false,
  unequalSides = false
): readonly SemanticTableRow[] {
  const mapped = rows.map((row) => {
    const cached = mappedSideRuleRows.get(row);
    if (
      cached?.flag === flag &&
      cached.simpleSidesOnly === simpleSidesOnly &&
      cached.unequalSides === unequalSides
    ) {
      const previous = cached.row.deref();
      if (previous) return previous;
    }
    const copy = shareRowFacts(
      row,
      carryUniformRow(row, {
        ...row,
        cells: row.cells.map((cell) =>
          sharesSideRuleGridLine(cell, simpleSidesOnly, unequalSides)
            ? { ...cell, [flag]: true as const }
            : cell
        ),
      })
    );
    mappedSideRuleRows.set(row, { flag, simpleSidesOnly, unequalSides, row: weakRefOf(copy) });
    return copy;
  });
  return carryUniformTable(rows, mapped);
}

/**
 * Centre the painted stroke on the grid line, without moving the content edge.
 *
 * In the legacy modes, the same captured control drawn with `w:tblW w:type="auto"` centres
 * its rules exactly as the `dxa` one does, so the width type does not decide where the
 * reference paints. It does decide the legacy content budget: `centeredSideRules` also
 * reclaims half the stroke as padding in `table-cell-geometry.ts`, which changes line
 * breaking. Paint follows the wider rule; the content inset keeps the narrow one it was
 * measured against. Mode 15 gives `auto` the whole `dxa` geometry instead.
 */
export function withCentredSideRulePaint(
  rows: readonly SemanticTableRow[],
  simpleSidesOnly = false,
  unequalSides = false
): readonly SemanticTableRow[] {
  return mapCells(rows, 'centeredSidePaint', simpleSidesOnly, unequalSides);
}

/** Legacy simple side rules share the grid line with padding, rather than adding to it. */
export function withLegacyTableSideRules(
  rows: readonly SemanticTableRow[],
  simpleSidesOnly = false,
  unequalSides = false
): readonly SemanticTableRow[] {
  return mapCells(rows, 'centeredSideRules', simpleSidesOnly, unequalSides);
}

/**
 * True when every side rule of the table's cells is a simple rule of one width, and at least
 * one cell has such a rule. Rows may skip grid columns. A cell rule that loses a conflict to a
 * rule of another width on its grid line is outside the geometry the controls cover.
 */
function sideRulesShareOneWidth(rows: readonly SemanticTableRow[]): boolean {
  let width: number | undefined;
  const check = (side: TableBorderSide): boolean => {
    if (side.state !== 'edge') return true;
    const rule = simpleSideRuleWidth(side);
    if (rule === undefined || (width !== undefined && rule !== width)) return false;
    width = rule;
    return true;
  };
  for (const row of rows) {
    for (const cell of row.cells) {
      const shown = cell.contentBorders ?? cell.borders;
      for (const side of [shown.left, shown.right, cell.borders.left, cell.borders.right])
        if (!check(side)) return false;
    }
  }
  return width !== undefined;
}

/** The table-level facts that decide whether its side rules share the grid line. */
export interface SideRuleTableShape {
  readonly compatibilityMode: number | undefined;
  readonly depth: number;
  readonly bidiVisual: boolean;
  readonly floating: boolean;
  readonly cellSpacingPt: number;
  readonly widthType: PreferredWidthType;
  /** The stated `dxa` table width in points; absent for other width types. */
  readonly statedWidthPt?: number;
  readonly alignment: TableAlignment;
  readonly layoutFixed: boolean;
  readonly indentPt: number;
  readonly columnWidthsPt: readonly number[];
  /** Width of the box the table is aligned in. */
  readonly containerWidthPt: number;
  /** The table is in a text box story. */
  readonly textBox?: boolean;
}

/** Cells with their side-rule geometry, and where the grid sits against the aligned edge. */
export interface SharedGridLineSideRules {
  readonly rows: readonly SemanticTableRow[];
  /** See `SemanticTableStructure.outerRuleOffsetPt`. */
  readonly outerRuleOffsetPt?: number;
  /** See `SemanticTableStructure.sharedGridLinesHold`. */
  readonly holdsWhenWidened?: true;
}

/**
 * The one side-rule width of a table whose every cell has a simple rule of that width on
 * both sides, and whose rows each cover the whole grid (no `w:gridBefore`/`w:gridAfter`);
 * else `undefined`.
 */
const uniformRows = new WeakMap<
  SemanticTableRow,
  { columns: number; value: number | null | undefined }
>();
const uniformTables = new WeakMap<
  readonly SemanticTableRow[],
  { columns: number; value: number | undefined }
>();

/**
 * Give `copy` the uniform-rule answer of `source`. Only for a copy that adds or drops the
 * centred side-rule flags: the answer reads cell grid columns, spans, merge continuation and
 * side borders (`contentBorders`, else `borders`), which those copies share by reference.
 * The memo value holds no row, so the source row is not retained.
 */
function carryUniformRow(source: SemanticTableRow, copy: SemanticTableRow): SemanticTableRow {
  const known = uniformRows.get(source);
  if (known) uniformRows.set(copy, known);
  return copy;
}

/** `carryUniformRow` for a table: `copy` maps each row of `source`, in order, that way. */
function carryUniformTable(
  source: readonly SemanticTableRow[],
  copy: readonly SemanticTableRow[]
): readonly SemanticTableRow[] {
  carryPartialSimpleSideGrid(source, copy);
  const known = uniformTables.get(source);
  if (known) uniformTables.set(copy, known);
  return copy;
}

function uniformRowRule(row: SemanticTableRow, columnCount: number): number | null | undefined {
  const known = uniformRows.get(row);
  if (known?.columns === columnCount) return known.value;
  const read = (): number | null | undefined => {
    const first = row.cells[0],
      last = row.cells.at(-1);
    if (
      !first ||
      !last ||
      !(
        (first.gridColumn === 0 && last.gridColumn + last.gridSpan === columnCount) ||
        (last.gridColumn === 0 && first.gridColumn + first.gridSpan === columnCount)
      )
    )
      return null;
    let width: number | undefined;
    for (const cell of row.cells) {
      if (cell.vMergeContinue) continue;
      const { left, right } = cell.contentBorders ?? cell.borders;
      const leftWidth = simpleSideRuleWidth(left);
      if (leftWidth === undefined || (width !== undefined && leftWidth !== width)) return null;
      if (simpleSideRuleWidth(right) !== leftWidth) return null;
      width = leftWidth;
    }
    return width;
  };
  const value = read();
  uniformRows.set(row, { columns: columnCount, value });
  return value;
}
function uniformSimpleSideRuleWidth(
  rows: readonly SemanticTableRow[],
  columnCount: number
): number | undefined {
  const known = uniformTables.get(rows);
  if (known?.columns === columnCount) return known.value;
  let width: number | undefined;
  for (const row of rows) {
    const value = uniformRowRule(row, columnCount);
    if (value === null || (value !== undefined && width !== undefined && value !== width)) {
      uniformTables.set(rows, { columns: columnCount, value: undefined });
      return undefined;
    }
    if (value !== undefined) width = value;
  }
  uniformTables.set(rows, { columns: columnCount, value: width });
  return width;
}

/**
 * The mode-15 left- or right-aligned table whose captured controls cover it, as the offset
 * of its grid from the aligned edge; else `undefined`.
 *
 * Captured `dxa` and `auto` controls put the OUTER edge of the leading (left) or trailing (right) rule
 * on the aligned edge, so the grid moves inward by half the rule. Every rule is centred on
 * its grid line and the margin is measured from that centre, as in the centred shape. The
 * controls cover 0.5 to 6pt single rules, 3pt thick rules, 0 to 10.8pt margins, indents,
 * fixed and autofit layout, and one to three columns. A fixed table, left- or right-aligned,
 * and a table whose stated absolute width already overflows, keep the offset when the outer
 * box overflows the container: full-width and over-wide controls put the outer rule edge on
 * the aligned edge. A
 * table that only widens past its room for its content, and a table whose side rules differ,
 * keep the full-stroke inset and the unshifted grid until controls cover them.
 */
function modernEdgeAlignedOffsetPt(
  rows: readonly SemanticTableRow[],
  table: SideRuleTableShape
): number | undefined {
  if (table.alignment === 'center') return undefined;
  // A percentage states its own width, so its grid always moves in, however wide it is.
  // In a text box the trailing grid line stays on the trailing edge.
  const trailing = (rule: number) => (table.textBox ? 0 : -rule / 2);
  const percentRule = modernPercentRulePt(rows, table);
  if (percentRule !== undefined)
    return table.alignment === 'left' ? percentRule / 2 : trailing(percentRule);
  if (
    !hasCompatibilityRule(table.compatibilityMode, 'modernGridLineSideRules') ||
    !MODERN_GRID_WIDTH_TYPES.includes(table.widthType)
  )
    return undefined;
  const rule = uniformSimpleSideRuleWidth(rows, table.columnWidthsPt.length);
  if (rule === undefined) return undefined;
  let gridWidth = 0;
  for (const column of table.columnWidthsPt) gridWidth += column;
  const left = table.alignment === 'left';
  // AutoFit settles an automatic-width table with its outer box inside the container.
  const fits =
    (left ? table.indentPt : 0) + gridWidth + rule <= table.containerWidthPt + 1e-6 ||
    autoWidthOuterRulePt(rows, table) > 0;
  // A stated absolute width that already overflows keeps the offset; a table that only
  // widens past its room for its content does not.
  const statedOverflow =
    table.statedWidthPt !== undefined &&
    (left ? table.indentPt : 0) + table.statedWidthPt + rule > table.containerWidthPt + 1e-6;
  if (!fits && !table.layoutFixed && !statedOverflow) return undefined;
  return left ? rule / 2 : trailing(rule);
}

/**
 * The one side-rule width of a percentage table that shares its grid lines; else
 * `undefined`. A top-level table needs mode 15; a nested table takes it in every mode.
 *
 * With one simple rule width on every cell side, such a table takes the shared-grid-line
 * geometry of the absolute-width shapes. Its percentage is a share of the container less
 * that rule, and the outer box, the grid plus half of each outer rule, is one rule wider
 * (`modernSharedPercentWidth`). Captured controls cover 0.5, 1.5 and 3pt single rules, 0 to
 * 3pt margins, 50 to 150%, left, indented, right and centred AutoFit tables, top-level in
 * mode 15 and nested in modes 11 to 15. Mixed, compound and absent rules keep the full-stroke
 * inset.
 */
export function modernPercentRulePt(
  rows: readonly SemanticTableRow[],
  table: Pick<
    SideRuleTableShape,
    'compatibilityMode' | 'depth' | 'floating' | 'cellSpacingPt' | 'widthType'
  > & { readonly columnCount?: number; readonly columnWidthsPt?: readonly number[] }
): number | undefined {
  if (
    // Nested tables take it in every mode.
    (table.depth === 0 &&
      !hasCompatibilityRule(table.compatibilityMode, 'modernGridLineSideRules')) ||
    table.widthType !== 'pct' ||
    table.floating ||
    table.cellSpacingPt !== 0
  )
    return undefined;
  return uniformSimpleSideRuleWidth(rows, table.columnCount ?? table.columnWidthsPt?.length ?? 0);
}

/**
 * The room a mode-15 automatic-width AutoFit table gives its outer side rules: AutoFit keeps
 * the outer box, the grid plus half of each outer rule, inside the container for every
 * alignment, so the grid settles one rule narrower. 0 for any other table.
 */
export function autoWidthOuterRulePt(
  rows: readonly SemanticTableRow[],
  table: SideRuleTableShape
): number {
  if (
    !hasCompatibilityRule(table.compatibilityMode, 'modernGridLineSideRules') ||
    table.widthType !== 'auto' ||
    table.layoutFixed ||
    table.depth !== 0 ||
    table.floating ||
    table.cellSpacingPt !== 0
  )
    return 0;
  return uniformSimpleSideRuleWidth(rows, table.columnWidthsPt.length) ?? 0;
}

/**
 * The leading rule width of a mode-15 left-aligned table whose simple side rules differ in
 * width, when captured controls cover it; else `undefined`.
 *
 * Fixed and autofit controls with a 0.5pt frame and 1.5, 3 and 6pt rules on one cell, at
 * 0 and 5.4pt margins, and with 1.5, 3 and 6pt frames around 0.5pt rules, centre every rule
 * on its grid line, wide or narrow, and measure each margin from that centre. The grid moves
 * inward by half the leading rule, as in the uniform shape.
 */
function modernMixedLeadPt(
  rows: readonly SemanticTableRow[],
  table: SideRuleTableShape
): number | undefined {
  if (
    !hasCompatibilityRule(table.compatibilityMode, 'modernGridLineSideRules') ||
    !MODERN_GRID_WIDTH_TYPES.includes(table.widthType) ||
    table.alignment !== 'left' ||
    uniformSimpleSideRuleWidth(rows, table.columnWidthsPt.length) !== undefined
  )
    return undefined;
  const lead = mixedSimpleSideGridLeadPt(rows, table.columnWidthsPt.length);
  if (lead === undefined) return undefined;
  let gridWidth = 0;
  for (const column of table.columnWidthsPt) gridWidth += column;
  const fits = table.indentPt + gridWidth + lead <= table.containerWidthPt + 1e-6;
  return fits || table.layoutFixed ? lead : undefined;
}

/**
 * Admit simple collapsed side rules to the shared-grid-line geometry.
 *
 * Modes 11, 12 and 14 (and an absent mode) take it for every top-level, collapsed, unpositioned
 * table, left-to-right or right-to-left. Mode 15 takes it only for the shapes its captured
 * controls cover: a `dxa` or `auto` width (`MODERN_GRID_WIDTH_TYPES`), a `pct` width with
 * one simple rule width (`modernPercentRulePt`), and a right-to-left table of either kind:
 *
 * - a centred table. Fixed-layout controls at 0.5, 1.5, 3 and 6pt strokes with 0 and
 *   5.4pt margins, and autofit controls, put text and strokes at the mode-14 positions: the
 *   stroke centred on the grid line and the margin measured from that centre.
 * - a left- or right-aligned table with one simple rule width on every cell side. It
 *   takes the same cell geometry, and its grid moves inward by half the outer rule
 *   (`modernEdgeAlignedOffsetPt`). The two go together: the inset alone would move the text
 *   outward by half a rule.
 *
 * - a left-aligned table whose simple rules differ in width (`modernMixedLeadPt`).
 *
 * Other mode-15 shapes (`pct` width with mixed rules, compound rules, right-aligned unequal
 * rules) and mode 16 keep the full-stroke inset until controls cover them. Nested tables
 * take `nestedSharedGridLineDecision` in every mode.
 */
function sharedGridLineDecision(
  rows: readonly SemanticTableRow[],
  table: SideRuleTableShape
): {
  legacyMode: boolean;
  modernGridWidth: boolean;
  outerRuleOffsetPt?: number;
  unequalSides?: true;
} | null {
  const { compatibilityMode: mode } = table;
  if (table.floating || table.cellSpacingPt !== 0) return null;
  if (table.depth !== 0) return nestedSharedGridLineDecision(rows, table);
  // The legacy modes give right-to-left tables the same shared grid lines.
  if (table.bidiVisual && hasCompatibilityRule(mode, 'legacySharedGridLineSideRules'))
    return { legacyMode: true, modernGridWidth: false };
  if (table.bidiVisual) {
    const rule = uniformSimpleSideRuleWidth(rows, table.columnWidthsPt.length);
    if (
      !hasCompatibilityRule(mode, 'modernGridLineSideRules') ||
      (!MODERN_GRID_WIDTH_TYPES.includes(table.widthType) && table.widthType !== 'pct') ||
      rule === undefined
    )
      return null;
    // A right-to-left table shares its side rules with cell padding, in fixed and AutoFit
    // layout: the left-to-right geometry mirrored, then half a rule toward the visual left.
    // Leading-aligned, its grid moves by one outer rule toward the visual left; centred, by
    // half of one; trailing-aligned, its grid stays on the aligned edge.
    // In a text box it takes the mirrored text-box geometry alone (`textBoxBidiShiftPt`).
    const shift = table.textBox ? 0 : -rule / 2;
    return {
      legacyMode: false,
      modernGridWidth: true,
      outerRuleOffsetPt:
        table.alignment === 'left' ? shift - rule / 2 : table.alignment === 'center' ? shift : 0,
    };
  }
  const legacyMode = hasCompatibilityRule(mode, 'legacySharedGridLineSideRules');
  const modernGridWidth =
    (hasCompatibilityRule(mode, 'modernGridLineSideRules') &&
      MODERN_GRID_WIDTH_TYPES.includes(table.widthType)) ||
    modernPercentRulePt(rows, table) !== undefined;
  const modernCentred = modernGridWidth && table.alignment === 'center';
  const outerRuleOffsetPt = legacyMode ? undefined : modernEdgeAlignedOffsetPt(rows, table);
  const partialGrid =
    modernGridWidth &&
    !modernCentred &&
    outerRuleOffsetPt === undefined &&
    uniformSimpleSideRuleWidth(rows, table.columnWidthsPt.length) === undefined &&
    hasPartialSimpleSideGrid(rows, table.columnWidthsPt.length);
  if (!legacyMode && !modernCentred && !partialGrid && outerRuleOffsetPt === undefined) {
    const lead = modernMixedLeadPt(rows, table);
    return lead === undefined
      ? null
      : { legacyMode, modernGridWidth, outerRuleOffsetPt: lead / 2, unequalSides: true };
  }
  // A left-aligned partial grid whose rows all open with one leading rule moves inward by
  // half that rule, as a complete grid does.
  const partialLead =
    partialGrid && table.alignment === 'left'
      ? partialSimpleSideGridLeadPt(rows, table.columnWidthsPt.length)
      : undefined;
  if (partialLead !== undefined)
    return { legacyMode, modernGridWidth, outerRuleOffsetPt: partialLead / 2 };
  return { legacyMode, modernGridWidth, outerRuleOffsetPt };
}

/**
 * A nested table with one simple rule width on every cell side shares its grid lines with
 * the cell padding in every mode, whatever its width type. Its grid moves in by half the
 * outer rule from a leading alignment, so the rule's outer edge meets the cell's content
 * edge. A trailing alignment does the same in mode 15; the older modes keep the trailing grid
 * line on that edge. A centred grid stays centred. Captured controls cover 0.5pt rules, cell
 * margins of 0 and 5.4pt, percentage, absolute and absent widths, both directions and
 * every alignment.
 */
function nestedSharedGridLineDecision(
  rows: readonly SemanticTableRow[],
  table: SideRuleTableShape
): { legacyMode: boolean; modernGridWidth: boolean; outerRuleOffsetPt?: number } | null {
  const rule = uniformSimpleSideRuleWidth(rows, table.columnWidthsPt.length);
  if (rule === undefined) return null;
  // Authored alignments; a right-to-left table leads from its visual right.
  const leading = table.alignment === 'left';
  const inward =
    leading ||
    (table.alignment === 'right' &&
      hasCompatibilityRule(table.compatibilityMode, 'modernGridLineSideRules'));
  if (table.alignment === 'center' || !inward) return { legacyMode: false, modernGridWidth: true };
  // The visual left moves right; the visual right moves left.
  const visualLeft = leading !== table.bidiVisual;
  return {
    legacyMode: false,
    modernGridWidth: true,
    outerRuleOffsetPt: visualLeft ? rule / 2 : -rule / 2,
  };
}

const rowsWithoutSharedSides = new WeakMap<SemanticTableRow, SemanticTableRow>();
function withoutSharedSides(row: SemanticTableRow): SemanticTableRow {
  const known = rowsWithoutSharedSides.get(row);
  if (known) return known;
  let changed = false;
  const cells = row.cells.map((cell) => {
    if (!cell.centeredSideRules && !cell.centeredSidePaint) return cell;
    changed = true;
    const { centeredSideRules: _rules, centeredSidePaint: _paint, ...plain } = cell;
    carryWidenedCellContentInsets(cell, plain);
    return plain;
  });
  const result = changed ? shareRowFacts(row, carryUniformRow(row, { ...row, cells })) : row;
  rowsWithoutSharedSides.set(row, result);
  return result;
}

/**
 * Reuse the flag-free cells AutoFit needs for its widened measurement in a later retarget.
 * Only prepare a whole row when every cell participates in that measurement. Other rows
 * keep per-cell measurement, so merge continuations and vertical cells add no unused copies.
 */
export function rowForWidenedMeasurement(
  row: SemanticTableRow,
  columnCount: number,
  measureSpanning: boolean
): SemanticTableRow | undefined {
  const known = rowsWithoutSharedSides.get(row);
  if (known) return known;
  if (
    !row.cells.every(
      (cell) =>
        !cell.legacyContentAlignment &&
        !cell.vMergeContinue &&
        cell.gridColumn >= 0 &&
        cell.gridColumn < columnCount &&
        cell.textDirection === 'horizontal' &&
        (cell.gridSpan === 1 || measureSpanning)
    )
  )
    return undefined;
  return withoutSharedSides(row);
}

/** Reapply only the width-dependent side rules; authored cell material stays unchanged. */
export function retargetSharedGridLineSideRules(
  rows: readonly SemanticTableRow[],
  before: SideRuleTableShape,
  widths: readonly number[]
): SharedGridLineSideRules {
  const old = sharedGridLineDecision(rows, before);
  const shape = { ...before, columnWidthsPt: widths };
  const next = sharedGridLineDecision(rows, shape);
  if (
    old === next ||
    (old &&
      next &&
      old.legacyMode === next.legacyMode &&
      old.modernGridWidth === next.modernGridWidth &&
      old.outerRuleOffsetPt === next.outerRuleOffsetPt &&
      old.unequalSides === next.unequalSides)
  )
    return {
      rows,
      ...(next?.outerRuleOffsetPt === undefined
        ? {}
        : { outerRuleOffsetPt: next.outerRuleOffsetPt }),
    };
  return withSharedGridLineSideRules(carryUniformTable(rows, rows.map(withoutSharedSides)), shape);
}

export function withSharedGridLineSideRules(
  rows: readonly SemanticTableRow[],
  table: SideRuleTableShape
): SharedGridLineSideRules {
  const decision = sharedGridLineDecision(rows, table);
  if (!decision) return { rows };
  const { legacyMode, modernGridWidth, outerRuleOffsetPt, unequalSides = false } = decision;
  const painted = withCentredSideRulePaint(rows, !legacyMode, unequalSides);
  // A legacy automatic-width AutoFit table whose side rules all share one simple width sizes
  // and fills its columns from the margins alone where they clear half a rule (17.4.53,
  // 17.4.64): captured controls at 0.5 to 3pt single and thick rules, with 0 to 10pt margins,
  // with and without `w:gridBefore`, in modes 12 and 14.
  const legacyAutoFit =
    legacyMode && table.widthType === 'auto' && !table.layoutFixed && sideRulesShareOneWidth(rows);
  const shared =
    table.widthType === 'dxa' || modernGridWidth
      ? withLegacyTableSideRules(painted, !legacyMode, unequalSides)
      : legacyAutoFit
        ? withLegacyTableSideRules(painted, true, unequalSides)
        : painted;
  // A legacy, nested or one-rule percentage table keeps the shared lines at any widths; a
  // mode-15 absolute or automatic width can lose them as it widens, so it does not hold.
  const holds =
    shared !== painted &&
    (legacyMode || table.depth !== 0 || modernPercentRulePt(rows, table) !== undefined);
  return {
    rows: shared,
    ...(outerRuleOffsetPt === undefined ? {} : { outerRuleOffsetPt }),
    ...(holds ? { holdsWhenWidened: true as const } : {}),
  };
}
