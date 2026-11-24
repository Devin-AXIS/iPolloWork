// A legacy drawing on the line that cannot paint keeps its box as a labelled placeholder, so
// the text after it stays where the reference puts it.

import { expect, test } from 'bun:test';
import { projectDrawingsInPart } from '../package/drawing-projection.ts';
import { readOoxmlPart } from '../package/ooxml-tree.ts';
import { isLegacyPlaceholder } from './legacy-vml-refusal.ts';

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"';
// Warped WordArt with depth: outside what the engine paints.
const WARPED =
  '<v:shape type="#_x0000_t138" style="width:385.5pt;height:54.75pt" fillcolor="#ffc">' +
  '<o:extrusion v:ext="view" on="t"/><v:textpath style="font-family:Arial" string="Title"/></v:shape>';

function project(run: string) {
  const read = readOoxmlPart(
    `<w:document ${NS}><w:body><w:p><w:r>${run}</w:r></w:p></w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!read.ok) throw new Error(read.reason);
  return projectDrawingsInPart(read.part);
}

test('an unsupported drawing on the line keeps its box and paints nothing', () => {
  const [placeholder] = project(`<w:pict>${WARPED}</w:pict>`);
  expect(placeholder).toBeDefined();
  expect(isLegacyPlaceholder(placeholder!)).toBe(true);
  expect(placeholder!.kind).toBe('inline');
  expect(placeholder!.extentEmu).toEqual({ cx: 385.5 * 12_700, cy: Math.round(54.75 * 12_700) });
});

test('a floating unsupported drawing, or one without a size, keeps no box', () => {
  expect(
    project(`<w:pict>${WARPED.replace('style="', 'style="position:absolute;')}</w:pict>`)
  ).toEqual([]);
  expect(project(`<w:pict>${WARPED.replace('width:385.5pt;', '')}</w:pict>`)).toEqual([]);
  expect(project(`<w:pict>${WARPED.replace('385.5pt', '20000pt')}</w:pict>`)).toEqual([]);
});
