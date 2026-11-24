// Author colours are session state, not a fresh ranking after every edit.
//
// A commenter starts outside the layout author scan. If that person later types a tracked
// change before existing revisions, a cold scan ranks them first. The attached editor must
// retain the colour its review cards already taught the reader.

import { describe, expect, test } from 'bun:test';
import type { SemanticLayout } from '../../layout/semantic-records.ts';
import { createStableReviewAuthorSlots, revisionStyleContextOf } from '../revision-presentation.ts';

const REVISION_AUTHORS = new Map([
  ['Ada', 0],
  ['Bea', 1],
  ['Cora', 2],
]);

describe('stable review author slots', () => {
  test('keeps a commenter’s slot when they become the first revision author', () => {
    const session = createStableReviewAuthorSlots();
    const before = session.resolve(REVISION_AUTHORS, ['Demo Reviewer']);
    expect(before.get('Demo Reviewer')).toBe(3);

    const after = session.resolve(
      new Map([
        ['Demo Reviewer', 0],
        ['Ada', 1],
        ['Bea', 2],
        ['Cora', 3],
      ]),
      ['Demo Reviewer']
    );
    expect(after).toEqual(before);
  });

  test('reserves a deleted author’s slot for undo and resets with another session', () => {
    const session = createStableReviewAuthorSlots();
    session.resolve(REVISION_AUTHORS, ['Demo Reviewer']);

    const deleted = session.resolve(REVISION_AUTHORS, []);
    expect(deleted.has('Demo Reviewer')).toBe(false);

    const restored = session.resolve(
      new Map([
        ['Demo Reviewer', 0],
        ['Ada', 1],
        ['Bea', 2],
        ['Cora', 3],
      ]),
      ['Demo Reviewer']
    );
    expect(restored.get('Demo Reviewer')).toBe(3);

    const otherDocument = createStableReviewAuthorSlots().resolve(
      new Map([['Demo Reviewer', 0]]),
      []
    );
    expect(otherDocument.get('Demo Reviewer')).toBe(0);
  });

  test('hands the stable assignment to tracked-text presentation', () => {
    const slots = createStableReviewAuthorSlots().resolve(REVISION_AUTHORS, ['Demo Reviewer']);
    const layout = { pages: [] } as unknown as SemanticLayout;
    expect(revisionStyleContextOf('author', layout, slots)?.authorSlots).toBe(slots);
  });
});
