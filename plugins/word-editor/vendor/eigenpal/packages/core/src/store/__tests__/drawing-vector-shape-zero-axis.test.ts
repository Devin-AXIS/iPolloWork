// A straight vertical or horizontal line has zero width or height. Such lines appear as
// standalone shapes and as `wpg:wgp` group children, so a zero axis must not refuse the
// drawing (#972), while invalid sizes still do.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../index.ts';
import { indexInlineDrawingProjectionsInPart } from '../package/drawing-projection.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';

const lineChild = (x: number, cx: number | string, cy: number) =>
  `<wps:wsp><wps:cNvCnPr/><wps:spPr><a:xfrm><a:off x="${x}" y="0"/>` +
  `<a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom>` +
  '<a:ln w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>' +
  '</wps:spPr><wps:bodyPr/></wps:wsp>';

const freeformRule = (pathSize: string) =>
  '<wps:wsp><wps:spPr><a:xfrm><a:off x="300000" y="0"/><a:ext cx="0" cy="1000000"/></a:xfrm>' +
  `<a:custGeom><a:pathLst><a:path${pathSize}>` +
  '<a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="0" y="1000000"/></a:lnTo>' +
  '</a:path></a:pathLst></a:custGeom>' +
  '<a:ln w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>' +
  '</wps:spPr></wps:wsp>';

function shapeOf(children: string, cx = 600000) {
  const drawing =
    '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${cx}" cy="1000000"/><wp:docPr id="5" name="Group 5"/>` +
    `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="1000000"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="${cx}" cy="1000000"/></a:xfrm></wpg:grpSpPr>` +
    children +
    '</wpg:wgp></a:graphicData></a:graphic></wp:inline></w:drawing>';
  return project(drawing);
}

/** A standalone `wps:wsp` line, as Insert > Shapes > Line writes it. */
function standaloneLine(cx: number, cy: number) {
  return project(
    '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="6" name="Line 6"/>` +
      `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp><wps:cNvCnPr/><wps:spPr>` +
      `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
      '<a:prstGeom prst="line"><a:avLst/></a:prstGeom>' +
      '<a:ln w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>' +
      '</wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing>'
  );
}

function project(drawing: string) {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
      `xmlns:wps="${WPS}" xmlns:wpg="${WPG}"><w:body><w:p><w:r>${drawing}</w:r></w:p>` +
      '</w:body></w:document>',
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return [...indexInlineDrawingProjectionsInPart(parsed.part).values()][0]!.vectorShape;
}

describe('zero-width and zero-height group children', () => {
  test('vertical rule children project, one component each', () => {
    const rules = shapeOf(
      lineChild(50000, 0, 1000000) + lineChild(0, 0, 1000000) + lineChild(600000, 0, 1000000)
    );
    expect(rules?.components).toHaveLength(3);
    expect(rules?.components[0]!.subpathsEmu[0]).toEqual([
      { x: 50000, y: 0 },
      { x: 50000, y: 1000000 },
    ]);
    expect(rules?.components[2]!.strokeHex).toBe('000000');
    expect(rules?.components[0]!.strokeInset).toBeUndefined();
    expect(shapeOf(lineChild(0, 600000, 0))?.components).toHaveLength(1);
  });

  test('a 0x0 child is a point and still passes the child checks', () => {
    expect(shapeOf(lineChild(0, 0, 1000000) + lineChild(0, 0, 0))?.components).toHaveLength(2);
    // A zero-extent text box paints its shape as a point too; a group does not lay out its text.
    const emptyTextbox =
      '<wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
      '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></wps:spPr>' +
      '<wps:txbx><w:txbxContent><w:p/></w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp>';
    expect(shapeOf(lineChild(0, 0, 1000000) + emptyTextbox)?.components).toHaveLength(2);
    const plainRect = emptyTextbox.replace(/<wps:txbx>.*<\/wps:txbx>/, '');
    expect(shapeOf(lineChild(0, 0, 1000000) + plainRect)?.components).toHaveLength(2);
  });

  test('a standalone vertical or horizontal line projects; a point paints nothing', () => {
    const vertical = standaloneLine(0, 1000000);
    expect(vertical?.extentEmu).toEqual({ cx: 0, cy: 1000000 });
    expect(vertical?.components[0]!.subpathsEmu[0]).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1000000 },
    ]);
    expect(standaloneLine(1000000, 0)?.components).toHaveLength(1);
    // A line with no width and no height paints nothing, not even its outline's caps, and
    // keeps no placeholder, so it stays selectable.
    const point = standaloneLine(0, 0);
    expect(point?.extentEmu).toEqual({ cx: 0, cy: 0 });
    expect(point?.components).toEqual([]);
  });

  test('a group of rules on one x has a zero child extent and keeps its stroke width', () => {
    const rules = shapeOf(lineChild(0, 0, 1000000) + lineChild(0, 0, 500000), 0);
    expect(rules?.components).toHaveLength(2);
    // The collapsed axis does not halve the stroke.
    expect(rules?.components[0]!.strokeWidthEmu).toBe(9525);
  });

  test('an arrowhead keeps its shape in a group that collapses an axis', () => {
    const arrowRule = lineChild(0, 0, 1000000).replace(
      '</a:solidFill></a:ln>',
      '</a:solidFill><a:tailEnd type="triangle" w="med" len="med"/></a:ln>'
    );
    const arrow = shapeOf(arrowRule, 0)?.components[0]!.arrowheadsEmu?.[0];
    expect(arrow).toHaveLength(3);
    // The tip stays on the line; the wings spread across it instead of flattening.
    expect(arrow![0]).toEqual({ x: 0, y: 1000000 });
    expect(Math.abs(arrow![1]!.x)).toBeGreaterThan(0);
    expect(arrow![1]!.x).toBeCloseTo(-arrow![2]!.x, 6);
  });

  test('an arrowhead keeps its absolute size in a group with a large child scale', () => {
    // Child units 635 times smaller than the extent: the line scales, its line end does not.
    const arrowRule = (cy: number) =>
      lineChild(0, 0, cy).replace(
        '</a:solidFill></a:ln>',
        '</a:solidFill><a:tailEnd type="triangle" w="lg" len="lg"/></a:ln>'
      );
    const span = (points: readonly { x: number; y: number }[]) =>
      Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y));
    const plain = shapeOf(arrowRule(1000000))?.components[0]!.arrowheadsEmu?.[0];
    const drawing =
      '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="600000" cy="1000000"/><wp:docPr id="9" name="Group 9"/>' +
      `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
      '<a:xfrm><a:off x="0" y="0"/><a:ext cx="600000" cy="1000000"/>' +
      '<a:chOff x="0" y="0"/><a:chExt cx="945" cy="1575"/></a:xfrm></wpg:grpSpPr>' +
      arrowRule(1575) +
      '</wpg:wgp></a:graphicData></a:graphic></wp:inline></w:drawing>';
    const scaled = project(drawing)?.components[0]!.arrowheadsEmu?.[0];
    expect(scaled).toHaveLength(plain!.length);
    expect(scaled![0]!.y).toBeCloseTo(1000000, 0);
    expect(span(scaled!)).toBeCloseTo(span(plain!), 0);
  });

  test('a zero child extent under a wider group puts every child at the group origin', () => {
    // Such children draw on the extent's left edge, at their full stroke width.
    const drawing =
      '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="914400" cy="1000000"/><wp:docPr id="8" name="Group 8"/>' +
      `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
      '<a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="1000000"/>' +
      '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="1000000"/></a:xfrm></wpg:grpSpPr>' +
      lineChild(0, 0, 1000000) +
      '</wpg:wgp></a:graphicData></a:graphic></wp:inline></w:drawing>';
    const rules = project(drawing);
    expect(rules?.components[0]!.subpathsEmu[0]).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1000000 },
    ]);
    expect(rules?.components[0]!.strokeWidthEmu).toBe(9525);
  });

  test('a diagonal arrow that a group collapses points along the line it became', () => {
    const diagonal =
      '<wps:wsp><wps:cNvCnPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/>' +
      '<a:ext cx="1000000" cy="1000000"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom>' +
      '<a:ln w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill>' +
      '<a:tailEnd type="triangle" w="med" len="med"/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp>';
    const drawing =
      '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="0" cy="1000000"/><wp:docPr id="9" name="Group 9"/>' +
      `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
      '<a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="1000000"/>' +
      '<a:chOff x="0" y="0"/><a:chExt cx="1000000" cy="1000000"/></a:xfrm></wpg:grpSpPr>' +
      diagonal +
      '</wpg:wgp></a:graphicData></a:graphic></wp:inline></w:drawing>';
    const [tip, wingA, wingB] = project(drawing)!.components[0]!.arrowheadsEmu![0]!;
    // Pointing down the now-vertical line: both wings share one y above the tip, split in x.
    expect(tip).toEqual({ x: 0, y: 1000000 });
    expect(wingA!.y).toBeCloseTo(wingB!.y, 6);
    expect(wingA!.y).toBeLessThan(1000000);
    expect(wingA!.x).toBeCloseTo(-wingB!.x, 6);
  });

  test('an inset child in small child units keeps its inset once scaled', () => {
    const unitRect =
      '<wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
      '<a:ln w="1" algn="in"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>' +
      '</wps:spPr></wps:wsp>';
    const drawing =
      '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="1000000" cy="1000000"/><wp:docPr id="7" name="Group 7"/>' +
      `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
      '<a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/>' +
      '<a:chOff x="0" y="0"/><a:chExt cx="1" cy="1"/></a:xfrm></wpg:grpSpPr>' +
      unitRect +
      '</wpg:wgp></a:graphicData></a:graphic></wp:inline></w:drawing>';
    expect(project(drawing)?.components[0]!.strokeInset).toBe(true);
  });

  test('only a closed outline is marked inset; a line stays centred', () => {
    const insetLine = lineChild(0, 0, 1000000).replace(
      '<a:ln w="9525">',
      '<a:ln w="9525" algn="in">'
    );
    expect(shapeOf(insetLine)?.components[0]!.strokeInset).toBeUndefined();
    const insetRect = shapeOf(
      insetLine
        .replace('cx="0" cy="1000000"', 'cx="600000" cy="1000000"')
        .replace('prst="line"', 'prst="rect"')
    );
    expect(insetRect?.components[0]!.strokeInset).toBe(true);
    // A closed path collapsed onto a line has no inside; clipping to it would erase it.
    const flatRect = shapeOf(insetLine.replace('prst="line"', 'prst="rect"'));
    expect(flatRect?.components[0]!.strokeInset).toBeUndefined();
    // So does a closed path whose points are collinear, whatever its extent.
    const collinear = shapeOf(
      '<wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="600000" cy="1000000"/></a:xfrm>' +
        '<a:custGeom><a:pathLst><a:path w="600000" h="1000000">' +
        '<a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="600000" y="1000000"/></a:lnTo>' +
        '<a:close/></a:path></a:pathLst></a:custGeom>' +
        '<a:ln w="9525" algn="in"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>' +
        '</wps:spPr></wps:wsp>'
    );
    expect(collinear?.components[0]!.strokeInset).toBeUndefined();
    // And a rectangle that a group collapsed onto a line (a zero group extent axis).
    const squashed = shapeOf(
      insetLine
        .replace('cx="0" cy="1000000"', 'cx="600000" cy="1000000"')
        .replace('prst="line"', 'prst="rect"'),
      0
    );
    expect(squashed?.components[0]!.strokeInset).toBeUndefined();
  });

  test('negative sizes stay invalid, although a clamped read would make them zero', () => {
    expect(shapeOf(lineChild(0, 0, 1000000) + lineChild(0, '-5000', 1000000))).toBeNull();
    expect(shapeOf(freeformRule(' w="-5" h="1000000"'))).toBeNull();
  });

  test('a freeform rule maps a zero path space onto a zero-width child only', () => {
    for (const pathSize of [' w="0" h="1000000"', '']) {
      expect(shapeOf(freeformRule(pathSize))?.components[0]!.subpathsEmu[0]).toEqual([
        { x: 300000, y: 0 },
        { x: 300000, y: 1000000 },
      ]);
    }
    expect(shapeOf(freeformRule(' w="0" h="1000000"').replace('cx="0"', 'cx="1000"'))).toBeNull();
  });
});
