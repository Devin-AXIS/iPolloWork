// Table-cell border paint: scale and draw layout-owned records only.
//
// Conflict resolution, compound stroke/gap/extent/inset math, and corner endpoint
// ownership live in `layout/table-borders.ts`. This module must not invent geometry.

import type {
  ResolvedCellBorders,
  ResolvedTableBorderEdge,
  TableBorderStrokeRecord,
} from '@docx-editor.dev/core/layout';

import { applyDashBackground, applyHatchBackground } from './border-pattern-css.ts';
import { paintCellDiagonals } from './table-cell-diagonal-paint.ts';

const HEX = /^[0-9A-Fa-f]{6}$/;

export type TableBorderSide = 'Top' | 'Right' | 'Bottom' | 'Left';

/** Map a layout-owned table border style to a CSS border-style keyword. */
export function cssBorderStyle(style: ResolvedTableBorderEdge['style']): string {
  switch (style) {
    case 'dashed':
      return 'dashed';
    case 'dotted':
      return 'dotted';
    case 'double':
    case 'triple':
      // Compound edges are drawn from published stroke records, not CSS border-style.
      return 'solid';
    case 'thick':
    case 'single':
    default:
      return 'solid';
  }
}

function hexColor(color: string | null | undefined): string {
  return color && HEX.test(color) ? color : '000000';
}

/** Selection-inert overlay shell for layout-owned stroke records. */
function createTableBorderOverlay(document: Document, className: string): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.className = className;
  overlay.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('contenteditable', 'false');
  overlay.style.position = 'absolute';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.right = '0';
  overlay.style.bottom = '0';
  overlay.style.overflow = 'visible';
  overlay.style.pointerEvents = 'none';
  overlay.style.boxSizing = 'border-box';
  return overlay;
}

function applyCssEdge(
  element: HTMLElement,
  side: TableBorderSide,
  edge: ResolvedTableBorderEdge | undefined,
  scale: number
): void {
  if (!edge) return;
  const color = `#${hexColor(edge.color)}`;
  const widthPx = `${Math.max(0, edge.widthPt * scale)}px`;
  element.style[`border${side}Width` as 'borderTopWidth'] = widthPx;
  element.style[`border${side}Color` as 'borderTopColor'] = color;
  // Compound sides: CSS would collapse thin doubles; strokes carry the geometry.
  if (edge.style === 'double' || edge.style === 'triple') {
    element.style[`border${side}Style` as 'borderTopStyle'] = 'none';
    return;
  }
  element.style[`border${side}Style` as 'borderTopStyle'] = cssBorderStyle(edge.style);
}

function appendStroke(
  document: Document,
  host: HTMLElement,
  stroke: TableBorderStrokeRecord,
  scale: number,
  className: string
): HTMLElement {
  const seg = document.createElement('div');
  seg.className = className;
  seg.dataset.edge = stroke.side;
  seg.dataset.stroke = stroke.role;
  seg.style.position = 'absolute';
  seg.style.left = `${stroke.x * scale}px`;
  seg.style.top = `${stroke.y * scale}px`;
  seg.style.width = `${stroke.width * scale}px`;
  seg.style.height = `${stroke.height * scale}px`;
  seg.style.pointerEvents = 'none';
  const vertical = stroke.side === 'left' || stroke.side === 'right';
  if (stroke.hatch) applyHatchBackground(seg, hexColor(stroke.color), scale);
  else if (stroke.dashPt)
    applyDashBackground(seg, hexColor(stroke.color), stroke.dashPt, vertical, scale);
  else if (stroke.cssStyle === 'solid') seg.style.backgroundColor = `#${hexColor(stroke.color)}`;
  else {
    const horizontal = stroke.side === 'top' || stroke.side === 'bottom';
    seg.style.boxSizing = 'border-box';
    seg.style[horizontal ? 'borderTop' : 'borderLeft'] =
      `${(horizontal ? stroke.height : stroke.width) * scale}px ${stroke.cssStyle} #${hexColor(stroke.color)}`;
  }
  host.append(seg);
  return seg;
}

/** One pass over published strokes — O(n) role lookup per stroke during paint. */
function strokeRoleIndex(strokes: readonly TableBorderStrokeRecord[]): Set<string> {
  const roles = new Set<string>();
  for (const stroke of strokes) {
    roles.add(`${stroke.side}\0${stroke.role}`);
  }
  return roles;
}

function paintPublishedStrokes(
  document: Document,
  element: HTMLElement,
  strokes: readonly TableBorderStrokeRecord[],
  scale: number
): HTMLElement[] {
  const roles = strokeRoleIndex(strokes);
  const hasMiddleOnSide = (side: TableBorderStrokeRecord['side']): boolean =>
    roles.has(`${side}\0middle`);

  const doubleHost = createTableBorderOverlay(document, 'docx-table-border-double');
  const tripleHost = createTableBorderOverlay(document, 'docx-table-border-triple');
  const edgeHost = createTableBorderOverlay(document, 'docx-table-border-edge');
  // A shared horizontal band runs DOWNWARD out of the cell that owns it, into the row below.
  // Painted cells are positioned siblings, so without a z-index the next row's `w:shd`
  // background would cover the rule it is supposed to sit under.
  for (const host of [doubleHost, tripleHost, edgeHost]) host.style.zIndex = '1';
  let hasDouble = false;
  let hasTriple = false;
  let hasEdge = false;
  const painted: HTMLElement[] = [];

  for (const stroke of strokes) {
    if (stroke.role === 'edge') {
      hasEdge = true;
      painted.push(
        appendStroke(document, edgeHost, stroke, scale, 'docx-table-border-edge-stroke')
      );
      continue;
    }
    if (hasMiddleOnSide(stroke.side)) {
      hasTriple = true;
      painted.push(
        appendStroke(document, tripleHost, stroke, scale, 'docx-table-border-triple-stroke')
      );
      continue;
    }
    if (stroke.role === 'outer' || stroke.role === 'inner') {
      hasDouble = true;
      painted.push(
        appendStroke(document, doubleHost, stroke, scale, 'docx-table-border-double-stroke')
      );
    }
  }

  if (hasDouble) element.append(doubleHost);
  if (hasTriple) element.append(tripleHost);
  if (hasEdge) element.append(edgeHost);
  return painted;
}

/**
 * Apply layout-owned cell borders: CSS for simple full-side edges, inert overlays for
 * published stroke records. No metrics, gap, conflict, or corner ownership here.
 *
 * Returns the painted stroke elements, which follow record order with any stroke the overlay
 * rules skip left out, or undefined when the cell publishes no strokes.
 */
export function applyCellBorders(
  document: Document,
  element: HTMLElement,
  borders: ResolvedCellBorders | undefined,
  scale: number
): HTMLElement[] | undefined {
  paintCellDiagonals(document, element, borders, scale);
  const publishedSides = new Set((borders?.strokes ?? []).map((stroke) => stroke.side));
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const cssSide = `${side[0]!.toUpperCase()}${side.slice(1)}` as TableBorderSide;
    applyCssEdge(element, cssSide, borders?.[side], scale);
    // Convenience edge metadata must not add a second inward stroke beneath the
    // authoritative layout rectangle (including centered and partial edges).
    if (publishedSides.has(side))
      element.style[`border${cssSide}Style` as 'borderTopStyle'] = 'none';
  }
  if (borders?.strokes && borders.strokes.length > 0) {
    return paintPublishedStrokes(document, element, borders.strokes, scale);
  }
  return undefined;
}
