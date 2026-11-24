// A compound outline on a filled shape: the fill paints once on the shape's own geometry,
// and the outline bands paint no fill.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../../index.ts';
import { projectDrawingsInPart } from '../drawing-projection.ts';
import { compoundBands } from '../drawing-line-compound.ts';
import type { VectorShapeComponent } from '../drawing-shape-projection.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const CX = 1_371_600;
const CY = 914_400;

function shapeComponents(spPrTail: string): readonly VectorShapeComponent[] {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:wps="${WPS}"><w:body><w:p><w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${CX}" cy="${CY}"/>` +
    `<wp:docPr id="1" name="Shape 1"/><a:graphic><a:graphicData uri="${WPS}">` +
    `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/>` +
    `<a:ext cx="${CX}" cy="${CY}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `${spPrTail}</wps:spPr><wps:bodyPr/></wps:wsp>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>`;
  const parsed = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const [projection] = projectDrawingsInPart(parsed.part);
  return projection!.vectorShape!.components;
}

function bounds(points: readonly Readonly<{ x: number; y: number }>[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const HALF_BLUE =
  '<a:solidFill><a:srgbClr val="4472C4"><a:alpha val="50000"/></a:srgbClr></a:solidFill>';
const RED = '<a:solidFill><a:srgbClr val="C00000"/></a:solidFill>';

describe('compound outlines on filled shapes', () => {
  test('a translucent fill paints once on the geometry; the bands carry no fill', () => {
    const components = shapeComponents(`${HALF_BLUE}<a:ln w="152400" cmpd="dbl">${RED}</a:ln>`);
    expect(components).toHaveLength(3);
    const filled = components.filter((component) => component.fillHex !== null);
    expect(filled).toHaveLength(1);
    const [fill, ...bands] = components;
    expect(fill).toBe(filled[0]!);
    expect(fill!.fillHex).toBe('4472C4');
    expect(fill!.fillAlpha).toBeCloseTo(0.5, 6);
    expect(fill!.strokeHex).toBeNull();
    expect(fill!.strokeWidthEmu).toBe(0);
    expect(bounds(fill!.subpathsEmu[0]!)).toEqual([0, 0, CX, CY]);
    for (const band of bands) {
      expect(band.fillHex).toBeNull();
      expect(band.fillGradient).toBeUndefined();
      expect(band.fillPattern).toBeUndefined();
      expect(band.strokeHex).toBe('C00000');
      expect(band.strokeWidthEmu).toBeCloseTo(152_400 / 3, 6);
    }
  });

  test('a gradient or pattern fill stays on the fill component only', () => {
    const component: VectorShapeComponent = {
      subpathsEmu: [
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
      ],
      fillHex: '808080',
      fillAlpha: 1,
      fillGradient: {} as NonNullable<VectorShapeComponent['fillGradient']>,
      fillPattern: {} as NonNullable<VectorShapeComponent['fillPattern']>,
      fillRule: 'nonzero',
      shadow: {} as NonNullable<VectorShapeComponent['shadow']>,
      strokeHex: '000000',
      strokeAlpha: 1,
      strokeWidthEmu: 30,
      strokeDash: [3, 1],
    };
    const [fill, ...bands] = compoundBands(component, 'tri');
    expect(fill!.fillGradient).toBeDefined();
    expect(fill!.fillPattern).toBeDefined();
    expect(fill!.shadow).toBeDefined();
    expect(fill!.strokeDash).toBeUndefined();
    expect(fill!.subpathsEmu).toBe(component.subpathsEmu);
    expect(bands).toHaveLength(3);
    for (const band of bands) {
      expect(band.fillHex).toBeNull();
      expect(band.fillGradient).toBeUndefined();
      expect(band.fillPattern).toBeUndefined();
      expect(band.fillRule).toBeUndefined();
      expect(band.shadow).toBeUndefined();
      expect(band.strokeDash).toEqual([3, 1]);
    }
  });

  test('an unfilled outline casts its shadow from the outer band only', () => {
    const bands = compoundBands(
      {
        subpathsEmu: [
          [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ],
        ],
        subpathsClosed: [false],
        fillHex: null,
        fillAlpha: 1,
        shadow: {} as NonNullable<VectorShapeComponent['shadow']>,
        strokeHex: '000000',
        strokeAlpha: 1,
        strokeWidthEmu: 30,
      },
      'dbl'
    );
    expect(bands).toHaveLength(2);
    expect(bands.map((band) => band.shadow !== undefined)).toEqual([true, false]);
  });
});
