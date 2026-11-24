// A paragraph that opens with a column break is broken again at the next column's width.
// The keep plan from the first break must not cut the new lines: they stay in the column.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

test('the lines after an opening column break stay in the narrow column', () => {
  const xml =
    `<w:document xmlns:w="${W}"><w:body>` +
    '<w:p><w:r><w:t>left</w:t></w:r></w:p>' +
    '<w:p><w:r><w:br w:type="column"/></w:r>' +
    '<w:r><w:t>aaaa bbbb cccc dddd eeee ffff gggg</w:t></w:r></w:p>' +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>' +
    '<w:cols w:num="2" w:equalWidth="0"><w:col w:w="7200" w:space="200"/><w:col w:w="1500"/>' +
    '</w:cols></w:sectPr></w:body></w:document>';
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  const result = layoutSemanticDocument(parsed.part, 0, { measurer: createFixedMeasurer(5, 12) });
  expect(result.pages).toHaveLength(1);
  const right = result.pages[0]!.fragments.filter(
    (fragment): fragment is ParagraphFragmentRecord =>
      fragment.kind === 'paragraph' && fragment.box.x > 300
  );
  expect(right.flatMap((fragment) => fragment.lines)).toHaveLength(3);
});
