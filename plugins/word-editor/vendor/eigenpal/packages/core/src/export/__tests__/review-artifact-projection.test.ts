import { expect, test } from 'bun:test';
import { assignOpaqueReviewIds } from '../review-artifact-projection.ts';

test('opaque review ids resolve forced digest collisions deterministically', () => {
  const collide = (): string => 'comment_collision';
  const forward = assignOpaqueReviewIds('comment', ['second', 'first'], collide);
  const reverse = assignOpaqueReviewIds('comment', ['first', 'second'], collide);

  expect(forward).toEqual(reverse);
  expect(forward.get('first')).toBe('comment_collision_0');
  expect(forward.get('second')).toBe('comment_collision_1');
  expect(new Set(forward.values()).size).toBe(2);
});
