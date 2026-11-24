import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument, linesOf } from '../index.ts';
import type { TextMeasurer } from '../text-measurer.ts';
import {
  createFontResourceSnapshot,
  FontResolutionError,
  sha256FontBytes,
} from '../font-resource.ts';
import {
  createHarfBuzzTextShaper,
  HARFBUZZ_SHAPING_LIBRARY,
  harfBuzzFontValidator,
  initializeHarfBuzz,
} from '../harfbuzz-shaper.ts';
import { createShapedMeasurer } from '../shaped-measurer.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';

await initializeHarfBuzz();

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** An East Asian face with no glyph for the non-breaking hyphen, and a taller line than Arial. */
const EAST_ASIAN = 'Coverage CJK Face';
const MISSING = new Set(['‑']);

/** Fixed metrics, with a 20 pt line for the East Asian face and a coverage answer for it. */
function coverageMeasurer(): TextMeasurer {
  const base = createFixedMeasurer(6, 14);
  return {
    ...base,
    lineMetrics: (style, text) =>
      style.fontFamily === EAST_ASIAN
        ? { height: 20, baseline: 16 }
        : base.lineMetrics(style, text),
    faceCovers: (text, style) =>
      style.fontFamily === EAST_ASIAN ? ![...text].some((c) => MISSING.has(c)) : true,
  };
}

function lineOf(runs: string, measurer: TextMeasurer = coverageMeasurer()) {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p>${runs}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return linesOf(layoutSemanticDocument(parsed.part, 1, { measurer }))[0]!;
}

const run = (text: string, hint: boolean, lang?: string) =>
  `<w:r><w:rPr><w:rFonts${hint ? ' w:hint="eastAsia"' : ''} w:ascii="Arial" w:hAnsi="Arial" ` +
  `w:eastAsia="${EAST_ASIAN}"/>${lang ? `<w:lang w:eastAsia="${lang}"/>` : ''}</w:rPr>` +
  `<w:t xml:space="preserve">${text}</w:t></w:r>`;

test('a hinted character the East Asian face cannot draw takes the Latin face and line', () => {
  for (const lang of [undefined, 'ja-JP', 'zh-CN', 'zh-TW', 'ko-KR']) {
    const line = lineOf(run('long', false, lang) + run('‑', true, lang) + run('term', false, lang));
    const hyphen = line.spans.find((span) => span.text === '‑')!;
    expect(hyphen.fontSlot).toBeUndefined();
    expect(hyphen.range).toEqual({ paragraphId: hyphen.range.paragraphId, start: 4, end: 5 });
    expect(line.box.height).toBeCloseTo(lineOf(run('longterm', false, lang)).box.height, 3);
  }
});

test('a hinted character the East Asian face draws keeps that face and its line', () => {
  const line = lineOf(run('long', false) + run('–', true) + run('term', false));
  const dash = line.spans.find((span) => span.text === '–')!;
  expect(dash.fontSlot).toBe('eastAsia');
  expect(line.box.height).toBeCloseTo(20, 3);
});

test('a hinted run splits at each character the East Asian face cannot draw', () => {
  const line = lineOf(run('a–‑‑—b', true));
  const slots = line.spans.map((span) => [span.text, span.fontSlot ?? 'latin']);
  expect(slots).toEqual([
    ['a', 'latin'],
    ['–', 'eastAsia'],
    ['‑‑', 'latin'],
    ['—', 'eastAsia'],
    ['b', 'latin'],
  ]);
  expect(line.spans.map((span) => [span.range.start, span.range.end])).toEqual([
    [0, 1],
    [1, 2],
    [2, 4],
    [4, 5],
    [5, 6],
  ]);
});

test('without a coverage answer, hinted characters keep the East Asian face', () => {
  const { faceCovers: _ignored, ...measurer } = coverageMeasurer();
  const line = lineOf(run('long', false) + run('‑', true) + run('term', false), measurer);
  expect(line.spans.find((span) => span.text === '‑')!.fontSlot).toBe('eastAsia');
});

test('the shaped measurer answers coverage from the face itself', () => {
  const bytes = new Uint8Array(
    readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
  );
  const request = { family: 'Coverage Fixture', weight: 400, style: 'normal' as const };
  const snapshot = createFontResourceSnapshot({
    epoch: 0,
    maxFontBytes: 2_000_000,
    validateFont: harfBuzzFontValidator,
    resources: [{ id: 'c', request, bytes, hash: sha256FontBytes(bytes), faceIndex: 0 }],
  });
  const font = snapshot.resolve(request);
  if (font instanceof FontResolutionError) throw font;
  const measurer = createShapedMeasurer({
    shaper: createHarfBuzzTextShaper(),
    resolveFont: () => font,
    fallback: createFixedMeasurer(),
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
    unicodeDataVersion: '15.1',
  });
  const style = { ...DEFAULT_RUN_STYLE, fontFamily: 'Coverage Fixture' };
  expect(measurer.faceCovers!('–', style)).toBe(true);
  expect(measurer.faceCovers!('あ', style)).toBe(false);
  expect(measurer.faceCovers!('あ', style)).toBe(false);
});
