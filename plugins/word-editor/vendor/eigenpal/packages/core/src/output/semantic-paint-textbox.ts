// Paint for a text box drawing's laid-out story.
//
// The shape paints first: a plain box with a CSS border, or, for a legacy oval, round
// rectangle or preset, an SVG outline. A turned shape turns about its centre. The story
// paints inside a clipped content container at its laid-out frame, turned about the frame's
// pivot when its text turns. Every value is a validated number or a validated 6-digit colour;
// the DOM is built with element APIs only.

import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../layout/drawing-layout.ts';
import type { LayoutBox } from '../layout/semantic-records.ts';
import type { TextboxStoryLayout } from '../layout/textbox-story-layout.ts';
import type { DrawingPaintContext } from './semantic-paint-drawings.ts';
import { applyAccessibility, positionedBox } from './semantic-paint-drawing-box.ts';
import { applyVectorInkReach, vectorShapeFrame } from './semantic-paint-vector-shape.ts';
import { vectorShapeInkClip } from '../layout/vector-shape-ink.ts';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const n = (value: number) => String(Math.round(value * 1000) / 1000);

const SQUARE = Object.freeze({ kind: 'roundRect' as const, arc: 0 });

/**
 * The shape edge as an SVG path in the `width`×`height` box at (`x`, `y`), shrunk by `inset` on
 * every side. A round rectangle's radius is its arc times `shorterSide`, less the inset. Paths
 * run clockwise from where a dash pattern starts, as the PDF ones do: an ellipse from its left
 * middle, a rounded rectangle from below its top-left arc, a rectangle from its top-left corner.
 */
function shapePath(
  outline: NonNullable<TextboxStoryLayout['outline']>,
  x: number,
  y: number,
  width: number,
  height: number,
  inset: number,
  shorterSide: number
): string {
  const left = x + inset,
    top = y + inset;
  const w = Math.max(0, width - 2 * inset),
    h = Math.max(0, height - 2 * inset);
  if (outline.kind === 'ellipse') {
    const rx = w / 2,
      ry = h / 2;
    return (
      `M${n(left)} ${n(top + ry)} A${n(rx)} ${n(ry)} 0 1 1 ${n(left + w)} ${n(top + ry)} ` +
      `A${n(rx)} ${n(ry)} 0 1 1 ${n(left)} ${n(top + ry)} Z`
    );
  }
  if (outline.kind === 'polygon')
    return outline.subpaths
      .map(
        (points) =>
          points
            .map((p, k) => `${k ? 'L' : 'M'}${n(left + p.x * w)} ${n(top + p.y * h)}`)
            .join(' ') + ' Z'
      )
      .join(' ');
  const r = Math.min(Math.max(0, outline.arc * shorterSide - inset), w / 2, h / 2);
  return (
    `M${n(left)} ${n(top + r)} A${n(r)} ${n(r)} 0 0 1 ${n(left + r)} ${n(top)} H${n(left + w - r)} ` +
    `A${n(r)} ${n(r)} 0 0 1 ${n(left + w)} ${n(top + r)} V${n(top + h - r)} ` +
    `A${n(r)} ${n(r)} 0 0 1 ${n(left + w - r)} ${n(top + h)} H${n(left + r)} ` +
    `A${n(r)} ${n(r)} 0 0 1 ${n(left)} ${n(top + h - r)} Z`
  );
}

/** An SVG outline of a legacy shape: its geometry, or a rectangle for a dashed plain box. */
function outlineElement(
  document: Document,
  story: TextboxStoryLayout,
  width: number,
  height: number,
  scale: number
): SVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('width', n(width * scale));
  svg.setAttribute('height', n(height * scale));
  svg.setAttribute('viewBox', `0 0 ${n(width)} ${n(height)}`);
  svg.style.position = 'absolute';
  svg.style.left = '0';
  svg.style.top = '0';
  svg.style.overflow = 'visible';
  const stroke = story.strokeHex !== null ? Math.max(story.strokeWidthPt, 0.5 / scale) : 0;
  // A centred outline runs on the edge itself; otherwise it stays inside the box.
  const half = story.strokeCentered ? 0 : stroke / 2;
  const shape = document.createElementNS(SVG_NAMESPACE, 'path');
  const outline = story.outline ?? SQUARE;
  shape.setAttribute('d', shapePath(outline, 0, 0, width, height, half, Math.min(width, height)));
  // SAFE: hex colors are validated 6-digit sRGB at the projection trust boundary.
  shape.setAttribute('fill', story.fillHex !== null ? `#${story.fillHex}` : 'none');
  if (story.strokeHex !== null) {
    shape.setAttribute('stroke', `#${story.strokeHex}`);
    shape.setAttribute('stroke-width', n(stroke));
    if (story.strokeDashPt)
      shape.setAttribute('stroke-dasharray', story.strokeDashPt.map(n).join(' '));
    if (story.strokeCap) shape.setAttribute('stroke-linecap', story.strokeCap);
  }
  svg.append(shape);
  return svg;
}

/** `dx`, `dy` turned counterclockwise by `degrees`: a page offset in a turned element's frame. */
function unturned(dx: number, dy: number, degrees: number | undefined): [number, number] {
  if (!degrees) return [dx, dy];
  const radians = (-degrees * Math.PI) / 180;
  return [
    dx * Math.cos(radians) - dy * Math.sin(radians),
    dx * Math.sin(radians) + dy * Math.cos(radians),
  ];
}

/**
 * The shadow of the shape: a copy of `box` in the shadow colour at the page offset. An
 * obscured shadow is the solid silhouette, cut out where the shape itself stands.
 */
function shadowElement(
  box: HTMLElement,
  story: TextboxStoryLayout,
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  scale: number,
  reach: number
): HTMLElement {
  const shadow = story.shadow!;
  const copy = box.cloneNode(true) as HTMLElement;
  copy.className = 'docx-drawing-textbox-shadow';
  // SAFE: a validated 6-digit sRGB colour and finite numbers.
  const tint = `#${shadow.hex}`;
  if (copy.style.backgroundColor || shadow.obscured) copy.style.backgroundColor = tint;
  if (copy.style.borderColor) copy.style.borderColor = tint;
  for (const shape of copy.querySelectorAll('path')) {
    if (shape.getAttribute('fill') !== 'none' || shadow.obscured) shape.setAttribute('fill', tint);
    if (shape.getAttribute('stroke')) shape.setAttribute('stroke', tint);
  }
  copy.style.opacity = n(shadow.alpha);
  const turn = story.chromeRotationDegrees;
  const dx = shadow.dx * scale,
    dy = shadow.dy * scale;
  copy.style.transform = `translate(${n(dx)}px, ${n(dy)}px)${turn ? ` rotate(${turn}deg)` : ''}`;
  if (shadow.obscured) {
    // The shape itself, in the copy's own frame, is cut out of the shadow.
    const [ox, oy] = unturned(-dx, -dy, turn);
    const width = drawing.width * scale,
      height = drawing.height * scale;
    const edge = shapePath(
      story.outline ?? SQUARE,
      reach + ox,
      reach + oy,
      width,
      height,
      0,
      Math.min(width, height)
    );
    copy.style.clipPath = `path(evenodd, 'M-100000 -100000 H100000 V100000 H-100000 Z ${edge}')`;
  }
  return copy;
}

/**
 * Paint a textbox drawing's laid-out story: optional fill/outline box, then the story
 * fragments inside a clipped content container at the resolved anchor position. The
 * container is page furniture — non-editable, with no selection bindings inside.
 */
export function paintTextboxStory(
  document: Document,
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  story: NonNullable<InlineDrawingRecord['textboxStory']>,
  ctx: DrawingPaintContext,
  origin?: LayoutBox
): HTMLElement {
  const scale = ctx.scale;
  const outer = document.createElement('div');
  outer.className = 'docx-drawing docx-drawing-textbox';
  if (!ctx.unbound) outer.dataset.drawingNodeId = drawing.drawingNodeId;
  outer.setAttribute('contenteditable', 'false');
  positionedBox(outer, drawing.paintBounds, ctx.scale, origin);
  outer.style.overflow = 'hidden';

  // Extent box in paint-bounds-relative coordinates (paintBounds may be a clipped subregion).
  const extentLeft = (drawing.x - drawing.paintBounds.x) * scale;
  const extentTop = (drawing.y - drawing.paintBounds.y) * scale;

  // A box whose shape paints as vector components: that shape, under the text.
  if (story.chromeByVector && drawing.vectorShape) {
    const frame = vectorShapeFrame(document, drawing, scale);
    applyVectorInkReach(
      outer,
      frame,
      drawing.paintBounds,
      vectorShapeInkClip(drawing, drawing.paintBounds),
      scale
    );
    outer.append(frame);
  } else if (story.fillHex !== null || story.strokeHex !== null) {
    const box = document.createElement('div');
    box.className = 'docx-drawing-textbox-box';
    box.style.position = 'absolute';
    // A dashed outline paints through SVG, as a shape outline does.
    const svgOutline = story.outline !== undefined || story.strokeDashPt !== undefined;
    // A centred plain outline: the border box grows by the outline's outer half.
    const reach =
      story.strokeCentered && story.strokeHex !== null && !svgOutline
        ? Math.max(story.strokeWidthPt * scale, 0.5) / 2
        : 0;
    box.style.left = `${extentLeft - reach}px`;
    box.style.top = `${extentTop - reach}px`;
    box.style.width = `${drawing.width * scale + 2 * reach}px`;
    box.style.height = `${drawing.height * scale + 2 * reach}px`;
    box.style.boxSizing = 'border-box';
    if (svgOutline) {
      box.append(outlineElement(document, story, drawing.width, drawing.height, scale));
    } else {
      // SAFE: hex colors are validated 6-digit sRGB at the projection trust boundary.
      if (story.fillHex !== null) box.style.backgroundColor = `#${story.fillHex}`;
      if (story.strokeHex !== null) {
        box.style.border = `${Math.max(story.strokeWidthPt * scale, 0.5)}px solid #${story.strokeHex}`;
      }
    }
    // The shape turns about its own centre.
    if (story.chromeRotationDegrees)
      box.style.transform = `rotate(${story.chromeRotationDegrees}deg)`;
    if (story.shadow) outer.append(shadowElement(box, story, drawing, scale, reach));
    outer.append(box);
  }

  const content = document.createElement('div');
  content.className = 'docx-drawing-textbox-content';
  content.style.position = 'absolute';
  content.style.left = `${extentLeft + story.contentOffset.x * scale}px`;
  content.style.top = `${extentTop + story.contentOffset.y * scale}px`;
  content.style.width = `${story.contentWidth * scale}px`;
  content.style.height = `${Math.max(0, story.contentHeight) * scale}px`;
  content.style.overflow = 'hidden';
  // A run paints bold or italic only when it is, so the story must not inherit either from the
  // line that holds an inline box, which carries its paragraph mark's face.
  content.style.fontWeight = 'normal';
  content.style.fontStyle = 'normal';
  const turn = story.contentRotation;
  if (turn) {
    const originX = (turn.pivot.x - story.contentOffset.x) * scale;
    const originY = (turn.pivot.y - story.contentOffset.y) * scale;
    content.style.transformOrigin = `${originX}px ${originY}px`;
    content.style.transform = `rotate(${turn.degrees}deg)`;
  }
  for (const fragment of story.fragments) {
    content.append(ctx.paintStoryFragment!(document, fragment));
  }
  // Keep story bindings inert until the surface enters this textbox for editing.
  for (const bound of content.querySelectorAll<HTMLElement>('[data-paragraph-id]')) {
    bound.dataset.textboxParagraphId = bound.dataset.paragraphId;
    delete bound.dataset.paragraphId;
  }
  outer.append(content);
  // The text of an unfilled shape casts a plain shadow too.
  const shadow = story.chromeByVector ? undefined : story.shadow;
  if (shadow && !shadow.obscured && story.fillHex === null) {
    const alpha = Math.round(shadow.alpha * 255)
      .toString(16)
      .padStart(2, '0');
    const [dx, dy] = unturned(shadow.dx * scale, shadow.dy * scale, story.contentRotation?.degrees);
    // SAFE: a validated 6-digit sRGB colour and finite numbers.
    content.style.filter = `drop-shadow(${n(dx)}px ${n(dy)}px 0 #${shadow.hex}${alpha})`;
  }
  applyAccessibility(outer, drawing, false);
  return outer;
}
