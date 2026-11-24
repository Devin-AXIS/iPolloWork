// Shape projection over the DrawingML geometry engine: preset and custom geometry, per-path
// fill modes, turned group members, gradient fills, and drawing canvases.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../index.ts';
import {
  indexInlineDrawingProjectionsInPart,
  projectDrawingsInPart,
} from '../package/drawing-projection.ts';
import type { VectorShapeProjection } from '../package/drawing-shape-projection.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const WPC = 'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const V = 'urn:schemas-microsoft-com:vml';

function parsePart(body: string) {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:wps="${WPS}" xmlns:wpg="${WPG}" xmlns:wpc="${WPC}" xmlns:mc="${MC}" xmlns:v="${V}">` +
    `<w:body>${body}</w:body></w:document>`;
  const parsed = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

function inline(cx: number, cy: number, uri: string, payload: string): string {
  return (
    `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Shape 1"/>` +
    `<a:graphic><a:graphicData uri="${uri}">${payload}</a:graphicData></a:graphic>` +
    `</wp:inline></w:drawing></w:r></w:p>`
  );
}

function shape(spPr: string, extra = ''): string {
  return `<wps:wsp><wps:cNvSpPr/><wps:spPr>${spPr}</wps:spPr>${extra}<wps:bodyPr/></wps:wsp>`;
}

function onlyVector(body: string): VectorShapeProjection {
  const [projection] = projectDrawingsInPart(parsePart(body));
  expect(projection?.vectorShape).toBeTruthy();
  return projection!.vectorShape!;
}

const XFRM = '<a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="500000"/></a:xfrm>';
const FILL = '<a:solidFill><a:srgbClr val="336699"/></a:solidFill>';

function bounds(points: readonly Readonly<{ x: number; y: number }>[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

describe('preset geometry through the geometry engine', () => {
  test('a rounded rectangle keeps its box and rounds its corners', () => {
    const vector = onlyVector(
      inline(
        1000000,
        500000,
        WPS,
        shape(`${XFRM}<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>${FILL}`)
      )
    );
    const points = vector.components[0]!.subpathsEmu[0]!;
    const [minX, minY, maxX, maxY] = bounds(points);
    expect(minX).toBeCloseTo(0, 3);
    expect(minY).toBeCloseTo(0, 3);
    expect(maxX).toBeCloseTo(1000000, 3);
    expect(maxY).toBeCloseTo(500000, 3);
    // No vertex sits on a corner: the default radius is a sixth of the short side.
    expect(points.some((point) => point.x < 1 && point.y < 1)).toBe(false);
    expect(points.length).toBeGreaterThan(8);
  });

  test('an adjust override changes the preset outline', () => {
    const square = onlyVector(
      inline(
        1000000,
        500000,
        WPS,
        shape(
          `${XFRM}<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 0"/></a:avLst></a:prstGeom>${FILL}`
        )
      )
    );
    expect(square.components[0]!.subpathsEmu[0]).toContainEqual({ x: 0, y: 0 });
  });

  test('an unknown preset leaves the shape unprojected', () => {
    const [projection] = projectDrawingsInPart(
      parsePart(inline(1000000, 500000, WPS, shape(`${XFRM}<a:prstGeom prst="notAShape"/>${FILL}`)))
    );
    expect(projection?.vectorShape ?? null).toBeNull();
  });

  test('a quadratic curve in a custom path flattens and paints', () => {
    const custom =
      '<a:custGeom><a:pathLst><a:path w="100" h="100">' +
      '<a:moveTo><a:pt x="0" y="0"/></a:moveTo>' +
      '<a:quadBezTo><a:pt x="100" y="0"/><a:pt x="100" y="100"/></a:quadBezTo>' +
      '<a:close/></a:path></a:pathLst></a:custGeom>';
    const vector = onlyVector(inline(1000000, 1000000, WPS, shape(`${XFRM}${custom}${FILL}`)));
    const points = vector.components[0]!.subpathsEmu[0]!;
    expect(points.length).toBeGreaterThan(4);
    expect(points).toContainEqual({ x: 1000000, y: 1000000 });
  });

  test('a cube paints its darkened and lightened faces as separate components', () => {
    const vector = onlyVector(
      inline(
        1000000,
        500000,
        WPS,
        shape(`${XFRM}<a:prstGeom prst="cube"><a:avLst/></a:prstGeom>${FILL}`)
      )
    );
    const fills = new Set(vector.components.map((component) => component.fillHex));
    expect(fills.size).toBeGreaterThan(1);
    expect(fills.has('336699')).toBe(true);
  });

  test('a turned top-level shape turns about its extent centre and paints past it', () => {
    const [projection] = projectDrawingsInPart(
      parsePart(
        inline(
          1000000,
          500000,
          WPS,
          shape(
            '<a:xfrm rot="5400000"><a:off x="0" y="0"/><a:ext cx="1000000" cy="500000"/></a:xfrm>' +
              `<a:prstGeom prst="rect"/>${FILL}`
          )
        )
      )
    );
    const vector = projection!.vectorShape!;
    expect(vector.rotationDegrees).toBe(90);
    expect(vector.overflowVisible).toBe(true);
    // A quarter turn about (500000, 250000): the top-left corner lands at (750000, -250000).
    const [first] = vector.components[0]!.subpathsEmu[0]!;
    expect(first!.x).toBeCloseTo(750000, 3);
    expect(first!.y).toBeCloseTo(-250000, 3);
  });
});

describe('gradient fills', () => {
  const gradient = (shade: string) =>
    '<a:gradFill><a:gsLst>' +
    '<a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs>' +
    '<a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs>' +
    `</a:gsLst>${shade}</a:gradFill>`;

  test('a linear gradient spans the box along its angle and keeps a mean fill colour', () => {
    const vector = onlyVector(
      inline(
        1000000,
        500000,
        WPS,
        shape(`${XFRM}<a:prstGeom prst="rect"/>${gradient('<a:lin ang="5400000" scaled="0"/>')}`)
      )
    );
    const component = vector.components[0]!;
    expect(component.fillHex).toBe('800080');
    const fill = component.fillGradient!;
    expect(fill.kind).toBe('linear');
    expect(fill.stops.map((stop) => stop.hex)).toEqual(['FF0000', '0000FF']);
    // 90 degrees runs top to bottom through the box centre.
    const [x1, y1, x2, y2] = fill.coords;
    expect(x1).toBeCloseTo(500000, 3);
    expect(y1).toBeCloseTo(0, 3);
    expect(x2).toBeCloseTo(500000, 3);
    expect(y2).toBeCloseTo(500000, 3);
  });

  test('a path gradient grows from the focus rectangle to the farthest corner', () => {
    const vector = onlyVector(
      inline(
        1000000,
        500000,
        WPS,
        shape(
          `${XFRM}<a:prstGeom prst="rect"/>` +
            gradient(
              '<a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>'
            )
        )
      )
    );
    const fill = vector.components[0]!.fillGradient!;
    expect(fill.kind).toBe('radial');
    expect(fill.coords[0]).toBeCloseTo(0.5, 6);
    expect(fill.coords[1]).toBeCloseTo(0.5, 6);
    expect(fill.coords[2]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(fill.matrix).toEqual([1000000, 0, 0, 500000, 0, 0]);
  });

  test('an unresolvable stop leaves the gradient unpainted rather than guessed', () => {
    const [projection] = projectDrawingsInPart(
      parsePart(
        inline(
          1000000,
          500000,
          WPS,
          shape(
            `${XFRM}<a:prstGeom prst="rect"/><a:gradFill><a:gsLst>` +
              '<a:gs pos="0"><a:srgbClr val="FF0000"><a:lumMod val="abc"/></a:srgbClr></a:gs>' +
              '<a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs>' +
              '</a:gsLst></a:gradFill>'
          )
        )
      )
    );
    expect(projection?.vectorShape ?? null).toBeNull();
  });
});

describe('outer shadows', () => {
  test('without an effects renderer, other effects paint as an empty effect list', () => {
    const effects =
      '<a:effectLst><a:glow rad="127000"><a:srgbClr val="FFC000"/></a:glow>' +
      '<a:innerShdw blurRad="63500" dist="50800" dir="13500000"><a:prstClr val="black"/>' +
      '</a:innerShdw></a:effectLst><a:sp3d prstMaterial="dkEdge"><a:bevelT w="8200"/></a:sp3d>';
    const vector = onlyVector(
      inline(1000000, 500000, WPS, shape(`${XFRM}<a:prstGeom prst="rect"/>${FILL}${effects}`))
    );
    const plain = onlyVector(
      inline(1000000, 500000, WPS, shape(`${XFRM}<a:prstGeom prst="rect"/>${FILL}`))
    );
    expect(vector.components).toEqual(plain.components);
  });

  test('a direct outer shadow offsets along its direction in its colour', () => {
    const effect =
      '<a:effectLst><a:outerShdw blurRad="40000" dist="20000" dir="5400000">' +
      '<a:srgbClr val="000000"><a:alpha val="38000"/></a:srgbClr></a:outerShdw></a:effectLst>';
    const vector = onlyVector(
      inline(1000000, 500000, WPS, shape(`${XFRM}<a:prstGeom prst="rect"/>${FILL}${effect}`))
    );
    const shadow = vector.components[0]!.shadow!;
    expect(shadow.dxEmu).toBeCloseTo(0, 6);
    expect(shadow.dyEmu).toBeCloseTo(20000, 6);
    expect(shadow.blurEmu).toBe(40000);
    expect(shadow.hex).toBe('000000');
    expect(shadow.alpha).toBeCloseTo(0.38, 6);
  });

  test('an empty direct effect list replaces any theme shadow, and none paints by default', () => {
    const empty = onlyVector(
      inline(1000000, 500000, WPS, shape(`${XFRM}<a:prstGeom prst="rect"/>${FILL}<a:effectLst/>`))
    );
    expect(empty.components[0]!.shadow).toBeUndefined();
    const plain = onlyVector(
      inline(1000000, 500000, WPS, shape(`${XFRM}<a:prstGeom prst="rect"/>${FILL}`))
    );
    expect(plain.components[0]!.shadow).toBeUndefined();
  });

  test('a shape of several paths casts one silhouette shadow before its paths', () => {
    const effect =
      '<a:effectLst><a:outerShdw blurRad="0" dist="12700" dir="5400000">' +
      '<a:srgbClr val="000000"/></a:outerShdw></a:effectLst>';
    const vector = onlyVector(
      inline(1000000, 500000, WPS, shape(`${XFRM}<a:prstGeom prst="cube"/>${FILL}${effect}`))
    );
    const [first, ...rest] = vector.components;
    expect(first!.shadowOnly).toBe(true);
    expect(first!.shadow!.dyEmu).toBeCloseTo(12700, 6);
    expect(rest.length).toBeGreaterThan(1);
    expect(rest.every((component) => component.shadow === undefined)).toBe(true);
  });

  test('a hostile shadow distance is clamped', () => {
    const effect =
      '<a:effectLst><a:outerShdw blurRad="9999999999" dist="9999999999" dir="0">' +
      '<a:srgbClr val="000000"/></a:outerShdw></a:effectLst>';
    const vector = onlyVector(
      inline(1000000, 500000, WPS, shape(`${XFRM}<a:prstGeom prst="rect"/>${FILL}${effect}`))
    );
    const shadow = vector.components[0]!.shadow!;
    expect(shadow.dxEmu).toBeLessThanOrEqual(1_270_000);
    expect(shadow.blurEmu).toBeLessThanOrEqual(1_270_000);
  });
});

describe('inner shadows', () => {
  test('preset colours resolve by name and short form', () => {
    const vector = onlyVector(
      inline(
        1000000,
        500000,
        WPS,
        shape(
          `${XFRM}<a:prstGeom prst="rect"/><a:solidFill><a:prstClr val="dkSlateBlue"/></a:solidFill>`
        )
      )
    );
    expect(vector.components[0]!.fillHex).toBe('483D8B');
  });
});

describe('drawing canvases', () => {
  const box = (id: number, x: number, text: string) =>
    `<wps:wsp><wps:cNvPr id="${id}" name="Box ${id}"/><wps:cNvSpPr/><wps:spPr>` +
    `<a:xfrm><a:off x="${x}" y="100000"/><a:ext cx="1400000" cy="600000"/></a:xfrm>` +
    '<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="DCE6F2"/></a:solidFill>' +
    '<a:ln w="12700"><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill></a:ln></wps:spPr>' +
    `<wps:txbx><w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:txbxContent></wps:txbx>` +
    '<wps:bodyPr anchor="ctr"/></wps:wsp>';
  const arrow = (id: number, x: number) =>
    `<wps:wsp><wps:cNvPr id="${id}" name="Arrow ${id}"/><wps:cNvCnPr/><wps:spPr>` +
    `<a:xfrm><a:off x="${x}" y="400000"/><a:ext cx="900000" cy="0"/></a:xfrm>` +
    '<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>' +
    '<a:ln w="19050"><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill><a:tailEnd type="triangle"/></a:ln>' +
    '</wps:spPr><wps:bodyPr/></wps:wsp>';
  const canvas = (members: string, chrome = '<wpc:bg/><wpc:whole/>') =>
    inline(6000000, 800000, WPC, `<wpc:wpc>${chrome}${members}</wpc:wpc>`);

  test('members paint at their canvas offsets and their stories lay out as member text', () => {
    const [projection] = projectDrawingsInPart(
      parsePart(canvas(box(2, 0, 'Start') + arrow(3, 1400000) + box(4, 2300000, 'End')))
    );
    expect(projection?.diagnostics).toEqual([]);
    const vector = projection!.vectorShape!;
    expect(vector.components.length).toBe(3);
    const [, , maxX] = bounds(vector.components[2]!.subpathsEmu[0]!);
    expect(maxX).toBeCloseTo(3700000, 3);
    expect(vector.components[1]!.arrowheadsEmu?.length).toBe(1);
    const texts = projection!.groupTextboxes!;
    expect(texts.map((member) => member.frameEmu.x)).toEqual([0, 2300000]);
    // The shape paints as a vector component; the story carries text only.
    expect(texts[0]!.story.fillHex).toBeNull();
    expect(texts[0]!.story.verticalAnchor).toBe('center');
  });

  test('the canvas background and outline paint first', () => {
    const [projection] = projectDrawingsInPart(
      parsePart(
        canvas(
          box(2, 0, 'Start'),
          '<wpc:bg><a:solidFill><a:srgbClr val="FFFFCC"/></a:solidFill></wpc:bg>' +
            '<wpc:whole><a:ln w="6350"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></wpc:whole>'
        )
      )
    );
    const first = projection!.vectorShape!.components[0]!;
    expect(first.fillHex).toBe('FFFFCC');
    expect(first.strokeHex).toBe('000000');
    expect(first.strokeWidthEmu).toBe(6350);
  });

  test('a canvas with a member outside the subset keeps its placeholder', () => {
    const [projection] = projectDrawingsInPart(
      parsePart(canvas(box(2, 0, 'Start') + '<pic:pic xmlns:pic="urn:example"/>'))
    );
    expect(projection?.vectorShape ?? null).toBeNull();
    expect(projection?.groupTextboxes).toBeUndefined();
  });

  test('a canvas wrapped for compatibility uses its modern branch', () => {
    const body =
      '<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wpc">' +
      canvas(box(2, 0, 'Start')).slice('<w:p><w:r>'.length, -'</w:r></w:p>'.length) +
      '</mc:Choice><mc:Fallback><w:pict><v:group id="g"/></w:pict></mc:Fallback>' +
      '</mc:AlternateContent></w:r></w:p>';
    const atoms = [...indexInlineDrawingProjectionsInPart(parsePart(body)).values()];
    expect(atoms).toHaveLength(1);
    expect(atoms[0]!.vectorShape?.components.length).toBe(1);
  });
});

describe('group fills inside a drawing canvas', () => {
  const member =
    '<wps:wsp><wps:cNvPr id="5" name="Member"/><wps:cNvSpPr/><wps:spPr>' +
    '<a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="500000"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:grpFill/>' +
    '<a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></wps:spPr>' +
    '<wps:bodyPr/></wps:wsp>';
  const canvasWithGroup = (fill: string) =>
    inline(
      6000000,
      800000,
      WPC,
      '<wpc:wpc><wpc:bg/><wpc:whole/><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>' +
        '<a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="500000"/>' +
        '<a:chOff x="0" y="0"/><a:chExt cx="1000000" cy="500000"/></a:xfrm>' +
        `${fill}</wpg:grpSpPr>${member}</wpg:wgp></wpc:wpc>`
    );
  const vectorOf = (fill: string) =>
    projectDrawingsInPart(parsePart(canvasWithGroup(fill)))[0]?.vectorShape ?? null;

  test('a member paints a solid group fill', () => {
    const vector = vectorOf('<a:solidFill><a:srgbClr val="C00000"/></a:solidFill>');
    expect(vector?.components.map((c) => c.fillHex)).toEqual(['C00000']);
  });

  // A gradient spans the group box in Word; a pattern or picture fill has no per-member paint.
  for (const [name, fill] of [
    [
      'gradient',
      '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs>' +
        '<a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill>',
    ],
    [
      'pattern',
      '<a:pattFill prst="pct50"><a:fgClr><a:srgbClr val="FF0000"/></a:fgClr>' +
        '<a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr></a:pattFill>',
    ],
    [
      'picture',
      '<a:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
        'r:embed="rId9"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>',
    ],
  ]) {
    test(`a member that takes a ${name} group fill keeps the placeholder`, () => {
      expect(vectorOf(fill!)).toBeNull();
    });
  }
});
