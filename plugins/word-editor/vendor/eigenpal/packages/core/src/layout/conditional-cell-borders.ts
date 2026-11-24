import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { mergeCellDiagonalBorders } from './table-border-cascade.ts';
import { EMPTY_CELL_BORDER_BOX, readCellBorders, type CellBorderBox } from './table-borders.ts';

/** Resolve basedOn diagonals within one condition before the next condition takes precedence. */
export function readConditionalCellBorders(
  properties: OoxmlElement | undefined,
  layers: readonly OoxmlElement[] = []
): CellBorderBox {
  let diagonals = EMPTY_CELL_BORDER_BOX;
  for (const layer of layers) {
    const tcPr = layer.children.find(
      (child) => child.kind !== 'textValue' && child.localName === 'tcPr'
    );
    diagonals = mergeCellDiagonalBorders(
      diagonals,
      readCellBorders(tcPr?.kind !== 'textValue' ? tcPr : undefined)
    );
  }
  // Physical sides retain the existing resolved-condition path.
  return mergeCellDiagonalBorders(readCellBorders(properties), diagonals);
}
