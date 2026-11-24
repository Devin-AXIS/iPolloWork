// ASK and SET store their result in a bookmark and display nothing where they stand.

import { expect, test } from 'bun:test';
import { loadBody } from './float-over-table-harness.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';

const field = (instruction: string, result: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  `<w:r><w:t>${result}</w:t></w:r>` +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

const text = (inner: string) =>
  linesOf(
    layoutSemanticDocument(
      loadBody(`<w:p><w:r><w:t xml:space="preserve">Title </w:t></w:r>${inner}</w:p>`),
      1,
      { measurer: createFixedMeasurer(6, 12) }
    )
  )
    .flatMap((line) => line.spans.map((span) => span.text))
    .join('');

test('ASK and SET results do not display', () => {
  expect(text(field('ASK name "Prompt text"', '[Answer]'))).toBe('Title ');
  expect(text(field('SET name "Value"', 'Value'))).toBe('Title ');
});

test('other field results still display', () => {
  expect(text(field('FILLIN "Prompt text"', 'Answer'))).toBe('Title Answer');
  expect(text(field('DOCVARIABLE name', 'Value'))).toBe('Title Value');
});
