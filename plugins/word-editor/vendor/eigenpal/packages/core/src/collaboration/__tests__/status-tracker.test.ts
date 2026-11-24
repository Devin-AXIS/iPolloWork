import { describe, expect, test } from 'bun:test';
import { createCollaborationStatusTracker, isCollaborationFailureCode } from '../failure.ts';

describe('collaboration status tracker', () => {
  test('a recovered error keeps lastFailure for a later reader', () => {
    const tracker = createCollaborationStatusTracker('ready');
    expect(tracker.set('error', 'unknown-logical-id', 'no-such-node')).toBe(true);
    expect(tracker.set('ready')).toBe(true);

    const snapshot = tracker.snapshot();
    expect(snapshot.status).toBe('ready');
    expect(snapshot.reason).toBeUndefined();
    expect(snapshot.lastFailure).toEqual({
      code: 'unknown-logical-id',
      detail: 'no-such-node',
    });
    expect(tracker.snapshot()).toBe(snapshot);
  });

  test('isCollaborationFailureCode names only enumerated members', () => {
    expect(isCollaborationFailureCode('document-id-mismatch')).toBe(true);
    expect(isCollaborationFailureCode('offline')).toBe(false);
  });
});
