// Where a legacy table places each row across its text column.
//
// A row can state its own alignment in its table property exception, `w:tblPrEx/w:jc`
// (17.4.61, 17.4.28). The legacy modes place that row by it; compatibility mode 15 ignores
// it. Measured in modes 11, 12 and 14, one-column and two-column tables, fixed and AutoFit
// layouts, absolute and automatic widths:
//
// - A centred row centres its outer edges in the text column. Its cell margins and the
//   table's indent do not move it.
// - A trailing-aligned row puts its trailing outer edge past the text edge by the leading
//   margin of its own first cell. That margin comes from the row's `w:tblCellMar`
//   exception (17.4.60, 17.4.42), the table's margins, or the cell's `w:tcMar`; the
//   trailing margins do not count. A table aligned to the trailing edge places every row
//   this way, so a row whose leading margin differs moves.
// - Leading-aligned rows share one origin: the leading content edge of the first of them
//   meets the text edge, moved by the table's indent. A later row whose margins differ
//   keeps that origin.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { wmlChildNamed } from '../store/store/tree-op-table-shared.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import { readTableAlignment } from './table-alignment.ts';
import { tableOriginX } from './table-origin.ts';
import type { SemanticTableRow, SemanticTableStructure, TableAlignment } from './semantic-table.ts';

/** The row's `w:tblPrEx/w:jc`, as a spread for the row record. */
export function rowExceptionAlignment(row: OoxmlElement): Pick<SemanticTableRow, 'alignment'> {
  const alignment = readTableAlignment(wmlChildNamed(row, 'tblPrEx'));
  return alignment ? { alignment } : {};
}

interface PlacementContext {
  readonly compatibilityMode: number | undefined;
  readonly depth: number;
  readonly contentWidthPt: number;
}

/** The effective alignment of a row: its own, or the table's. */
export function rowAlignment(
  row: SemanticTableRow,
  structure: Pick<SemanticTableStructure, 'alignment'>
): TableAlignment {
  return row.alignment ?? structure.alignment;
}

/**
 * Whether a legacy table places its rows one by one: a top-level inline left-to-right table
 * without cell spacing, with an absolute width, or an automatic one.
 */
export function placesRowsAlone(
  structure: Pick<
    SemanticTableStructure,
    'bidiVisual' | 'float' | 'textBox' | 'cellSpacingPt' | 'tableWidth'
  >,
  context: Pick<PlacementContext, 'compatibilityMode' | 'depth'>
): boolean {
  return (
    hasCompatibilityRule(context.compatibilityMode, 'rowExceptionAlignment') &&
    context.depth === 0 &&
    !structure.bidiVisual &&
    !structure.float &&
    !structure.textBox &&
    structure.cellSpacingPt === 0 &&
    (structure.tableWidth.type === 'dxa' || structure.tableWidth.type === 'auto')
  );
}

/** The leading margin of a row's first cell, which places a trailing-aligned row. */
export function trailingPlacementInsetPt(row: SemanticTableRow): number | undefined {
  const margin = row.cells[0]?.margins.left;
  return margin !== undefined && Number.isFinite(margin) && margin >= 0 ? margin : undefined;
}

/**
 * `structure` with each row's move from the table's grid origin. Rows that keep the origin
 * carry no move; a structure none of whose rows move comes back by identity.
 */
export function withLegacyRowPlacement(
  structure: SemanticTableStructure,
  context: PlacementContext
): SemanticTableStructure {
  if (!placesRowsAlone(structure, context)) return structure;
  const tableAlignment = structure.alignment;
  const differs = structure.rows.some((row) => rowAlignment(row, structure) !== tableAlignment);
  // A trailing-aligned table places its rows by their own margins only where it places its
  // content edge at all.
  const contentPlaced = structure.legacyContentOffsetPt !== undefined;
  if (!differs && !(tableAlignment === 'right' && contentPlaced)) return structure;
  const container = context.contentWidthPt;
  const width = structure.columnWidthsPt.reduce((sum, column) => sum + column, 0);
  const slack = container - width;
  const origin = tableOriginX(structure, container);
  if (!Number.isFinite(slack) || !Number.isFinite(origin)) return structure;
  const leadingRow = structure.rows.find((row) => rowAlignment(row, structure) === 'left');
  const leadingCell = leadingRow?.cells[0];
  const leadingRule = (leadingCell?.contentBorders ?? leadingCell?.borders)?.left;
  // As a leading-aligned table places it: a margin narrower than half the rule starts there.
  const leadingInset =
    leadingCell &&
    Math.max(leadingCell.margins.left, leadingRule?.state === 'edge' ? leadingRule.widthPt / 2 : 0);
  const rows = structure.rows.map((row) => {
    const alignment = rowAlignment(row, structure);
    let x: number | undefined;
    if (alignment === 'center') x = alignment === tableAlignment ? undefined : slack / 2;
    else if (alignment === 'right') {
      const inset = trailingPlacementInsetPt(row);
      x =
        inset === undefined || (alignment === tableAlignment && !contentPlaced)
          ? undefined
          : slack + inset;
    } else if (alignment !== tableAlignment && leadingInset !== undefined)
      x = structure.indentPt - leadingInset;
    const shift = x === undefined ? 0 : x - origin;
    const { xShiftPt: _previous, ...rest } = row;
    if (Math.abs(shift) < 0.001 || !Number.isFinite(shift))
      return row.xShiftPt === undefined ? row : rest;
    return { ...rest, xShiftPt: shift };
  });
  return rows.some((row, index) => row !== structure.rows[index])
    ? { ...structure, rows }
    : structure;
}
