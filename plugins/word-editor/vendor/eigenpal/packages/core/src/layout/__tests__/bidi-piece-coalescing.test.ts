import { expect, test } from 'bun:test';
import { coalesceBidiPieces } from '../bidi-piece-coalescing.ts';
import { bidiPieces } from '../rtl-paragraph.ts';
import type { FieldAwarePiece } from '../field-pieces.ts';
import { readFileSync } from 'node:fs';
import { readOoxmlPart } from '../../store/index.ts';
import { linesOf } from '../semantic-records.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import {
  DEFAULT_RUN_STYLE,
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
  return linesOf(result);
}

test.each(['مرحبا', 'لا', 'سلام', 'العربية', 'مَرْحَبًا', 'אבג'])(
  'equivalent source runs shape %s as one contextual sequence',
  (text) => {
    const whole = run([text]);
    const split = run([...text]);
    const geometry = (lines: ReturnType<typeof run>) =>
      lines.map((line) =>
        line.spans.map((span) => ({
          text: span.text,
          range: { start: span.range.start, end: span.range.end },
          box: span.box,
        }))
      );
    expect(geometry(split)).toEqual(geometry(whole));
  }
);
test('source fragmentation does not wrap a fitting lam-alef ligature', () => {
  expect(run(['لا'], 8)).toHaveLength(1);
  const fragmented = run(['ل', 'ا'], 8);
  expect(fragmented).toHaveLength(1);
  expect(fragmented[0]!.spans[0]!.text).toBe('لا');
  expect(fragmented[0]!.spans[0]!.box.width).toBeLessThan(8);
});

const piece = (text: string, start: number): FieldAwarePiece => ({
  text,
  start,
  end: start + text.length,
  props: [],
  style: DEFAULT_RUN_STYLE,
});
test('coalescing preserves source ranges, revision, link, field, break, and property boundaries', () => {
  const first = piece('ل', 0),
    second = piece('ا', 1);
  expect(coalesceBidiPieces([first, second])).toMatchObject([{ text: 'لا', start: 0, end: 2 }]);
  const boundaries: Partial<FieldAwarePiece>[] = [
    { style: { ...DEFAULT_RUN_STYLE, bold: true } },
    { props: [{ localName: 'rtl' }] },
    { link: { href: 'https://example.com' } },
    { revisions: [{ kind: 'insertion', id: 'change', author: 'Reviewer', nodeId: 'r1' }] },
    { fieldAtom: { formField: false } },
    { breakKind: 'line' },
    { anchoredAtom: true },
    { noteNav: { scopeId: 'note', direction: 'to-note' } },
    { fontSlot: 'cs' },
    { start: 2, end: 3 },
  ];
  for (const boundary of boundaries)
    expect(coalesceBidiPieces([first, { ...second, ...boundary }])).toHaveLength(2);
});
test('ordinary LTR pieces keep their existing boundaries', () => {
  const pieces = [piece('of', 0), piece('fice', 2)];
  expect(bidiPieces(pieces, false)).toBe(pieces);
});
