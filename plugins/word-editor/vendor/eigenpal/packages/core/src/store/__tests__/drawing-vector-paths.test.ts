// ECMA-376 Part 1, 20.1.9: only `a:moveTo` sets the current point of an `a:custGeom` path, and
// every other command needs one. A path has no current point before its first `a:moveTo`, and
// after `a:close` until the next `a:moveTo`. A command without one makes the whole shape paint
// nothing. The polygon reader and the geometry engine read custom paths by the same rule.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '../package/ooxml-tree.ts';
import { readShapePathPolygons } from '../package/drawing-vector-paths.ts';
import { customGeometryDefinition, evaluateGeometry } from '../package/drawing-geometry-engine.ts';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function pathElement(body: string): OoxmlElement {
  const result = readOoxmlPart(`<a:path xmlns:a="${A}">${body}</a:path>`, {
    name: '/word/geometry.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part.root;
}

function read(body: string, budget = 1000) {
  const sink: { x: number; y: number }[][] = [];
  const closed: boolean[] = [];
  const result = readShapePathPolygons(
    pathElement(body),
    1,
    1,
    sink,
    { remaining: budget },
    closed
  );
  return { result, subpaths: sink, closed };
}

/** The engine's paths for a custom geometry of one or more `a:path` bodies. */
function engine(...bodies: string[]) {
  const pathList = bodies.map((body) => `<a:path>${body}</a:path>`).join('');
  const root = readOoxmlPart(
    `<a:custGeom xmlns:a="${A}"><a:rect l="l" t="t" r="r" b="b"/>` +
      `<a:pathLst>${pathList}</a:pathLst></a:custGeom>`,
    { name: '/word/geometry.xml', contentType: 'application/xml' }
  );
  if (!root.ok) throw new Error(root.reason);
  return evaluateGeometry(customGeometryDefinition(root.part.root)!, 1000, 1000)!;
}

function engineSubpaths(body: string) {
  return engine(body).paths.flatMap((path) =>
    path.subpaths.map((subpath) => ({
      points: subpath.points.map((point) => ({ x: point.x, y: point.y })),
      closed: subpath.closed,
    }))
  );
}

const line = (x: number, y: number) => `<a:lnTo><a:pt x="${x}" y="${y}"/></a:lnTo>`;
const move = (x: number, y: number) => `<a:moveTo><a:pt x="${x}" y="${y}"/></a:moveTo>`;
const close = '<a:close/>';
const cubic =
  '<a:cubicBezTo><a:pt x="1" y="1"/><a:pt x="2" y="2"/><a:pt x="3" y="3"/></a:cubicBezTo>';
const quad = '<a:quadBezTo><a:pt x="5" y="9"/><a:pt x="9" y="5"/></a:quadBezTo>';
const arc = '<a:arcTo wR="4" hR="4" stAng="0" swAng="5400000"/>';
const triangle = `${move(10, 10)}${line(90, 10)}${line(90, 90)}${close}`;

describe('custom geometry current point', () => {
  test('a command before the first moveTo blanks the whole shape', () => {
    for (const command of [line(9, 9), cubic, close]) {
      expect(read(`${command}${triangle}`)).toEqual({
        result: 'blank',
        subpaths: [],
        closed: [],
      });
    }
    // The engine reads arcs and quadratic curves too.
    for (const command of [line(9, 9), cubic, close, arc, quad]) {
      expect(engine(`${command}${triangle}`).paths).toEqual([]);
    }
  });

  test('a line or curve after close blanks the whole shape', () => {
    expect(read(`${triangle}${line(10, 90)}`).result).toBe('blank');
    expect(read(`${triangle}${cubic}`).result).toBe('blank');
    for (const command of [line(10, 90), cubic, close, arc, quad]) {
      expect(engine(`${triangle}${command}`).paths).toEqual([]);
    }
  });

  test('a path without a current point blanks the other paths of the shape too', () => {
    expect(engine(`${line(100, 0)}${line(100, 100)}${close}`, triangle).paths).toEqual([]);
    expect(engine(triangle, `${line(100, 0)}${close}`).paths).toEqual([]);
  });

  test('a blanked shape keeps its text rectangle', () => {
    expect(engine(`${triangle}${line(10, 90)}`).textRect).toEqual({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 1000,
    });
  });

  test('moveTo after close, or a second moveTo, draws as usual', () => {
    const reopened = `${triangle}${move(10, 10)}${line(10, 90)}`;
    expect(read(reopened)).toEqual({
      result: 'drawn',
      subpaths: [
        [
          { x: 10, y: 10 },
          { x: 90, y: 10 },
          { x: 90, y: 90 },
        ],
        [
          { x: 10, y: 10 },
          { x: 10, y: 90 },
        ],
      ],
      closed: [true, false],
    });
    expect(read(`${move(50, 50)}${triangle}`).result).toBe('drawn');
  });

  test('both readers draw the same subpaths for line paths', () => {
    // The geometry engine takes paths with arcs, so a line path must read the same in both.
    const bodies = [
      triangle,
      `${move(50, 50)}${triangle}`,
      `${triangle}${move(10, 10)}${line(10, 90)}`,
      `${move(0, 0)}${line(5, 0)}${close}${move(7, 7)}${line(8, 8)}${close}`,
    ];
    for (const body of bodies) {
      const polygons = read(body);
      expect(polygons.result).toBe('drawn');
      expect(engineSubpaths(body)).toEqual(
        polygons.subpaths.map((points, index) => ({ points, closed: polygons.closed[index] }))
      );
    }
  });

  test('a malformed verb before the first moveTo still refuses', () => {
    expect(read('<a:lnTo/>').result).toBe('refused');
    expect(read('<a:cubicBezTo><a:pt x="1" y="1"/></a:cubicBezTo>').result).toBe('refused');
    expect(read(`${arc}${triangle}`).result).toBe('refused');
  });
});
