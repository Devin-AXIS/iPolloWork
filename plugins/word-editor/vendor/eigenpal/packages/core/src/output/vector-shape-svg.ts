// SVG support for the vector-shape painter: the viewport of a straight line with a zero
// extent axis, and inset outlines (`a:ln algn="in"`).
import type { VectorShapeProjection } from '../store/package/drawing-projection.ts';
import type { VectorGradient } from '../store/package/drawing-gradient.ts';
import type { VectorPattern } from '../store/package/drawing-pattern-fill.ts';
import type { VectorShapeComponent } from '../store/package/drawing-shape-projection.ts';
import type { LayoutBox } from '../layout/semantic-records.ts';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
let nextClipId = 0;

/**
 * The `viewBox` (in EMU) and the frame box (in layout points) that map a shape onto its
 * content box. A straight vertical or horizontal line has a zero width or height, which would
 * scale that axis, and the stroke drawn across it, to nothing. That axis instead gets a small
 * range around the line at the other axis's scale, so the outline keeps its authored width.
 */
export function vectorShapeViewport(
  shape: VectorShapeProjection,
  content: LayoutBox
): { readonly viewBox: readonly [number, number, number, number]; readonly frame: LayoutBox } {
  const { cx, cy } = shape.extentEmu;
  if (cx > 0 && cy > 0) return { viewBox: [0, 0, cx, cy], frame: content };
  let pad = 1;
  for (const component of shape.components) pad = Math.max(pad, component.strokeWidthEmu);
  if (cx <= 0) {
    const scale = cy > 0 ? content.height / cy : 0;
    return {
      viewBox: [-pad, 0, 2 * pad, Math.max(1, cy)],
      frame: { ...content, x: content.x - pad * scale, width: 2 * pad * scale },
    };
  }
  const scale = content.width / cx;
  return {
    viewBox: [0, -pad, cx, 2 * pad],
    frame: { ...content, y: content.y - pad * scale, height: 2 * pad * scale },
  };
}

/**
 * Keep an inset outline inside its closed geometry: stroke at twice the authored width and
 * clip the stroke to the path, so the outer half is cut away and the authored width remains
 * inside the shape. The fill is inside the geometry already, so the clip leaves it unchanged.
 */
export function applyInsetStroke(
  document: Document,
  svg: SVGSVGElement,
  path: SVGPathElement,
  d: string,
  widthEmu: number,
  fillRule: 'nonzero' | 'evenodd' = 'evenodd'
): void {
  const id = `docx-inset-${++nextClipId}`;
  const clip = document.createElementNS(SVG_NAMESPACE, 'clipPath');
  clip.setAttribute('id', id);
  const outline = document.createElementNS(SVG_NAMESPACE, 'path');
  outline.setAttribute('d', d);
  // The clip follows the fill rule, so the kept half of the stroke matches the filled area.
  outline.setAttribute('clip-rule', fillRule);
  clip.append(outline);
  svg.append(clip);
  path.setAttribute('stroke-width', String(2 * Math.max(1, widthEmu)));
  path.setAttribute('clip-path', `url(#${id})`);
}

let nextGradientId = 0;

/**
 * Fill `path` with `gradient`: a gradient element in user space, mapped onto the extent's
 * point space by the gradient's own matrix. Stop colours are validated sRGB from the
 * projection, so no file string reaches an attribute.
 */
export function applyGradientFill(
  document: Document,
  svg: SVGSVGElement,
  path: SVGPathElement,
  gradient: VectorGradient
): void {
  const id = `docx-gradient-${++nextGradientId}`;
  const element = document.createElementNS(
    SVG_NAMESPACE,
    gradient.kind === 'linear' ? 'linearGradient' : 'radialGradient'
  );
  element.setAttribute('id', id);
  element.setAttribute('gradientUnits', 'userSpaceOnUse');
  element.setAttribute(
    'gradientTransform',
    `matrix(${gradient.matrix.map(finiteNumber).join(' ')})`
  );
  const names = gradient.kind === 'linear' ? ['x1', 'y1', 'x2', 'y2'] : ['cx', 'cy', 'r'];
  names.forEach((name, index) =>
    element.setAttribute(name, finiteNumber(gradient.coords[index] ?? 0))
  );
  for (const stop of gradient.stops) {
    const node = document.createElementNS(SVG_NAMESPACE, 'stop');
    node.setAttribute('offset', finiteNumber(Math.max(0, Math.min(1, stop.offset))));
    node.setAttribute('stop-color', `#${stop.hex}`);
    if (stop.alpha < 1) node.setAttribute('stop-opacity', finiteNumber(Math.max(0, stop.alpha)));
    element.append(node);
  }
  svg.append(element);
  path.setAttribute('fill', `url(#${id})`);
}

function finiteNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

let nextPatternId = 0;
/** One pattern cell is one point, in the extent's EMU space. */
const PATTERN_CELL_EMU = 12_700;

/**
 * Fill `path` with an 8 × 8 pattern tile: the background, then one square per
 * foreground cell, merged into a single path.
 */
export function applyPatternFill(
  document: Document,
  svg: SVGSVGElement,
  path: SVGPathElement,
  pattern: VectorPattern
): void {
  const id = `docx-pattern-${++nextPatternId}`;
  const cell = PATTERN_CELL_EMU;
  const element = document.createElementNS(SVG_NAMESPACE, 'pattern');
  element.setAttribute('id', id);
  element.setAttribute('patternUnits', 'userSpaceOnUse');
  element.setAttribute('width', finiteNumber(cell * 8));
  element.setAttribute('height', finiteNumber(cell * 8));
  const layer = (hex: string, alpha: number, d: string) => {
    if (alpha <= 0 || !d) return;
    const node = document.createElementNS(SVG_NAMESPACE, 'path');
    node.setAttribute('d', d);
    // SAFE: pattern colours are validated 6-digit sRGB from the projection.
    node.setAttribute('fill', `#${hex}`);
    if (alpha < 1) node.setAttribute('fill-opacity', finiteNumber(alpha));
    element.append(node);
  };
  layer(pattern.background.hex, pattern.background.alpha, `M0 0H${cell * 8}V${cell * 8}H0Z`);
  const cells: string[] = [];
  pattern.rows.slice(0, 8).forEach((row, y) => {
    for (let x = 0; x < 8; x += 1) {
      if ((row >> (7 - x)) & 1) cells.push(`M${x * cell} ${y * cell}h${cell}v${cell}h${-cell}Z`);
    }
  });
  layer(pattern.foreground.hex, pattern.foreground.alpha, cells.join(''));
  svg.append(element);
  path.setAttribute('fill', `url(#${id})`);
}

let nextShadowId = 0;

/**
 * The component's outer shadow: its path offset and filled (or stroked, for a line) in the
 * shadow colour, blurred by half the blur radius as a standard deviation. It is appended
 * before the component's own path, so it paints underneath.
 */
export function appendShadow(
  document: Document,
  svg: SVGSVGElement,
  d: string,
  component: VectorShapeComponent
): void {
  const shadow = component.shadow;
  if (!shadow || (component.fillHex === null && component.strokeHex === null)) return;
  const path = document.createElementNS(SVG_NAMESPACE, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill-rule', 'evenodd');
  // SAFE: the shadow colour is validated sRGB from the projection.
  path.setAttribute('fill', component.fillHex !== null ? `#${shadow.hex}` : 'none');
  if (component.strokeHex !== null) {
    path.setAttribute('stroke', `#${shadow.hex}`);
    path.setAttribute('stroke-width', finiteNumber(Math.max(1, component.strokeWidthEmu)));
  }
  path.setAttribute('opacity', finiteNumber(Math.max(0, Math.min(1, shadow.alpha))));
  path.setAttribute(
    'transform',
    `translate(${finiteNumber(shadow.dxEmu)} ${finiteNumber(shadow.dyEmu)})`
  );
  if (shadow.blurEmu > 0) {
    const id = `docx-shadow-${++nextShadowId}`;
    const filter = document.createElementNS(SVG_NAMESPACE, 'filter');
    filter.setAttribute('id', id);
    // In user space, from the geometry's own box: a straight line has no box height to scale a
    // relative region by, and a large blur on a small shape outgrows any fixed percentage.
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const points of component.subpathsEmu) {
      for (const point of points) {
        left = Math.min(left, point.x);
        top = Math.min(top, point.y);
        right = Math.max(right, point.x);
        bottom = Math.max(bottom, point.y);
      }
    }
    const reach =
      (shadow.blurEmu / 4) * 3 +
      (component.strokeHex !== null ? Math.max(1, component.strokeWidthEmu) / 2 : 0) +
      1;
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    filter.setAttribute('x', finiteNumber(left - reach));
    filter.setAttribute('y', finiteNumber(top - reach));
    filter.setAttribute('width', finiteNumber(right - left + 2 * reach));
    filter.setAttribute('height', finiteNumber(bottom - top + 2 * reach));
    const blur = document.createElementNS(SVG_NAMESPACE, 'feGaussianBlur');
    // A quarter of the blur radius as the standard deviation, as the PDF painter steps it.
    blur.setAttribute('stdDeviation', finiteNumber(shadow.blurEmu / 4));
    filter.append(blur);
    svg.append(filter);
    path.setAttribute('filter', `url(#${id})`);
  }
  path.setAttribute('data-docx-shadow', '');
  // An inner shadow stays inside its shape: the clip wraps the offset path, so it does not move.
  if (component.clipEmu?.length) {
    const clipId = `docx-shadow-clip-${++nextShadowId}`;
    const clip = document.createElementNS(SVG_NAMESPACE, 'clipPath');
    clip.setAttribute('id', clipId);
    const outline = document.createElementNS(SVG_NAMESPACE, 'path');
    outline.setAttribute(
      'd',
      component.clipEmu
        .map(
          (points) =>
            `M${points.map((point) => `${finiteNumber(point.x)} ${finiteNumber(point.y)}`).join('L')}Z`
        )
        .join('')
    );
    outline.setAttribute('clip-rule', 'evenodd');
    clip.append(outline);
    const group = document.createElementNS(SVG_NAMESPACE, 'g');
    group.setAttribute('clip-path', `url(#${clipId})`);
    group.append(path);
    svg.append(clip, group);
    return;
  }
  svg.append(path);
}
