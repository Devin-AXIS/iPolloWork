import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode } from '../../store/package/ooxml-tree.ts';
import { walkDrawingAtoms } from '../drawing-inline-walk.ts';

function paragraph(content: string) {
  const result = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body><w:p>${content}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw Error(result.reason);
  const node = result.part.root.children[0]!.children[0]!;
  if (node.kind !== 'paragraph') throw Error('Missing paragraph');
  return node;
}

test('an empty drawing walk does not hide drawings in a later immutable paragraph', () => {
  const before = paragraph('<w:r><w:t>Text</w:t></w:r>');
  const drawn = paragraph(
    '<w:r><w:drawing><wp:inline><wp:extent cx="1" cy="1"/><wp:docPr id="1" name="Shape"/><a:graphic><a:graphicData uri="urn:test"/></a:graphic></wp:inline></w:drawing></w:r>'
  );
  const found: OoxmlNode[] = [];
  walkDrawingAtoms(before, (node) => found.push(node));
  walkDrawingAtoms(before, (node) => found.push(node));
  expect(found).toEqual([]);
  const after = { ...before, children: [...before.children, ...drawn.children] };
  walkDrawingAtoms(after, (node) => found.push(node));
  expect(found).toHaveLength(1);
  walkDrawingAtoms(after, (node) => found.push(node));
  expect(found).toHaveLength(2);
  expect(found[0]).toBe(found[1]);
});
