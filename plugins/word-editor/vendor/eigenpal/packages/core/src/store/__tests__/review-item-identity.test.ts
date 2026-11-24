// A re-derived queue keeps the objects of the cards that did not change.

import { describe, expect, test } from 'bun:test';
import { withStableCards } from '../store/review-item-identity.ts';
import { registerRevisionSiteNodeIds, type ReviewRevisionItem } from '../store/review-items.ts';

function card(id: string, text: string, siteIds: readonly string[] = [id]): ReviewRevisionItem {
  return registerRevisionSiteNodeIds(
    {
      kind: 'revision',
      id,
      address: { id, author: 'Ada' },
      addresses: [{ id, author: 'Ada' }],
      revisionKind: 'insert',
      author: 'Ada',
      text,
      replacedText: '',
      ranges: [
        {
          partName: '/word/document.xml',
          start: { paragraphId: 'p', offset: 0 },
          end: { paragraphId: 'p', offset: text.length },
        },
      ],
      nesting: 0,
      readOnly: false,
      replyIds: [],
    } as ReviewRevisionItem,
    siteIds
  );
}

describe('withStableCards', () => {
  test('an equal card keeps its object; a changed one is the new object', () => {
    const part = '/word/stable-test-a.xml';
    const first = withStableCards(part, [card('1', 'a'), card('2', 'b')]);
    const changed = card('2', 'bb');
    const second = withStableCards(part, [card('1', 'a'), changed]);
    expect(second[0]).toBe(first[0]!);
    expect(second[1]).toBe(changed);
  });

  test('an unchanged queue in the same order is the same array', () => {
    const part = '/word/stable-test-b.xml';
    const first = withStableCards(part, [card('1', 'a'), card('2', 'b')]);
    expect(withStableCards(part, [card('1', 'a'), card('2', 'b')])).toBe(first);
    const reordered = withStableCards(part, [card('2', 'b'), card('1', 'a')]);
    expect(reordered).not.toBe(first);
    expect(reordered[0]).toBe(first[1]!);
  });

  test('different site nodes make a different card', () => {
    const part = '/word/stable-test-c.xml';
    const first = withStableCards(part, [card('1', 'a', ['n1'])]);
    const moved = withStableCards(part, [card('1', 'a', ['n2'])]);
    expect(moved[0]).not.toBe(first[0]!);
  });
});
