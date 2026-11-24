// How `reviewItemsAt` orders items that all cover one position.
//
// Width alone was the order, and width is the wrong question at a boundary. Both ends of a range
// count as covered — a caret resting past a range's last character is visually still on that
// character, and requiring it to be strictly inside makes the last character feel dead — but a
// range that merely ENDS at the caret then beat the range the caret is properly inside whenever
// the toucher was narrower. Tracked edits meet end-to-start by construction, so that was the
// common case, not a corner: a one-character insertion claimed every click on the six-character
// one beside it.

import { describe, expect, test } from 'bun:test';
import { reviewItemsAt, type ReviewItem, type ReviewRange } from '../review-support.ts';

const PART = 'word/document.xml';
const P1 = 'p1';
const P2 = 'p2';
const ORDER: ReadonlyMap<string, number> = new Map([
  [P1, 0],
  [P2, 1],
]);

function range(
  start: number,
  end: number,
  paragraphId = P1,
  endParagraphId = paragraphId
): ReviewRange {
  return {
    partName: PART,
    start: { paragraphId, offset: start },
    end: { paragraphId: endParagraphId, offset: end },
  };
}

function revision(id: string, ...ranges: ReviewRange[]): ReviewItem {
  return nested(id, 0, ...ranges);
}

function nested(id: string, nesting: number, ...ranges: ReviewRange[]): ReviewItem {
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
    nesting,
    readOnly: false,
    replyIds: [],
  };
}

function keysAt(items: readonly ReviewItem[], offset: number, paragraphId = P1): string[] {
  return reviewItemsAt(items, { paragraphId, offset }, ORDER).map((item) => item.id);
}

describe('ordering items that cover one position', () => {
  test('a range holding the caret inside beats a narrower one that only ends there', () => {
    const toucher = revision('toucher', range(29, 30));
    const container = revision('container', range(30, 36));
    // Both cover offset 30. The toucher is one character wide against six.
    expect(keysAt([toucher, container], 30)).toEqual(['container', 'toucher']);
    // Order of the input must not decide it.
    expect(keysAt([container, toucher], 30)).toEqual(['container', 'toucher']);
  });

  test('the narrower container still wins between two that both hold the caret', () => {
    const wide = revision('wide', range(0, 100));
    const narrow = revision('narrow', range(28, 34));
    expect(keysAt([wide, narrow], 30)).toEqual(['narrow', 'wide']);
  });

  test('a range covering no characters ranks FIRST at its own offset', () => {
    // A zero-width range is a deliberate point anchor. The store anchors a tracked paragraph
    // mark at the paragraph end for exactly this reason, so that the card of a tracked Enter
    // opens when the caret is at the break that made it. Ranking it behind a toucher took the
    // only caret position that can reach that card away from it.
    const mark = revision('mark', range(30, 30));
    const container = revision('container', range(30, 36));
    const toucher = revision('toucher', range(24, 30));
    expect(keysAt([container, mark], 30)).toEqual(['mark', 'container']);
    expect(keysAt([toucher, mark], 30)).toEqual(['mark', 'toucher']);
  });

  test('a point comment is not shadowed by the revision around it', () => {
    // The kind rank says a comment outranks everything at equal width, because it is a
    // question waiting on the reader. A zero-width anchor used to win on width 0; grip has to
    // keep it winning, or clicking the marker opens the revision it sits in.
    const comment: ReviewItem = {
      kind: 'comment',
      id: 'c1',
      comment: { id: 'c1', author: 'A', blocks: [] },
      range: range(5, 5),
      resolved: false,
      replyIds: [],
      orphaned: false,
    };
    const around = revision('around', range(0, 9));
    expect(keysAt([around, comment], 5)).toEqual(['c1', 'around']);
  });

  test('the caret at a range start is inside it, not merely touching', () => {
    const before = revision('before', range(20, 30));
    const at = revision('at', range(30, 40));
    // `before` is ten characters wide and `at` is ten too, so width cannot separate them:
    // only the grip says the caret is inside `at` and merely at the end of `before`.
    expect(keysAt([before, at], 30)).toEqual(['at', 'before']);
  });

  test('a caret at a boundary still activates when nothing else covers it', () => {
    // The spec's own boundary scenario: both sides of the caret count, so a range entirely
    // before the caret still activates. Demoting a toucher must not mean dropping it.
    const toucher = revision('toucher', range(20, 30));
    expect(keysAt([toucher], 30)).toEqual(['toucher']);
  });

  test('a card reports its HARDEST grip, not its first range', () => {
    // A replacement's two halves meet at the caret: the first range ends at 30 and the second
    // starts there. Asking only the first range read the card as a toucher and lost it to a
    // neighbour it should have outranked.
    const replacement = revision('replacement', range(20, 30), range(30, 40));
    const toucher = revision('toucher', range(29, 30));
    expect(keysAt([replacement, toucher], 30)).toEqual(['replacement', 'toucher']);
  });

  test('a cross-paragraph range holds a caret in its interior paragraph', () => {
    const spanning = revision('spanning', range(5, 5, P1, P2));
    expect(keysAt([spanning], 0, P2)).toEqual(['spanning']);
    // Past its end in the last paragraph is uncovered, as before.
    expect(keysAt([spanning], 6, P2)).toEqual([]);
  });

  test('an item whose paragraph the order does not know covers nothing', () => {
    const unknown = revision('unknown', range(0, 10, 'gone'));
    expect(keysAt([unknown], 5, P1)).toEqual([]);
  });

  test('two changes on ONE identical span order innermost first', () => {
    // `w:ins` wrapping `w:del`: identical ranges, so grip, width and kind all tie. Word reads
    // the innermost as the operative change, and it is the one striking the text on the page.
    const wrapper = nested('wrapper', 0, range(30, 36));
    const inner = nested('inner', 1, range(30, 36));
    // Both input orders, because the whole defect was that the tree walk's order decided it.
    expect(keysAt([wrapper, inner], 33)).toEqual(['inner', 'wrapper']);
    expect(keysAt([inner, wrapper], 33)).toEqual(['inner', 'wrapper']);
    // The wrapper stays listed and reachable — the stack is what a surface cycles through.
    expect(keysAt([wrapper, inner], 30)).toHaveLength(2);
  });

  test('nesting never outranks a tighter range or a comment', () => {
    // Depth is the LAST word, not the first: a change nested three deep must not steal the
    // caret from a shallower change whose range actually holds it more tightly.
    const deepWide = nested('deepWide', 3, range(0, 100));
    const shallowTight = nested('shallowTight', 0, range(28, 34));
    expect(keysAt([deepWide, shallowTight], 30)).toEqual(['shallowTight', 'deepWide']);
  });
});
