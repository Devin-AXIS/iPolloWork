// A review card's placement is reused while its item and every input it shows stay the same.

import { describe, expect, test } from 'bun:test';
import type { ReviewItem } from '../../layout/index.ts';
import { reviewItemPlacement, type ReviewPlacementInputs } from '../review-placement-cache.ts';

const item = {
  kind: 'revision',
  id: 'insert-/word/document.xml\u00001\u0000Ada\u0000',
  address: { id: '1', author: 'Ada' },
  addresses: [{ id: '1', author: 'Ada' }],
  revisionKind: 'insert',
  author: 'Ada Lovelace',
  text: 'new­text',
  replacedText: '',
  ranges: [],
  nesting: 0,
  readOnly: false,
  replyIds: [],
} as unknown as ReviewItem;

const inputs: ReviewPlacementInputs = {
  anchorY: 120,
  pageIndex: 3,
  activatable: true,
  isActive: false,
  locked: false,
};

describe('reviewItemPlacement', () => {
  test('the same item and inputs give the same placement object', () => {
    const first = reviewItemPlacement(item, inputs);
    expect(reviewItemPlacement(item, { ...inputs })).toBe(first);
    expect(first).toMatchObject({
      kind: 'revision',
      author: 'Ada Lovelace',
      initials: 'AL',
      anchorY: 120,
      pageIndex: 3,
      isActive: false,
      readOnly: false,
      item,
    });
  });

  test('any changed input builds a new placement that shows it', () => {
    const first = reviewItemPlacement(item, inputs);
    const active = reviewItemPlacement(item, { ...inputs, isActive: true });
    expect(active).not.toBe(first);
    expect(active.isActive).toBe(true);
    const moved = reviewItemPlacement(item, { ...inputs, isActive: true, anchorY: 140 });
    expect(moved.anchorY).toBe(140);
    const locked = reviewItemPlacement(item, {
      ...inputs,
      isActive: true,
      anchorY: 140,
      locked: true,
    });
    expect(locked.readOnly).toBe(true);
    expect(reviewItemPlacement(item, inputs)).not.toBe(locked);
  });

  test('reads with and without geometry do not evict each other', () => {
    const fresh = { ...item } as ReviewItem;
    const unplaced = { ...inputs, anchorY: null, pageIndex: null };
    const placed = reviewItemPlacement(fresh, inputs);
    const bare = reviewItemPlacement(fresh, unplaced);
    expect(bare.anchorY).toBeNull();
    expect(reviewItemPlacement(fresh, inputs)).toBe(placed);
    expect(reviewItemPlacement(fresh, unplaced)).toBe(bare);
  });
});
