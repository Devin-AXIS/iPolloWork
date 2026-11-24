import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode } from '../../store/package/ooxml-tree.ts';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { drawingInputsUnchangedByTextEdit } from '../drawing-text-only-change.ts';
import { drawingAtomIdentities, drawingSourceOrderInPart } from '../inline-drawing-source.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function load(body: string) {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:x="urn:test"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}
const paragraph = '<w:p><w:r><w:t>Text</w:t></w:r></w:p>';
function changeText(node: OoxmlNode): OoxmlNode {
  return node.kind === 'textValue'
    ? { ...node, value: node.value + 'X' }
    : ({ ...node, children: node.children.map(changeText) } as OoxmlNode);
}

test('ordinary immutable text edits preserve drawing inputs in both directions', () => {
  const part = load(paragraph);
  const p = part.root.children[0]!.children[0]!;
  const edited = applyTreeOp(part, { op: 'insertText', paragraphId: p.id, offset: 1, text: 'X' });
  expect(edited.ok).toBe(true);
  if (!edited.ok) return;
  expect(drawingInputsUnchangedByTextEdit(part.root, edited.part.root)).toBe(true);
  expect(drawingInputsUnchangedByTextEdit(edited.part.root, part.root)).toBe(true);
  expect(
    drawingInputsUnchangedByTextEdit(part.root, {
      ...part.root,
      attributes: [...part.root.attributes],
    })
  ).toBe(false);
  expect(drawingInputsUnchangedByTextEdit(part.root, { ...part.root, namespaceBindings: [] })).toBe(
    false
  );
  expect(drawingInputsUnchangedByTextEdit(part.root, { ...part.root, prefix: 'other' })).toBe(
    false
  );
  expect(drawingInputsUnchangedByTextEdit(part.root, { ...part.root, children: [] })).toBe(false);
});

for (const body of [
  '<w:p><w:r><w:instrText>Text</w:instrText></w:r></w:p>',
  `<w:p><w:r><w:drawing><w:txbxContent>${paragraph}</w:txbxContent></w:drawing></w:r></w:p>`,
  `<w:p><w:r><w:pict><w:txbxContent>${paragraph}</w:txbxContent></w:pict></w:r></w:p>`,
  `<w:p><w:r><w:object><w:txbxContent>${paragraph}</w:txbxContent></w:object></w:r></w:p>`,
  `<x:wrapper>${paragraph}</x:wrapper>`,
])
  test(`refuses changed field, drawing, or foreign content: ${body.slice(0, 35)}`, () => {
    const part = load(body);
    expect(drawingInputsUnchangedByTextEdit(part.root, changeText(part.root))).toBe(false);
  });

test('bounded drawing-order fallback reuses its result only for proven text edits', () => {
  const part = load(paragraph + '<x:box>'.repeat(70) + '</x:box>'.repeat(70));
  expect(drawingAtomIdentities(part)).toBeNull();
  const context: InlineDrawingLayoutContext = {
    ownerPartName: part.name,
    project: () => null,
    resourceOf: () => ({ kind: 'missing' }),
  };
  const before = drawingSourceOrderInPart(part, context);
  const p = part.root.children[0]!.children[0]!;
  const edited = applyTreeOp(part, { op: 'insertText', paragraphId: p.id, offset: 1, text: 'X' });
  if (!edited.ok) throw new Error(edited.reason);
  expect(drawingAtomIdentities(edited.part)).toBeNull();
  expect(drawingSourceOrderInPart(edited.part, context)).toBe(before);
  const body = part.root.children[0]!;
  if (body.kind === 'textValue') throw new Error('body missing');
  const reordered = {
    ...part,
    root: { ...part.root, children: [{ ...body, children: [...body.children].reverse() }] },
  };
  expect(drawingInputsUnchangedByTextEdit(part.root, reordered.root)).toBe(false);
  // Moving a drawing-free paragraph preserves the drawing order.
  expect(drawingSourceOrderInPart(reordered, context)).toBe(before);
});

test('restoring a cached drawing order resets the text-edit comparison root', () => {
  const part = load(paragraph + '<x:box>'.repeat(70) + '</x:box>'.repeat(70));
  const context: InlineDrawingLayoutContext = {
    ownerPartName: part.name,
    project: () => null,
    resourceOf: () => ({ kind: 'missing' }),
  };
  const original = drawingSourceOrderInPart(part, context);
  const p = part.root.children[0]!.children[0]!;
  const split = applyTreeOp(part, { op: 'splitParagraph', paragraphId: p.id, offset: 1 });
  if (!split.ok) throw Error(split.reason);
  drawingSourceOrderInPart(split.part, context);
  expect(drawingSourceOrderInPart(part, context)).toBe(original);
  const edited = applyTreeOp(part, { op: 'insertText', paragraphId: p.id, offset: 1, text: 'X' });
  if (!edited.ok) throw Error(edited.reason);
  expect(drawingSourceOrderInPart(edited.part, context)).toBe(original);
});
