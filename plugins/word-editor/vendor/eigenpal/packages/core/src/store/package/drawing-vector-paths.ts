import { parseEmu, findDirectChild, readSize } from './drawing-shape-readers.ts';
import { schemaFlagIsUnset } from './drawing-group-frame.ts';
import { customGeometryDefinition, type GeometryFill } from './drawing-geometry-engine.ts';
import { isElement } from './drawing-projection-walk.ts';
import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';

const MAX_VECTOR_SHAPE_SUBPATHS = 64;
const CUBIC_BEZIER_SEGMENTS = 8;
const readCoordinate = (value: string | undefined): number | null => parseEmu(value, false);

/**
 * How one `a:path` reads: `drawn` added its subpaths, `blank` means the whole shape paints
 * nothing, and `refused` means the path is outside this reader's subset.
 */
export type ShapePathRead = 'drawn' | 'blank' | 'refused';

/**
 * Polygon subpaths of one `a:path`: move, line, cubic and close verbs only; anything else
 * refuses. ECMA-376 Part 1, 20.1.9 (`CT_Path2D`): only `a:moveTo` sets the current point, and
 * lines and curves draw from it. A path has no current point before its first `a:moveTo`, and
 * after `a:close` until the next `a:moveTo`. A line or curve without one makes the whole shape
 * paint nothing (`blank`), as the geometry engine reads it. A malformed verb still refuses.
 */
export function readShapePathPolygons(
  path: OoxmlElement,
  scaleX: number,
  scaleY: number,
  sink: { x: number; y: number }[][],
  pointBudget: { remaining: number },
  closed: boolean[]
): ShapePathRead {
  /** The open subpath, or null when there is no current point. */
  let current: { x: number; y: number }[] | null = null;
  for (const verb of path.children) {
    if (!isElement(verb)) continue;
    if (verb.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI) return 'refused';
    if (verb.localName === 'close') {
      if (current === null) return 'blank';
      closed[sink.length - 1] = true;
      current = null;
      continue;
    }
    if (verb.localName === 'cubicBezTo') {
      const controls = verb.children.filter(isElement);
      if (
        controls.length !== 3 ||
        controls.some(
          (point) => point.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI || point.localName !== 'pt'
        )
      ) {
        return 'refused';
      }
      const parsed = controls.map((point) => {
        const x = readCoordinate(schemaAttributeValue(point.attributes, 'x'));
        const y = readCoordinate(schemaAttributeValue(point.attributes, 'y'));
        return x === null || y === null ? null : { x: x * scaleX, y: y * scaleY };
      });
      if (parsed.some((point) => point === null)) return 'refused';
      if (current === null) return 'blank';
      if (pointBudget.remaining < CUBIC_BEZIER_SEGMENTS) return 'refused';
      const start = current[current.length - 1]!;
      const control1 = parsed[0]!;
      const control2 = parsed[1]!;
      const end = parsed[2]!;
      for (let index = 1; index <= CUBIC_BEZIER_SEGMENTS; index += 1) {
        const t = index / CUBIC_BEZIER_SEGMENTS;
        const inverse = 1 - t;
        current.push({
          x:
            inverse ** 3 * start.x +
            3 * inverse ** 2 * t * control1.x +
            3 * inverse * t ** 2 * control2.x +
            t ** 3 * end.x,
          y:
            inverse ** 3 * start.y +
            3 * inverse ** 2 * t * control1.y +
            3 * inverse * t ** 2 * control2.y +
            t ** 3 * end.y,
        });
      }
      pointBudget.remaining -= CUBIC_BEZIER_SEGMENTS;
      continue;
    }
    if (verb.localName !== 'moveTo' && verb.localName !== 'lnTo') return 'refused';
    const pt = findDirectChild(verb.children, {
      namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
      localName: 'pt',
    });
    if (!pt) return 'refused';
    const x = readCoordinate(schemaAttributeValue(pt.attributes, 'x'));
    const y = readCoordinate(schemaAttributeValue(pt.attributes, 'y'));
    if (x === null || y === null) return 'refused';
    const scaled = { x: x * scaleX, y: y * scaleY };
    if (!Number.isFinite(scaled.x) || !Number.isFinite(scaled.y)) return 'refused';
    if (verb.localName === 'lnTo') {
      if (current === null) return 'blank';
      if (pointBudget.remaining <= 0) return 'refused';
      pointBudget.remaining -= 1;
      current.push(scaled);
      continue;
    }
    if (pointBudget.remaining <= 0 || sink.length >= MAX_VECTOR_SHAPE_SUBPATHS) return 'refused';
    pointBudget.remaining -= 1;
    current = [scaled];
    sink.push(current);
    closed.push(false);
  }
  return 'drawn';
}

/** One painted path of a shape, in the shape's own extent. */
export interface ShapePath {
  readonly subpaths: readonly {
    readonly points: readonly Readonly<{ x: number; y: number }>[];
    readonly closed: boolean;
  }[];
  readonly fill: GeometryFill;
  readonly stroke: boolean;
}

/**
 * Whether `spPr` holds a custom geometry with no paths, because a path has a command with no
 * current point (`everyCommandHasCurrentPoint` in the geometry engine). Such a shape paints
 * nothing.
 */
export function hasPathlessCustomGeometry(spPr: OoxmlElement | null): boolean {
  const custGeom = spPr
    ? findDirectChild(spPr.children, {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: 'custGeom',
      })
    : null;
  return custGeom !== null && customGeometryDefinition(custGeom)?.paths.length === 0;
}

/** Whether a custom geometry uses arcs, quadratic curves, guides, or per-path paint modes. */
export function needsGeometryEngine(custGeom: OoxmlElement): boolean {
  for (const list of custGeom.children) {
    if (!isElement(list) || list.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI) continue;
    if (list.localName === 'gdLst' && list.children.some(isElement)) return true;
    if (list.localName !== 'pathLst') continue;
    for (const path of list.children) {
      if (!isElement(path)) continue;
      const fillMode = schemaAttributeValue(path.attributes, 'fill');
      if (fillMode !== undefined && fillMode !== 'norm') return true;
      if (schemaFlagIsUnset(schemaAttributeValue(path.attributes, 'stroke') ?? '1')) return true;
      for (const command of path.children) {
        if (isElement(command) && ['arcTo', 'quadBezTo'].includes(command.localName)) return true;
      }
    }
  }
  return false;
}

/** The polygon reader's view of an `a:custGeom`: one filled and stroked path set. */
export function readCustomPolygons(
  custGeom: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  pointBudget: { remaining: number }
): ShapePath | null {
  const pathLst = findDirectChild(custGeom.children, {
    namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
    localName: 'pathLst',
  });
  if (!pathLst) return null;
  const subpaths: { x: number; y: number }[][] = [];
  const closed: boolean[] = [];
  const budget = { remaining: pointBudget.remaining };
  for (const child of pathLst.children) {
    if (!isElement(child)) continue;
    if (child.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI || child.localName !== 'path') {
      return null;
    }
    // Paths that opt out of fill or stroke need the engine's per-path modes.
    const fillMode = schemaAttributeValue(child.attributes, 'fill');
    const strokeMode = schemaAttributeValue(child.attributes, 'stroke');
    if ((fillMode !== undefined && fillMode !== 'norm') || schemaFlagIsUnset(strokeMode ?? '1'))
      return null;
    const pathW = readSize(schemaAttributeValue(child.attributes, 'w'), extent.cx);
    const pathH = readSize(schemaAttributeValue(child.attributes, 'h'), extent.cy);
    if (pathW === null || pathH === null) return null;
    const scaleX = pathScale(extent.cx, pathW);
    const scaleY = pathScale(extent.cy, pathH);
    if (scaleX === null || scaleY === null) return null;
    const read = readShapePathPolygons(child, scaleX, scaleY, subpaths, budget, closed);
    if (read === 'refused') return null;
    // A command with no current point leaves the whole shape with no paths to paint.
    if (read === 'blank') return { subpaths: [], fill: 'norm', stroke: true };
  }
  pointBudget.remaining = budget.remaining;
  return {
    subpaths: subpaths.map((points, index) => ({ points, closed: closed[index]! })),
    fill: 'norm',
    stroke: true,
  };
}

/** How a path coordinate space maps onto a shape axis; a zero space fits only a zero axis. */
function pathScale(size: number, space: number): number | null {
  if (space > 0) return size / space;
  return size === 0 ? 0 : null;
}
