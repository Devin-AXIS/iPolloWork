// Vertical alignment metadata for table-cell layout.

import type { OoxmlElement } from '@docx-editor.dev/core/store';

/** `w:vAlign` — where a cell's content sits when the row is taller than the content. */
export type CellVerticalAlign = 'top' | 'center' | 'bottom';

/** Read `w:tcPr/w:vAlign`, defaulting absent or unsupported values to Word's top alignment. */
export function readCellVerticalAlign(cellProperties: OoxmlElement | undefined): CellVerticalAlign {
  let node: OoxmlElement | undefined;
  for (const child of cellProperties?.children ?? []) {
    if (child.kind !== 'textValue' && child.localName === 'vAlign') {
      node = child;
      break;
    }
  }
  const value = node?.attributes.find((attribute) => attribute.localName === 'val')?.value;
  if (value === 'center') return 'center';
  if (value === 'bottom') return 'bottom';
  return 'top';
}
