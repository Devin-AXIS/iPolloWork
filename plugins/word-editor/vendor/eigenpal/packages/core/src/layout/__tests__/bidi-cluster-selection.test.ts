import { expect, test } from 'bun:test';
import { selectionRects } from '../selection-rects.ts';
import { spanOffsetX } from '../semantic-hit-test.ts';
import { readFileSync } from 'node:fs';
import { readOoxmlPart } from '../../store/index.ts';
import { linesOf } from '../semantic-records.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
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
function run(parts: string[], width = 120) {
  const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:bidi/></w:pPr>${parts.map((t) => `<w:r><w:rPr><w:rFonts w:ascii="DejaVu Sans" w:hAnsi="DejaVu Sans" w:cs="DejaVu Sans"/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r>`).join('')}</w:p><w:sectPr><w:pgSz w:w="${width * 20 + 600}" w:h="5000"/><w:pgMar w:left="300" w:right="300" w:top="300" w:bottom="300"/></w:sectPr></w:body></w:document>`;
  const part = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!part.ok) throw Error(part.reason);
  const result = layoutSemanticDocument(part.part, 0, { measurer });
  return result;
}

function selected(text: string, start: number, end: number) {
  const layout = run([text]);
  const line = linesOf(layout)[0]!;
  return selectionRects(
    layout,
    {
      anchor: { paragraphId: line.range.paragraphId, offset: start },
      head: { paragraphId: line.range.paragraphId, offset: end },
    },
    [line.range.paragraphId],
    measurer
  );
}
test('either logical half of lam-alef highlights the whole visible ligature', () => {
  const full = selected('لا', 0, 2);
  expect(full[0]!.width).toBeGreaterThan(5);
  expect(selected('لا', 0, 1)).toEqual(full);
  expect(selected('لا', 1, 2)).toEqual(full);
  const span = linesOf(run(['لا']))[0]!.spans[0]!;
  expect(spanOffsetX(span, 0, measurer)).toBe(spanOffsetX(span, 1, measurer));
});
test.each(['لَا', 'לָ', 'مَ'])(
  'a selected attached mark highlights its visible cluster: %s',
  (text) => {
    const mark = selected(text, 1, 2);
    expect(mark[0]!.width).toBeGreaterThan(0);
    expect(mark).toEqual(selected(text, 0, text === 'لَا' ? 3 : 2));
  }
);
test('a range ending inside a later ligature includes that final visible glyph', () => {
  expect(selected('بلا', 0, 2)).toEqual(selected('بلا', 0, 3));
});
test.each(['\u200b', '\u200c', '\u200d', '\u200e', '\u200f', '\u2060', '\u2066'])(
  'a control-only selection never borrows adjacent ink: %s',
  (control) => {
    expect(selected('ل' + control + 'ا', 1, 2)).toEqual([]);
  }
);
test('an isolated leading combining mark does not highlight the following base', () => {
  const mark = selected('َب', 0, 1);
  expect(mark.every((rect) => rect.width === 0)).toBe(true);
});

test('Latin ligatures inside mixed bidi text highlight their whole glyph', () => {
  expect(selected('ffi אב', 0, 1)).toEqual(selected('ffi אב', 0, 3));
});
