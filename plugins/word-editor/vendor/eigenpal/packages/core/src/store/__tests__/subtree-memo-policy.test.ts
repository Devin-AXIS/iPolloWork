import { expect, test } from 'bun:test';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { keepsSubtreeMemo, WIDE_SUBTREE_CHILDREN } from '../package/subtree-memo-policy.ts';
import { usedParaIds } from '../package/para-id.ts';
import { ordinaryMoveRanges } from '../store/revision-move-ranges.ts';
import { applyTreeOp } from '../store/tree-ops.ts';
import { loadPart, W, W14 } from './random-edit-test-support.ts';

const document = (body: string): OoxmlPart =>
  loadPart(`<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}</w:body></w:document>`);
const bodyOf = (part: OoxmlPart) =>
  part.root.children.find((node) => node.kind === 'body') as OoxmlElement;
const element = (node: OoxmlNode | undefined) => node as OoxmlElement;

test('only wide nodes and nodes with an element below their children keep an entry', () => {
  const leaves = '<w:b/>'.repeat(WIDE_SUBTREE_CHILDREN - 1);
  const part = document(
    `<w:p><w:r><w:rPr>${leaves}</w:rPr><w:t>x</w:t></w:r></w:p>` +
      `<w:p><w:r><w:rPr>${leaves}<w:i/></w:rPr></w:r></w:p>`
  );
  const [narrow, wide] = bodyOf(part).children.map(element);
  const run = element(narrow!.children[0]);
  const properties = element(run.children[0]);
  const text = element(run.children[1]);
  expect(keepsSubtreeMemo(text.children[0]!)).toBe(false);
  expect(keepsSubtreeMemo(text)).toBe(false);
  // A wide text-only child also bounds the policy scan for generic trees.
  const wideText = {
    ...text,
    children: Array.from({ length: WIDE_SUBTREE_CHILDREN }, () => text.children[0]!),
  };
  expect(keepsSubtreeMemo({ ...run, children: [wideText] })).toBe(true);
  expect(keepsSubtreeMemo(properties)).toBe(false);
  expect(keepsSubtreeMemo(run)).toBe(true);
  expect(keepsSubtreeMemo(narrow!)).toBe(true);
  expect(keepsSubtreeMemo(element(element(wide!.children[0]).children[0]))).toBe(true);
});

const MOVE =
  '<w:moveFromRangeStart w:id="7" w:name="move" w:author="A"/><w:moveFromRangeEnd w:id="7"/>';
const para = (id: string, inner: string) => `<w:p w14:paraId="${id}">${inner}</w:p>`;

test('answers over nodes without an entry stay equal to a fresh read across edits', () => {
  // The move range and two of the ids sit in paragraphs of leaves only, which keep no entry.
  let part = document(
    para('1A000001', '<w:r><w:t>first</w:t></w:r>') +
      para('1A000002', MOVE) +
      para('1A000003', '<w:proofErr w:type="spellStart"/>')
  );
  const [edited, moved, proofed] = bodyOf(part).children.map(element);
  expect(keepsSubtreeMemo(moved!)).toBe(false);
  expect(keepsSubtreeMemo(proofed!)).toBe(false);
  const fresh = (current: OoxmlPart) => {
    const clone = structuredClone(current);
    return {
      ids: [...usedParaIds(clone.root)].sort(),
      moves: ordinaryMoveRanges(clone.root).map((range) => [range.start.id, range.supported]),
    };
  };
  for (const [offset, text] of ['a', 'b', 'c'].entries()) {
    const memoized = {
      ids: [...usedParaIds(part.root)].sort(),
      moves: ordinaryMoveRanges(part.root).map((range) => [range.start.id, range.supported]),
    };
    expect(memoized).toEqual(fresh(part));
    expect(memoized.ids).toEqual(['1A000001', '1A000002', '1A000003']);
    expect(memoized.moves).toHaveLength(1);
    const edit = applyTreeOp(part, { op: 'insertText', paragraphId: edited!.id, offset, text });
    if (!edit.ok) throw Error(edit.reason);
    part = edit.part;
  }
  // The untouched paragraphs are shared with the edited tree, so the reads above reused them.
  const after = bodyOf(part).children.map(element);
  expect(after[1]).toBe(moved);
  expect(after[2]).toBe(proofed);
});
