// `@w:initials` comes from the file with no length limit; the avatar and the margin marker
// show at most three characters of it.
import { expect, test } from 'bun:test';
import { commentInitials } from '../store/review-text.ts';
import type { CommentRecord } from '../store/comment-reads.ts';

const record = (author: string, initials?: string) =>
  ({ author, ...(initials === undefined ? {} : { initials }) }) as unknown as CommentRecord;

test('declared initials are cut to three characters', () => {
  expect(commentInitials(record('Ada Lovelace', 'ABCDEFGHIJ'))).toBe('ABC');
  expect(commentInitials(record('Ada Lovelace', '  AL  '))).toBe('AL');
});

test('a surrogate pair counts as one character and is never split', () => {
  expect(commentInitials(record('Ada', '\u{1F600}\u{1F601}\u{1F602}\u{1F603}'))).toBe(
    '\u{1F600}\u{1F601}\u{1F602}'
  );
});

test('blank initials fall back to the author name', () => {
  expect(commentInitials(record('Ada Lovelace', '   '))).toBe('AL');
  expect(commentInitials(record('   '))).toBe('?');
});
