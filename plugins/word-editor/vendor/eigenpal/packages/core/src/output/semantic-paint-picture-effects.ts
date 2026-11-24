// Effects that change how a picture itself paints: soft edges that fade it out at its edge,
// and a reflection, a mirror image below it that fades out downward.
//
// Trust boundary: every value is a finite number from the projection; styles are set through
// the CSSOM, never from strings of file data.

import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../layout/drawing-layout.ts';

const EMU_PER_POINT = 12_700;

function px(value: number): string {
  return `${Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0}px`;
}

/**
 * The opacity a soft edge of radius `r` leaves at distance `d` inside the edge: clear at the
 * edge, half at nine tenths of the radius, and whole by about 1.7 radii.
 */
const SOFT_EDGE_STOPS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.5, 0.1],
  [0.9, 0.5],
  [1.3, 0.9],
  [1.7, 1],
];

function edgeGradient(direction: 'right' | 'bottom', radius: number): string {
  const near = SOFT_EDGE_STOPS.map(([at, alpha]) => `rgba(0,0,0,${alpha}) ${px(at * radius)}`);
  const far = [...SOFT_EDGE_STOPS]
    .reverse()
    .map(([at, alpha]) => `rgba(0,0,0,${alpha}) calc(100% - ${px(at * radius)})`);
  return `linear-gradient(to ${direction}, ${[...near, ...far].join(', ')})`;
}

/** Fade the picture's frame out at its edges over `radius` CSS pixels. */
export function applySoftEdge(frame: HTMLElement, radius: number): void {
  if (!(radius > 0)) return;
  const mask = `${edgeGradient('right', radius)}, ${edgeGradient('bottom', radius)}`;
  frame.style.setProperty('mask-image', mask);
  frame.style.setProperty('-webkit-mask-image', mask);
  frame.style.setProperty('mask-composite', 'intersect');
  frame.style.setProperty('-webkit-mask-composite', 'source-in');
}

/**
 * A mirror image of the picture's frame below it, fading from the reflection's start opacity
 * to its end opacity over its end position, and clear below that.
 */
export function appendReflection(
  document: Document,
  outer: HTMLElement,
  frame: HTMLElement,
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  scale: number
): void {
  const reflection = drawing.frameEffects?.reflection;
  if (!reflection) return;
  const unit = scale / EMU_PER_POINT;
  const width = Number.parseFloat(frame.style.width) || 0;
  const height = Number.parseFloat(frame.style.height) || 0;
  const top = (Number.parseFloat(frame.style.top) || 0) + height;
  const wrap = document.createElement('div');
  wrap.className = 'docx-drawing-reflection';
  wrap.style.position = 'absolute';
  wrap.style.left = frame.style.left;
  wrap.style.top = px(top + reflection.distanceEmu * unit);
  wrap.style.width = px(width);
  wrap.style.height = px(height * reflection.endPosition);
  wrap.style.overflow = 'hidden';
  wrap.style.pointerEvents = 'none';
  const fade = `linear-gradient(to bottom, rgba(0,0,0,${reflection.startAlpha}), rgba(0,0,0,${reflection.endAlpha}))`;
  wrap.style.setProperty('mask-image', fade);
  wrap.style.setProperty('-webkit-mask-image', fade);
  const copy = frame.cloneNode(true) as HTMLElement;
  copy.style.left = '0';
  copy.style.top = '0';
  copy.style.transformOrigin = 'center';
  copy.style.transform = 'scaleY(-1)';
  if (reflection.blurEmu > 0) copy.style.filter = `blur(${px((reflection.blurEmu / 4) * unit)})`;
  wrap.append(copy);
  outer.append(wrap);
  outer.style.overflow = 'visible';
}
