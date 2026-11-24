import { describe, expect, test } from 'bun:test';
import { withoutTrailingSpaces } from '../trailing-spaces.ts';

describe('withoutTrailingSpaces', () => {
  test('drops only trailing U+0020, like `/ +$/`', () => {
    expect(withoutTrailingSpaces('word   ')).toBe('word');
    expect(withoutTrailingSpaces('  a  b  ')).toBe('  a  b');
    expect(withoutTrailingSpaces('   ')).toBe('');
    expect(withoutTrailingSpaces('')).toBe('');
    // Tabs and no-break spaces are not U+0020, so they stay.
    expect(withoutTrailingSpaces('a\t')).toBe('a\t');
    expect(withoutTrailingSpaces(`a${String.fromCharCode(0xa0)} `)).toBe(
      `a${String.fromCharCode(0xa0)}`
    );
  });

  test('a long inner space run stays linear', () => {
    // `/ +$/` retried from every space of this run: 50k spaces took about 1.8 seconds, so
    // 200k would exceed the test timeout. The linear scan takes well under a millisecond.
    const text = `a${' '.repeat(200_000)}b `;
    expect(withoutTrailingSpaces(text)).toBe(text.slice(0, -1));
  });
});
