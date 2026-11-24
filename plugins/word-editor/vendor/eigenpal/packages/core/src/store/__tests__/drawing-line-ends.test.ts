// Line styles of projected shapes: dash patterns, line-end outlines, and how far a line
// stops short under its line end.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../index.ts';
import { projectDrawingsInPart } from '../package/drawing-projection.ts';
import { transformComponent } from '../package/drawing-group-transform.ts';
import type { VectorShapeComponent } from '../package/drawing-shape-projection.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const EMU_PER_POINT = 12_700;
const LENGTH = 2_743_200;

function lineComponent(lineXml: string, width = 50_800): VectorShapeComponent {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:wps="${WPS}"><w:body><w:p><w:r><w:drawing><wp:inline distT="0" distB="0" ` +
    `distL="0" distR="0"><wp:extent cx="${LENGTH}" cy="0"/><wp:docPr id="1" name="Line 1"/>` +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp><wps:cNvCnPr/><wps:spPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${LENGTH}" cy="0"/></a:xfrm>` +
    `<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="${width}"><a:solidFill>` +
    `<a:srgbClr val="1F3864"/></a:solidFill>${lineXml}</a:ln></wps:spPr><wps:bodyPr/>` +
    `</wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body>` +
    `</w:document>`;
  const parsed = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const [projection] = projectDrawingsInPart(parsed.part);
  const component = projection?.vectorShape?.components?.[0];
  expect(component).toBeTruthy();
  return component!;
}

/** Points of the tail end relative to the line end, in points, rounded to 0.01 pt. */
function tailPoints(component: VectorShapeComponent) {
  const [outline] = component.arrowheadsEmu ?? [];
  expect(outline).toBeTruthy();
  return outline!.map((point) => ({
    along: Math.round(((point.x - LENGTH) / EMU_PER_POINT) * 100) / 100,
    across: Math.round((point.y / EMU_PER_POINT) * 100) / 100,
  }));
}

function lineEndX(component: VectorShapeComponent): number {
  const [path] = component.subpathsEmu;
  return Math.max(...path!.map((point) => point.x));
}

describe('dash patterns', () => {
  test('a preset dash is dash and gap lengths in line widths', () => {
    expect(lineComponent('<a:prstDash val="sysDash"/>').strokeDash).toEqual([3, 1]);
    expect(lineComponent('<a:prstDash val="lgDashDotDot"/>').strokeDash).toEqual([
      8, 3, 1, 3, 1, 3,
    ]);
  });

  test('a solid or unknown preset paints solid', () => {
    expect(lineComponent('<a:prstDash val="solid"/>').strokeDash).toBeUndefined();
    expect(lineComponent('<a:prstDash val="wavy"/>').strokeDash).toBeUndefined();
  });

  test('a custom dash reads per-mille-of-percent and percent stops', () => {
    expect(
      lineComponent(
        '<a:custDash><a:ds d="300000" sp="100000"/><a:ds d="100%" sp="50%"/></a:custDash>'
      ).strokeDash
    ).toEqual([3, 1, 1, 0.5]);
  });

  test('a custom dash with no gap paints solid', () => {
    expect(
      lineComponent('<a:custDash><a:ds d="0" sp="0"/></a:custDash>').strokeDash
    ).toBeUndefined();
  });
});

describe('line ends', () => {
  test('a triangle scales by the line width and the line stops at its base', () => {
    const component = lineComponent('<a:tailEnd type="triangle" w="lg" len="sm"/>');
    // A 4 pt line: 2 widths long, 5 wide.
    expect(tailPoints(component)).toEqual([
      { along: 0, across: 0 },
      { along: -8, across: 10 },
      { along: -8, across: -10 },
    ]);
    // The line stops half its width inside the base, so no butt end shows past the tip.
    expect(lineEndX(component)).toBe(LENGTH - 6 * EMU_PER_POINT);
  });

  test('a thin line sizes its end as a 2 pt line does', () => {
    const component = lineComponent('<a:tailEnd type="triangle" w="sm" len="sm"/>', 9_525);
    expect(tailPoints(component)).toEqual([
      { along: 0, across: 0 },
      { along: -4, across: 2 },
      { along: -4, across: -2 },
    ]);
  });

  test('a stealth end notches its back by its length and the line stops at the notch', () => {
    for (const [len, notch] of [
      ['sm', -4],
      ['med', -8],
      ['lg', -12],
    ] as const) {
      const component = lineComponent(`<a:tailEnd type="stealth" w="med" len="${len}"/>`);
      expect(tailPoints(component)[2]).toEqual({ along: notch, across: 0 });
      expect(lineEndX(component)).toBe(LENGTH + notch * EMU_PER_POINT);
    }
  });

  test('a diamond is centred on the line end and keeps the line whole', () => {
    const component = lineComponent('<a:tailEnd type="diamond" w="sm" len="sm"/>');
    const points = tailPoints(component);
    expect(points[0]).toEqual({ along: 0, across: 0 });
    expect(points).toContainEqual({ along: 4, across: 0 });
    expect(points).toContainEqual({ along: -4, across: 0 });
    expect(points).toContainEqual({ along: 0, across: 4 });
    expect(lineEndX(component)).toBe(LENGTH);
  });

  test('an oval is centred on the line end', () => {
    const points = tailPoints(lineComponent('<a:tailEnd type="oval" w="lg" len="sm"/>'));
    const alongs = points.map((point) => point.along);
    const acrosses = points.map((point) => point.across);
    expect([Math.min(...alongs), Math.max(...alongs)]).toEqual([-4, 4]);
    expect([Math.min(...acrosses), Math.max(...acrosses)]).toEqual([-10, 10]);
  });

  test('an open arrow has its outer point on the line end and round arm ends', () => {
    const component = lineComponent('<a:tailEnd type="arrow" w="sm" len="sm"/>', 28_575);
    const points = tailPoints(component);
    expect(points[0]).toEqual({ along: 0, across: 0 });
    const alongs = points.map((point) => point.along);
    const acrosses = points.map((point) => Math.abs(point.across));
    // Arms of 2.25 pt reach 2 widths behind the apex and spread 1.25 widths; with their round
    // ends the arrow spans about 7.9 pt back and 4.1 pt out.
    expect(Math.abs(Math.min(...alongs) + 7.9)).toBeLessThan(0.2);
    expect(Math.abs(Math.max(...acrosses) - 4.1)).toBeLessThan(0.2);
    // The line stops at the apex, one miter behind the line end.
    expect((LENGTH - lineEndX(component)) / EMU_PER_POINT).toBeCloseTo(2.12, 1);
  });

  test('an unknown end type refuses the shape', () => {
    const xml = '<a:tailEnd type="spiral"/>';
    expect(() => lineComponent(xml)).toThrow();
  });

  test('a group that collapses an axis keeps a centred end at full size', () => {
    const component = lineComponent('<a:tailEnd type="diamond" w="sm" len="sm"/>');
    const turned = transformComponent(component, { x: 0, y: 0 }, 1, 0);
    const [outline] = turned.arrowheadsEmu ?? [];
    expect(outline!.length).toBe(component.arrowheadsEmu![0]!.length);
    const xs = outline!.map((point) => point.x);
    const ys = outline!.map((point) => point.y);
    // The diamond keeps its 8 pt size across the collapsed axis.
    expect((Math.max(...xs) - Math.min(...xs)) / EMU_PER_POINT).toBeCloseTo(8, 5);
    expect((Math.max(...ys) - Math.min(...ys)) / EMU_PER_POINT).toBeCloseTo(8, 5);
  });
});
