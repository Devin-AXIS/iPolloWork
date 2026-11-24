import { describe, expect, test } from 'bun:test';
import type { ReviewItem } from '../../layout/index.ts';
import { reviewReplyRefusal } from '../review-reply.ts';

describe('review reply admission', () => {
  test('refuses a reply to a resolved comment', () => {
    const resolved = { kind: 'comment', resolved: true } as unknown as ReviewItem;
    expect(reviewReplyRefusal(resolved, 'Too late.', 'Ada')).toEqual({
      ok: false,
      code: 'unsupported',
      reason: 'a resolved comment takes no replies',
    });
  });
});
