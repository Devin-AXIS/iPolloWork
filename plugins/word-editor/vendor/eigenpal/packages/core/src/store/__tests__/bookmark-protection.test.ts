import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../package/ooxml-tree.ts';
import { serializeOoxmlPart } from '../package/ooxml-serialize.ts';
import { listBookmarkPairs } from '../package/bookmark-list.ts';
import { applyTreeOp } from '../store/tree-ops.ts';

for (const protection of ['contentLocked', 'sdtContentLocked', 'bound']) {
  for (const inline of [false, true]) {
    test(`bookmark removal respects ${protection} in ${inline ? 'inline' : 'block'} controls`, () => {
      const markers =
        '<w:bookmarkStart w:id="1" w:name="Same"/><w:r><w:t>Protected</w:t></w:r><w:bookmarkEnd w:id="1"/>';
      const properties =
        protection === 'bound'
          ? '<w:dataBinding w:storeItemID="{123}" w:xpath="/value"/>'
          : `<w:lock w:val="${protection}"/>`;
      const control = `<w:sdt><w:sdtPr>${properties}</w:sdtPr><w:sdtContent>${inline ? markers : `<w:p>${markers}</w:p>`}</w:sdtContent></w:sdt>`;
      const result = readOoxmlPart(
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${inline ? `<w:p>${control}</w:p>` : control}<w:p><w:r><w:t>Target</w:t></w:r></w:p></w:body></w:document>`,
        { name: '/word/document.xml', contentType: 'application/xml' }
      );
      if (!result.ok) throw new Error(result.reason);
      const part = result.part;
      const before = serializeOoxmlPart(part);
      const pair = listBookmarkPairs(part)[0]!;
      const target = part.root.children.find(
        (node) => node.kind !== 'textValue' && node.localName === 'body'
      )!;
      if (target.kind === 'textValue') throw new Error('body missing');
      const paragraphId = target.children.at(-1)!.id;
      for (const op of [
        { op: 'deleteBookmark', name: 'Same' } as const,
        {
          op: 'deleteBookmark',
          name: 'Same',
          pair: { startNodeId: pair.startNodeId, endNodeId: pair.endNodeId },
        } as const,
        {
          op: 'insertBookmark',
          name: 'Same',
          start: { paragraphId, offset: 0 },
          end: { paragraphId, offset: 6 },
        } as const,
      ]) {
        const applied = applyTreeOp(part, op);
        expect(applied.ok ? 'applied' : applied.reason).toBe(
          protection === 'bound' ? 'bound' : 'locked'
        );
        expect(serializeOoxmlPart(part)).toBe(before);
      }
    });
  }
}
