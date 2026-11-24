import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createParagraphLayoutCache, type ParagraphKeyInputs } from '../layout-cache.ts';
import {
  reuseParagraphAtWidth,
  tokenLineHoldsAtWidth,
  tokenLineMovable,
} from '../paragraph-cache-width-reuse.ts';
import { breakParagraph, type PendingLine } from '../paragraph-flow.ts';
import {
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  createFixedMeasurer,
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  createShapedMeasurer,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  sha256FontBytes,
} from '../index.ts';
import type { TextMeasurer } from '../semantic-records.ts';

// A real shaped face, so advances, kerning and space widths are the ones shaping produces.
await initializeHarfBuzz();
const bytes = new Uint8Array(
  readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
const request = { family: 'DejaVu Sans', weight: 400, style: 'normal' } as const;
const font = createFontResourceSnapshot({
  epoch: 1,
  maxFontBytes: 2_000_000,
  resources: [{ request, id: 'dejavu', bytes, hash: sha256FontBytes(bytes), faceIndex: 0 }],
  validateFont: harfBuzzFontValidator,
}).resolve(request);
if (font instanceof FontResolutionError) throw font;
const shaped = createShapedMeasurer({
  shaper: createHarfBuzzTextShaper(),
  resolveFont: () => font,
  fallback: createFixedMeasurer(6, 14),
  shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
  unicodeDataVersion: '15.1',
});
const fixed = createFixedMeasurer(6, 14);

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const paragraphOf = (runs: string, pPr = '') => {
  const read = readOoxmlPart(`<w:p xmlns:w="${W}"><w:pPr>${pPr}</w:pPr>${runs}</w:p>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw Error(read.reason);
  return read.part.root;
};
const run = (text: string, rPr = '') =>
  `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

// Ordinary spaced text: inner, leading and repeated spaces, mixed runs, sizes, spacing, kerning.
const SAMPLES = [
  run('Two words'),
  run('Total (net) 12,345.67'),
  run(' leading space'),
  run('double  space and   triple'),
  run('AV To Wa: 100% kerned'),
  run('x ') + run('bold y', '<w:b/>'),
  run('small ', '<w:sz w:val="16"/>') + run('LARGE text', '<w:sz w:val="32"/>'),
  run('wide spacing here', '<w:spacing w:val="40"/>'),
  run('Item 12 - North/South: 3.5'),
];

for (const [name, measurer] of [
  ['shaped', shaped],
  ['fixed', fixed],
] as [string, TextMeasurer][])
  for (const sample of SAMPLES)
    test(`${name}: a fitting spaced line breaks the same at every width that holds it`, () => {
      const paragraph = paragraphOf(sample);
      const at = (width: number) =>
        breakParagraph(paragraph, paragraph.id, 0, width, measurer, undefined, null);
      const wide = at(2000);
      expect(wide.length).toBe(1);
      const line = wide[0]!;
      expect(tokenLineMovable(line)).toBe(true);
      // Every width that holds the line, down to the exact natural width.
      const widths = [line.width, line.width + 1e-9, line.width + 0.37, line.width * 1.5, 640];
      for (const width of widths) {
        expect(tokenLineHoldsAtWidth(line, width)).toBe(true);
        expect(at(width)).toEqual(wide);
      }
      // Within half the breaker's 0.001pt overflow tolerance the line still holds, and the
      // breaker keeps it whole; AutoFit columns land within rounding of their widest line.
      for (const short of [1e-12, 1e-7, 0.0004]) {
        expect(tokenLineHoldsAtWidth(line, line.width - short)).toBe(true);
        expect(at(line.width - short)).toEqual(wide);
      }
      // Past that band the predicate refuses, whatever the breaker decides.
      expect(tokenLineHoldsAtWidth(line, line.width - 0.0006)).toBe(false);
      expect(tokenLineHoldsAtWidth(line, line.width - 0.01)).toBe(false);
    });

test('a spaced line moves through the cache width transfer like a token', () => {
  const paragraph = paragraphOf(run('Two words here'));
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  const inputs: ParagraphKeyInputs = { paragraph, properties: [], width: 300, producer: 'test' };
  const key = cache.keyFor!(inputs);
  breakParagraph(paragraph, paragraph.id, 0, 300, shaped, cache, key);
  const measured = cache.get(key)!;
  for (const width of [measured[0]!.width + 0.5, 200, 400]) {
    const next = cache.keyFor!({ ...inputs, width });
    const reused = reuseParagraphAtWidth(cache, paragraph, next, width);
    expect(reused).toBe(measured);
    expect(reused).toEqual(
      breakParagraph(paragraph, paragraph.id, 0, width, shaped, undefined, null)
    );
  }
});

test('trailing spaces, other spaces, tabs and negative advances are refused', () => {
  for (const sample of [run('ends with space '), run('no break'), run('tab\tstop')]) {
    const paragraph = paragraphOf(sample);
    const line = breakParagraph(paragraph, paragraph.id, 0, 2000, shaped, undefined, null)[0]!;
    expect(tokenLineMovable(line)).toBe(false);
  }
  const paragraph = paragraphOf(run('a b'));
  const line = breakParagraph(paragraph, paragraph.id, 0, 2000, fixed, undefined, null)[0]!;
  const negative: PendingLine = {
    ...line,
    spans: line.spans.map((span, index) =>
      index === 0 ? { ...span, box: { ...span.box, width: -1 } } : span
    ),
  };
  expect(tokenLineMovable(negative)).toBe(false);
});
