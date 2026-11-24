// A selection-inert, bounded SVG viewport. No hit targets, text or DOM measurement.
import type { ResolvedCellBorders } from '../layout/table-borders.ts';
const NS = 'http://www.w3.org/2000/svg';
export function paintCellDiagonals(
  document: Document,
  element: HTMLElement,
  borders: ResolvedCellBorders | undefined,
  scale: number
): void {
  const records = borders?.diagonals;
  if (!records?.length) return;
  const first = records[0]!;
  const svg = document.createElementNS(NS, 'svg');
  svg.classList.add('docx-table-cell-diagonals');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('contenteditable', 'false');
  svg.setAttribute('viewBox', `0 0 ${first.clipWidth} ${first.clipHeight}`);
  svg.setAttribute('width', String(first.clipWidth * scale));
  svg.setAttribute('height', String(first.clipHeight * scale));
  Object.assign(svg.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '1',
  });
  for (const stroke of records) {
    const line = document.createElementNS(NS, 'line');
    line.dataset.diagonal = stroke.direction;
    for (const key of ['x1', 'y1', 'x2', 'y2'] as const)
      line.setAttribute(key, String(stroke[key]));
    line.setAttribute('stroke', `#${stroke.color ?? '000000'}`);
    line.setAttribute('stroke-width', String(stroke.widthPt));
    line.setAttribute('stroke-linecap', 'butt');
    if (stroke.cssStyle !== 'solid')
      line.setAttribute(
        'stroke-dasharray',
        `${stroke.widthPt * (stroke.cssStyle === 'dotted' ? 1 : 3)} ${stroke.widthPt * 2}`
      );
    svg.append(line);
  }
  element.append(svg);
}
