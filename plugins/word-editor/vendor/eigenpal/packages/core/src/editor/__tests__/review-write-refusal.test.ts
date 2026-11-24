// `reviewWriteRefusal` turns the reason `commitReviewOps` returned into a review command's answer.

import { describe, expect, test } from 'bun:test';
import { reviewWriteRefusal } from '../review-write-refusal.ts';
import { REFRESH_WRITE_REFUSAL } from '../refresh-write-guard.ts';
import { READ_ONLY_PROTECTION_REASON } from '../opening-editing-mode.ts';

describe('reviewWriteRefusal', () => {
  test('a decision a lock or a binding keeps gets the exec code an edit there gets', () => {
    // Such as the locked half of a move, which the planner adds to the card's decision.
    const locked = 'locked-content: the change stays pending';
    const bound = 'bound-content: the change stays pending';
    expect(reviewWriteRefusal(locked, 'x')).toEqual({ ok: false, code: 'locked', reason: locked });
    expect(reviewWriteRefusal(bound, 'x')).toEqual({ ok: false, code: 'bound', reason: bound });
  });

  test('a write that refused without a reason keeps the fallback and its code', () => {
    expect(reviewWriteRefusal(null, 'the reply could not be committed')).toEqual({
      ok: false,
      code: 'unsupported',
      reason: 'the reply could not be committed',
    });
    expect(reviewWriteRefusal('rejected', 'not resolved', 'notFound')).toEqual({
      ok: false,
      code: 'notFound',
      reason: 'not resolved',
    });
  });

  test('viewing and protection refusals answer locked with their own reason', () => {
    expect(reviewWriteRefusal('the document is open for viewing', 'x')).toEqual({
      ok: false,
      code: 'locked',
      reason: 'the document is open for viewing',
    });
    expect(reviewWriteRefusal(READ_ONLY_PROTECTION_REASON, 'x').code).toBe('locked');
  });

  test('a refresh or collaboration refusal names itself', () => {
    expect(reviewWriteRefusal(REFRESH_WRITE_REFUSAL, 'x')).toEqual({
      ok: false,
      code: 'unsupported',
      reason: REFRESH_WRITE_REFUSAL,
    });
    expect(reviewWriteRefusal('collaboration-session-not-ready', 'x').reason).toBe(
      'collaboration-session-not-ready'
    );
  });
});
