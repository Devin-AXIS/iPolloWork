import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement, type OoxmlPart } from '@docx-editor.dev/core/store';
import { keepsSubtreeMemo } from '../../store/package/subtree-memo-policy.ts';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { storyCarriesCommentAnchor } from '../story-text-reads.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function load(body: string): OoxmlPart {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw Error(read.reason);
  return read.part;
}
const bodyOf = (part: OoxmlPart) =>
  part.root.children.find((node) => node.kind === 'body') as OoxmlElement;
const ANCHORED = '<w:p><w:r><w:commentReference w:id="0"/></w:r></w:p>';

test('an anchor in a run without an entry is still found after edits elsewhere', () => {
  let part = load(`<w:p><w:r><w:t>text</w:t></w:r></w:p>${ANCHORED}`);
  const [edited, anchored] = bodyOf(part).children as OoxmlElement[];
  const run = anchored!.children[0] as OoxmlElement;
  expect(keepsSubtreeMemo(run)).toBe(false);
  expect(keepsSubtreeMemo(anchored!)).toBe(true);
  for (const [offset, text] of ['a', 'b'].entries()) {
    expect(storyCarriesCommentAnchor(part.root)).toBe(true);
    expect(storyCarriesCommentAnchor(structuredClone(part).root)).toBe(true);
    const edit = applyTreeOp(part, { op: 'insertText', paragraphId: edited!.id, offset, text });
    if (!edit.ok) throw Error(edit.reason);
    part = edit.part;
  }
  expect(bodyOf(part).children[1]).toBe(anchored);
  expect(storyCarriesCommentAnchor(part.root)).toBe(true);
  expect(storyCarriesCommentAnchor(load('<w:p><w:r><w:t>none</w:t></w:r></w:p>').root)).toBe(false);
});

test('the anchor walk keeps its depth bound', () => {
  const nest = (levels: number) =>
    load('<w:customXml>'.repeat(levels) + ANCHORED + '</w:customXml>'.repeat(levels));
  // The run that holds the reference is walked at depth levels + 3; the limit is 64.
  expect(storyCarriesCommentAnchor(nest(61).root)).toBe(true);
  expect(storyCarriesCommentAnchor(nest(62).root)).toBe(false);
});
