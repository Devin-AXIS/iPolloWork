import type { TableCellFragmentRecord } from '../layout/semantic-records.ts';

/** Content host for a table cell, rotated only when layout published a `btLr` plane. */
export function tableCellContentHost(
  document: Document,
  cell: TableCellFragmentRecord,
  scale: number,
  cellElement: HTMLElement
): HTMLElement {
  if (cell.textDirection !== 'btLr') return cellElement;
  const content = document.createElement('div');
  content.className = 'docx-table-cell-content-btlr';
  content.style.position = 'absolute';
  content.style.left = '0';
  content.style.top = '0';
  content.style.width = `${cell.box.height * scale}px`;
  content.style.height = `${cell.box.width * scale}px`;
  content.style.transformOrigin = '0 0';
  content.style.transform = `translateY(${cell.box.height * scale}px) rotate(-90deg)`;
  cellElement.append(content);
  return content;
}
