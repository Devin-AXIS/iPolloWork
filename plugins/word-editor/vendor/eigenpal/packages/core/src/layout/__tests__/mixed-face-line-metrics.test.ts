import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { layoutSemanticDocument, linesOf, type TextMeasurer } from '../index.ts';

const measurer: TextMeasurer = {
  measure: (text) => text.length * 5,
  lineMetrics: (style) =>
    style.fontFamily === 'Deep' ? { height: 12, baseline: 7 } : { height: 12, baseline: 10 },
};
const run = (family: string, text: string) =>
  `<w:r><w:rPr><w:rFonts w:ascii="${family}"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
function layout(runs: string, spacing = '', width = 100, textMeasurer = measurer) {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      `<w:p><w:pPr>${spacing}</w:pPr>${runs}</w:p>` +
      `<w:sectPr><w:pgSz w:w="${width * 20}" w:h="2000"/>` +
      '<w:pgMar w:top="0" w:bottom="0" w:left="0" w:right="0"/></w:sectPr>' +
      '</w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return linesOf(layoutSemanticDocument(parsed.part, 1, { measurer: textMeasurer }));
}

for (const families of [
  ['Tall', 'Deep'],
  ['Deep', 'Tall'],
]) {
  test(`baseline-aligned mixed faces retain both descents: ${families.join(', ')}`, () => {
    const line = layout(run(families[0]!, 'A ') + run(families[1]!, 'g'))[0]!;
    expect(line.baseline).toBe(10);
    expect(line.box.height).toBe(15);
  });
}

test('automatic spacing scales the combined face band; exact spacing retains its authored box', () => {
  const runs = run('Tall', 'A ') + run('Deep', 'g');
  const auto = layout(runs, '<w:spacing w:line="480" w:lineRule="auto"/>')[0]!;
  expect(auto.box.height).toBe(30);
  expect(auto.baseline).toBe(10);
  const exact = layout(runs, '<w:spacing w:line="240" w:lineRule="exact"/>')[0]!;
  expect(exact.box.height).toBe(12);
});

test('carried words recompute the source line and retain the mixed destination band', () => {
  const lines = layout(run('Tall', 'aa xx') + run('Deep', 'yy'), '', 30);
  expect(lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
    'aa ',
    'xxyy',
  ]);
  expect(lines.map((line) => line.box.height)).toEqual([12, 15]);
  expect(lines.map((line) => line.baseline)).toEqual([10, 10]);
});

test('fallback glyph metrics reach layout and survive a carried-word recomputation', () => {
  const byText: TextMeasurer = {
    measure: (text) => text.length * 5,
    lineMetrics: (_style, text) =>
      text?.includes('#') ? { height: 20, baseline: 14 } : { height: 12, baseline: 10 },
  };
  const lines = layout(run('Primary', 'aa x#y'), '', 25, byText);
  expect(lines.map((line) => line.box.height)).toEqual([12, 20]);
  expect(lines.map((line) => line.baseline)).toEqual([10, 14]);
});
