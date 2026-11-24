import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode } from '../../store/package/ooxml-tree.ts';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { drawingInputsUnchangedByParagraphEdit } from '../drawing-paragraph-change.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const paragraph = '<w:p><w:r><w:t>Text</w:t></w:r></w:p>';
function load(body: string) {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:x="urn:test"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw Error(read.reason);
  return read.part;
}
function changeText(node: OoxmlNode): OoxmlNode {
  return node.kind === 'textValue'
    ? { ...node, value: node.value + 'X' }
    : ({ ...node, children: node.children.map(changeText) } as OoxmlNode);
}

test('paragraph splits and joins preserve unchanged drawing ancestors', () => {
  const part = load('<w:p><w:r><w:object/></w:r></w:p>' + paragraph);
  const p = part.root.children[0]!.children[1]!;
  const split = applyTreeOp(part, { op: 'splitParagraph', paragraphId: p.id, offset: 2 });
  if (!split.ok) throw Error(split.reason);
  expect(drawingInputsUnchangedByParagraphEdit(part.root, split.part.root)).toBe(true);
  expect(drawingInputsUnchangedByParagraphEdit(split.part.root, part.root)).toBe(true);
});

test('accepts edits to paragraphs whose fields and bookmarks hold no drawing', () => {
  const part = load(
    '<w:p><w:pPr><w:adjustRightInd/></w:pPr><w:bookmarkStart w:id="1" w:name="a"/>' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>REF a</w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r><w:bookmarkEnd w:id="1"/></w:p>' +
      '<w:p><w:r><w:object/></w:r></w:p>'
  );
  const p = part.root.children[0]!.children[0]!;
  const typed = applyTreeOp(part, { op: 'insertText', paragraphId: p.id, offset: 0, text: 'X' });
  if (!typed.ok) throw Error(typed.reason);
  expect(drawingInputsUnchangedByParagraphEdit(part.root, typed.part.root)).toBe(true);
  const listed = applyTreeOp(part, { op: 'setListNumbering', paragraphId: p.id, numId: '1' });
  if (!listed.ok) throw Error(listed.reason);
  expect(drawingInputsUnchangedByParagraphEdit(part.root, listed.part.root)).toBe(true);
});

test('rejects a property edit on a paragraph that holds a drawing', () => {
  // An object's preview reads its own paragraph's frame and style.
  const part = load('<w:p><w:bookmarkStart w:id="1" w:name="a"/><w:r><w:object/></w:r></w:p>');
  const p = part.root.children[0]!.children[0]!;
  const listed = applyTreeOp(part, { op: 'setListNumbering', paragraphId: p.id, numId: '1' });
  if (!listed.ok) throw Error(listed.reason);
  expect(drawingInputsUnchangedByParagraphEdit(part.root, listed.part.root)).toBe(false);
});

for (const body of [
  `<w:p><w:r><w:drawing><w:txbxContent>${paragraph}</w:txbxContent></w:drawing></w:r></w:p>`,
  `<w:p><w:r><w:pict><w:txbxContent>${paragraph}</w:txbxContent></w:pict></w:r></w:p>`,
  `<w:p><w:r><w:object><w:txbxContent>${paragraph}</w:txbxContent></w:object></w:r></w:p>`,
  `<x:wrapper>${paragraph}</x:wrapper>`,
])
  test(`rejects projection changes: ${body.slice(0, 30)}`, () => {
    const part = load(body);
    expect(drawingInputsUnchangedByParagraphEdit(part.root, changeText(part.root))).toBe(false);
  });

test('rejects changed ancestor metadata and added drawing content', () => {
  const part = load(paragraph);
  expect(drawingInputsUnchangedByParagraphEdit(part.root, { ...part.root, attributes: [] })).toBe(
    false
  );
  expect(
    drawingInputsUnchangedByParagraphEdit(part.root, { ...part.root, namespaceBindings: [] })
  ).toBe(false);
  const body = part.root.children[0]!;
  if (body.kind === 'textValue') throw Error('Missing body');
  const object = load('<w:p><w:r><w:object/></w:r></w:p>').root.children[0]!.children[0]!;
  const after = { ...part.root, children: [{ ...body, children: [...body.children, object] }] };
  expect(drawingInputsUnchangedByParagraphEdit(part.root, after)).toBe(false);
});

test('numbered paragraph splits retain drawing data without changing table reuse admission', async () => {
  const { ordinaryTableParagraph, ordinaryDrawingParagraph } =
    await import('../table-ordinary-paragraph.ts');
  const numbered =
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Numbered text</w:t></w:r></w:p>';
  const part = load(numbered + '<w:p><w:r><w:object/></w:r></w:p>');
  const p = part.root.children[0]!.children[0]!;
  expect(ordinaryTableParagraph(p)).toBe(false);
  expect(ordinaryDrawingParagraph(p)).toBe(true);
  const split = applyTreeOp(part, { op: 'splitParagraph', paragraphId: p.id, offset: 3 });
  if (!split.ok) throw Error(split.reason);
  expect(drawingInputsUnchangedByParagraphEdit(part.root, split.part.root)).toBe(true);
  expect(drawingInputsUnchangedByParagraphEdit(split.part.root, part.root)).toBe(true);
  const unsafe = load(numbered.replace('<w:numPr>', '<w:numPr><w:object/>'));
  expect(ordinaryDrawingParagraph(unsafe.root.children[0]!.children[0]!)).toBe(false);
});
