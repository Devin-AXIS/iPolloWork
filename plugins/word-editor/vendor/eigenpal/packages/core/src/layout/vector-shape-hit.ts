// Where a press reaches a vector shape: its filled area, and its outline or path within reach.
// A shape with no fill, a line and a connector take a press only near the path they paint, so
// a press on text inside or beside them goes to the text. A shape that paints nothing at all
// takes a press anywhere on its frame, so it stays reachable.

import type { AnchoredDrawingRecord, InlineDrawingRecord } from './drawing-layout.ts';
import type { VectorShapeComponent } from '../store/package/drawing-shape-projection.ts';
import type { LayoutBox } from './semantic-records.ts';
import { vectorShapeInkClip } from './vector-shape-ink.ts';

type Drawing = InlineDrawingRecord | AnchoredDrawingRecord;
type Point = { readonly x: number; readonly y: number };

/** How far, in points, a press reaches past a painted path or outline edge. */
export const PATH_HIT_REACH = 3;
const EMU_PER_POINT = 12_700;

/**
 * Whether `point` (page-content points) reaches the shape `drawing` paints, or null when the
 * drawing is not a plain vector shape: a picture, a text box or any other drawing keeps its
 * whole frame.
 */
export function vectorShapeHit(drawing: Drawing, point: Point): boolean | null {
  const shape = drawing.vectorShape;
  if (!shape || drawing.textboxStory || drawing.resource.kind === 'ready') return null;
  // A picture's outline projects as a stroke-only shape; the picture keeps its whole frame,
  // whatever its resource state. A legacy VML drawing and a group of pictures do too.
  if (drawing.placeholderGraphicKind === null || drawing.groupPicture) return null;
  return shapeHit(drawing, shape, point);
}

/** Whether `point` reaches what the components of `shape`, laid on `drawing`, paint. */
function shapeHit(
  drawing: Drawing,
  shape: NonNullable<Drawing['vectorShape']>,
  point: Point
): boolean {
  const content = drawing.geometry.contentBounds;
  const { cx, cy } = shape.extentEmu;
  // A collapsed axis has no scale of its own; the other axis gives it, so a turned straight
  // line keeps its length along the axis its extent does not have.
  const sx = cx > 0 ? content.width / cx : cy > 0 ? content.height / cy : 0;
  const sy = cy > 0 ? content.height / cy : sx;
  const place = (p: Point): Point => ({ x: content.x + p.x * sx, y: content.y + p.y * sy });
  // A shape that paints nothing would be out of reach: its frame takes the press instead, the
  // turned frame for a turned shape.
  if (!shape.components.some(paints)) {
    return insideBox(content, unturned(point, content, shape.rotationDegrees), PATH_HIT_REACH);
  }
  for (const component of shape.components) {
    if (componentHit(component, place, point)) return true;
  }
  return false;
}

function paints(component: VectorShapeComponent): boolean {
  return (
    (component.fillHex !== null && component.fillAlpha > 0) ||
    !!component.fillGradient ||
    !!component.fillPattern ||
    (component.strokeHex !== null && component.strokeAlpha > 0) ||
    !!component.arrowheadsEmu?.length
  );
}

/** `point` turned back about the centre of `box` by `turn` degrees: into the unturned frame. */
function unturned(point: Point, box: LayoutBox, turn: number | undefined): Point {
  if (!turn) return point;
  const radians = (-turn * Math.PI) / 180;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

function insideBox(
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  point: Point,
  reach: number
): boolean {
  return (
    point.x >= box.x - reach &&
    point.x <= box.x + box.width + reach &&
    point.y >= box.y - reach &&
    point.y <= box.y + box.height + reach
  );
}

function componentHit(
  component: VectorShapeComponent,
  place: (p: Point) => Point,
  point: Point
): boolean {
  const rings = component.subpathsEmu.map((ring) => ring.map(place));
  const closed = (index: number) => component.subpathsClosed?.[index] !== false;
  const filled =
    (component.fillHex !== null && component.fillAlpha > 0) ||
    !!component.fillGradient ||
    !!component.fillPattern;
  if (
    filled &&
    insideRings(
      rings.filter((_, index) => closed(index)),
      point
    )
  )
    return true;
  if (component.arrowheadsEmu?.some((head) => insideRings([head.map(place)], point))) return true;
  const stroked = component.strokeHex !== null && component.strokeAlpha > 0;
  const reach = PATH_HIT_REACH + (stroked ? component.strokeWidthEmu / EMU_PER_POINT / 2 : 0);
  return rings.some((ring, index) => nearPath(ring, closed(index), point, reach));
}

/** Even-odd inside test over every ring, as the fill paints. */
function insideRings(rings: readonly (readonly Point[])[], point: Point): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!;
      const b = ring[j]!;
      if (a.y > point.y !== b.y > point.y) {
        const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
        if (point.x < x) inside = !inside;
      }
    }
  }
  return inside;
}

function nearPath(ring: readonly Point[], closed: boolean, point: Point, reach: number): boolean {
  const limit = reach * reach;
  if (ring.length === 1) return squaredDistance(ring[0]!, ring[0]!, point) <= limit;
  const last = closed ? ring.length : ring.length - 1;
  for (let index = 0; index < last; index += 1) {
    const a = ring[index]!;
    const b = ring[(index + 1) % ring.length]!;
    if (squaredDistance(a, b, point) <= limit) return true;
  }
  return false;
}

/** The squared distance from `point` to the segment `a`-`b`. */
function squaredDistance(a: Point, b: Point, point: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
  const x = a.x + t * dx - point.x;
  const y = a.y + t * dy - point.y;
  return x * x + y * y;
}

/**
 * The box a turned shape covers: its unturned extent box turned about its centre, in the
 * record's coordinates. Null for a drawing that is not a turned shape.
 */
export function turnedShapeBounds(drawing: Drawing): LayoutBox | null {
  const turn = drawing.vectorShape?.rotationDegrees;
  if (!turn || !Number.isFinite(turn)) return null;
  const content = drawing.geometry.contentBounds;
  const radians = (turn * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const width = content.width * cos + content.height * sin;
  const height = content.width * sin + content.height * cos;
  return Object.freeze({
    x: content.x + (content.width - width) / 2,
    y: content.y + (content.height - height) / 2,
    width,
    height,
  });
}

/** The smallest box holding both boxes. */
export function unionBox(a: LayoutBox, b: LayoutBox | null): LayoutBox {
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return Object.freeze({
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  });
}

/** Points on each quarter of a legacy oval or rounded corner. */
const ARC_STEPS = 8;
/**
 * How far past its extent a text box's chrome must paint to count, in EMU (half a point):
 * float error in turned points stays below it.
 */
const CHROME_PAST_FRAME_EMU = 6350;

/**
 * The outline of a text box's shape in points: its polygon, oval or rounded rectangle, or a
 * rectangle when it has none. Polygon points are shares of the frame.
 */
function textboxRings(
  outline: NonNullable<Drawing['textboxStory']>['outline'],
  frame: LayoutBox
): readonly (readonly Point[])[] {
  const at = (x: number, y: number): Point => ({
    x: frame.x + x * frame.width,
    y: frame.y + y * frame.height,
  });
  if (outline?.kind === 'polygon')
    return outline.subpaths.map((ring) => ring.map((p) => at(p.x, p.y)));
  // An arc of radii (rx, ry) about (cx, cy) in shares, from `start` a quarter turn on. The
  // oval leaves out each quarter's end point, which the next quarter starts on.
  const arc = (cx: number, cy: number, rx: number, ry: number, start: number, end = 1): Point[] =>
    Array.from({ length: ARC_STEPS + end }, (_, k) => {
      const angle = start + (k / ARC_STEPS) * (Math.PI / 2);
      return at(cx + rx * Math.cos(angle), cy + ry * Math.sin(angle));
    });
  if (outline?.kind === 'ellipse') {
    return [[0, 1, 2, 3].flatMap((quarter) => arc(0.5, 0.5, 0.5, 0.5, (quarter * Math.PI) / 2, 0))];
  }
  if (outline?.kind === 'roundRect' && frame.width > 0 && frame.height > 0) {
    const radius = Math.max(0, outline.arc) * Math.min(frame.width, frame.height);
    const rx = Math.min(0.5, radius / frame.width);
    const ry = Math.min(0.5, radius / frame.height);
    return [
      [
        ...arc(1 - rx, 1 - ry, rx, ry, 0),
        ...arc(rx, 1 - ry, rx, ry, Math.PI / 2),
        ...arc(rx, ry, rx, ry, Math.PI),
        ...arc(1 - rx, ry, rx, ry, (3 * Math.PI) / 2),
      ],
    ];
  }
  return [[at(0, 0), at(1, 0), at(1, 1), at(0, 1)]];
}

/** The vector shape that paints a text box's chrome, such as a gradient fill; else null. */
function textboxChrome(drawing: Drawing): NonNullable<Drawing['vectorShape']> | null {
  return drawing.textboxStory?.chromeByVector && drawing.vectorShape ? drawing.vectorShape : null;
}

/** Whether a text box's vector chrome or polygon outline reaches past its frame. */
const chromePastFrame = new WeakMap<object, boolean>();

/**
 * Whether a text box's painted shape reaches past its frame, such as a callout's tail or a
 * turned box. A press there reaches the text box.
 */
export function textboxPaintsPastFrame(drawing: Drawing): boolean {
  const story = drawing.textboxStory;
  if (!story) return false;
  const chrome = textboxChrome(drawing);
  if (chrome) {
    const known = chromePastFrame.get(chrome);
    if (known !== undefined) return known;
    // The chrome's points carry the turn and the flips, in the extent's units.
    const { cx, cy } = chrome.extentEmu;
    const t = CHROME_PAST_FRAME_EMU;
    const past =
      chrome.components.some(paints) &&
      chrome.components.some((component) =>
        component.subpathsEmu.some((ring) =>
          ring.some((p) => p.x < -t || p.y < -t || p.x > cx + t || p.y > cy + t)
        )
      );
    chromePastFrame.set(chrome, past);
    return past;
  }
  if (story.fillHex === null && story.strokeHex === null) return false;
  if (story.chromeRotationDegrees) return true;
  const outline = story.outline;
  if (outline?.kind !== 'polygon') return false;
  const known = chromePastFrame.get(outline);
  if (known !== undefined) return known;
  const past = outline.subpaths.some((ring) =>
    ring.some((p) => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)
  );
  chromePastFrame.set(outline, past);
  return past;
}

/**
 * Whether `point` reaches the shape a text box paints past its frame: inside its outline, or
 * on the outline within reach. Null for a drawing that is not such a text box. A press inside
 * the frame keeps going to the frame, which edits the text.
 */
export function textboxOutlineHit(drawing: Drawing, point: Point): boolean | null {
  const story = drawing.textboxStory;
  if (!story || !textboxPaintsPastFrame(drawing)) return null;
  const chrome = textboxChrome(drawing);
  if (chrome) return shapeHit(drawing, chrome, point);
  const frame = drawing.geometry.contentBounds;
  const local = unturned(point, frame, story.chromeRotationDegrees);
  const rings = textboxRings(story.outline, frame);
  if (story.fillHex !== null && insideRings(rings, local)) return true;
  const reach = PATH_HIT_REACH + (story.strokeHex !== null ? story.strokeWidthPt / 2 : 0);
  return rings.some((ring) => nearPath(ring, true, local, reach));
}

/**
 * Whether a press at `point` on a text box's painted box takes the text box. A press inside
 * the frame, unturned or turned with the box, or on the laid-out text area, always does, so
 * the text stays reachable for editing. Past those, only the shape the box paints there takes
 * it, such as a callout's tail. A shadow past the frame takes no press, as a shape's shadow
 * does not, and neither does the rest of a `wp:effectExtent` that covers a tail or a turned
 * corner. A text box that paints nothing past its frame takes every press on its painted
 * box.
 */
export function textboxPressReaches(drawing: Drawing, point: Point): boolean {
  const frame = drawing.geometry.contentBounds;
  const story = drawing.textboxStory;
  if (insideBox(frame, point, 0)) return true;
  if (insideBox(frame, unturned(point, frame, story?.chromeRotationDegrees), 0)) return true;
  if (story && insideTextArea(story, frame, point)) return true;
  return textboxOutlineHit(drawing, point) !== false;
}

/** Whether `point` lies on a story's text area, as paint places and turns it. */
function insideTextArea(
  story: NonNullable<Drawing['textboxStory']>,
  frame: LayoutBox,
  point: Point
): boolean {
  const area = {
    x: frame.x + story.contentOffset.x,
    y: frame.y + story.contentOffset.y,
    width: story.contentWidth,
    height: Math.max(0, story.contentHeight),
  };
  const turn = story.contentRotation;
  if (!turn) return insideBox(area, point, 0);
  const pivot = { x: frame.x + turn.pivot.x, y: frame.y + turn.pivot.y };
  const radians = (-turn.degrees * Math.PI) / 180;
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  const local = {
    x: pivot.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: pivot.y + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
  return insideBox(area, local, 0);
}

/**
 * Whether a shape or a text box paints past its box further than a press reaches anyway, such
 * as a callout's tail: a press there reaches it. Ink within the press reach of the box edge,
 * such as half of an outline up to 6pt wide, does not count.
 */
export function drawingPaintsPastBox(drawing: Drawing): boolean {
  if (textboxPaintsPastFrame(drawing)) return true;
  if (!drawing.vectorShape?.overflowVisible) return false;
  const known = paintsPastBox.get(drawing);
  if (known !== undefined) return known;
  const box = drawing.paintBounds;
  const ink = vectorShapeInkClip(drawing, box);
  const past =
    ink.x < box.x - PATH_HIT_REACH ||
    ink.y < box.y - PATH_HIT_REACH ||
    ink.x + ink.width > box.x + box.width + PATH_HIT_REACH ||
    ink.y + ink.height > box.y + box.height + PATH_HIT_REACH;
  paintsPastBox.set(drawing, past);
  return past;
}

/** Drawing records are immutable, so one ink measure per record serves every press. */
const paintsPastBox = new WeakMap<Drawing, boolean>();
