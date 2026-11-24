import type { OoxmlElement } from '@docx-editor.dev/core/store';
import {
  wmlAttributeValue as attributeValue,
  wmlChildNamed as childNamed,
} from '../store/store/tree-op-table-shared.ts';
import { readTableAlignment } from './table-alignment.ts';
import { readTableFloatPosition, type TableFloatPosition } from './table-float-properties.ts';
import type { TableAlignment } from './semantic-table.ts';
import {
  AUTO_PREFERRED_WIDTH,
  preferredLengthPt,
  readTableIndentPt,
  readTablePreferredWidth,
  type PreferredWidth,
} from './table-widths.ts';

/** The table properties a table style's `w:tblPr` layers state, the last layer winning. */
export interface StyleTableProperties {
  readonly tableWidth: PreferredWidth;
  readonly layoutFixed: boolean | undefined;
  readonly indentPt: number | undefined;
  readonly alignment: TableAlignment | undefined;
  readonly cellSpacingPt: number | undefined;
  readonly float: TableFloatPosition | undefined;
}

/**
 * `w:tblW` and `w:tblLayout` both live in CT_TblPrBase, which is what a table STYLE's
 * `w:tblPr` carries, the same reason `tblCellMar` and `tblBorders` cascade. A style that
 * states "AutoFit to Window" or fixed layout states it for every table that names it.
 * 17.4.52: an absent `w:tblLayout` means autofit.
 */
export function readStyleTableProperties(
  nodes: readonly OoxmlElement[],
  limits: { readonly indentPt: number; readonly cellSpacingPt: number }
): StyleTableProperties {
  let tableWidth = AUTO_PREFERRED_WIDTH;
  let layoutFixed: boolean | undefined;
  let indentPt: number | undefined;
  let alignment: TableAlignment | undefined;
  let cellSpacingPt: number | undefined;
  let float: TableFloatPosition | undefined;
  for (const node of nodes) {
    const width = childNamed(node, 'tblW');
    if (width) tableWidth = readTablePreferredWidth(width);
    const layout = childNamed(node, 'tblLayout');
    if (layout) layoutFixed = attributeValue(layout, 'type') === 'fixed';
    indentPt = readTableIndentPt(childNamed(node, 'tblInd'), limits.indentPt) ?? indentPt;
    alignment = readTableAlignment(node) ?? alignment;
    cellSpacingPt =
      preferredLengthPt(childNamed(node, 'tblCellSpacing'), limits.cellSpacingPt) ?? cellSpacingPt;
    float = readTableFloatPosition(node) ?? float;
  }
  return { tableWidth, layoutFixed, indentPt, alignment, cellSpacingPt, float };
}
