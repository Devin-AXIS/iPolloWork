import { expect, test } from 'bun:test';
import { loadBody } from './float-over-table-harness.ts';
import { breakParagraph } from '../paragraph-flow.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';
import { reorderBidiSpans } from '../rtl-paragraph.ts';

// In a right-to-left run of an Arabic-script language, a slash between digits separates the
// numbers: `17/08/96` reads `96/08/17`. In a left-to-right run, and in a Hebrew run, the date
// stays one number.

function visualText(runs: string, bidi = true): string {
  const part = loadBody(
    `<w:p><w:pPr>${bidi ? '<w:bidi/>' : ''}<w:spacing w:after="0"/></w:pPr>${runs}</w:p>`
  );
  const paragraph = part.root.children
    .flatMap((node) => node.children)
    .find((node) => node.kind === 'paragraph')!;
  const lines = breakParagraph(paragraph, paragraph.id, 0, 500, createFixedMeasurer(6, 14));
  expect(lines).toHaveLength(1);
  return reorderBidiSpans(lines[0]!.spans, bidi)
    .slice()
    .sort((left, right) => left.box.x - right.box.x)
    .map((span) => span.text)
    .join('');
}

const run = (text: string, rtl: boolean, lang = 'ar-SA') =>
  `<w:r><w:rPr>${rtl ? '<w:rtl/>' : ''}<w:lang w:bidi="${lang}"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

test('a date in a right-to-left run reads from its last number', () => {
  expect(visualText(run('تاريخ 17/08/96', true))).toStartWith('96/08/17');
});

test('a date split over right-to-left runs reads the same way', () => {
  expect(visualText(run('تاريخ 17/', true) + run('08/96', true))).toContain('96/08/17');
});

test('a date in a left-to-right run stays one number', () => {
  expect(visualText(run('تاريخ ', true) + run('17/08/96', false))).toContain('17/08/96');
});

test('a slash without digits on both sides keeps its usual resolution', () => {
  expect(visualText(run('12/ab', true))).toBe('ab/12');
});

test('a Hebrew run keeps a number with a slash as one left-to-right number', () => {
  expect(visualText(run('\u05d0"\u05d1 852/20', true, 'he-IL'))).toContain('852/20');
});
