// A picture's frame from its `pic:spPr`: the clip of its geometry, an outline outside it, and
// the shadow and fill under it; and compound outlines on shapes.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../index.ts';
import { projectDrawingsInPart, type DrawingProjection } from '../package/drawing-projection.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const CX = 1_371_600;
const CY = 914_400;

function project(payload: string, uri: string, cy = CY): DrawingProjection {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:pic="${PIC}" xmlns:r="${R}" xmlns:wps="${WPS}"><w:body><w:p><w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${CX}" cy="${cy}"/>` +
    `<wp:docPr id="1" name="Picture 1"/><a:graphic><a:graphicData uri="${uri}">${payload}` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>`;
  const parsed = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const [projection] = projectDrawingsInPart(parsed.part);
  expect(projection).toBeTruthy();
  return projection!;
}

function picture(spPrTail: string, xfrmAttributes = ''): DrawingProjection {
  return project(
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="p.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm${xfrmAttributes}><a:off x="0" y="0"/><a:ext cx="${CX}" cy="${CY}"/>` +
      `</a:xfrm>${spPrTail}</pic:spPr></pic:pic>`,
    PIC
  );
}

function bounds(points: readonly Readonly<{ x: number; y: number }>[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const RECT = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
const RED = '<a:solidFill><a:srgbClr val="C00000"/></a:solidFill>';

describe('picture frames', () => {
  test('without an effects renderer, a glow, reflection and soft edge paint nothing', () => {
    const projection = picture(
      `${RECT}<a:effectLst><a:glow rad="50800"><a:srgbClr val="4472C4"/></a:glow>` +
        '<a:softEdge rad="76200"/><a:reflection stA="52000" endPos="35000" dir="5400000" ' +
        'sy="-100000" algn="bl"/></a:effectLst>'
    );
    expect(projection.picture!.frameEffects).toBeUndefined();
    expect(projection.vectorShape).toBeNull();
  });

  test('a plain picture has no frame and no clip ring', () => {
    const projection = picture(RECT);
    expect(projection.picture).toBeTruthy();
    expect(projection.picture!.clipUnit).toBeUndefined();
    expect(projection.vectorShape).toBeNull();
  });

  test('an outline runs half its width outside the picture and joins round', () => {
    const projection = picture(`${RECT}<a:ln w="38100">${RED}</a:ln>`);
    const [outline] = projection.vectorShape!.components;
    expect(outline!.strokeHex).toBe('C00000');
    expect(outline!.strokeWidthEmu).toBe(38_100);
    expect(outline!.strokeOutsetEmu).toBe(19_050);
    expect(outline!.strokeJoin).toBe('round');
    expect(outline!.belowPicture).toBeUndefined();
    expect(bounds(outline!.subpathsEmu[0]!)).toEqual([-19_050, -19_050, CX + 19_050, CY + 19_050]);
    // The picture keeps its own rectangle; only the frame is painted outside it.
    expect(projection.picture!.clipUnit).toBeUndefined();
  });

  test('a preset clips the picture by its adjusted geometry', () => {
    const rounded = picture(
      '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 30000"/></a:avLst></a:prstGeom>'
    );
    const ring = rounded.picture!.clipUnit!;
    expect(ring.length).toBeGreaterThan(8);
    // The top edge starts after a corner of 30% of the short side.
    const top = ring.filter((point) => Math.abs(point.y) < 1e-9).map((point) => point.x);
    expect(Math.min(...top) * CX).toBeCloseTo(0.3 * CY, 0);

    const hexagon = picture('<a:prstGeom prst="hexagon"><a:avLst/></a:prstGeom>');
    expect(hexagon.picture!.clipUnit).toHaveLength(6);
    bounds(hexagon.picture!.clipUnit!).forEach((edge, index) =>
      expect(edge).toBeCloseTo([0, 0, 1, 1][index]!, 5)
    );
  });

  test('an outer shadow and a fill paint under the picture', () => {
    const projection = picture(
      `${RECT}<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst>` +
        '<a:outerShdw blurRad="50800" dist="76200" dir="2700000" algn="tl" rotWithShape="0">' +
        '<a:srgbClr val="000000"><a:alpha val="50000"/></a:srgbClr></a:outerShdw></a:effectLst>'
    );
    const [shadow, fill] = projection.vectorShape!.components;
    expect(shadow!.shadowOnly).toBe(true);
    expect(shadow!.belowPicture).toBe(true);
    expect(shadow!.shadow!.alpha).toBe(0.5);
    expect(shadow!.shadow!.dxEmu).toBeCloseTo(76_200 / Math.SQRT2, 3);
    expect(fill!.fillHex).toBe('FFFFFF');
    expect(fill!.belowPicture).toBe(true);
  });

  test('a skewed or sideways reflection is left out', () => {
    const skewed = picture(
      `${RECT}<a:effectLst><a:reflection stA="50000" endPos="40000" dir="5400000" ` +
        'sy="-100000" kx="600000"/></a:effectLst>'
    );
    expect(skewed.picture!.frameEffects).toBeUndefined();
  });

  test('a compound outline paints its bands outside the picture', () => {
    const projection = picture(`${RECT}<a:ln w="76200" cmpd="dbl">${RED}</a:ln>`);
    const bands = projection.vectorShape!.components;
    expect(bands).toHaveLength(2);
    // Each band is a third of the width: the outer one centred 1/6 in from the outer edge.
    for (const band of bands) expect(band.strokeWidthEmu).toBeCloseTo(25_400, 6);
    expect(bounds(bands[0]!.subpathsEmu[0]!)[0]).toBeCloseTo(-76_200 + 12_700, 6);
    expect(bounds(bands[1]!.subpathsEmu[0]!)[0]).toBeCloseTo(-12_700, 6);
  });

  test('a turned picture keeps its clip ring but paints no frame', () => {
    const projection = picture(
      `<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:ln w="12700">${RED}</a:ln>`,
      ' rot="5400000"'
    );
    expect(projection.picture!.clipUnit!.length).toBeGreaterThan(8);
    expect(projection.vectorShape).toBeNull();
  });
});

describe('compound outlines on shapes', () => {
  function shape(geometry: string, cmpd: string, cy = 548_640) {
    return project(
      `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/>` +
        `<a:ext cx="${CX}" cy="${cy}"/></a:xfrm><a:prstGeom prst="${geometry}"><a:avLst/>` +
        `</a:prstGeom><a:noFill/><a:ln w="152400" cmpd="${cmpd}">${RED}</a:ln></wps:spPr>` +
        `<wps:bodyPr/></wps:wsp>`,
      WPS,
      cy
    ).vectorShape!.components;
  }

  test('a thick-thin rectangle paints its thick band outside and thin band inside', () => {
    const bands = shape('rect', 'thickThin');
    expect(bands[0]!.strokeWidthEmu).toBeCloseTo(0.6 * 152_400, 6);
    expect(bands[1]!.strokeWidthEmu).toBeCloseTo(0.2 * 152_400, 6);
    // Band centres: 0.2 widths outside the path and 0.4 inside it.
    expect(bounds(bands[0]!.subpathsEmu[0]!)[0]).toBeCloseTo(-0.2 * 152_400, 6);
    expect(bounds(bands[1]!.subpathsEmu[0]!)[0]).toBeCloseTo(0.4 * 152_400, 6);
  });

  test('a triple line paints three bands, the middle one twice as wide', () => {
    const widths = shape('rect', 'tri').map((band) => band.strokeWidthEmu / 152_400);
    expect(widths).toHaveLength(3);
    [1 / 6, 1 / 3, 1 / 6].forEach((width, index) => expect(widths[index]).toBeCloseTo(width, 9));
  });

  test('a compound line puts its first band on the left of its direction', () => {
    const bands = shape('line', 'thickThin', 0);
    // Left of a rightward line is up (negative y).
    expect(bands[0]!.subpathsEmu[0]![0]!.y).toBeCloseTo(-0.2 * 152_400, 6);
    expect(bands[1]!.subpathsEmu[0]![0]!.y).toBeCloseTo(0.4 * 152_400, 6);
    expect(bands.every((band) => (band.strokeOutsetEmu ?? 0) > 0)).toBe(true);
  });

  test('an unknown compound value paints a single line', () => {
    expect(shape('rect', 'quad')).toHaveLength(1);
  });
});

describe('shapes filled with a picture', () => {
  function filled(geometry: string, extra = '') {
    return project(
      `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/>` +
        `<a:ext cx="${CX}" cy="${CY}"/></a:xfrm><a:prstGeom prst="${geometry}"><a:avLst/>` +
        `</a:prstGeom><a:blipFill><a:blip r:embed="rId1"/>${extra}<a:stretch><a:fillRect/>` +
        `</a:stretch></a:blipFill><a:ln w="12700">${RED}</a:ln></wps:spPr><wps:bodyPr/></wps:wsp>`,
      WPS
    );
  }

  test('the picture fills the box, clipped to the geometry, under the outline', () => {
    const projection = filled('ellipse', '<a:srcRect l="10000" r="10000"/>');
    const picture = projection.groupPicture!;
    expect(picture.embeddedRelationshipId).toBe('rId1');
    expect(picture.frameEmu).toEqual({ x: 0, y: 0, cx: CX, cy: CY });
    expect(picture.crop.left).toBeCloseTo(0.1, 6);
    expect(picture.clipUnit!.length).toBeGreaterThan(8);
    const [outline] = projection.vectorShape!.components;
    expect(outline!.fillHex).toBeNull();
    expect(outline!.strokeHex).toBe('C00000');
  });

  test('a rectangle keeps the picture box, and a tiled fill is left out', () => {
    expect(filled('rect').groupPicture!.clipUnit).toBeUndefined();
    const tiled = project(
      `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/>` +
        `<a:ext cx="${CX}" cy="${CY}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
        `<a:blipFill><a:blip r:embed="rId1"/><a:tile/></a:blipFill></wps:spPr><wps:bodyPr/></wps:wsp>`,
      WPS
    );
    expect(tiled.groupPicture).toBeNull();
  });
});
