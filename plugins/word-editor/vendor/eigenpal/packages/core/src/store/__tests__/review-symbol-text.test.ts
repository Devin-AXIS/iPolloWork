// Review cards show a symbol as its glyph. Its model text reads as "(", which a reader of a
// card would take for a parenthesis.

import { expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../package/ooxml-tree.ts';
import { revisionItemsOf } from '../store/review-reads.ts';

test('a tracked symbol deletion shows the symbol on its card', () => {
  const loaded = readOoxmlPart(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p><w:r><w:t>a</w:t></w:r>` +
      '<w:del w:id="1" w:author="A" w:date="2024-01-01T00:00:00Z"><w:r>' +
      '<w:sym w:font="Wingdings" w:char="F0FC"/></w:r></w:del><w:r><w:t>b</w:t></w:r></w:p>' +
      '</w:body></w:document>',
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  const [item] = revisionItemsOf(loaded.part);
  expect(item?.revisionKind).toBe('delete');
  expect(item?.text).toBe('✔');
});
