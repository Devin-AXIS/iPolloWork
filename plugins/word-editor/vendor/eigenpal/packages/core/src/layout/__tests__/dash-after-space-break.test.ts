import { expect, test } from 'bun:test';
import { wordBoundaries } from '../cjk-line-break.ts';

const words = (text: string) => {
  const out: string[] = [];
  let start = 0;
  for (const end of wordBoundaries(text, true)) {
    out.push(text.slice(start, end));
    start = end;
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
};

test('a dash after a space stays with its Latin word', () => {
  expect(words('alpha -beta')).toEqual(['alpha ', '-beta']);
});

test('a dash after a space may end the line before a right-to-left word', () => {
  expect(words('مرحبا -بالعالم')).toEqual(['مرحبا ', '-', 'بالعالم']);
  expect(words('שלום -עולם')).toEqual(['שלום ', '-', 'עולם']);
});

test('a dash inside a word still breaks after it', () => {
  expect(words('alpha-beta')).toEqual(['alpha-', 'beta']);
});
