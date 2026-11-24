// Box placement and accessibility shared by the drawing painters.

import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../layout/drawing-layout.ts';
import type { LayoutBox } from '../layout/semantic-records.ts';

export function applyAccessibility(
  element: HTMLElement,
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  interactive: boolean
): void {
  const { accessibility } = drawing;
  if (accessibility.hidden) return;
  element.setAttribute('role', interactive ? 'link' : 'img');
  if (accessibility.label) {
    element.setAttribute('aria-label', accessibility.label);
  } else if (!interactive) {
    element.setAttribute('aria-hidden', 'true');
  }
}

export function positionedBox(
  element: HTMLElement,
  box: LayoutBox,
  scale: number,
  origin?: LayoutBox
): void {
  const ox = origin?.x ?? 0;
  const oy = origin?.y ?? 0;
  element.style.position = 'absolute';
  element.style.left = `${(box.x - ox) * scale}px`;
  element.style.top = `${(box.y - oy) * scale}px`;
  element.style.width = `${box.width * scale}px`;
  element.style.height = `${box.height * scale}px`;
  element.style.boxSizing = 'border-box';
  element.style.overflow = 'hidden';
  element.style.pointerEvents = 'auto';
}
