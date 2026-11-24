// A turned or flipped group, and turned members in a group. Members map into the group extent,
// then the whole group flips and turns clockwise about the centre of its extent. A turned
// member's box scales into the group first and the member turns about its centre, so an
// uneven group scale never skews it. The expected points are reference measurements, as
// offsets from the group's extent origin in points.

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

const xfrmAttrs = (rot = 0, flipH = false, flipV = false) =>
  (rot ? ` rot="${rot * 60_000}"` : '') + (flipH ? ' flipH="1"' : '') + (flipV ? ' flipV="1"' : '');

function member(
  x: number,
  cx: number,
  cy: number,
  prst: string,
  fill: string,
  rot = 0,
  flipH = false
): string {
  return (
    `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm${xfrmAttrs(rot, flipH)}>` +
    `<a:off x="${x * EMU}" y="0"/><a:ext cx="${cx * EMU}" cy="${cy * EMU}"/></a:xfrm>` +
    `<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>` +
    `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln><a:noFill/></a:ln>` +
    '</wps:spPr><wps:bodyPr/></wps:wsp>'
  );
}

interface GroupOptions {
  readonly rot?: number;
  readonly flipH?: boolean;
  readonly flipV?: boolean;
  /** Child extent in points; the group extent is 144 x 72pt. */
  readonly ch?: readonly [number, number];
  readonly memberRot?: number;
  readonly memberFlipH?: boolean;
  readonly members?: string;
}

/** A 144 x 72pt group: a red square on the left, a blue right triangle on the right. */
function groupXml(options: GroupOptions = {}): string {
  const [chx, chy] = options.ch ?? [144, 72];
  const members =
    options.members ??
    member(0, chx / 2, chy, 'rect', 'FF0000') +
      member(chx / 2, chx / 2, chy, 'rtTriangle', '0000FF', options.memberRot, options.memberFlipH);
  return (
    '<w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    'relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>914400' +
    '</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>914400' +
    `</wp:posOffset></wp:positionV><wp:extent cx="${144 * EMU}" cy="${72 * EMU}"/>` +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="1" name="Group 1"/>' +
    `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
    `<a:xfrm${xfrmAttrs(options.rot, options.flipH, options.flipV)}><a:off x="0" y="0"/>` +
    `<a:ext cx="${144 * EMU}" cy="${72 * EMU}"/><a:chOff x="0" y="0"/>` +
    `<a:chExt cx="${chx * EMU}" cy="${chy * EMU}"/></a:xfrm></wpg:grpSpPr>${members}` +
    '</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>'
  );
}

function group(options: GroupOptions = {}): VectorShapeProjection | null {
  const [projection] = projectDrawingsInPart(parsePart(groupXml(options)));
  return projection!.vectorShape;
}

/** Every point of a component's first path matches one expected point, within 0.01pt. */
function expectCorners(
  shape: VectorShapeProjection,
  index: number,
  expected: readonly (readonly [number, number])[]
): void {
  const points = shape.components[index]!.subpathsEmu[0]!.map((p) => [p.x / EMU, p.y / EMU]);
  const distinct = points.filter(
    ([x, y], i) => !points.slice(0, i).some(([px, py]) => Math.hypot(px! - x!, py! - y!) < 1e-6)
  );
  expect(distinct).toHaveLength(expected.length);
  for (const [x, y] of expected) {
    const near = distinct.some(
      ([px, py]) => Math.abs(px! - x) < 0.011 && Math.abs(py! - y) < 0.011
    );
    if (!near) throw new Error(`no point near (${x}, ${y}) in ${JSON.stringify(distinct)}`);
  }
}

describe('turned groups', () => {
  test('a turned group turns every member about the centre of its extent', () => {
    const shape = group({ rot: 30 })!;
    expect(shape.rotationDegrees).toBe(30);
    expect(shape.overflowVisible).toBe(true);
    // Measured at page offset (72, 72): red (99.64,40.82) (162,76.82) (126,139.18) (63.64,103.18).
    expectCorners(shape, 0, [
      [27.64, -31.18],
      [90, 4.82],
      [54, 67.18],
      [-8.36, 31.18],
    ]);
    expectCorners(shape, 1, [
      [54, 67.18],
      [90, 4.82],
      [116.36, 103.18],
    ]);
  });

  test('a flipped group mirrors about its extent centre, before it turns', () => {
    const flipped = group({ flipH: true })!;
    expect(flipped.rotationDegrees).toBeUndefined();
    expectCorners(flipped, 0, [
      [72, 0],
      [144, 0],
      [144, 72],
      [72, 72],
    ]);
    expectCorners(flipped, 1, [
      [72, 0],
      [72, 72],
      [0, 72],
    ]);
    // Measured flipV + 30: blue (162,254.82) (126,317.18) (224.36,290.82) at (72, 250).
    expectCorners(group({ rot: 30, flipV: true })!, 1, [
      [90, 4.82],
      [54, 67.18],
      [152.36, 40.82],
    ]);
    // Measured flipH + 30: blue (374,317.18) (410,254.82) (311.64,281.18) at (320, 250).
    expectCorners(group({ rot: 30, flipH: true })!, 1, [
      [54, 67.18],
      [90, 4.82],
      [-8.36, 31.18],
    ]);
  });

  test('a quarter-turned group scales its members first, without swapping axes', () => {
    // Measured: 144 x 144pt child units in 144 x 72pt, turned 90: red (36..108, -36..36).
    const shape = group({ rot: 90, ch: [144, 144] })!;
    expectCorners(shape, 0, [
      [36, -36],
      [108, -36],
      [108, 36],
      [36, 36],
    ]);
  });

  test('a turned member turns about its scaled box, never skewed by an uneven scale', () => {
    // Measured, the same in an even group and in 144 x 144pt child units:
    // (130.82,469.18) (166.82,406.82) (193.18,505.18) at (72, 420).
    const expected: [number, number][] = [
      [58.82, 49.18],
      [94.82, -13.18],
      [121.18, 85.18],
    ];
    expectCorners(group({ memberRot: 30 })!, 1, expected);
    expectCorners(group({ memberRot: 30, ch: [144, 144] })!, 1, expected);
  });

  test('a member turned nearer a quarter turn takes the other axis scale', () => {
    // 144 x 144pt child units in 144 x 72pt: the member box becomes 36 x 144pt.
    const measured: [number, [number, number][]][] = [
      // (179.11,57.10) (129.10,108.89) (180.89,158.90) at (72, 72).
      [
        44,
        [
          [107.11, -14.9],
          [57.1, 36.89],
          [108.89, 86.9],
        ],
      ],
      // (466.18,44.36) (364.36,146.18) (389.82,171.64) at (320, 72).
      [
        45,
        [
          [146.18, -27.64],
          [44.36, 74.18],
          [69.82, 99.64],
        ],
      ],
      // (356,268) (500,268) (356,304) at (320, 250).
      [
        90,
        [
          [36, 18],
          [180, 18],
          [36, 54],
        ],
      ],
      // (180,405.09) (230.91,456) (129.09,456) at (72, 420).
      [
        135,
        [
          [108, -14.91],
          [158.91, 36],
          [57.09, 36],
        ],
      ],
      // (243.64,587.82) (141.82,689.64) (218.18,562.36) at (72, 590).
      [
        225,
        [
          [171.64, -2.18],
          [69.82, 99.64],
          [146.18, -27.64],
        ],
      ],
    ];
    for (const [memberRot, points] of measured) {
      expectCorners(group({ memberRot, ch: [144, 144] })!, 1, points);
    }
  });

  test('a turned text box member lays out its text in the box its shape paints in', () => {
    // 144 x 144pt child units in 144 x 72pt: a 72 x 144pt member turned 90 degrees paints in
    // a 36 x 144pt box about the centre (108, 36), as the triangle above does.
    const textbox =
      member(0, 72, 144, 'rect', 'FF0000') +
      `<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm rot="${90 * 60_000}">` +
      `<a:off x="${72 * EMU}" y="0"/><a:ext cx="${72 * EMU}" cy="${144 * EMU}"/></a:xfrm>` +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFF00"/>' +
      '</a:solidFill></wps:spPr><wps:txbx><w:txbxContent><w:p><w:r><w:t>Text</w:t></w:r></w:p>' +
      '</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp>';
    const [projection] = projectDrawingsInPart(
      parsePart(groupXml({ ch: [144, 144], members: textbox }))
    );
    const frame = projection!.groupTextboxes![0]!.frameEmu;
    expect([frame.x, frame.y, frame.cx, frame.cy].map((v) => v / EMU)).toEqual([90, -36, 36, 144]);
  });

  test('a group with a turned member paints the member whole, past the group extent', () => {
    expect(group()!.overflowVisible).toBeUndefined();
    expect(group({ memberRot: 45 })!.overflowVisible).toBe(true);
  });

  test('a gradient that keeps its direction moves with a turned group but does not turn', () => {
    const gradient = (rotWithShape: string | number) =>
      member(0, 72, 72, 'rect', 'FF0000').replace(
        '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>',
        `<a:gradFill rotWithShape="${rotWithShape}"><a:gsLst><a:gs pos="0">` +
          '<a:srgbClr val="FF0000"/></a:gs><a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs>' +
          '</a:gsLst><a:lin ang="0" scaled="0"/></a:gradFill>'
      );
    const matrix = (rotWithShape: string | number) =>
      group({ rot: 45, members: gradient(rotWithShape) })!.components[0]!.fillGradient!.matrix;
    // Measured: the gradient runs left to right across the 72pt member box, centred on the
    // turned member's centre, (72 - 25.46, 36 - 25.46)pt in the group.
    const [a, b, c, d, e, f] = matrix(0);
    expect([a, b, c, d]).toEqual([1, 0, 0, 1]);
    expect((e + 36 * EMU) / EMU).toBeCloseTo(72 - 36 * Math.SQRT1_2, 6);
    expect((f + 36 * EMU) / EMU).toBeCloseTo(36 - 36 * Math.SQRT1_2, 6);
    // A gradient that turns with its shape turns with the group too.
    const [ta, tb] = matrix(1);
    expect(ta).toBeCloseTo(Math.SQRT1_2, 9);
    expect(tb).toBeCloseTo(Math.SQRT1_2, 9);
    // Every legal false spelling keeps the direction; an invalid one turns, as the default does.
    for (const spelling of [' 0 ', 'false', ' false\t'])
      expect(matrix(spelling)).toEqual(matrix(0));
    expect(matrix('no')).toEqual(matrix(1));
  });

  test('a member turn and flip compose with the group turn', () => {
    // Measured: blue (162,693.18) (224.36,657.18) (126,630.82) at (72, 590).
    expectCorners(group({ rot: 30, memberRot: 30, memberFlipH: true })!, 1, [
      [90, 103.18],
      [152.36, 67.18],
      [54, 40.82],
    ]);
  });

  test('a turned group keeps its placeholder for paint and text that do not turn with it', () => {
    const pattern = member(0, 72, 72, 'rect', 'FF0000').replace(
      '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>',
      '<a:pattFill prst="pct50"><a:fgClr><a:srgbClr val="FF0000"/></a:fgClr>' +
        '<a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr></a:pattFill>'
    );
    expect(group({ members: pattern })?.components[0]!.fillPattern).toBeTruthy();
    expect(group({ rot: 30, members: pattern })).toBeNull();
    const textbox =
      '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/>' +
      `<a:ext cx="${72 * EMU}" cy="${72 * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/>` +
      '</a:prstGeom><a:solidFill><a:srgbClr val="FFFF00"/></a:solidFill></wps:spPr>' +
      '<wps:txbx><w:txbxContent><w:p><w:r><w:t>Text</w:t></w:r></w:p></w:txbxContent>' +
      '</wps:txbx><wps:bodyPr/></wps:wsp>';
    expect(group({ rot: 30, members: textbox })).toBeNull();
    // A schema-invalid group turn refuses too.
    expect(
      projectDrawingsInPart(
        parsePart(groupXml({ rot: 30 }).replace('rot="1800000"', 'rot="30deg"'))
      )[0]!.vectorShape
    ).toBeNull();
  });
});
