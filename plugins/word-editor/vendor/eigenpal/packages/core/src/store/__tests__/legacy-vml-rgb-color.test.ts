// A VML colour in the CSS `rgb(r, g, b)` form paints, with each channel bounded to 0..255.

import { expect, test } from 'bun:test';
import { projectDrawingsInPart } from '../package/drawing-projection.ts';
import { readOoxmlPart } from '../package/ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const EMU = 12_700;

function projectionOf(rect: string) {
  const xml =
    `<w:document xmlns:w="${W}" xmlns:v="${V}"><w:body><w:p><w:r><w:pict>${rect}</w:pict>` +
    '</w:r></w:p></w:body></w:document>';
  const loaded = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!loaded.ok) throw new Error(loaded.reason);
  const projections = projectDrawingsInPart(loaded.part);
  expect(projections).toHaveLength(1);
  return projections[0]!;
}

test('an rgb() fill and outline paint with the outline weight', () => {
  const shape = projectionOf(
    '<v:rect id="r" style="width:60pt;height:40pt" fillcolor="rgb(0, 128, 255)" ' +
      'strokecolor="rgb(255,0,0)" strokeweight="2pt"/>'
  ).vectorShape!;
  expect(shape.components[0]).toMatchObject({
    fillHex: '0080FF',
    strokeHex: 'FF0000',
    strokeWidthEmu: 2 * EMU,
  });
});

test('an rgb() colour out of range or malformed paints no vector shape', () => {
  for (const value of ['rgb(256,0,0)', 'rgb(1,2)', 'rgb(-1,0,0)', `rgb(${'1'.repeat(40)},0,0)`]) {
    const projection = projectionOf(
      `<v:rect id="r" style="width:60pt;height:40pt" strokecolor="${value}"/>`
    );
    expect(projection.vectorShape ?? null).toBeNull();
  }
});
