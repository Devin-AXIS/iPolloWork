// DrawingML text boxes in shapes other than an upright rectangle: the geometry outline, the
// text rectangle it names, the turn, and the text flow.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../index.ts';
import { projectDrawingsInPart } from '../package/drawing-projection.ts';
import { turnedTextboxBounds } from '../../layout/drawing-text-art.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const CX = 2_286_000;
const CY = 914_400;
const LINE = '<a:ln w="19050"><a:solidFill><a:srgbClr val="2F5496"/></a:solidFill></a:ln>';

function projection(prst: string, xfrm = '', bodyPr = '', paint = LINE) {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:wps="${WPS}"><w:body><w:p><w:r><w:drawing><wp:inline distT="0" distB="0" ` +
    `distL="0" distR="0"><wp:extent cx="${CX}" cy="${CY}"/><wp:docPr id="1" name="Box"/>` +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr>` +
    `<a:xfrm${xfrm}><a:off x="0" y="0"/><a:ext cx="${CX}" cy="${CY}"/></a:xfrm>` +
    `<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>` +
    `${paint}</wps:spPr>` +
    `<wps:txbx><w:txbxContent><w:p><w:r><w:t>Text</w:t></w:r></w:p></w:txbxContent></wps:txbx>` +
    `<wps:bodyPr${bodyPr}/></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing>` +
    `</w:r></w:p></w:body></w:document>`;
  const parsed = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const [projected] = projectDrawingsInPart(parsed.part);
  expect(projected?.textboxStory).toBeTruthy();
  return projected!;
}

function story(prst: string, xfrm = '', bodyPr = '') {
  return projection(prst, xfrm, bodyPr).textboxStory!;
}

describe('DrawingML text box frames', () => {
  test('an upright rectangle keeps the plain box', () => {
    expect(story('rect').legacyFrame).toBeUndefined();
  });

  test('a rounded rectangle paints its outline and moves its text inside the corners', () => {
    const textbox = story('roundRect');
    const frame = textbox.legacyFrame!;
    expect(frame.outline?.kind).toBe('polygon');
    expect(textbox.strokeCentered).toBe(true);
    // The preset text rectangle sits 29.3% of the corner radius in: 1/6 of the short side.
    const inset = (CY / 6) * (1 - Math.SQRT1_2);
    expect(frame.textAreaEmu.left).toBeCloseTo(inset, 0);
    expect(frame.textAreaEmu.top).toBeCloseTo(inset, 0);
    expect(frame.rotationDegrees).toBe(0);
    expect(frame.flow).toBe('horizontal');
  });

  test("a callout's tail leaves the box and widens the painted area", () => {
    const textbox = story('wedgeRectCallout');
    const outline = textbox.legacyFrame!.outline!;
    if (outline.kind !== 'polygon') throw new Error('not a polygon');
    const lowest = Math.max(...outline.subpaths.flat().map((point) => point.y));
    expect(lowest).toBeGreaterThan(1);
    const bounds = turnedTextboxBounds(
      { x: 0, y: 0, width: 180, height: 72 },
      { ...textbox.legacyFrame!, outline, strokeHex: null, strokeWidthPt: 0 }
    );
    expect(bounds.height).toBeCloseTo(72 * lowest, 6);
  });

  test('a turned rectangle turns, and an upright body keeps its text level', () => {
    expect(story('rect', ' rot="1200000"').legacyFrame).toMatchObject({
      outline: null,
      rotationDegrees: 20,
      textTurnsWithShape: true,
    });
    expect(story('rect', ' rot="1200000"', ' upright="1"').legacyFrame).toMatchObject({
      textTurnsWithShape: false,
    });
  });

  test('vertical text flows top to bottom or bottom to top', () => {
    expect(story('rect', '', ' vert="vert"').legacyFrame?.flow).toBe('vertical');
    expect(story('rect', '', ' vert="vert270"').legacyFrame?.flow).toBe('verticalBottomToTop');
  });

  test('a flipped shape mirrors its outline and text rectangle', () => {
    const plain = story('round1Rect').legacyFrame!;
    const flipped = story('round1Rect', ' flipH="1"').legacyFrame!;
    expect(flipped.textAreaEmu.left).toBeCloseTo(plain.textAreaEmu.right, 6);
    expect(flipped.textAreaEmu.right).toBeCloseTo(plain.textAreaEmu.left, 6);
  });

  test('a gradient box paints its shape as vector components under its text', () => {
    const gradient =
      '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FFF2CC"/></a:gs>' +
      '<a:gs pos="100000"><a:srgbClr val="F4B183"/></a:gs></a:gsLst>' +
      '<a:lin ang="5400000" scaled="0"/></a:gradFill>';
    const drawing = projection('roundRect', '', '', gradient + LINE);
    expect(drawing.textboxStory!.chromeByVector).toBe(true);
    const [shape] = drawing.vectorShape!.components;
    expect(shape!.fillGradient?.stops).toHaveLength(2);
    expect(shape!.strokeHex).toBe('2F5496');
    // The story keeps its outline for the text inset it gives.
    expect(drawing.textboxStory!.strokeHex).toBe('2F5496');
  });

  test('a solid box keeps painting as the story box', () => {
    const solid = '<a:solidFill><a:srgbClr val="DEEAF6"/></a:solidFill>';
    const drawing = projection('roundRect', '', '', solid + LINE);
    expect(drawing.textboxStory!.chromeByVector).toBeUndefined();
    expect(drawing.vectorShape).toBeNull();
  });
});
