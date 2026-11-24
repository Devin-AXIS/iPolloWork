// `reviewItemsAtSelection`: the items a range selection is in.
//
// The caret rule counts both ends of a range, which is right for a caret and wrong for a range
// selection. A selection whose head sits on an item's boundary, with none of the item's
// characters selected, must not open that item.

import { describe, expect, test } from 'bun:test';
import {
  reviewItemsAtSelection,
  type ReviewItem,
  type ReviewRange,
} from '../store/review-items.ts';

const PART = 'word/document.xml';
const ORDER: ReadonlyMap<string, number> = new Map([
  ['p1', 0],
  ['p2', 1],
]);

function range(
  start: number,
  end: number,
  paragraphId = 'p1',
  endParagraphId = paragraphId
): ReviewRange {
  return {
    partName: PART,
    start: { paragraphId, offset: start },
    end: { paragraphId: endParagraphId, offset: end },
  };
}

function revision(id: string, ...ranges: ReviewRange[]): ReviewItem {
  return {
    kind: 'revision',
    id,
    address: { id, author: 'A' },
    addresses: [{ id, author: 'A' }],
    replacedText: '',
    revisionKind: 'insert',
    author: 'A',
    text: 'x',
    ranges,
    nesting: 0,
    readOnly: false,
    replyIds: [],
  };
}

function comment(id: string, anchor: ReviewRange): ReviewItem {
  return {
    kind: 'comment',
    id,
    comment: { id, author: 'A', blocks: [] },
    range: anchor,
    resolved: false,
    replyIds: [],
    orphaned: false,
  };
}

function idsAt(
  items: readonly ReviewItem[],
  anchor: number,
  head: number,
  anchorParagraph = 'p1',
  headParagraph = anchorParagraph
): string[] {
  return reviewItemsAtSelection(
    items,
    { paragraphId: anchorParagraph, offset: anchor },
    { paragraphId: headParagraph, offset: head },
    ORDER
  ).map((item) => item.id);
}

describe('items a selection is in', () => {
  const before = revision('before', range(0, 5));
  const after = revision('after', range(10, 15));

  test('a collapsed selection keeps the caret rule at both ends', () => {
    expect(idsAt([before, after], 5, 5)).toEqual(['before']);
    expect(idsAt([before, after], 10, 10)).toEqual(['after']);
  });

  test('a head on a neighbour boundary opens nothing', () => {
    expect(idsAt([before, after], 5, 10)).toEqual([]);
    expect(idsAt([before, after], 10, 5)).toEqual([]);
  });

  test('a head that holds selected characters of the item opens it', () => {
    expect(idsAt([before, after], 7, 11)).toEqual(['after']);
    expect(idsAt([before, after], 7, 4)).toEqual(['before']);
    expect(idsAt([before, after], 12, 15)).toEqual(['after']);
    expect(idsAt([before, after], 3, 0)).toEqual(['before']);
  });

  test('a comment beside the selection does not open', () => {
    const note = comment('c1', range(10, 15));
    expect(idsAt([note], 6, 10)).toEqual([]);
    expect(idsAt([note], 6, 11)).toEqual(['c1']);
  });

  test('a point anchor counts only when the selection includes its position', () => {
    // A tracked paragraph mark sits at the paragraph end and decorates the break after it.
    const mark = revision('mark', range(20, 20));
    expect(idsAt([mark], 15, 20)).toEqual([]);
    expect(idsAt([mark], 0, 20, 'p2', 'p1')).toEqual(['mark']);
    expect(idsAt([mark], 20, 20)).toEqual(['mark']);
  });

  test('a range across paragraphs compares by paragraph order first', () => {
    const spanning = revision('spanning', range(8, 3, 'p1', 'p2'));
    expect(idsAt([spanning], 3, 6, 'p2')).toEqual([]);
    expect(idsAt([spanning], 2, 8, 'p1')).toEqual([]);
    expect(idsAt([spanning], 6, 2, 'p2')).toEqual(['spanning']);
    expect(idsAt([spanning], 2, 9, 'p1')).toEqual(['spanning']);
  });
});
