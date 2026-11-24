import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createLayoutSession, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type TextMeasurer } from '../semantic-records.ts';
import { runBorderStrokesForLine } from '../run-border-strokes.ts';

const measurer: TextMeasurer = {
  measure: (text, style) => (text.length * style.fontSizePt) / 2,
  lineMetrics: (style) => ({ height: style.fontSizePt, baseline: style.fontSizePt * 0.8 }),
};
const border = '<w:bdr w:val="single" w:sz="4" w:space="1"/>';
const run = (text: string, props = '') => `<w:r><w:rPr>${props}</w:rPr><w:t>${text}</w:t></w:r>`;
function part(body: string, height = 100) {
  const result = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      body +
      '<w:sectPr><w:pgSz w:w="3000" w:h="' +
      height * 20 +
      '"/>' +
      '<w:pgMar w:left="0" w:right="0" w:top="0" w:bottom="0"/></w:sectPr></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

test('character border height is reserved once per line, including joined styled runs', () => {
  const doc = part(
    '<w:p>' +
      run('box', border) +
      run(' bold', border + '<w:b/>') +
      '</w:p><w:p>' +
      run('next') +
      '</w:p>'
  );
  const layout = layoutSemanticDocument(doc, 1, { measurer });
  const [boxed, next] = linesOf(layout);
  expect(boxed!.box.height).toBe(13);
  expect(boxed!.baseline).toBe(9.5);
  expect(next!.box.y).toBe(13);
  const strokes = runBorderStrokesForLine(boxed!);
  expect(strokes).toHaveLength(4);
  expect(strokes.find((stroke) => stroke.side === 'top')!.box.y).toBe(0);
  expect(strokes.find((stroke) => stroke.side === 'bottom')!.box.y + 0.5).toBe(13);
});

test('automatic and minimum spacing reserve borders while exact spacing keeps its authored height', () => {
  for (const [attrs, expected] of [
    ['w:line="480" w:lineRule="auto"', 26],
    ['w:line="240" w:lineRule="atLeast"', 13],
    ['w:line="240" w:lineRule="exact"', 12],
  ] as const) {
    const doc = part(`<w:p><w:pPr><w:spacing ${attrs}/></w:pPr>${run('box', border)}</w:p>`);
    const line = linesOf(layoutSemanticDocument(doc, 1, { measurer }))[0]!;
    expect(line.box.height).toBe(expected);
  }
});

test('a small bordered face does not enlarge a taller visible face', () => {
  const doc = part(
    '<w:p>' +
      run('small', border + '<w:sz w:val="8"/>') +
      run('tall', '<w:sz w:val="40"/>') +
      '</w:p>'
  );
  const line = linesOf(layoutSemanticDocument(doc, 1, { measurer }))[0]!;
  expect(line.box.height).toBe(20);
  expect(line.baseline).toBe(16);
  const top = runBorderStrokesForLine(line).find((stroke) => stroke.side === 'top')!;
  expect(top.box.y).toBeCloseTo(16 - 3.2 - 1.5, 6);
});

test('pagination budgets character borders and warm layout retains the same page break', () => {
  const doc = part('<w:p>' + run('box', border) + '</w:p><w:p>' + run('next') + '</w:p>', 22);
  const session = createLayoutSession();
  const cold = layoutSemanticDocument(doc, 1, { measurer, session });
  const warm = layoutSemanticDocument(doc, 1, { measurer, session });
  expect(cold.pages).toHaveLength(2);
  expect(linesOf(cold).map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
    'box',
    'next',
  ]);
  expect(warm.pages).toEqual(cold.pages);
});
