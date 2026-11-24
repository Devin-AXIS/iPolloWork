import { expect, test } from 'bun:test';
import { loadBody } from './float-over-table-harness.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';

// Every character is 6pt wide, and the column is 60pt.
const measurer = createFixedMeasurer(6, 14);
const paragraph = (spacesRun: string, spaces = 6) =>
  loadBody(
    '<w:p><w:pPr><w:bidi/></w:pPr>' +
      '<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">אבג </w:t></w:r>' +
      '<w:r><w:t>abc</w:t></w:r>' +
      `<w:r>${spacesRun}<w:t xml:space="preserve">${' '.repeat(spaces)}</w:t></w:r></w:p>` +
      '<w:sectPr><w:pgSz w:w="2200" w:h="6000"/>' +
      '<w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr>'
  );
const words = (body: ReturnType<typeof loadBody>) =>
  linesOf(layoutSemanticDocument(body, 1, { measurer, compatibilityMode: 15 })).map((line) =>
    line.spans
      .map((span) => span.text)
      .join('')
      .trim()
  );

test('paragraph-end spaces of a run against the paragraph direction take room', () => {
  // 42pt of text fits, but with the six 6pt spaces after it the last word does not.
  expect(words(paragraph(''))).toEqual(['אבג', 'abc']);
  // Spaces wider than the room left even on the new line hang there, without an empty line.
  expect(words(paragraph('', 10))).toEqual(['אבג', 'abc']);
});

test('paragraph-end spaces of a run in the paragraph direction still hang', () => {
  expect(words(paragraph('<w:rPr><w:rtl/></w:rPr>'))).toEqual(['אבג abc']);
});
