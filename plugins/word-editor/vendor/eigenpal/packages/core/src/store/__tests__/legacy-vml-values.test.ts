import { expect, test } from 'bun:test';
import { color } from '../package/legacy-vml-values.ts';

test('parses supported VML colors and optional palette indices', () => {
  for (const [input, expected] of [
    ['black', '#000000'],
    ['WHITE', '#ffffff'],
    ['Red', '#ff0000'],
    ['blue', '#0000ff'],
    ['green', '#008000'],
    ['yellow', '#ffff00'],
    ['Silver', '#c0c0c0'],
    ['#Ab12Ef', '#ab12ef'],
    ['#3A9', '#33aa99'],
  ]) {
    expect(color(input, '')).toBe(expected);
    for (const whitespace of [' ', '\t', '\r\n', '\u00a0', ' \t\n\uFEFF']) {
      expect(color(`${input}${whitespace}[00123]`, '')).toBe(expected);
    }
  }
  expect(color(undefined, 'RED [1]')).toBe('#ff0000');
  expect(color('', 'red')).toBeNull();
});

test('rejects unsupported colors and malformed palette suffixes', () => {
  for (const input of [
    'window',
    '#abcd',
    '#ab',
    ' red',
    'red ',
    ' red [1]',
    'red[1]',
    'red []',
    'red [-1]',
    'red [1.5]',
    'red [1',
    'red [1]x',
    'red [1] ',
    'red [1]\n',
    'red [1] [2]',
    'red blue [1]',
    ' [1]',
  ]) {
    expect(color(input, 'red')).toBeNull();
  }
});

test('handles long whitespace runs and malformed indices without excessive backtracking', () => {
  const whitespace = '\t'.repeat(100_000);
  expect(color(`red${whitespace}`, '')).toBeNull();
  expect(color(`red${whitespace}!`, '')).toBeNull();
  expect(color(`red${whitespace}[123`, '')).toBeNull();
  expect(color(`red${whitespace}[123]`, '')).toBe('#ff0000');
  expect(color(whitespace, '')).toBeNull();
  expect(color(undefined, `red${whitespace}!`)).toBeNull();
  expect(color(`red [${'1'.repeat(100_000)}!`, '')).toBeNull();
});
