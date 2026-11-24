import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { ordinaryTableParagraph } from '../table-ordinary-paragraph.ts';

function paragraph(content: string) {
  const read = readOoxmlPart(
    `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:r>${content}</w:r></w:p>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw Error(read.reason);
  return read.part.root;
}

test('saved pagination markers allow ordinary paragraph reuse', () => {
  expect(ordinaryTableParagraph(paragraph('<w:lastRenderedPageBreak/><w:t>Text</w:t>'))).toBe(true);
});

test('pagination markers with unexpected descendants refuse reuse', () => {
  expect(
    ordinaryTableParagraph(
      paragraph('<w:lastRenderedPageBreak><w:drawing/></w:lastRenderedPageBreak>')
    )
  ).toBe(false);
});

test('content-bearing fields and drawings still refuse ordinary paragraph reuse', () => {
  for (const content of ['<w:drawing/>', '<w:instrText>PAGE</w:instrText>']) {
    expect(ordinaryTableParagraph(paragraph(content))).toBe(false);
  }
});
