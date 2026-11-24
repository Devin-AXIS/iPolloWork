// The paint clip of a vector shape, grown where a stroked outline reaches past its extent.

import type { AnchoredDrawingRecord, InlineDrawingRecord } from './drawing-layout.ts';
import {
  expandBoxByInsets,
  finite,
  type DrawingInsets,
  type DrawingPoint as Point,
} from './drawing-geometry.ts';
import type { VectorShapeProjection } from '../store/package/drawing-projection.ts';
import type { LayoutBox } from './semantic-records.ts';

type Drawing = InlineDrawingRecord | AnchoredDrawingRecord;

/**
 * How far inside the extent edge a paint edge must sit to count as cut. Layout moves
 * `paintBounds` by any amount but skips geometry moves under 1e-4pt, so smaller drift between
 * the two is not a cut.
 */
const CLIP_EPSILON = 1e-3;
/**
 * Group transforms scale child points by `extent / chExt`, which can land a point on the
 * extent edge a few ULPs outside it. One EMU of tolerance keeps such an edge inside.
 */
const EXTENT_TOLERANCE_EMU = 1;
/** The miter limit both painters use (SVG default, PDF `4 M`). */
const MITER_LIMIT = 4;
const NO_GROWTH: DrawingInsets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
/**
 * The stroke reach depends only on the projected shape, which keeps its identity when layout
 * moves the drawing into a new record, and on every page a header group repeats on.
 */
const reachCache = new WeakMap<VectorShapeProjection, DrawingInsets>();

/**
 * The box a painter clips a vector shape to: `bounds` grown on each side where a stroked
 * outline or an outer shadow reaches past the drawing extent.
 *
 * An outline is centred on its geometry and is not cut at the extent, a text column, or a cell
 * edge that meets the extent: a rule at x=0 of a group with `wp:effectExtent l="0"` keeps
 * its full width. The reach comes from butt-capped segments and miter joins, measured
 * only on the part of each segment inside the extent, so geometry outside the extent stays
 * clipped and a side grows by at most the miter reach. A line-end triangle on a line that
 * ends inside the extent grows it too. A shape that paints outside its extent
 * (`overflowVisible`, every direct shape) grows by its whole geometry and ink instead, past a
 * cell or content edge outside its extent and past a negative effect extent. Where a layout
 * region cut into the extent itself (`geometry.regionCuts`: a cell, a frame, or the page, never
 * an inline drawing's own line or column), such a shape is cut at the region edge. A side
 * stays as it is when a region or a negative effect extent cut into the extent of a shape that
 * does not paint outside its extent. A drawing clipped to nothing stays empty.
 *
 * Only the paint clip grows; collisions and text wrap keep `paintBounds`. Hit testing reaches
 * the ink of a shape that paints outside its extent, through its geometry.
 *
 * `bounds` is the drawing's `paintBounds` in any translation: the record's own, or the
 * absolute paint bounds of an export visit.
 *
 * @public
 */
export function vectorShapeInkClip(
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  bounds: LayoutBox
): LayoutBox {
  const growth = inkGrowth(drawing);
  return growth === NO_GROWTH ? bounds : expandBoxByInsets(bounds, growth);
}

function inkGrowth(drawing: Drawing): DrawingInsets {
  const shape = drawing.vectorShape;
  if (!shape) return NO_GROWTH;
  const { cx, cy } = shape.extentEmu;
  // A straight line has one zero axis; both zero is empty.
  if (!(cx >= 0) || !(cy >= 0) || (cx === 0 && cy === 0)) return NO_GROWTH;
  let reachEmu = reachCache.get(shape);
  if (!reachEmu) {
    reachEmu = strokeReach(shape);
    reachCache.set(shape, reachEmu);
  }
  // A shape that paints outside its extent is cut only by a region: a negative effect extent
  // cuts nothing, so the clip grows back to the extent on that side.
  const open = shape.overflowVisible === true;
  // A hand-built record may carry no effect insets; it then has no effect extent to undo.
  const effect: DrawingInsets = drawing.geometry.effectInsets ?? NO_GROWTH;
  const effectCuts =
    open && (effect.left < 0 || effect.top < 0 || effect.right < 0 || effect.bottom < 0);
  if (reachEmu === NO_GROWTH && !effectCuts) return NO_GROWTH;
  const paint = drawing.paintBounds;
  const content = drawing.geometry.contentBounds;
  // A drawing that a region clipped away entirely paints nothing, ink included. A zero-width
  // line keeps a zero-width paint box of its own, which is not a clip.
  if (!(paint.width > 0 || content.width <= 0) || !(paint.height > 0 || content.height <= 0)) {
    return NO_GROWTH;
  }
  // A collapsed axis has no scale of its own; the drawing's other axis gives it.
  const scaleX = cx > 0 ? content.width / cx : content.height / cy;
  const scaleY = cy > 0 ? content.height / cy : content.width / cx;
  // `room` is how far the paint edge already sits outside the extent edge: the effect extent,
  // or less where a region cut it. A paint edge inside the extent means a region or a negative
  // effect extent cut into the shape itself, and that side stays as it is. A shape that paints
  // outside its extent is cut only at the edge of a region that cut into its extent (`cut`,
  // its depth inside the extent); a negative effect extent cuts nothing, so that side grows
  // back past the extent, or back to the region edge.
  const cuts = drawing.geometry.regionCuts;
  const grow = (overhangEmu: number, scale: number, room: number, cut: number) => {
    if (open) {
      const extra = cut > 0 ? -room - cut : overhangEmu * scale - room;
      return Number.isFinite(extra) && extra > 0 ? extra : 0;
    }
    if (room < -CLIP_EPSILON) return 0;
    const extra = overhangEmu * scale - Math.max(0, room);
    return Number.isFinite(extra) && extra > 0 ? extra : 0;
  };
  // An inline picture's frame never paints above the picture's top edge; it reaches past the
  // other edges as a shape's outline does.
  const inlinePicture = drawing.kind === 'inlineDrawing' && drawing.placeholderGraphicKind === null;
  const growth = {
    left: grow(reachEmu.left, scaleX, content.x - paint.x, cuts?.left ?? 0),
    top: inlinePicture ? 0 : grow(reachEmu.top, scaleY, content.y - paint.y, cuts?.top ?? 0),
    right: grow(
      reachEmu.right,
      scaleX,
      paint.x + paint.width - (content.x + content.width),
      cuts?.right ?? 0
    ),
    bottom: grow(
      reachEmu.bottom,
      scaleY,
      paint.y + paint.height - (content.y + content.height),
      cuts?.bottom ?? 0
    ),
  };
  return growth.left || growth.top || growth.right || growth.bottom
    ? Object.freeze(growth)
    : NO_GROWTH;
}

/** How far stroked ink reaches past each extent edge, in EMU; `NO_GROWTH` when it stays in. */
function strokeReach(shape: VectorShapeProjection): DrawingInsets {
  const { cx, cy } = shape.extentEmu;
  let minX = 0;
  let minY = 0;
  let maxX = cx;
  let maxY = cy;
  const include = (x: number, y: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  // A shape that paints outside its extent reaches as far as its geometry and ink go.
  const open = shape.overflowVisible === true;
  const t = open ? Infinity : EXTENT_TOLERANCE_EMU;
  const inside = (point: Point) =>
    point.x >= -t && point.x <= cx + t && point.y >= -t && point.y <= cy + t;
  for (const component of shape.components) {
    if (open) for (const path of component.subpathsEmu) for (const p of path) include(p.x, p.y);
    // An outer shadow reaches past the geometry by its offset and its blur. Only geometry
    // inside the extent casts it: outside parts stay clipped like the shape itself.
    // An inner shadow stays inside its shape; it adds no ink outside it.
    const shadow = component.clipEmu ? undefined : component.shadow;
    if (shadow) {
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      for (const path of component.subpathsEmu) {
        for (const point of path) {
          const x = open ? point.x : Math.max(0, Math.min(cx, point.x));
          const y = open ? point.y : Math.max(0, Math.min(cy, point.y));
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }
      // Three quarters of the blur radius covers the visible tail in both painters.
      const spread =
        finite(shadow.blurEmu) * 0.75 +
        (component.strokeHex !== null ? Math.max(1, finite(component.strokeWidthEmu)) / 2 : 0);
      const dx = finite(shadow.dxEmu);
      const dy = finite(shadow.dyEmu);
      if (left <= right) {
        include(left + dx - spread, top + dy - spread);
        include(right + dx + spread, bottom + dy + spread);
      }
    }
    // An inset outline stays inside the geometry, so it keeps the extent clip.
    if (component.strokeHex === null || component.strokeInset === true) continue;
    // Both painters draw at least a 1 EMU stroke.
    const half = Math.max(1, finite(component.strokeWidthEmu)) / 2;
    // An outset outline lies outside the geometry by design, so the extent test widens by it.
    const reach = t + Math.max(0, finite(component.strokeOutsetEmu ?? 0));
    const within = (point: Point) =>
      point.x >= -reach && point.x <= cx + reach && point.y >= -reach && point.y <= cy + reach;
    component.subpathsEmu.forEach((raw, index) => {
      const closed = component.subpathsClosed?.[index] !== false;
      const points = distinctPoints(raw, closed);
      const segments = closed && points.length > 2 ? points.length : points.length - 1;
      const normals: Point[] = [];
      for (let at = 0; at < segments; at += 1) {
        const a = points[at]!;
        const b = points[(at + 1) % points.length]!;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
        normals.push(normal);
        if (!clipSegment(a, b, -reach, cx + reach, -reach, cy + reach)) continue;
        for (let end = 0; end < 2; end += 1) {
          const along = SPAN[end]!;
          const x = a.x + (b.x - a.x) * along;
          const y = a.y + (b.y - a.y) * along;
          include(x + normal.x * half, y + normal.y * half);
          include(x - normal.x * half, y - normal.y * half);
        }
      }
      // Caps apply only to real open ends inside the extent. Clipped-away ends stay clipped.
      if (
        !closed &&
        normals.length &&
        (component.strokeCap === 'round' || component.strokeCap === 'square')
      ) {
        for (const [vertex, normal, direction] of [
          [points[0]!, normals[0]!, -1],
          [points[points.length - 1]!, normals[normals.length - 1]!, 1],
        ] as const) {
          if (!within(vertex)) continue;
          if (component.strokeCap === 'round') {
            include(vertex.x - half, vertex.y - half);
            include(vertex.x + half, vertex.y + half);
          } else {
            const x = vertex.x + direction * normal.y * half;
            const y = vertex.y - direction * normal.x * half;
            include(x + normal.x * half, y + normal.y * half);
            include(x - normal.x * half, y - normal.y * half);
          }
        }
      }
      // A miter join reaches past the segment edges along the bisector of its two normals.
      const joins = closed && points.length > 2 ? normals.length : normals.length - 1;
      for (let at = 0; at < joins; at += 1) {
        const vertex = points[(at + 1) % points.length]!;
        if (!within(vertex)) continue;
        if (component.strokeJoin === 'round') {
          include(vertex.x - half, vertex.y - half);
          include(vertex.x + half, vertex.y + half);
          continue;
        }
        if (component.strokeJoin === 'bevel') continue;
        const first = normals[at]!;
        const second = normals[(at + 1) % normals.length]!;
        const denominator = 1 + first.x * second.x + first.y * second.y;
        // 1 / cos(half the turn) is the miter ratio; past the limit the join is bevelled.
        if (denominator < 2 / (MITER_LIMIT * MITER_LIMIT)) continue;
        // The tip lies on the outer side of the turn: right of a left turn, left of a right
        // turn. Directions are the normals turned back a quarter (d = (n.y, -n.x)).
        const turn = first.y * -second.x - -first.x * second.y;
        if (turn === 0) continue;
        const side = turn > 0 ? -1 : 1;
        include(
          vertex.x + (side * (first.x + second.x) * half) / denominator,
          vertex.y + (side * (first.y + second.y) * half) / denominator
        );
      }
    });
    // A line end is painted in the stroke colour wherever its line ends in the extent.
    // Its outline's first point is the line end (see `projectLineArrowheads`).
    for (const triangle of component.arrowheadsEmu ?? []) {
      if (!triangle[0] || !inside(triangle[0])) continue;
      for (const point of triangle) include(point.x, point.y);
    }
  }
  if (minX >= 0 && minY >= 0 && maxX <= cx && maxY <= cy) return NO_GROWTH;
  return Object.freeze({ left: -minX, top: -minY, right: maxX - cx, bottom: maxY - cy });
}

/** The path without repeated points, including a closing point that repeats the first. */
function distinctPoints(points: readonly Point[], closed: boolean): readonly Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (!last || last.x !== point.x || last.y !== point.y) out.push(point);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (closed && out.length > 1 && first!.x === last!.x && first!.y === last!.y) out.pop();
  return out;
}

/**
 * The part of segment a→b inside the box (Liang–Barsky), as the start and end fractions in
 * `SPAN`; false when the segment misses the box. The scratch array keeps the walk
 * allocation-free.
 */
const SPAN = new Float64Array(2);
function clipSegment(
  a: Point,
  b: Point,
  left: number,
  right: number,
  top: number,
  bottom: number
): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  SPAN[0] = 0;
  SPAN[1] = 1;
  return (
    clipEdge(-dx, a.x - left) &&
    clipEdge(dx, right - a.x) &&
    clipEdge(-dy, a.y - top) &&
    clipEdge(dy, bottom - a.y)
  );
}

/** One Liang–Barsky edge test: narrows `SPAN`, false when nothing is left. */
function clipEdge(p: number, q: number): boolean {
  if (p === 0) return q >= 0;
  const t = q / p;
  if (p < 0) SPAN[0] = Math.max(SPAN[0]!, t);
  else SPAN[1] = Math.min(SPAN[1]!, t);
  return SPAN[0]! <= SPAN[1]!;
}
