import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  WML_NAMESPACE_URI,
  RELATIONSHIPS_NAMESPACE_URI,
} from '../package/ooxml-tree.ts';
import { projectDrawingsInPart } from '../package/drawing-projection.ts';
import { VML, OFFICE } from '../package/legacy-vml-values.ts';
import { isLegacyPlaceholder } from './legacy-vml-refusal.ts';
import { drawingRenderers, installDrawingRenderers } from '../package/drawing-renderers.ts';
import { legacyTextArt } from '../package/legacy-vml-text-art.ts';

// The WordArt fixture projects through an installed text art renderer; the engine's watermark
// reader stands in for it.
const installed = drawingRenderers().legacyTextArt;
beforeAll(() => installDrawingRenderers({ legacyTextArt }));
afterAll(() => installDrawingRenderers({ legacyTextArt: installed }));

function template(file: string, part: string, type: number): string {
  const fixture = new URL(`../../../../../e2e/fixtures/${file}`, import.meta.url);
  const xml = strFromU8(unzipSync(readFileSync(fixture))[part]!);
  const value = xml.match(
    new RegExp(`<v:shapetype[^>]*id="_x0000_t${type}"[\\s\\S]*?</v:shapetype>`)
  )?.[0];
  if (!value) throw new Error('Expected standard template in upstream fixture');
  return value;
}
function count(source: string, shape: string): number {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:v="${VML}" xmlns:o="${OFFICE}" xmlns:r="${RELATIONSHIPS_NAMESPACE_URI}"><w:body><w:p><w:r><w:pict>${source}${shape}</w:pict></w:r></w:p></w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const before = serializeOoxmlPart(parsed.part);
  // A refused drawing keeps only its placeholder, which paints nothing.
  const result = projectDrawingsInPart(parsed.part).filter((p) => !isLegacyPlaceholder(p)).length;
  expect(serializeOoxmlPart(parsed.part)).toBe(before);
  return result;
}

test('recognizes complete standard photo and straight WordArt templates without trusting the id alone', () => {
  const photo = template('watermark-picture.docx', 'word/header1.xml', 75);
  const art = template('watermark-confidential.docx', 'word/header1.xml', 136);
  const image =
    '<v:shape type="#_x0000_t75" style="width:80pt;height:40pt"><v:imagedata r:id="rPhoto"/></v:shape>';
  const wordArt =
    '<v:shape type="#_x0000_t136" style="width:120pt;height:30pt" stroked="f"><v:textpath on="t" fitshape="t" style="font-size:24pt" string="Label"/></v:shape>';
  expect(count(photo, image)).toBe(1);
  expect(count(art, wordArt)).toBe(1);
  expect(count(photo.replace('prod @3 21600 pixelWidth', 'prod @3 10000 pixelWidth'), image)).toBe(
    0
  );
  expect(count(art.replace('adj="10800"', 'adj="8000"'), wordArt)).toBe(0);
  expect(count('<v:shapetype id="_x0000_t136"/>', wordArt)).toBe(0);
  expect(count(art, wordArt.replace('style="width', 'adj="8000" style="width'))).toBe(0);
});

test('refuses picture effects and duplicate style nodes instead of dropping authored appearance', () => {
  const shape =
    '<v:shape type="#_x0000_t75" style="width:80pt;height:40pt"><v:imagedata r:id="rPhoto"/><v:stroke color="red"/></v:shape>';
  expect(count('', shape)).toBe(0);
  expect(
    count(
      '',
      '<v:shape type="#_x0000_t75" style="width:80pt;height:40pt"><v:imagedata r:id="rPhoto" cropleft="0.999999999999999"/></v:shape>'
    )
  ).toBe(0);
  const art =
    '<v:shape type="#_x0000_t136" style="width:120pt;height:30pt"><v:fill color="red"/><v:fill color="blue"/><v:textpath style="font-size:24pt" string="Label"/></v:shape>';
  expect(count('', art)).toBe(0);
});

test('recognizes the picture frame template without its formulas, and nothing looser', () => {
  const photo = template('watermark-picture.docx', 'word/header1.xml', 75).replace(
    /<v:formulas>[\s\S]*?<\/v:formulas>/,
    ''
  );
  const image =
    '<v:shape type="#_x0000_t75" style="width:80pt;height:40pt"><v:imagedata r:id="rPhoto"/></v:shape>';
  expect(photo).not.toContain('formulas');
  expect(count(photo, image)).toBe(1);
  // Any other change to the shortened template is custom geometry and stays refused.
  expect(count(photo.replace('m@4@5l@4@11', 'm@4@5l@4@10'), image)).toBe(0);
  expect(count(photo.replace('<v:stroke joinstyle="miter"/>', ''), image)).toBe(0);
  expect(count(photo.replace('id="_x0000_t75"', 'id="_x0000_t76"'), image)).toBe(0);
});
