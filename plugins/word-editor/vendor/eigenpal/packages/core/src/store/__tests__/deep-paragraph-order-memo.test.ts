import { expect, test } from 'bun:test';
import type { OoxmlElement, OoxmlPart } from '../package/ooxml-tree.ts';
import { keepsSubtreeMemo } from '../package/subtree-memo-policy.ts';
import { deepParagraphOrderOfPart } from '../store/review-paragraph-order.ts';
import { applyTreeOp } from '../store/tree-ops.ts';
import { loadPart, W } from './random-edit-test-support.ts';

// Nodes whose children are leaves keep no deep-id entry. Their answers, and every answer
// above them, must equal a read over a clone that shares no node with the memo.
const document = (body: string): OoxmlPart =>
  loadPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`);
const bodyOf = (part: OoxmlPart) =>
  part.root.children.find((node) => node.kind === 'body') as OoxmlElement;
const run = (text: string) => `<w:r><w:rPr><w:b/></w:rPr><w:t>${text}</w:t></w:r>`;
const cell = (inner: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${inner}</w:tc>`;
const table =
  '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
  `<w:tr>${cell(`<w:p>${run('a')}</w:p>`)}${cell('<w:p/>')}</w:tr></w:tbl>`;
const order = (part: OoxmlPart) => [...deepParagraphOrderOfPart(part).entries()];

test('deep paragraph order over nodes without an entry equals a fresh read across edits', () => {
  let part = document(
    `<w:p>${run('edited')}</w:p>` +
      '<w:p><w:proofErr w:type="spellStart"/></w:p>' +
      '<w:p/>' +
      table +
      `<w:p><w:r><w:t>plain</w:t></w:r></w:p>`
  );
  const [edited, proofed, empty] = bodyOf(part).children as OoxmlElement[];
  expect(keepsSubtreeMemo(proofed!)).toBe(false);
  expect(keepsSubtreeMemo(empty!)).toBe(false);
  const plainRun = (bodyOf(part).children[4] as OoxmlElement).children[0]!;
  expect(keepsSubtreeMemo(plainRun)).toBe(false);
  for (const [offset, text] of ['x', 'y', 'z'].entries()) {
    const memoized = order(part);
    expect(memoized).toEqual(order(structuredClone(part)));
    // Four body paragraphs and two cell paragraphs, in document order.
    expect(memoized).toHaveLength(6);
    const edit = applyTreeOp(part, { op: 'insertText', paragraphId: edited!.id, offset, text });
    if (!edit.ok) throw Error(edit.reason);
    part = edit.part;
  }
  expect(bodyOf(part).children[1]).toBe(proofed);
  expect(order(part)).toEqual(order(structuredClone(part)));
});

test('deep paragraph order keeps its depth bound', () => {
  const nest = (levels: number) =>
    document('<w:customXml>'.repeat(levels) + '<w:p/>' + '</w:customXml>'.repeat(levels));
  // The paragraph sits at depth levels + 2 under the root; the limit is 64.
  expect(order(nest(62))).toHaveLength(1);
  expect(order(nest(63))).toHaveLength(0);
});

test('deep paragraph order after splits equals a fresh read, text box paragraphs included', () => {
  const textBox =
    '<w:r><w:pict><w:txbxContent><w:p>' +
    run('inner one') +
    '</w:p><w:p>' +
    run('inner two') +
    '</w:p></w:txbxContent></w:pict></w:r>';
  let part = document(
    `<w:p>${run('first')}</w:p>` + `<w:p>${run('holder')}${textBox}</w:p>` + table + '<w:p/>'
  );
  // Three body paragraphs, two text box paragraphs, two cell paragraphs.
  expect(order(part)).toHaveLength(7);
  for (const index of [0, 2, 0]) {
    const paragraphId = (bodyOf(part).children[index] as OoxmlElement).id;
    const edit = applyTreeOp(part, { op: 'splitParagraph', paragraphId, offset: 2 });
    if (!edit.ok) throw Error(edit.reason);
    part = edit.part;
    expect(order(part)).toEqual(order(structuredClone(part)));
  }
  expect(order(part)).toHaveLength(10);
});
