import { describe, expect, test } from 'bun:test';
import {
  createReviewAuthorCommands,
  createRevisionAuthorVisibility,
} from '../revision-author-visibility.ts';

describe('detached review author commands', () => {
  test('hide all keeps known hidden authors when no reviewer roster exists', () => {
    const visibility = createRevisionAuthorVisibility(['Ada']);
    let notifications = 0;
    const commands = createReviewAuthorCommands(visibility, {
      enabled: true,
      surface: () => null,
      notify: () => {
        notifications += 1;
      },
    });

    commands.setAllReviewAuthorsVisible(false);
    expect([...visibility.hiddenAuthors]).toEqual(['Ada']);
    expect((visibility.hiddenAuthors as unknown as { add?: unknown }).add).toBeUndefined();
    expect(notifications).toBe(0);

    commands.showAllReviewAuthors();
    expect(visibility.hiddenAuthors.size).toBe(0);
    expect((visibility.hiddenAuthors as unknown as { add?: unknown }).add).toBeUndefined();
    expect(notifications).toBe(1);
  });
});
