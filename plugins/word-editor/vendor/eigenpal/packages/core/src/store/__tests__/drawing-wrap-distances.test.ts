import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../package/ooxml-tree.ts';
import {
  indexInlineDrawingProjectionsInPart,
  projectDrawingsInPart,
} from '../package/drawing-projection.ts';
import { wrapDistancePoints } from '../package/legacy-vml-values.ts';

const ANCHOR_DISTANCES = 'distT="12700" distB="25400" distL="114300" distR="228600"';

function anchorPart(wrap: string, anchorDistances: string) {
  const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
    xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body><w:p><w:r><w:drawing>
    <wp:anchor ${anchorDistances} simplePos="0" relativeHeight="0" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">
    <wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>
    <wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>
    <wp:extent cx="1270000" cy="1270000"/>${wrap}<wp:docPr id="1" name="fixture"/>
    <wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="urn:fixture"/></a:graphic>
    </wp:anchor></w:drawing></w:r></w:p></w:body></w:document>`;
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

function project(wrap: string, anchorDistances = ANCHOR_DISTANCES) {
  const part = anchorPart(wrap, anchorDistances);
  const before = serializeOoxmlPart(part);
  const projections = indexInlineDrawingProjectionsInPart(part);
  expect(projections.size).toBeGreaterThan(0);
  // Projection normalizes its reading only; the canonical XML keeps the authored values.
  expect(serializeOoxmlPart(part)).toBe(before);
  return projections.values().next().value!.wrapGeometry!.distancesEmu;
}

const tight =
  '<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon edited="0"><wp:start x="0" y="0"/><wp:lineTo x="21600" y="0"/><wp:lineTo x="21600" y="21600"/><wp:lineTo x="0" y="21600"/></wp:wrapPolygon></wp:wrapTight>';
const inherited = { top: 12700, right: 228600, bottom: 25400, left: 114300 };

test('tight and square wraps inherit all anchor text distances', () => {
  expect(project(tight)).toEqual(inherited);
  expect(project('<wp:wrapSquare wrapText="bothSides"/>')).toEqual(inherited);
});

test('an explicit wrap-side zero overrides only that anchor distance', () => {
  expect(
    project(tight.replace('wrapText="bothSides"', 'wrapText="bothSides" distL="0" distR="6350"'))
  ).toEqual({ ...inherited, left: 0, right: 6350 });
  expect(project('<wp:wrapTopAndBottom distT="0"/>')).toEqual({ ...inherited, top: 0 });
});

test('missing wrap and anchor distances retain zero defaults', () => {
  expect(project('<wp:wrapSquare wrapText="bothSides"/>', '')).toEqual({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });
});

// 4294967291 is -5 EMU in two's complement; 2147483648 is the signed 32-bit minimum.
const NEGATIVE_BITS = ['4294967291', '2147483648', '4294967295'] as const;
const SIDES = [
  ['distT', 'top'],
  ['distR', 'right'],
  ['distB', 'bottom'],
  ['distL', 'left'],
] as const;

function anchorWith(name: string, value: string): string {
  return ANCHOR_DISTANCES.replace(new RegExp(`${name}="\\d+"`), `${name}="${value}"`);
}

test('an anchor side stored as a negative unsigned value reads as zero on that side only', () => {
  for (const [name, side] of SIDES) {
    for (const value of NEGATIVE_BITS) {
      expect(project(tight, anchorWith(name, value))).toEqual({ ...inherited, [side]: 0 });
      expect(project('<wp:wrapSquare wrapText="bothSides"/>', anchorWith(name, value))).toEqual({
        ...inherited,
        [side]: 0,
      });
    }
  }
});

test('the signed 32-bit maximum and other positive distances stay exact', () => {
  for (const [name, side] of SIDES) {
    expect(project(tight, anchorWith(name, '2147483647'))).toEqual({
      ...inherited,
      [side]: 2147483647,
    });
    expect(project(tight, anchorWith(name, '1'))).toEqual({ ...inherited, [side]: 1 });
    expect(project(tight, anchorWith(name, '0'))).toEqual({ ...inherited, [side]: 0 });
  }
});

test('an unsigned-negative anchor top and bottom under a tight wrap keep the side distances', () => {
  expect(
    project(tight, 'distT="4294967291" distB="4294967291" distL="114300" distR="114300"')
  ).toEqual({ top: 0, right: 114300, bottom: 0, left: 114300 });
});

test('wrap-side values override anchor sides, including zero and negative bits', () => {
  const negativeAnchor =
    'distT="4294967291" distB="4294967291" distL="4294967291" distR="4294967291"';
  expect(
    project(
      '<wp:wrapSquare wrapText="bothSides" distT="12700" distB="0" distL="25400" distR="0"/>',
      negativeAnchor
    )
  ).toEqual({ top: 12700, right: 0, bottom: 0, left: 25400 });
  expect(
    project(
      '<wp:wrapSquare wrapText="bothSides" distT="4294967291" distB="2147483648" distL="0" distR="4294967295"/>'
    )
  ).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  expect(project('<wp:wrapTopAndBottom distB="4294967291"/>')).toEqual({
    ...inherited,
    bottom: 0,
  });
});

test('malformed wrap-side values read as zero instead of a clamped maximum', () => {
  for (const value of ['4294967296', '99999999999999', '-5', '+5', ' 5', '1.5', 'abc', '']) {
    expect(project(`<wp:wrapSquare wrapText="bothSides" distR="${value}"/>`)).toEqual({
      ...inherited,
      right: 0,
    });
  }
  expect(project('<wp:wrapSquare wrapText="bothSides" distR="0000012700"/>')).toEqual({
    ...inherited,
    right: 12700,
  });
});

test('an anchor distance outside xsd:unsignedInt is not projected as a typed anchor', () => {
  const square = '<wp:wrapSquare wrapText="bothSides"/>';
  expect(indexInlineDrawingProjectionsInPart(anchorPart(square, 'distR="0"')).size).toBe(1);
  for (const value of ['4294967296', '-5', 'abc']) {
    const part = anchorPart(square, `distR="${value}"`);
    expect(indexInlineDrawingProjectionsInPart(part).size).toBe(0);
    expect(serializeOoxmlPart(part)).toContain(`distR="${value}"`);
  }
});

function projectInline(attributes: string) {
  const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
    xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body><w:p><w:r><w:drawing>
    <wp:inline ${attributes}><wp:extent cx="1270000" cy="1270000"/><wp:docPr id="1" name="fixture"/>
    <wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="urn:fixture"/></a:graphic>
    </wp:inline></w:drawing></w:r></w:p></w:body></w:document>`;
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  const projections = indexInlineDrawingProjectionsInPart(parsed.part);
  expect(projections.size).toBeGreaterThan(0);
  return projections.values().next().value!.inlineDistancesEmu;
}

test('inline distances use the same bounded reading', () => {
  expect(projectInline('distT="4294967291" distB="4294967296" distL="-5" distR="114300"')).toEqual({
    top: 0,
    right: 114300,
    bottom: 0,
    left: 0,
  });
});

function projectVml(distances: string) {
  const xml =
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w10="urn:schemas-microsoft-com:office:word">' +
    '<w:body><w:p><w:r><w:pict><v:rect style="position:absolute;margin-left:0;margin-top:0;' +
    `width:144pt;height:2pt;z-index:1;${distances};mso-position-horizontal-relative:text;` +
    'mso-position-vertical-relative:text" fillcolor="#000000" stroked="f">' +
    '<w10:wrap type="square"/></v:rect></w:pict></w:r></w:p></w:body></w:document>';
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  const projections = projectDrawingsInPart(parsed.part);
  expect(projections).toHaveLength(1);
  return projections[0]!.wrapGeometry!.distancesEmu;
}

test('VML text distances read tiny and plain negatives as zero', () => {
  expect(
    projectVml(
      'mso-wrap-distance-left:9pt;mso-wrap-distance-top:-1e-4mm;' +
        'mso-wrap-distance-right:9pt;mso-wrap-distance-bottom:-20pt'
    )
  ).toEqual({ top: 0, right: 114300, bottom: 0, left: 114300 });
});

test('VML wrap distance values parse units and exponents with bounds', () => {
  expect(wrapDistancePoints('9pt')).toBe(9);
  expect(wrapDistancePoints('0')).toBe(0);
  expect(wrapDistancePoints('1in')).toBe(72);
  expect(wrapDistancePoints('2.5E1PT')).toBe(25);
  expect(wrapDistancePoints('-1e-4mm')).toBe(0);
  expect(wrapDistancePoints('-3pt')).toBe(0);
  expect(wrapDistancePoints('1e999pt')).toBeNaN();
  expect(wrapDistancePoints('1e1234')).toBeNaN();
  expect(wrapDistancePoints('e5pt')).toBeNaN();
  expect(wrapDistancePoints('1e')).toBeNaN();
  expect(wrapDistancePoints('abc')).toBeNaN();
});
