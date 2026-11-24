// A legacy rectangle without an outline whose fill is one picture stretched to the shape
// (`v:fill type="frame"`) draws as that picture.

import { expect, test } from 'bun:test';
import { indexInlineDrawingProjectionsInPart } from '../package/drawing-projection.ts';
import { readOoxmlPart } from '../package/ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const O = 'urn:schemas-microsoft-com:office:office';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function project(rect: string) {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:v="${V}" xmlns:o="${O}" xmlns:r="${R}"><w:body>` +
      `<w:p><w:r><w:pict>${rect}</w:pict></w:r></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return [...indexInlineDrawingProjectionsInPart(parsed.part).values()][0] ?? null;
}

const rect = (attributes: string, fill: string) =>
  `<v:rect style="position:absolute;margin-left:10pt;margin-top:5pt;width:129pt;height:64.5pt;` +
  `z-index:2;mso-position-horizontal-relative:text;mso-position-vertical-relative:text" ` +
  `${attributes}>${fill}</v:rect>`;

test('a frame picture fill draws its picture over the rectangle', () => {
  const projected = project(
    rect('stroked="f"', '<v:fill r:id="rId5" o:title="" recolor="t" rotate="t" type="frame"/>')
  );
  expect(projected?.relationshipId).toBe('rId5');
  expect(projected?.extentEmu).toEqual({ cx: 129 * 12700, cy: 64.5 * 12700 });
});

test('an outlined or tiled picture fill stays outside the subset', () => {
  expect(project(rect('', '<v:fill r:id="rId5" type="frame"/>'))).toBeNull();
  expect(project(rect('stroked="f"', '<v:fill r:id="rId5" type="tile"/>'))).toBeNull();
});
