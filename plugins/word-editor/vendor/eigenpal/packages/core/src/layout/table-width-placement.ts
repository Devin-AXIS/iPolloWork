// The box a top-level table's width resolves against, and the indent that places it, before the
// columns are resolved. Three compatibility behaviors meet here:
//
// - older modes measure a percentage, or a table without a usable width, against the text
//   column plus the outer cell margins, and align the content of the outer cells with the text
//   edge (`legacyTableContentWidth`);
// - outside that box, a percentage excludes the mean outer side rule (`ruleAdjustedTableWidth`);
// - an AutoFit table without a width fits the room its leading indent leaves, and a nested
//   one in the older modes also the room of its outer cell margins.
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import {
  legacyNestedAutoRoomPt,
  legacyRoundedCellClaims,
  legacyTableContentWidth,
  textBoxLegacyContentWidth,
  type LegacyTableContentWidth,
} from './legacy-table-content-width.ts';
import type { SemanticTableRow, TableAlignment } from './semantic-table.ts';
import type { TableBorderBox, TableBorderSide } from './table-borders.ts';
import { outerBandPt } from './table-spacing-band.ts';
import type { CellWidthClaim, PreferredWidth } from './table-widths.ts';

/** The painted width of a simple outer side rule; other rules have no captured geometry. */
function simpleRulePt(side: TableBorderSide): number {
  if (side.state !== 'edge' || (side.style !== 'single' && side.style !== 'thick')) return 0;
  return Number.isFinite(side.widthPt) && side.widthPt > 0 ? side.widthPt : 0;
}

/** The painted widths of a table's two visual outer side rules, where they are simple. */
function outerSideRulesPt(
  borders: TableBorderBox,
  rows: readonly SemanticTableRow[],
  bidiVisual: boolean
): { readonly left: number; readonly right: number } {
  // Cells and table borders are in document order, so a right-to-left table's visual left
  // side is the trailing side of its last cell. The outer cells' own rules replace the
  // table's, as they do when the table paints.
  const cells = rows[0]?.cells ?? [];
  const visualLeft = bidiVisual ? cells.at(-1)?.borders.right : cells[0]?.borders.left;
  const visualRight = bidiVisual ? cells[0]?.borders.left : cells.at(-1)?.borders.right;
  const tableLeft = bidiVisual ? borders.right : borders.left;
  const tableRight = bidiVisual ? borders.left : borders.right;
  const left = !visualLeft || visualLeft.state === 'omitted' ? tableLeft : visualLeft;
  const right = !visualRight || visualRight.state === 'omitted' ? tableRight : visualRight;
  return { left: simpleRulePt(left), right: simpleRulePt(right) };
}

/**
 * A table percentage resolved against a box whose outer side rules sit outside the share.
 *
 * Outside the legacy reference box, a percentage is a share of the container less the mean
 * outer side rule, and the table then adds that rule back: `p × (container − rule) + rule`.
 * At 100% this is the container itself; above or below, the result moves by the rule times
 * the distance from 100%. The returned preference states that width as a share of the
 * container, so the width resolver needs no other change.
 */
export function ruleAdjustedTableWidth(
  tableWidth: PreferredWidth,
  containerWidthPt: number,
  borders: TableBorderBox,
  rows: readonly SemanticTableRow[],
  bidiVisual = false
): PreferredWidth {
  // At 100% the share is the container itself, whatever the rules.
  if (tableWidth.type !== 'pct' || tableWidth.value === 100 || !(containerWidthPt > 0))
    return tableWidth;
  const sides = outerSideRulesPt(borders, rows, bidiVisual);
  const rule = (sides.left + sides.right) / 2;
  if (!(rule > 0) || rule >= containerWidthPt) return tableWidth;
  const widthPt = (tableWidth.value / 100) * (containerWidthPt - rule) + rule;
  return { type: 'pct', value: (widthPt / containerWidthPt) * 100 };
}

/**
 * The grid width of a mode-15 percentage table whose side rules share its grid lines
 * (`modernPercentRulePt`): its share of the container less the rule. The outer box adds the
 * rule back, so it stays where `ruleAdjustedTableWidth` puts it. The result is a share of
 * the container, so the width resolver and AutoFit need no other change.
 */
export function modernSharedPercentWidth(
  tableWidth: PreferredWidth,
  containerWidthPt: number,
  rulePt: number
): PreferredWidth {
  if (tableWidth.type !== 'pct' || !(containerWidthPt > 0) || !(rulePt > 0)) return tableWidth;
  if (rulePt >= containerWidthPt) return tableWidth;
  return {
    type: 'pct',
    value: (tableWidth.value * (containerWidthPt - rulePt)) / containerWidthPt,
  };
}

/**
 * The width of a top-level spaced percentage table in the legacy modes, as a share of the
 * container: the share of the text column widened by four spacing gaps, the outer cell
 * margins (half a point at least) and both outer frame rules, plus half those rules. The
 * result is the frame's outer extent. The margins are those of the cells on the outer grid
 * columns. Measured without a compatibility mode declaration, with 25 to 100% widths,
 * spacing of 5 and 15pt, outer rules of 0, 0.5 and 6pt on either side and cell margins of 0
 * and 5.4pt: thirteen tables to within 0.25pt. A 100% table overhangs both text edges.
 */
export function legacySpacedPercentWidth(
  tableWidth: PreferredWidth,
  containerWidthPt: number,
  cellSpacingPt: number,
  borders: TableBorderBox,
  rows: readonly SemanticTableRow[],
  columnCount: number
): PreferredWidth {
  if (tableWidth.type !== 'pct' || !(containerWidthPt > 0) || !(cellSpacingPt > 0))
    return tableWidth;
  const margins = outerCellMarginsPt(rows, columnCount);
  const leftMarginPt = Math.max(margins.left, 0.5);
  const rightMarginPt = Math.max(margins.right, 0.5);
  const rulesPt = outerBandPt(borders.left) + outerBandPt(borders.right);
  const boxPt = containerWidthPt + 4 * cellSpacingPt + leftMarginPt + rightMarginPt + rulesPt;
  const widthPt = (tableWidth.value / 100) * boxPt + rulesPt / 2;
  return Number.isFinite(widthPt)
    ? { type: 'pct', value: (widthPt / containerWidthPt) * 100 }
    : tableWidth;
}

/**
 * The width of a top-level spaced right-to-left percentage table in the legacy modes, as a
 * share of the container: the share of the text column widened by two spacing gaps, the outer
 * cell margins (half a point at least) and one more point, plus half the outer frame rules.
 * The result is the frame's outer extent, as for a left-to-right table. Measured in mode 14
 * with 30 to 100% widths, spacing of 5, 10 and 15pt, outer rules of 0.5, 3 and 6pt on either
 * side and cell margins of 0, 2.7 and 5.4pt: seventeen tables to within 0.25pt. The other
 * legacy modes take the same rule unmeasured, as they take the left-to-right one.
 */
export function legacySpacedBidiPercentWidth(
  tableWidth: PreferredWidth,
  containerWidthPt: number,
  cellSpacingPt: number,
  borders: TableBorderBox,
  margins: { readonly left: number; readonly right: number }
): PreferredWidth {
  if (tableWidth.type !== 'pct' || !(containerWidthPt > 0) || !(cellSpacingPt > 0))
    return tableWidth;
  const marginsPt = Math.max(margins.left, 0.5) + Math.max(margins.right, 0.5);
  const rulesPt = outerBandPt(borders.left) + outerBandPt(borders.right);
  const boxPt = containerWidthPt + 2 * cellSpacingPt + marginsPt + 1;
  const widthPt = (tableWidth.value / 100) * boxPt + rulesPt / 2;
  return Number.isFinite(widthPt)
    ? { type: 'pct', value: (widthPt / containerWidthPt) * 100 }
    : tableWidth;
}

/**
 * The `w:left` margin of the first cell and the `w:right` margin of the last cell, as authored
 * in either direction: the first cells that reach the outer grid columns, as a row may skip
 * either end.
 */
function outerCellMarginsPt(
  rows: readonly SemanticTableRow[],
  columnCount: number
): { readonly left: number; readonly right: number } {
  const first = rows.find((row) => row.cells[0]?.gridColumn === 0)?.cells[0];
  let last: SemanticTableRow['cells'][number] | undefined;
  for (const row of rows) {
    const cell = row.cells.at(-1);
    if (cell && cell.gridColumn + cell.gridSpan === columnCount) {
      last = cell;
      break;
    }
  }
  return { left: first?.margins.left ?? 0, right: last?.margins.right ?? 0 };
}

export interface TableWidthPlacement {
  readonly legacy: LegacyTableContentWidth | undefined;
  /** The width preference the column resolver reads. */
  readonly tableWidth: PreferredWidth;
  /** The box the column resolver measures against. */
  readonly contentWidthPt: number;
  readonly claims: readonly CellWidthClaim[];
  /** The indent that places the table. */
  readonly indentPt: number;
  /** How far a table moves from its aligned place for its outer rules, in points. */
  readonly ruleShiftPt?: number;
  /** See `SemanticTableStructure.textBoxBidiShiftPt`. */
  readonly textBoxBidiShiftPt?: number;
}

/**
 * How far a top-level spaced table moves from its aligned place, so that its frame rules
 * meet the aligned edges: the layout box leaves out the visual right rule, which draws
 * outward. Mode 15 aligns the outer edges of the rules: a centred table centres its whole
 * frame, and a right-to-left one also moves by a quarter of its visual left rule. The legacy
 * modes align the rules' centres; a right-aligned left-to-right table aligns its content
 * there instead (`legacyFixedTableContentOffset`). Modes outside both classes take the
 * mode-15 geometry, as their percentage widths do. Measured with spacing of 5pt, outer rules
 * of 0.5 and 6pt on either side, absolute, percentage and automatic widths: left-to-right
 * tables in every alignment, and right-to-left tables left-aligned or centred, every table to
 * within 0.3pt. A right-to-left table with `w:jc="right"` follows the next rule.
 *
 * A right-to-left table with `w:jc="right"` sits on the visual left edge. It centres its
 * visual left rule on that edge, and the legacy modes move it a further spacing gap, its
 * `w:left` margin of its first cell (half a point at least) and half a point outward.
 * Measured in modes 14 and 15 with absolute, percentage and automatic widths, spacing of 5, 10
 * and 15pt, outer rules of 0.5, 3 and 6pt, and table and cell margins of 0 to 10.8pt on either
 * side: every table to within 0.3pt.
 */
function spacedFrameShiftPt(
  borders: TableBorderBox,
  table: {
    readonly bidiVisual?: boolean;
    readonly alignment: TableAlignment;
    readonly depth: number;
    readonly textBox?: boolean;
    readonly floating?: boolean;
    readonly cellSpacingPt: number;
    readonly compatibilityMode?: number;
    /** The `w:left` margin of the first cell, which a right-to-left table moves by. */
    readonly leadingLeftMarginPt?: number;
  }
): number {
  if (table.depth > 0 || table.textBox || table.floating || !(table.cellSpacingPt > 0)) return 0;
  // The visual right rule of a right-to-left table is its `w:left` border.
  const right = outerBandPt(table.bidiVisual ? borders.left : borders.right);
  const left = outerBandPt(table.bidiVisual ? borders.right : borders.left);
  const modern = !hasCompatibilityRule(table.compatibilityMode, 'legacySpacedFrameRuleCenters');
  if (table.alignment === 'center') {
    if (!modern) return -(left + right) / 4;
    return table.bidiVisual ? -right / 2 - left / 4 : -right / 2;
  }
  if (table.bidiVisual && table.alignment === 'right') {
    if (modern) return -left / 2;
    const marginPt = Math.max(table.leadingLeftMarginPt ?? 0, 0.5);
    return -left / 2 - (table.cellSpacingPt + marginPt + 0.5);
  }
  if (table.bidiVisual) return modern ? -right : -right / 2;
  return table.alignment === 'right' && modern ? -right : 0;
}

/**
 * How far right a top-level right-to-left table in a text box sits from the mirrored
 * left-to-right geometry: 15 twips, in every mode and for every width type. Measured on
 * reference renderings of inline text boxes 2880 and 4320 twips wide, with percentage,
 * absolute and automatic widths, leading, trailing and centred alignment, and cell margins
 * of 0 and 108 twips: every grid line sat 0.72 to 0.96pt right, at the renderer's 0.24pt
 * position resolution.
 */
const TEXT_BOX_BIDI_SHIFT_PT = 0.75;

export function resolveTableWidthPlacement(input: {
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
  readonly layoutFixed: boolean;
  readonly alignment: TableAlignment;
  readonly bidiVisual: boolean;
  readonly indentPt: number;
  /** A direct or style `w:tblInd` states the indent. */
  readonly indentStated: boolean;
  /** The authored width of leading columns no cell reaches (`leadingSkipPt`). */
  readonly leadingSkipPt?: number;
  readonly tableBorders: TableBorderBox;
  readonly claims: readonly CellWidthClaim[];
  readonly gridCols: readonly OoxmlElement[];
  /** A top-level table of a text box story. */
  readonly textBox?: boolean;
}): TableWidthPlacement {
  const { depth, tableWidth, contentWidthPt, rows } = input;
  const reference = legacyTableContentWidth({
    ...input,
    outerRulesPt: outerSideRulesPt(input.tableBorders, rows, input.bidiVisual),
  });
  const legacy =
    reference && input.textBox ? textBoxLegacyContentWidth(reference, tableWidth) : reference;
  const legacyPercent = hasCompatibilityRule(
    input.compatibilityMode,
    'legacyPercentTableContentWidth'
  );
  // A nested table, and every table outside the legacy modes, adds its outer rule to the share.
  // A top-level spaced inline table in the legacy modes widens its share by its frame.
  const legacySpaced = legacy === undefined && legacyPercent && depth === 0 && !input.floating;
  // Only a spaced right-to-left table reads its outer cell margins.
  const outerMargins =
    input.bidiVisual && input.cellSpacingPt > 0
      ? outerCellMarginsPt(rows, input.columnCount)
      : { left: 0, right: 0 };
  const resolvedWidth =
    legacySpaced && !input.textBox && input.bidiVisual
      ? legacySpacedBidiPercentWidth(
          tableWidth,
          contentWidthPt,
          input.cellSpacingPt,
          input.tableBorders,
          outerMargins
        )
      : legacySpaced && !input.textBox
        ? legacySpacedPercentWidth(
            tableWidth,
            contentWidthPt,
            input.cellSpacingPt,
            input.tableBorders,
            rows,
            input.columnCount
          )
        : legacy === undefined && (depth > 0 || !legacyPercent)
          ? ruleAdjustedTableWidth(
              tableWidth,
              contentWidthPt,
              input.tableBorders,
              rows,
              input.bidiVisual
            )
          : tableWidth;
  // With neither a table style nor a stated indent, a leading-aligned legacy table sits as if
  // indented by its leading cell margin: its outer edge, not its content, meets the text edge.
  const leading = input.alignment === 'left' && !input.bidiVisual;
  // Measured for top-level inline tables only.
  const skipPt =
    leading && !input.indentStated && depth === 0 && !input.floating
      ? (input.leadingSkipPt ?? 0)
      : 0;
  const indentPt =
    skipPt +
    (legacy && leading && !input.indentStated && input.propertyNodes.length === 0
      ? (rows[0]?.cells[0]?.margins.left ?? 0)
      : input.indentPt);
  // A top-level AutoFit table without a width fits the room its leading indent leaves.
  const autoRoomPt =
    tableWidth.type === 'auto' &&
    !input.layoutFixed &&
    depth === 0 &&
    !input.floating &&
    input.alignment === 'left'
      ? Math.max(0, indentPt)
      : 0;
  // A nested table without a width of its own may also use its outer margins in older modes.
  const nestedRoomPt = legacy ? undefined : legacyNestedAutoRoomPt(input);
  // A right-to-left table mirrors the left-to-right geometry, then sits half its mean outer
  // side rule further toward its visual left.
  const sides =
    input.bidiVisual &&
    depth === 0 &&
    !input.textBox &&
    !input.floating &&
    input.cellSpacingPt === 0 &&
    hasCompatibilityRule(input.compatibilityMode, 'modernBidiTableRuleShift')
      ? outerSideRulesPt(input.tableBorders, rows, true)
      : undefined;
  const shift = sides
    ? -(sides.left + sides.right) / 4
    : spacedFrameShiftPt(input.tableBorders, {
        ...input,
        depth,
        leadingLeftMarginPt: outerMargins.left,
      });
  const textBoxShift =
    input.bidiVisual &&
    input.textBox &&
    depth === 0 &&
    !input.floating &&
    input.cellSpacingPt === 0;
  return {
    ...(shift < 0 ? { ruleShiftPt: shift } : {}),
    ...(textBoxShift ? { textBoxBidiShiftPt: TEXT_BOX_BIDI_SHIFT_PT } : {}),
    legacy,
    tableWidth: resolvedWidth,
    contentWidthPt: nestedRoomPt ?? (legacy?.widthPt ?? contentWidthPt) - autoRoomPt,
    claims: legacy?.gridConfirmed
      ? legacyRoundedCellClaims(
          input.claims,
          input.gridCols,
          (legacy.widthPt * tableWidth.value) / 100
        )
      : input.claims,
    indentPt,
  };
}
