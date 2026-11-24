// The rail reads its queue with placement and the commands read it without. The two reads take
// turns after every commit, so each keeps its own rank and placement list.

import { describe, expect, test } from 'bun:test';
import type { ReviewItem, ReviewParagraphAnchor } from '../../layout/index.ts';
import { createPlacementKeeper, createReviewRanker } from '../review-ranking.ts';

const items = [
  { kind: 'comment', id: 'a' },
  { kind: 'comment', id: 'b' },
] as unknown as ReviewItem[];
const anchors = new Map<string, ReviewParagraphAnchor>();

describe('review ranking', () => {
  test('a placed and an unplaced read of one queue keep separate ranks', () => {
    const rank = createReviewRanker();
    const placed = rank(items, anchors, 1, () => 1);
    const unplaced = rank(items, null, 1, () => 1);
    expect(unplaced).not.toBe(placed);
    expect(rank(items, anchors, 1, () => 1)).toBe(placed);
    expect(rank(items, null, 1, () => 1)).toBe(unplaced);
  });

  test('a placed and an unplaced read of one queue keep separate placement lists', () => {
    const keep = createPlacementKeeper<{ readonly id: string }>();
    const first = { id: 'a' };
    const second = { id: 'b' };
    const placed = keep(items, true, [first]);
    const unplaced = keep(items, false, [second]);
    expect(keep(items, true, [first])).toBe(placed);
    expect(keep(items, false, [second])).toBe(unplaced);
  });
});
