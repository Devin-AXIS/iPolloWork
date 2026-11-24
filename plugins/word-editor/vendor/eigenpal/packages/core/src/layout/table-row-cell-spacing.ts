import { flattenContentControls, type OoxmlElement } from '@docx-editor.dev/core/store';
import { wmlRevisionChild } from './revision-cell-shading.ts';
import { MAX_CELL_MARGIN_PT } from './table-cell-margins.ts';
import { preferredLengthPt } from './table-widths.ts';

function childNamed(node: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of node.children) {
    if (child.kind !== 'textValue' && child.localName === localName) return child;
  }
  return undefined;
}

/**
 * `w:trPr/w:tblCellSpacing` (17.4.44) when every row states the same value and the table
 * states none. A value shared by all rows is the table's spacing; rows that differ are an
 * exception this layout does not model, so they keep the table's own spacing.
 */
export function uniformRowCellSpacingPt(table: OoxmlElement): number | undefined {
  let spacing: number | undefined;
  for (const rowNode of flattenContentControls(table.children)) {
    if (rowNode.kind !== 'tableRow') continue;
    const properties = wmlRevisionChild(rowNode, 'trPr');
    const value = preferredLengthPt(
      properties && childNamed(properties, 'tblCellSpacing'),
      MAX_CELL_MARGIN_PT
    );
    if (value === undefined || (spacing !== undefined && Math.abs(value - spacing) > 0.001))
      return undefined;
    spacing = value;
  }
  return spacing;
}
