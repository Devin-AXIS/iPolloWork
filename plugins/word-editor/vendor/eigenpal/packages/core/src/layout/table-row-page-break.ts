// `w:pageBreakBefore` on a body table row.
//
// A row starts a new page when the FIRST paragraph of its FIRST cell resolves
// `w:pageBreakBefore` (§17.3.1.23) through the full cascade: document defaults, table style,
// paragraph style chain, then direct formatting, last value winning. The same property on a
// later paragraph of that cell or on another cell's paragraph does nothing, and so does a
// manual page break inside any cell. Only the body flow asks: a nested table's rows never
// break the page. Positioned (`w:tblpPr`) tables do not yet support this row-break rule.
//
// From Word 2013 layout on, a row whose previous row keeps with the next (`w:keepNext`,
// `table-row-keeps.ts`) does not start a new page: `rowStartsPage` there decides.
//
// Limit: a row that continues a vertical merge in ANY column ignores the property. Splitting
// a merged cell's text across the page break is not supported, so such a row keeps the
// placement it had without the property. A merge head row and a row after a merge ends
// still break.

import type { SemanticTableRow } from './semantic-table.ts';
import { propertiesOf } from './paragraph-flow.ts';
import { paragraphBreaksBefore } from './paragraph-style.ts';
import { cascadeParagraphFormatting, type StyleCascadeTable } from './style-cascade.ts';
import { findParagraphProperties } from './style-definition-reader.ts';

/**
 * Whether `row` asks to start on a new page.
 *
 * A row with a vertically merged continuation cell in any column never asks: merged text
 * does not yet paginate across a row break. The rule also excludes a first cell that opens
 * with a nested table instead of a paragraph.
 */
export function rowBreaksPageBefore(
  row: SemanticTableRow,
  styleCascade: StyleCascadeTable | undefined
): boolean {
  if (row.cells.some((candidate) => candidate.vMergeContinue)) return false;
  const cell = row.cells[0];
  if (!cell) return false;
  const first = cell.blocks[0];
  if (first?.kind !== 'paragraph') return false;
  const pPr = findParagraphProperties(first);
  const props = styleCascade
    ? cascadeParagraphFormatting(styleCascade, pPr, cell.styleFormatting).paragraphProperties
    : propertiesOf(pPr);
  return paragraphBreaksBefore(props);
}
