// VML text art (a text watermark, or WordArt on the line) as inline SVG.
//
// Layout fitted the glyph outlines into the unrotated box; paint draws that path and turns
// the box about its centre. Without outlines it draws the text through the same fit. Text art
// an installed layout drew paints its vector components instead.
//
// Trust boundary: colours are validated 6-digit sRGB, the path is engine-generated M/L/Q/C/Z
// data, the font family was validated at projection, and every node is built with
// createElementNS/setAttribute/textContent only.
import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../layout/drawing-layout.ts';
import type { DrawingTextArtRecord } from '../layout/drawing-text-art.ts';
import type { LayoutBox } from '../layout/semantic-records.ts';
import { appendVectorComponent } from './semantic-paint-vector-shape.ts';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const EMU_PER_POINT = 12_700;

const num = (value: number) => (Number.isFinite(value) ? String(value) : '0');

function ink(target: SVGElement, art: DrawingTextArtRecord): void {
  target.setAttribute('fill', art.fillHex !== null ? `#${art.fillHex}` : 'none');
  if (art.fillHex !== null && art.fillAlpha < 1)
    target.setAttribute('fill-opacity', num(Math.max(0, art.fillAlpha)));
  if (art.strokeHex === null) return;
  target.setAttribute('stroke', `#${art.strokeHex}`);
  target.setAttribute('stroke-width', num(art.strokeWidthPt));
  target.setAttribute('stroke-linejoin', 'round');
  if (art.strokeAlpha < 1) target.setAttribute('stroke-opacity', num(Math.max(0, art.strokeAlpha)));
}

/**
 * The painted element for a drawing that carries `textArt`, floating or on the line,
 * positioned in its paint bounds. It is a picture: no selection binding, no pointer target.
 */
export function paintTextArt(
  document: Document,
  drawing: (AnchoredDrawingRecord | InlineDrawingRecord) & {
    readonly textArt: DrawingTextArtRecord;
  },
  scale: number,
  unbound: boolean,
  origin?: LayoutBox
): HTMLElement {
  const art = drawing.textArt;
  const paint = drawing.paintBounds;
  const outer = document.createElement('div');
  outer.className = 'docx-drawing docx-drawing-text-art';
  if (!unbound) outer.dataset.drawingNodeId = drawing.drawingNodeId;
  outer.style.position = 'absolute';
  outer.style.left = `${(paint.x - (origin?.x ?? 0)) * scale}px`;
  outer.style.top = `${(paint.y - (origin?.y ?? 0)) * scale}px`;
  outer.style.width = `${paint.width * scale}px`;
  outer.style.height = `${paint.height * scale}px`;
  outer.style.overflow = 'hidden';
  outer.style.pointerEvents = 'none';
  outer.setAttribute('role', 'img');
  outer.setAttribute('aria-label', drawing.accessibility.label || art.text);

  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('viewBox', `0 0 ${num(drawing.width)} ${num(drawing.height)}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.style.left = `${(drawing.x - paint.x) * scale}px`;
  svg.style.top = `${(drawing.y - paint.y) * scale}px`;
  svg.style.width = `${drawing.width * scale}px`;
  svg.style.height = `${drawing.height * scale}px`;
  svg.style.overflow = 'visible';
  if (art.rotationDegrees) {
    svg.style.transformOrigin = '50% 50%';
    svg.style.transform = `rotate(${num(art.rotationDegrees)}deg)`;
  }

  if (art.components) {
    // An installed text art layout drew the text as vector components in box EMU.
    svg.setAttribute(
      'viewBox',
      `0 0 ${num(drawing.width * EMU_PER_POINT)} ${num(drawing.height * EMU_PER_POINT)}`
    );
    for (const component of art.components) appendVectorComponent(document, svg, component);
  } else if (art.path !== null) {
    const path = document.createElementNS(SVG_NAMESPACE, 'path');
    path.setAttribute('d', art.path);
    ink(path, art);
    svg.append(path);
  } else if (art.fit !== null) {
    const text = document.createElementNS(SVG_NAMESPACE, 'text');
    const { scaleX, scaleY, offsetX, offsetY } = art.fit;
    text.setAttribute(
      'transform',
      `matrix(${num(scaleX)} 0 0 ${num(scaleY)} ${num(offsetX)} ${num(offsetY)})`
    );
    text.setAttribute('font-family', art.fontFamily);
    text.setAttribute('font-size', num(art.fontSizePt));
    text.setAttribute('font-weight', art.bold ? 'bold' : 'normal');
    text.setAttribute('font-style', art.italic ? 'italic' : 'normal');
    text.setAttribute('xml:space', 'preserve');
    ink(text, art);
    text.textContent = art.text;
    svg.append(text);
  }
  outer.append(svg);
  return outer;
}
