import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';

// A justified line that ends at a manual line break and has no space to stretch stays at its
// start edge: the left one in a left-to-right paragraph, the right one in a right-to-left one.

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function firstLineSpans(bidi: boolean) {
  const xml =
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr>${bidi ? '<w:bidi/>' : ''}` +
    '<w:ind w:left="2287"/><w:jc w:val="both"/></w:pPr>' +
    '<w:r><w:t>WORD</w:t></w:r><w:r><w:br/></w:r>' +
    '<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve"> مرحبا بك</w:t></w:r>' +
    '</w:p></w:body></w:document>';
  const read = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!read.ok) throw new Error(read.reason);
  const result = layoutSemanticDocument(read.part, 1, { measurer: createFixedMeasurer(6, 14) });
  const fragment = result.pages[0]!.fragments.find((f) => f.kind === 'paragraph');
  if (fragment?.kind !== 'paragraph') throw new Error('paragraph');
  const word = fragment.lines[0]!.spans.find((span) => span.text === 'WORD')!;
  return { word, available: fragment.box.width };
}

test('a right-to-left justified line before a break stays at the right edge', () => {
  const { word, available } = firstLineSpans(true);
  expect(word.box.x + word.box.width).toBeCloseTo(available, 3);
});

test('a left-to-right justified line before a break stays at the left indent', () => {
  const { word } = firstLineSpans(false);
  expect(word.box.x).toBeCloseTo(2287 / 20, 3);
});
