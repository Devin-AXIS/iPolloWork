// A turned top-level shape or line: it flips, then turns clockwise about the centre of its
// unturned extent, and paints past that extent. A shape with no width and no height paints
// nothing and keeps no placeholder. The expected corners are reference measurements.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../index.ts';
import { projectDrawingsInPart } from '../package/drawing-projection.ts';
import type { VectorShapeProjection } from '../package/drawing-shape-projection.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const EMU = 12_700;

function parsePart(body: string) {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:wps="${WPS}" xmlns:wpg="${WPG}"><w:body>${body}</w:body></w:document>`;
  const parsed = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

interface ShapeOptions {
  readonly cx: number;
  readonly cy: number;
  readonly rot?: string;
  readonly flipH?: boolean;
  readonly flipV?: boolean;
  readonly prst?: string;
  readonly paint?: string;
}

const RED = '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:ln><a:noFill/></a:ln>';
const OUTLINE =
  '<a:noFill/><a:ln w="38100"><a:solidFill><a:srgbClr val="000080"/></a:solidFill></a:ln>';

function anchored(options: ShapeOptions): string {
  const { cx, cy } = options;
  const attrs =
    (options.rot !== undefined ? ` rot="${options.rot}"` : '') +
    (options.flipH ? ' flipH="1"' : '') +
    (options.flipV ? ' flipV="1"' : '');
  return (
    '<w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    'relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>914400' +
    '</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>914400' +
    `</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/>` +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="1" name="Shape 1"/>' +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp><wps:cNvSpPr/><wps:spPr>` +
    `<a:xfrm${attrs}><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="${options.prst ?? 'rect'}"><a:avLst/></a:prstGeom>${options.paint ?? RED}` +
    '</wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>' +
    '</w:r></w:p>'
  );
}

function project(options: ShapeOptions) {
  const [projection] = projectDrawingsInPart(parsePart(anchored(options)));
  return projection!;
}

function vector(options: ShapeOptions): VectorShapeProjection {
  const shape = project(options).vectorShape;
  expect(shape).toBeTruthy();
  return shape!;
}

/** The first path's points in points, rounded to 0.01pt. */
function pathPt(shape: VectorShapeProjection): [number, number][] {
  return shape.components[0]!.subpathsEmu[0]!.map((point) => [
    Math.round((point.x / EMU) * 100) / 100,
    Math.round((point.y / EMU) * 100) / 100,
  ]);
}

/** The same corners in any order, each within 0.02pt of the measured one. */
function sameCorners(actual: [number, number][], expected: [number, number][]) {
  expect(actual).toHaveLength(expected.length);
  for (const [x, y] of expected) {
    const near = actual.some(([ax, ay]) => Math.abs(ax - x) <= 0.02 && Math.abs(ay - y) <= 0.02);
    expect(`${x},${y}: ${near}`).toBe(`${x},${y}: true`);
  }
}

describe('turned top-level shapes', () => {
  test('a turned rectangle turns about its extent centre and paints past the extent', () => {
    const shape = vector({ cx: 144 * EMU, cy: 72 * EMU, rot: '1800000' });
    expect(shape.rotationDegrees).toBe(30);
    expect(shape.overflowVisible).toBe(true);
    expect(shape.extentEmu).toEqual({ cx: 144 * EMU, cy: 72 * EMU });
    // Measured corners of a 144 x 72pt rectangle turned 30 degrees, relative to its extent.
    sameCorners(pathPt(shape).slice(0, 4), [
      [27.64, -31.18],
      [152.36, 40.82],
      [116.36, 103.18],
      [-8.36, 31.18],
    ]);
  });

  test('flips apply before the turn', () => {
    // Measured: a right triangle flipped horizontally, then turned 30 degrees.
    sameCorners(
      pathPt(
        vector({ cx: 144 * EMU, cy: 72 * EMU, rot: '1800000', flipH: true, prst: 'rtTriangle' })
      ).slice(0, 3),
      [
        [116.36, 103.18],
        [152.36, 40.82],
        [-8.36, 31.18],
      ]
    );
    sameCorners(
      pathPt(
        vector({ cx: 144 * EMU, cy: 72 * EMU, rot: '1800000', flipV: true, prst: 'rtTriangle' })
      ).slice(0, 3),
      [
        [27.64, -31.18],
        [-8.36, 31.18],
        [152.36, 40.82],
      ]
    );
  });

  test('a turned straight line keeps its endpoints on the turned path', () => {
    const vertical = vector({ cx: 144 * EMU, cy: 0, rot: '5400000', prst: 'line', paint: OUTLINE });
    expect(pathPt(vertical)).toEqual([
      [72, -72],
      [72, 72],
    ]);
    const diagonal = vector({ cx: 144 * EMU, cy: 0, rot: '2700000', prst: 'line', paint: OUTLINE });
    expect(pathPt(diagonal)).toEqual([
      [21.09, -50.91],
      [122.91, 50.91],
    ]);
    // Measured: a 100 x 50pt line flipped horizontally and turned 30 degrees starts here.
    const flipped = vector({
      cx: 100 * EMU,
      cy: 50 * EMU,
      rot: '1800000',
      flipH: true,
      prst: 'line',
      paint: OUTLINE,
    });
    expect(pathPt(flipped)[0]).toEqual([105.8, 28.35]);
    expect(flipped.components[0]!.strokeHex).toBe('000080');
  });

  test('an upright shape carries no turn and paints past its extent', () => {
    const shape = vector({ cx: 144 * EMU, cy: 72 * EMU, rot: '0' });
    expect(shape.rotationDegrees).toBeUndefined();
    expect(shape.overflowVisible).toBe(true);
    expect(
      vector({ cx: 144 * EMU, cy: 72 * EMU, rot: '21600000' }).rotationDegrees
    ).toBeUndefined();
  });

  test('a schema-invalid turn or flip still refuses', () => {
    expect(project({ cx: 144 * EMU, cy: 72 * EMU, rot: '30deg' }).vectorShape).toBeNull();
    const badFlip = anchored({ cx: 144 * EMU, cy: 72 * EMU, rot: '1800000' }).replace(
      'rot="1800000"',
      'rot="1800000" flipH="yes"'
    );
    expect(projectDrawingsInPart(parsePart(badFlip))[0]!.vectorShape).toBeNull();
  });
});

describe('shapes with no width and no height', () => {
  test('a line with no extent paints nothing, turned or not, and keeps no placeholder', () => {
    for (const rot of [undefined, '2700000']) {
      const projection = project({ cx: 0, cy: 0, rot, prst: 'line', paint: OUTLINE });
      expect(projection.vectorShape?.components).toEqual([]);
      expect(projection.vectorShape?.extentEmu).toEqual({ cx: 0, cy: 0 });
      // The turn still reads back, though there is nothing to paint turned.
      expect(projection.vectorShape?.rotationDegrees).toBe(rot ? 45 : undefined);
      expect(projection.diagnostics.some((d) => d.code === 'unsupported-graphic')).toBe(false);
    }
  });

  test('a shape with no extent and an invalid turn refuses', () => {
    expect(
      project({ cx: 0, cy: 0, rot: 'x', prst: 'line', paint: OUTLINE }).vectorShape
    ).toBeNull();
  });
});
