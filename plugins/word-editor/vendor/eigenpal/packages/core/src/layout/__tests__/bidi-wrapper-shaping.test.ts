// Text inside a `w:bdo` override is shaped as one run in the override's direction, so pairs
// kern in painted order and the caret follows the shaped cluster edges.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPart } from '../../store/index.ts';
import { linesOf } from '../semantic-records.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { caretAt } from '../semantic-interaction.ts';
import {
  FontResolutionError,
  createFontResourceSnapshot,
  createShapedMeasurer,
  createHarfBuzzTextShaper,
  createFixedMeasurer,
  initializeHarfBuzz,
  harfBuzzFontValidator,
  sha256FontBytes,
  HARFBUZZ_SHAPING_LIBRARY,
} from '../index.ts';

await initializeHarfBuzz();
const bytes = new Uint8Array(
  readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
const request = { family: 'DejaVu Sans', weight: 400, style: 'normal' } as const;
const snapshot = createFontResourceSnapshot({
  epoch: 1,
  maxFontBytes: 2000000,
  resources: [{ request, id: 'dejavu', bytes, hash: sha256FontBytes(bytes), faceIndex: 0 }],
  validateFont: harfBuzzFontValidator,
});
const font = snapshot.resolve(request);
if (font instanceof FontResolutionError) throw font;
const measurer = createShapedMeasurer({
  shaper: createHarfBuzzTextShaper(),
  resolveFont: () => font,
  fallback: createFixedMeasurer(6, 14),
  shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
  unicodeDataVersion: '15.1',
});

const RPR =
  '<w:rPr><w:rFonts w:ascii="DejaVu Sans" w:hAnsi="DejaVu Sans" w:cs="DejaVu Sans"/></w:rPr>';
function lay(content: string) {
  const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>${content}</w:p><w:sectPr><w:pgSz w:w="6000" w:h="5000"/><w:pgMar w:left="300" w:right="300" w:top="300" w:bottom="300"/></w:sectPr></w:body></w:document>`;
  const part = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!part.ok) throw Error(part.reason);
  return layoutSemanticDocument(part.part, 0, { measurer });
}
const run = (text: string) => `<w:r>${RPR}<w:t xml:space="preserve">${text}</w:t></w:r>`;

test('an override is one shaped span as wide as its painted order', () => {
  const overridden = linesOf(lay(`<w:bdo w:val="rtl">${run('AVAT')}</w:bdo>`))[0]!;
  const painted = linesOf(lay(run('TAVA')))[0]!;
  expect(overridden.spans).toHaveLength(1);
  expect(overridden.spans[0]!.style.shaping?.direction).toBe('rtl');
  expect(overridden.spans[0]!.box.width).toBeCloseTo(painted.spans[0]!.box.width, 5);
});

test('caret positions inside an override fall on the painted letter edges', () => {
  const result = lay(`<w:bdo w:val="rtl">${run('AVAT')}</w:bdo>`);
  const paragraphId = linesOf(result)[0]!.range.paragraphId;
  const xs = [0, 1, 2, 3, 4].map((offset) => caretAt(result, { paragraphId, offset }, measurer)!.x);
  // Logical order runs right to left.
  for (let index = 1; index < xs.length; index++) expect(xs[index]).toBeLessThan(xs[index - 1]!);
  // The painted `TAVA` puts the caret after `A` (offset 1) at the left edge of the last `A`.
  const reference = lay(run('TAVA'));
  const referenceId = linesOf(reference)[0]!.range.paragraphId;
  const edge = caretAt(reference, { paragraphId: referenceId, offset: 3 }, measurer)!.x;
  expect(xs[1]).toBeCloseTo(edge, 5);
});
