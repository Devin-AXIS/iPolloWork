// Comment anchors memoize the marker-carrying paragraphs per immutable node, so an anchor pass
// after an edit re-walks only the changed path. The oracle is the export path, which keeps a
// memo-free walk: after every edit the two must agree exactly.

import { describe, expect, test } from 'bun:test';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { readOoxmlPart } from '../package/ooxml-tree.ts';
import { commentAnchorsOfStory, commentAnchorsOfStoryTransient } from '../store/comment-reads.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function partOf(body: string): OoxmlPart {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

const plain = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const marked = (id: string, text: string) =>
  `<w:p><w:commentRangeStart w:id="${id}"/><w:r><w:t>${text}</w:t></w:r>` +
  `<w:commentRangeEnd w:id="${id}"/></w:p>`;
const openOnly = (id: string, text: string) =>
  `<w:p><w:commentRangeStart w:id="${id}"/><w:r><w:t>${text}</w:t></w:r></w:p>`;

const bodyOf = (part: OoxmlPart) => part.root.children[0] as OoxmlElement;

/** A copy-on-write edit: new root and body, every other node shared by reference. */
function withBodyChildren(part: OoxmlPart, children: readonly OoxmlNode[]): OoxmlPart {
  const body = { ...bodyOf(part), children };
  return { ...part, root: { ...part.root, children: [body] } as OoxmlElement };
}

function expectOracle(part: OoxmlPart): void {
  expect(commentAnchorsOfStory(part)).toEqual(commentAnchorsOfStoryTransient(part));
}

describe('memoized comment anchors', () => {
  test('agree with the memo-free walk across edits that share untouched paragraphs', () => {
    const original = partOf(
      plain('one') +
        marked('1', 'two') +
        `<w:tbl><w:tr><w:tc>${openOnly('2', 'cell')}</w:tc></w:tr></w:tbl>` +
        plain('three')
    );
    expectOracle(original);
    const [first, second, table, last] = bodyOf(original).children;
    const donor = bodyOf(partOf(marked('3', 'new') + plain('bare'))).children;

    // A marker appears in a paragraph that had none.
    const added = withBodyChildren(original, [donor[0]!, second!, table!, last!]);
    expectOracle(added);
    expect(commentAnchorsOfStory(added).map((anchor) => anchor.commentId)).toContain('3');

    // A paragraph loses its markers; the orphan in the table now runs to the new last marker.
    const removed = withBodyChildren(added, [donor[0]!, donor[1]!, table!, last!]);
    expectOracle(removed);
    expect(commentAnchorsOfStory(removed).map((anchor) => anchor.commentId)).not.toContain('1');

    // Paragraphs reorder around an unchanged, memoized table.
    const reordered = withBodyChildren(original, [table!, last!, first!, second!]);
    expectOracle(reordered);
  });
});
