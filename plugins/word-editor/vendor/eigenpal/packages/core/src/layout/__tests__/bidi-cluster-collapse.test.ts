import { expect, test } from 'bun:test';
import { selectionRects } from '../selection-rects.ts';
import { caretAt, documentOrder } from '../semantic-interaction.ts';
import { collapseHorizontalSelection } from '../../editor/surface-selection-collapse.ts';
import { readFileSync } from 'node:fs';
import { readOoxmlPart } from '../../store/index.ts';
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

test('partial Arabic ligature collapse retains an in-range canonical insertion position', () => {
  const layout = run(['لا']);
  const order = documentOrder(layout);
  const from = { paragraphId: order[0]!, offset: 0 };
  const to = { paragraphId: order[0]!, offset: 1 };
  const ink = selectionRects(layout, { anchor: from, head: to }, order, measurer)[0]!;
  expect(ink.width).toBeGreaterThan(5);
  for (const command of ['left', 'right'] as const) {
    const position = collapseHorizontalSelection(layout, { from, to }, order, command, measurer);
    expect(position.offset).toBeGreaterThanOrEqual(0);
    expect(position.offset).toBeLessThanOrEqual(1);
    // Selection expands to the visible ligature. Insertion stays at its leading cluster edge.
    expect(caretAt(layout, position, measurer)!.x).toBeCloseTo(ink.x + ink.width);
  }
});
