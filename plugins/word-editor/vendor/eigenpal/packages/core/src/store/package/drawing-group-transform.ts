// Group-space to shape-space mapping for the children of one `wpg:wgp` group.
import type { VectorShapeComponent } from './drawing-shape-projection.ts';
import { compose, shapeAffine, type AffineMatrix } from './drawing-gradient.ts';
import type { GroupTurn } from './drawing-group-frame.ts';
import { shapePointTransform } from './drawing-shape-geometry.ts';

/**
 * Map a group child's component from child coordinates into the group's extent. A zero scale
 * collapses an axis: rules that share one x in child space all land on the group's origin.
 */
export function transformComponent(
  component: VectorShapeComponent,
  offset: Readonly<{ x: number; y: number }>,
  scaleX: number,
  scaleY: number
): VectorShapeComponent {
  // A group that collapses an axis flattens an inset outline's shape onto a line; with no
  // inside left, the outline stays centred.
  const { strokeInset: inset, ...rest } = component;
  return {
    ...rest,
    ...(inset && scaleX !== 0 && scaleY !== 0 ? { strokeInset: true } : {}),
    ...(component.shadow
      ? {
          shadow: {
            ...component.shadow,
            dxEmu: component.shadow.dxEmu * scaleX,
            dyEmu: component.shadow.dyEmu * scaleY,
            blurEmu: component.shadow.blurEmu * ((Math.abs(scaleX) + Math.abs(scaleY)) / 2),
          },
        }
      : {}),
    ...(component.fillGradient
      ? {
          fillGradient: {
            ...component.fillGradient,
            matrix: compose(
              [scaleX, 0, 0, scaleY, offset.x, offset.y],
              component.fillGradient.matrix
            ),
          },
        }
      : {}),
    ...(component.clipEmu
      ? {
          clipEmu: component.clipEmu.map((path) =>
            path.map((point) => ({
              x: offset.x + point.x * scaleX,
              y: offset.y + point.y * scaleY,
            }))
          ),
        }
      : {}),
    subpathsEmu: component.subpathsEmu.map((path) =>
      path.map((point) => ({
        x: offset.x + point.x * scaleX,
        y: offset.y + point.y * scaleY,
      }))
    ),
    // A line width is an absolute length: the group's child-to-extent scale moves and sizes
    // the geometry, never the width of its outlines.
    strokeWidthEmu: component.strokeWidthEmu,
    ...(component.arrowheadsEmu
      ? {
          arrowheadsEmu: component.arrowheadsEmu.map((path) =>
            groupArrowhead(path, offset, scaleX, scaleY)
          ),
        }
      : {}),
  };
}

/**
 * A line end under a group's child-to-extent scale. The outline is sized from the line width,
 * an absolute length, so it keeps its size and only turns to follow the scaled line. A group
 * that collapses one axis turns it along the other axis; a line perpendicular to the
 * collapsed axis shrinks to a point and loses its line end.
 *
 * The outline's first point is the line end (see `projectLineArrowheads`). The line direction
 * runs from the outline's centroid to that end, or for a centred outline from the end to the
 * second point.
 */
function groupArrowhead(
  path: readonly Readonly<{ x: number; y: number }>[],
  offset: Readonly<{ x: number; y: number }>,
  scaleX: number,
  scaleY: number
): { x: number; y: number }[] {
  const end = path[0];
  if (!end || path.length < 3) return [];
  let centroidX = 0;
  let centroidY = 0;
  for (const point of path) {
    centroidX += point.x / path.length;
    centroidY += point.y / path.length;
  }
  let ux = end.x - centroidX;
  let uy = end.y - centroidY;
  if (Math.hypot(ux, uy) < 1e-6 * Math.max(1, Math.abs(end.x), Math.abs(end.y))) {
    ux = path[1]!.x - end.x;
    uy = path[1]!.y - end.y;
  }
  const norm = Math.hypot(ux, uy);
  if (!(norm > 0)) return [];
  ux /= norm;
  uy /= norm;
  // The scaled direction; zero when the line runs along a collapsed axis.
  let newUx = ux * scaleX;
  let newUy = uy * scaleY;
  const newNorm = Math.hypot(newUx, newUy);
  if (!(newNorm > 1e-12)) return [];
  newUx /= newNorm;
  newUy /= newNorm;
  const endX = offset.x + end.x * scaleX;
  const endY = offset.y + end.y * scaleY;
  return path.map((point) => {
    const along = (point.x - end.x) * ux + (point.y - end.y) * uy;
    const across = -(point.x - end.x) * uy + (point.y - end.y) * ux;
    return { x: endX + along * newUx - across * newUy, y: endY + along * newUy + across * newUx };
  });
}

/**
 * Where a member lands in its group, as the extent to project it at, and the offset and
 * scale that map that projection into the group extent. An upright member projects at its
 * own extent and scales with the group. A turned member's box maps into the group extent
 * first, and the member turns about the centre of that box, so a group that scales its axes
 * unevenly never skews it. A member turned nearer a quarter turn ([45, 135) or [225, 315)
 * degrees) takes the scale of the other axis on each side, as its turned box lies across
 * them.
 */
export function groupMemberPlacement(
  child: Readonly<{
    offset: Readonly<{ x: number; y: number }>;
    extent: Readonly<{ cx: number; cy: number }>;
  }>,
  childOffset: Readonly<{ x: number; y: number }>,
  scaleX: number,
  scaleY: number,
  rotationDegrees: number
): {
  readonly extent: Readonly<{ cx: number; cy: number }>;
  readonly offset: Readonly<{ x: number; y: number }>;
  readonly scaleX: number;
  readonly scaleY: number;
} {
  const offset = {
    x: (child.offset.x - childOffset.x) * scaleX,
    y: (child.offset.y - childOffset.y) * scaleY,
  };
  if (rotationDegrees === 0 || !(scaleX > 0) || !(scaleY > 0)) {
    return { extent: child.extent, offset, scaleX, scaleY };
  }
  const across =
    (rotationDegrees >= 45 && rotationDegrees < 135) ||
    (rotationDegrees >= 225 && rotationDegrees < 315);
  const cx = child.extent.cx * (across ? scaleY : scaleX);
  const cy = child.extent.cy * (across ? scaleX : scaleY);
  const centreX = offset.x + (child.extent.cx * scaleX) / 2;
  const centreY = offset.y + (child.extent.cy * scaleY) / 2;
  return {
    extent: { cx, cy },
    offset: { x: centreX - cx / 2, y: centreY - cy / 2 },
    scaleX: 1,
    scaleY: 1,
  };
}

/**
 * A group's members under its own turn: flipped, then turned clockwise, about the centre of
 * the group extent. Null when a member's paint does not follow the turn here yet: a shadow or
 * a pattern fill. The group then keeps its placeholder.
 */
export function turnGroupComponents(
  components: readonly VectorShapeComponent[],
  extent: Readonly<{ cx: number; cy: number }>,
  turn: GroupTurn
): VectorShapeComponent[] | null {
  if (components.some((c) => c.shadow || c.shadowOnly || c.fillPattern)) return null;
  const place = shapePointTransform(extent, turn.flipH, turn.flipV, turn.rotationDegrees);
  const map = (paths: readonly (readonly Readonly<{ x: number; y: number }>[])[]) =>
    paths.map((path) => path.map(place));
  const affine = shapeAffine(extent.cx, extent.cy, turn.flipH, turn.flipV, turn.rotationDegrees);
  return components.map((component) => ({
    ...component,
    subpathsEmu: map(component.subpathsEmu),
    ...(component.arrowheadsEmu ? { arrowheadsEmu: map(component.arrowheadsEmu) } : {}),
    ...(component.clipEmu ? { clipEmu: map(component.clipEmu) } : {}),
    ...(component.fillGradient
      ? {
          fillGradient: {
            ...component.fillGradient,
            matrix:
              component.fillGradient.turnsWithShape === false
                ? movedUpright(component.fillGradient, place)
                : compose(affine, component.fillGradient.matrix),
          },
        }
      : {}),
  }));
}

/**
 * The matrix of a gradient that keeps its direction (`rotWithShape="0"`) in a turned group:
 * its box centre moves where the group turn takes it, and its axes stay as they were.
 */
function movedUpright(
  gradient: NonNullable<VectorShapeComponent['fillGradient']>,
  place: (point: Readonly<{ x: number; y: number }>) => Readonly<{ x: number; y: number }>
): AffineMatrix {
  const [a, b, c, d, e, f] = gradient.matrix;
  // A linear gradient spans its box in point units, centred on its coordinates' midpoint; a
  // radial one spans the unit square.
  const [x, y] =
    gradient.kind === 'linear'
      ? [
          (gradient.coords[0]! + gradient.coords[2]!) / 2,
          (gradient.coords[1]! + gradient.coords[3]!) / 2,
        ]
      : [0.5, 0.5];
  const centre = { x: a * x + c * y + e, y: b * x + d * y + f };
  const moved = place(centre);
  return [a, b, c, d, e + moved.x - centre.x, f + moved.y - centre.y];
}
