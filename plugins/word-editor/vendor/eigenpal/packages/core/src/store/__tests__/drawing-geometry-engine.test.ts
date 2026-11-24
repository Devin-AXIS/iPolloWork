// DrawingML geometry: every ECMA-376 preset evaluates to finite, bounded polylines, the
// common SmartArt and diagram presets land on their exact vertices, arcs follow the visual
// angle convention, and custom geometry stays inside its caps.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '../package/ooxml-tree.ts';
import { PRESET_SHAPE_SOURCE } from '../package/drawing-preset-table.ts';
import {
  customGeometryDefinition,
  evaluateGeometry,
  FLATTEN_TOLERANCE_EMU,
  MAX_GEOMETRY_COMMANDS,
  presetGeometryDefinition,
  type EvaluatedGeometry,
  type GeometryPoint,
} from '../package/drawing-geometry-engine.ts';
import { builtinGuides, evaluateGuide, parseGuide } from '../package/drawing-geometry-formula.ts';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const W = 914400;
const H = 609600;

const presetNames = PRESET_SHAPE_SOURCE.split('\n')
  .filter((line) => line.includes('|'))
  .map((line) => line.slice(0, line.indexOf('|')));

function preset(name: string, width = W, height = H, adjust?: Map<string, number>) {
  const definition = presetGeometryDefinition(name);
  if (definition === null) throw new Error(`missing preset ${name}`);
  const geometry = evaluateGeometry(definition, width, height, adjust);
  if (geometry === null) throw new Error(`preset ${name} exceeded its caps`);
  return geometry;
}

function points(geometry: EvaluatedGeometry, path = 0, subpath = 0): readonly GeometryPoint[] {
  return geometry.paths[path]!.subpaths[subpath]!.points;
}

function expectPoints(actual: readonly GeometryPoint[], expected: [number, number][]) {
  expect(actual.length).toBe(expected.length);
  for (const [index, [x, y]] of expected.entries()) {
    expect(actual[index]!.x).toBeCloseTo(x, 3);
    expect(actual[index]!.y).toBeCloseTo(y, 3);
  }
}

function custGeom(body: string): OoxmlElement {
  const result = readOoxmlPart(`<a:custGeom xmlns:a="${A}">${body}</a:custGeom>`, {
    name: '/word/geometry.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part.root;
}

describe('preset table', () => {
  test('carries all 187 ECMA-376 presets', () => {
    expect(presetNames.length).toBe(187);
    expect(new Set(presetNames).size).toBe(187);
  });

  test.each([
    [W, H],
    [0, 0],
    [100000, 900000],
  ])('every preset evaluates finite and bounded at %d x %d', (width, height) => {
    const bound = Math.max(width, height, 1);
    for (const name of presetNames) {
      const geometry = preset(name, width, height);
      expect(geometry.paths.length).toBeGreaterThan(0);
      for (const path of geometry.paths) {
        for (const subpath of path.subpaths) {
          for (const point of subpath.points) {
            expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
            expect(point.x).toBeGreaterThanOrEqual(-2 * bound);
            expect(point.x).toBeLessThanOrEqual(3 * bound);
            expect(point.y).toBeGreaterThanOrEqual(-2 * bound);
            expect(point.y).toBeLessThanOrEqual(3 * bound);
          }
        }
      }
      const { left, top, right, bottom } = geometry.textRect;
      expect([left, top, right, bottom].every(Number.isFinite)).toBe(true);
    }
  });

  test('unknown and prototype names miss', () => {
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '', 'nope']) {
      expect(presetGeometryDefinition(name)).toBeNull();
    }
  });
});

describe('preset vertices', () => {
  test('rect is the four corners, closed', () => {
    const geometry = preset('rect');
    expectPoints(points(geometry), [
      [0, 0],
      [W, 0],
      [W, H],
      [0, H],
    ]);
    expect(geometry.paths[0]!.subpaths[0]!.closed).toBe(true);
    expect(geometry.textRect).toEqual({ left: 0, top: 0, right: W, bottom: H });
  });

  test('roundRect corners use 16667/100000 of the short side', () => {
    const radius = (H * 16667) / 100000;
    const outline = points(preset('roundRect'));
    expect(outline[0]!.x).toBeCloseTo(0, 6);
    expect(outline[0]!.y).toBeCloseTo(radius, 3);
    // The first corner arc ends on the top edge, one radius in.
    const top = outline.find((point) => Math.abs(point.y) < 1e-6)!;
    expect(top.x).toBeCloseTo(radius, 3);
    for (const point of outline) {
      expect(point.x).toBeGreaterThanOrEqual(-1e-6);
      expect(point.x).toBeLessThanOrEqual(W + 1e-6);
    }
  });

  test('an avLst override changes the roundRect radius', () => {
    const outline = points(preset('roundRect', W, H, new Map([['adj', 50000]])));
    expect(outline[0]!.y).toBeCloseTo(H / 2, 3);
  });

  test('rightArrow default vertices', () => {
    expectPoints(points(preset('rightArrow')), [
      [0, 152400],
      [609600, 152400],
      [609600, 0],
      [W, 304800],
      [609600, H],
      [609600, 457200],
      [0, 457200],
    ]);
  });

  test('triangle, chevron and homePlate default vertices', () => {
    expectPoints(points(preset('triangle')), [
      [0, H],
      [W / 2, 0],
      [W, H],
    ]);
    expectPoints(points(preset('chevron')), [
      [0, 0],
      [609600, 0],
      [W, H / 2],
      [609600, H],
      [0, H],
      [304800, H / 2],
    ]);
    expectPoints(points(preset('homePlate')), [
      [0, 0],
      [609600, 0],
      [W, H / 2],
      [609600, H],
      [0, H],
    ]);
  });

  test('ellipse points lie on the inscribed ellipse', () => {
    const outline = points(preset('ellipse'));
    expect(outline.length).toBeGreaterThan(32);
    for (const point of outline) {
      const u = (point.x - W / 2) / (W / 2);
      const v = (point.y - H / 2) / (H / 2);
      expect(u * u + v * v).toBeCloseTo(1, 6);
    }
  });

  test('flattened arcs stay within the chord tolerance', () => {
    const outline = points(preset('ellipse'));
    for (let index = 1; index < outline.length; index += 1) {
      const a = outline[index - 1]!;
      const b = outline[index]!;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const u = (mid.x - W / 2) / (W / 2);
      const v = (mid.y - H / 2) / (H / 2);
      // Radial distance from the chord midpoint to the ellipse, in EMU.
      const radial = Math.hypot(mid.x - W / 2, mid.y - H / 2);
      expect(radial * (1 / Math.sqrt(u * u + v * v) - 1)).toBeLessThan(700);
    }
  });

  test('arc is a filled unstroked wedge plus a stroked unfilled curve', () => {
    const geometry = preset('arc');
    expect(geometry.paths.map((path) => [path.fill, path.stroke])).toEqual([
      ['norm', false],
      ['none', true],
    ]);
    // The default arc runs from 270° to 0°: from top centre to right middle.
    const curve = points(geometry, 1);
    expect(curve[0]!.x).toBeCloseTo(W / 2, 3);
    expect(curve[0]!.y).toBeCloseTo(0, 3);
    expect(curve.at(-1)!.x).toBeCloseTo(W, 3);
    expect(curve.at(-1)!.y).toBeCloseTo(H / 2, 3);
  });

  test('pie and blockArc are single closed filled and stroked paths', () => {
    for (const name of ['pie', 'blockArc']) {
      const geometry = preset(name);
      expect(geometry.paths.length).toBe(1);
      expect(geometry.paths[0]!.fill).toBe('norm');
      expect(geometry.paths[0]!.stroke).toBe(true);
      expect(geometry.paths[0]!.subpaths[0]!.closed).toBe(true);
    }
  });

  test('line has one open stroked subpath', () => {
    const geometry = preset('line');
    expectPoints(points(geometry), [
      [0, 0],
      [W, H],
    ]);
    expect(geometry.paths[0]!.subpaths[0]!.closed).toBe(false);
  });

  test('path w/h scale path coordinates onto the shape', () => {
    // flowChartProcess draws in a 1 x 1 path space.
    expectPoints(points(preset('flowChartProcess')), [
      [0, 0],
      [W, 0],
      [W, H],
      [0, H],
    ]);
  });
});

describe('custom geometry', () => {
  test('arcTo angles are visual angles on the ellipse', () => {
    const definition = customGeometryDefinition(
      custGeom(
        '<a:pathLst><a:path><a:moveTo><a:pt x="400" y="100"/></a:moveTo>' +
          '<a:arcTo wR="200" hR="100" stAng="0" swAng="2700000"/></a:path></a:pathLst>'
      )
    )!;
    const outline = points(evaluateGeometry(definition, 1000, 1000)!);
    // Centre (200, 100); the 45° ray meets the 200 x 100 ellipse where x = y.
    const offset = 1 / Math.sqrt(1 / 200 ** 2 + 1 / 100 ** 2);
    expect(outline.at(-1)!.x).toBeCloseTo(200 + offset, 6);
    expect(outline.at(-1)!.y).toBeCloseTo(100 + offset, 6);
  });

  test('guides, quadBezTo, cubicBezTo and close', () => {
    const definition = customGeometryDefinition(
      custGeom(
        '<a:avLst/><a:gdLst><a:gd name="mid" fmla="*/ w 1 2"/></a:gdLst>' +
          '<a:rect l="l" t="t" r="mid" b="b"/>' +
          '<a:pathLst><a:path w="200000" h="200000">' +
          '<a:moveTo><a:pt x="0" y="0"/></a:moveTo>' +
          '<a:quadBezTo><a:pt x="100000" y="200000"/><a:pt x="200000" y="0"/></a:quadBezTo>' +
          '<a:cubicBezTo><a:pt x="200000" y="100000"/><a:pt x="0" y="100000"/>' +
          '<a:pt x="0" y="0"/></a:cubicBezTo><a:close/>' +
          '</a:path></a:pathLst>'
      )
    )!;
    const geometry = evaluateGeometry(definition, 400000, 400000)!;
    const curve = points(geometry);
    // The quadratic peaks at half its control height, scaled 2x by the path space.
    const peak = Math.max(...curve.map((point) => point.y));
    expect(peak).toBeGreaterThan(200000 - 1300);
    expect(peak).toBeLessThanOrEqual(200000 + 1e-6);
    expect(curve.at(-1)).toEqual({ x: 0, y: 0 });
    expect(geometry.paths[0]!.subpaths[0]!.closed).toBe(true);
    expect(geometry.textRect).toEqual({ left: 0, top: 0, right: 200000, bottom: 400000 });
  });

  test('a custom command without a current point leaves the shape with no paths', () => {
    // ECMA-376 Part 1, 20.1.9: only moveTo sets the current point. The other cases are in
    // drawing-vector-paths.test.ts.
    const geometry = evaluateGeometry(
      customGeometryDefinition(
        custGeom(
          '<a:rect l="l" t="t" r="r" b="b"/><a:pathLst><a:path>' +
            '<a:lnTo><a:pt x="100" y="0"/></a:lnTo><a:lnTo><a:pt x="100" y="100"/></a:lnTo>' +
            '<a:close/></a:path></a:pathLst>'
        )
      )!,
      1000,
      1000
    )!;
    expect(geometry.paths).toEqual([]);
    expect(geometry.textRect).toEqual({ left: 0, top: 0, right: 1000, bottom: 1000 });
  });

  test('presets that draw after close continue from the closed subpath start', () => {
    // The ECMA-376 annex writes the accent callout bar as `M x1 t Z L x1 b`.
    const callout = preset('accentCallout1');
    const bar = callout.paths[1]!;
    expect(bar.subpaths.length).toBe(2);
    expect(bar.subpaths[1]!.points[0]).toEqual(bar.subpaths[0]!.points[0]);
    expect(bar.subpaths[1]!.points.at(-1)!.y).toBeCloseTo(H, 3);
  });

  test('arcTo sweeps beyond one turn keep the one-turn chord sag and the end point', () => {
    // Circle of radius 500 000 EMU centred in a 1 000 000 EMU square, from 0°. Before the
    // sweep was bounded, its worst chord sag was 622 EMU at 1 turn, 59 039 EMU at 10 turns
    // and 402 455 EMU at 100 turns.
    const arc = (swAng: number) => {
      const definition = customGeometryDefinition(
        custGeom(
          '<a:pathLst><a:path><a:moveTo><a:pt x="1000000" y="500000"/></a:moveTo>' +
            `<a:arcTo wR="500000" hR="500000" stAng="0" swAng="${swAng}"/></a:path></a:pathLst>`
        )
      )!;
      return points(evaluateGeometry(definition, 1000000, 1000000)!);
    };
    const worstSag = (outline: readonly GeometryPoint[]) => {
      let sag = 0;
      for (let index = 1; index < outline.length; index += 1) {
        const midX = (outline[index - 1]!.x + outline[index]!.x) / 2;
        const midY = (outline[index - 1]!.y + outline[index]!.y) / 2;
        sag = Math.max(sag, 500000 - Math.hypot(midX - 500000, midY - 500000));
      }
      return sag;
    };
    const turn = 21600000;
    const oneTurn = worstSag(arc(turn));
    expect(Math.round(oneTurn)).toBe(622);
    for (const swAng of [10 * turn, 100 * turn, -10 * turn]) {
      const outline = arc(swAng);
      expect(worstSag(outline)).toBeCloseTo(oneTurn, 3);
      expect(outline.length).toBeLessThanOrEqual(129);
      expect(outline.at(-1)!.x).toBeCloseTo(1000000, 3);
      expect(outline.at(-1)!.y).toBeCloseTo(500000, 3);
    }
    // 10.25 turns end a quarter turn on, at the bottom of the circle.
    const quarterPast = arc(10 * turn + turn / 4);
    expect(worstSag(quarterPast)).toBeLessThan(FLATTEN_TOLERANCE_EMU);
    expect(quarterPast.at(-1)!.x).toBeCloseTo(500000, 3);
    expect(quarterPast.at(-1)!.y).toBeCloseTo(1000000, 3);
  });

  test('arcTo of exactly one turn keeps one chord budget at every start angle', () => {
    // At 112.5° the ellipse parameter span rounds to just above one turn; the chord count
    // still follows the visual sweep, so the circle has the same points as one from 0°.
    const circle = (stAng: number) =>
      points(
        evaluateGeometry(
          customGeometryDefinition(
            custGeom(
              '<a:pathLst><a:path><a:moveTo><a:pt x="1000000" y="500000"/></a:moveTo>' +
                `<a:arcTo wR="500000" hR="500000" stAng="${stAng}" swAng="21600000"/>` +
                '</a:path></a:pathLst>'
            )
          )!,
          1000000,
          1000000
        )!
      );
    const fromZero = circle(0).length;
    for (const stAng of [6750000, 17550000, -21600000]) {
      expect(circle(stAng).length).toBe(fromZero);
    }
  });

  test('arcTo sweeps beyond one turn keep the parity of their turns', () => {
    // An even-odd fill paints a region that the loops wind an odd number of times, so the
    // bounded sweep drops turns only in pairs and keeps at least one full turn.
    const turns = (swAng: number) => {
      const outline = points(
        evaluateGeometry(
          customGeometryDefinition(
            custGeom(
              '<a:pathLst><a:path><a:moveTo><a:pt x="1000000" y="500000"/></a:moveTo>' +
                `<a:arcTo wR="500000" hR="500000" stAng="0" swAng="${swAng}"/>` +
                '</a:path></a:pathLst>'
            )
          )!,
          1000000,
          1000000
        )!
      );
      // Count crossings of the ray from the centre along +y (x = 500 000, y > 500 000).
      let crossings = 0;
      for (let index = 1; index < outline.length; index += 1) {
        const a = outline[index - 1]!;
        const b = outline[index]!;
        if (a.y > 500000 && b.y > 500000 && a.x < 500000 !== b.x < 500000) crossings += 1;
      }
      return crossings;
    };
    const turn = 21600000;
    expect(turns(turn)).toBe(1);
    expect(turns(2 * turn)).toBe(2);
    expect(turns(3 * turn) % 2).toBe(1);
    expect(turns(12 * turn) % 2).toBe(0);
    expect(turns(13 * turn) % 2).toBe(1);
    expect(turns(-12 * turn) % 2).toBe(0);
    expect(turns(12 * turn)).toBeGreaterThan(0);
  });

  test('unknown verbs, operators and oversized command lists refuse', () => {
    expect(
      customGeometryDefinition(custGeom('<a:pathLst><a:path><a:spline/></a:path></a:pathLst>'))
    ).toBeNull();
    expect(
      customGeometryDefinition(
        custGeom(
          '<a:gdLst><a:gd name="x" fmla="pow 2 3"/></a:gdLst>' +
            '<a:pathLst><a:path><a:moveTo><a:pt x="0" y="0"/></a:moveTo></a:path></a:pathLst>'
        )
      )
    ).toBeNull();
    const lines = '<a:lnTo><a:pt x="1" y="1"/></a:lnTo>'.repeat(MAX_GEOMETRY_COMMANDS + 1);
    expect(
      customGeometryDefinition(custGeom(`<a:pathLst><a:path>${lines}</a:path></a:pathLst>`))
    ).toBeNull();
  });

  test('flattened output beyond the point cap refuses', () => {
    // Each 64-segment arc adds 64 points; 2000 of them exceed 4096 long before the end.
    const arcs = '<a:arcTo wR="9000000" hR="9000000" stAng="0" swAng="21600000"/>'.repeat(2000);
    const definition = customGeometryDefinition(
      custGeom(
        `<a:pathLst><a:path><a:moveTo><a:pt x="0" y="0"/></a:moveTo>${arcs}</a:path></a:pathLst>`
      )
    )!;
    expect(definition).not.toBeNull();
    expect(evaluateGeometry(definition, 1000, 1000)).toBeNull();
  });
});

describe('guide formulas', () => {
  const values = builtinGuides(1000, 500);
  const evaluate = (formula: string) => evaluateGuide(parseGuide('g', formula)!, values);

  test('built-in guides', () => {
    expect(values.get('ss')).toBe(500);
    expect(values.get('ls')).toBe(1000);
    expect(values.get('wd32')).toBe(1000 / 32);
    expect(values.get('ssd16')).toBe(500 / 16);
    expect(values.get('7cd8')).toBe(18900000);
  });

  test.each([
    ['*/ w 3 4', 750],
    ['*/ w 3 0', 0],
    ['+- w h 100', 1400],
    ['+/ w h 3', 500],
    ['?: 1 w h', 1000],
    ['?: 0 w h', 500],
    ['?: -1 w h', 500],
    ['abs -7', 7],
    ['at2 1 1', 2700000],
    ['cat2 10 3 4', 6],
    ['cos 10 cd2', -10],
    ['max w h', 1000],
    ['min w h', 500],
    ['mod 3 4 12', 13],
    ['pin 0 w 600', 600],
    ['pin 0 -5 600', 0],
    ['pin 0 300 600', 300],
    ['sat2 10 3 4', 8],
    ['sin 10 cd4', 10],
    ['sqrt 81', 9],
    ['tan 10 2700000', 10],
    ['val 42', 42],
    ['val missing', 0],
  ])('%s = %d', (formula, expected) => {
    expect(evaluate(formula)).toBeCloseTo(expected, 6);
  });

  test('malformed formulas do not parse', () => {
    for (const formula of ['', 'val', '*/ 1 2', 'val 1 2 3', 'pow 2 3', '+- 1 2 3 4 5']) {
      expect(parseGuide('g', formula)).toBeNull();
    }
  });

  test('one trailing operand past the arity is ignored, as the annex writes it', () => {
    expect(evaluate('+- w 0 h 0')).toBe(500);
  });
});
