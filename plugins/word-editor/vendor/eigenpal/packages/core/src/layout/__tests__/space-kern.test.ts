import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { isRunKerningEnabled } from '../run-kerning.ts';
import type { TextMeasurer } from '../paragraph-flow.ts';

// A kerning run applies the font's pair between a word's trailing space and the next letter,
// as it does inside a word. Words are measured one at a time, so that pair is added when the
// next word lands on the same line.

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** 10pt per character; a kerning style tightens every " A" pair by 2pt. */
const measurer: TextMeasurer = {
  measure: (text, style) =>
    text.length * 10 - (isRunKerningEnabled(style) ? text.split(' A').length - 1 : 0) * 2,
  lineMetrics: () => ({ height: 12, baseline: 10 }),
};

function spans(text: string, kern: boolean, widthPt: number) {
  const run = `<w:r><w:rPr>${kern ? '<w:kern w:val="2"/>' : ''}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
  const xml = `<w:document xmlns:w="${W}"><w:body><w:p>${run}</w:p></w:body></w:document>`;
  const read = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!read.ok) throw new Error(read.reason);
  const result = layoutSemanticDocument(read.part, 1, {
    measurer,
    geometry: { width: widthPt, height: 400, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  });
  return result.pages[0]!.fragments.flatMap((fragment) =>
    fragment.kind === 'paragraph'
      ? fragment.lines.map((line) => line.spans.map((span) => [span.text, span.box.x]))
      : []
  );
}

test('the word after a space moves back by the space pair', () => {
  const plain = spans('XX AB', false, 400);
  const kerned = spans('XX AB', true, 400);
  expect(plain[0]!.at(-1)).toEqual(['AB', 30]);
  expect(kerned[0]!.at(-1)).toEqual(['AB', 28]);
});

test('the tighter line keeps a word that fits only with the pair', () => {
  // "XX " 30 + "AB " 30 - 2 + "C" 10 = 68 on a 69pt line; 70 without the pair.
  expect(spans('XX AB C', false, 69)).toHaveLength(2);
  expect(spans('XX AB C', true, 69)).toHaveLength(1);
});

test('a word that opens a line takes no pair from the space before it', () => {
  const lines = spans('XXXXX AB', true, 60);
  expect(lines).toHaveLength(2);
  expect(lines[1]![0]).toEqual(['AB', 0]);
});
