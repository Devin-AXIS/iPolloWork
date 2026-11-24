// Preset pattern fills: the projected tile and colours, its mean colour, and its SVG paint.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../index.ts';
import { projectDrawingsInPart } from '../package/drawing-projection.ts';
import { applyPatternFill } from '../../output/vector-shape-svg.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

function component(fill: string, line = '<a:ln><a:noFill/></a:ln>') {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:wps="${WPS}"><w:body><w:p><w:r><w:drawing><wp:inline distT="0" distB="0" ` +
    `distL="0" distR="0"><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="S"/>` +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp><wps:cNvSpPr/><wps:spPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}${line}` +
    `</wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing>` +
    `</w:r></w:p></w:body></w:document>`;
  const parsed = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const [projection] = projectDrawingsInPart(parsed.part);
  return projection!.vectorShape!.components[0]!;
}

const colours =
  '<a:fgClr><a:srgbClr val="FF0000"/></a:fgClr><a:bgClr><a:srgbClr val="0000FF"/></a:bgClr>';

describe('pattern fills', () => {
  test('a preset paints its tile in its colours, and its mean colour stands in', () => {
    const shape = component(`<a:pattFill prst="pct50">${colours}</a:pattFill>`);
    expect(shape.fillPattern?.rows).toEqual([0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55]);
    expect(shape.fillPattern?.foreground.hex).toBe('FF0000');
    expect(shape.fillPattern?.background.hex).toBe('0000FF');
    // Half the cells are foreground.
    expect(shape.fillHex).toBe('800080');
  });

  test('a downward diagonal runs from the top left', () => {
    const shape = component('<a:pattFill prst="dnDiag"/>');
    expect(shape.fillPattern?.rows[0]).toBe(0x80);
    expect(shape.fillPattern?.rows[7]).toBe(0x01);
    // A pattern with no colours is black on white.
    expect(shape.fillPattern?.foreground.hex).toBe('000000');
    expect(shape.fillPattern?.background.hex).toBe('FFFFFF');
  });

  test('an unknown preset leaves the shape unfilled', () => {
    const shape = component(
      '<a:pattFill prst="tartan"/>',
      '<a:ln><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>'
    );
    expect(shape.fillPattern).toBeUndefined();
    expect(shape.fillHex).toBeNull();
  });

  test('the editor paints the tile as a one-point SVG pattern', () => {
    const shape = component(`<a:pattFill prst="horz">${colours}</a:pattFill>`);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    applyPatternFill(document, svg, path, shape.fillPattern!);
    const pattern = svg.querySelector('pattern')!;
    expect(path.getAttribute('fill')).toBe(`url(#${pattern.id})`);
    expect(pattern.getAttribute('width')).toBe(String(8 * 12_700));
    const [background, foreground] = [...pattern.querySelectorAll('path')];
    expect(background!.getAttribute('fill')).toBe('#0000FF');
    // The top row of eight cells.
    expect(foreground!.getAttribute('d')!.match(/M/g)).toHaveLength(8);
  });
});
