import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';

// A right-to-left section stores its columns right to left. Balancing must still measure
// each column's own content, or every fragment counts toward one column.

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
const section = (columns: number, bidi: boolean, type = 'continuous') =>
  `<w:sectPr><w:type w:val="${type}"/><w:pgSz w:w="6000" w:h="2400"/>` +
  '<w:pgMar w:top="200" w:bottom="200" w:left="200" w:right="200"/>' +
  `<w:cols w:num="${columns}" w:space="200"/>${bidi ? '<w:bidi/>' : ''}</w:sectPr>`;
const paragraph = (text: string, height = 30, sect = '') =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${height * 20}" w:lineRule="exact"/>` +
  `${sect}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

function layout(bidi: boolean) {
  const xml =
    `<w:document xmlns:w="${W}"><w:body>` +
    Array.from({ length: 4 }, (_, i) => paragraph(`B${i}`)).join('') +
    paragraph('', 1, section(2, bidi)) +
    paragraph('FOLLOW', 8) +
    section(1, false) +
    '</w:body></w:document>';
  const read = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!read.ok) throw new Error(read.reason);
  const result = layoutSemanticDocument(read.part, 1, { measurer });
  const fragments = result.pages[0]!.fragments.flatMap((fragment) =>
    fragment.kind === 'paragraph'
      ? [
          {
            text: fragment.lines.flatMap((line) => line.spans.map((span) => span.text)).join(''),
            x: fragment.box.x,
            y: fragment.box.y,
          },
        ]
      : []
  );
  return {
    follow: fragments.find((fragment) => fragment.text === 'FOLLOW')!.y,
    columns: new Set(fragments.filter((f) => /^B\d$/.test(f.text)).map((f) => f.x)).size,
  };
}

test('a right-to-left section balances its columns as a left-to-right one does', () => {
  const ltr = layout(false);
  const rtl = layout(true);
  expect(ltr.columns).toBe(2);
  expect(rtl.columns).toBe(2);
  expect(rtl.follow).toBe(ltr.follow);
});
