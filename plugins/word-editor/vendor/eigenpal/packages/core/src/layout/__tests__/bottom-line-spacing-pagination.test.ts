import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const paragraph = (text: string, spacing = '') =>
  `<w:p>${spacing ? `<w:pPr>${spacing}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

test('auto spacing below the final glyph band may cross the bottom text margin', () => {
  // The content box is 30pt high. Both glyph bands fit, but auto 1.4 spacing makes the
  // second line's painted box cross the text margin. Word keeps both lines on one page and
  // lets only that trailing depth extend below the flow region.
  const body =
    paragraph('first') +
    paragraph('second', '<w:spacing w:line="336" w:lineRule="auto"/>') +
    '<w:sectPr><w:pgSz w:w="3000" w:h="1000"/>' +
    '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200"/></w:sectPr>';
  const layout = layoutSemanticDocument(load(body), 1, {
    measurer: createFixedMeasurer(6, 14),
  });

  expect(layout.pages).toHaveLength(1);
  expect(layout.pages[0]!.fragments).toHaveLength(2);
  expect(layout.pages[0]!.fragments[1]!.box.y).toBe(layout.pages[0]!.fragments[0]!.box.height);
});
