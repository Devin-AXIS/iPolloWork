import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';

function firstParagraph(runs: string) {
  const opened = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      `<w:p><w:r>${runs}</w:r></w:p>` +
      '<w:sectPr><w:pgSz w:w="1880" w:h="3000"/><w:pgMar w:left="400" w:right="400" w:top="200" w:bottom="200"/></w:sectPr>' +
      '</w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!opened.ok) throw new Error(opened.reason);
  const layout = layoutSemanticDocument(opened.part, 1, { measurer: createFixedMeasurer(6, 14) });
  const paragraph = layout.pages[0]!.fragments.find((fragment) => fragment.kind === 'paragraph')!;
  if (paragraph.kind !== 'paragraph') throw new Error('Missing paragraph');
  return paragraph;
}

test('a noBreakHyphen paints as one model character and does not permit a break', () => {
  const paragraph = firstParagraph('<w:t>A No</w:t><w:noBreakHyphen/><w:t>Break</w:t>');
  expect(paragraph.lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
    'A ',
    'No‑Break',
  ]);
  const spans = paragraph.lines.flatMap((line) => line.spans);
  const hyphen = spans.find((span) => span.range.start <= 4 && span.range.end >= 5)!;
  expect(hyphen.text[4 - hyphen.range.start]).toBe('‑');
  expect(spans[spans.length - 1]!.range.end).toBe(10);
});

test('a softHyphen occupies one model character and measures nothing', () => {
  const plain = firstParagraph('<w:t>rates</w:t>');
  const soft = firstParagraph('<w:t>rate</w:t><w:softHyphen/><w:t>s</w:t>');
  const width = (paragraph: ReturnType<typeof firstParagraph>) =>
    paragraph.lines[0]!.spans.reduce((sum, span) => sum + span.box.width, 0);
  expect(width(soft)).toBeCloseTo(width(plain), 6);
  const spans = soft.lines.flatMap((line) => line.spans);
  expect(spans.map((span) => span.text).join('')).toBe('rate­s');
  expect(spans[spans.length - 1]!.range.end).toBe(6);
});
