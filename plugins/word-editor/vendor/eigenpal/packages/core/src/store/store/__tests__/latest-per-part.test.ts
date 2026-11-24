import { expect, test } from 'bun:test';
import { setLatestPerPart } from '../latest-per-part.ts';

test('the map keeps the most recently written part names only', () => {
  const map = new Map<string, number>();
  for (let index = 0; index < 10; index += 1) setLatestPerPart(map, `part${index}`, index, 4);
  expect([...map.keys()]).toEqual(['part6', 'part7', 'part8', 'part9']);
  setLatestPerPart(map, 'part6', 60, 4);
  setLatestPerPart(map, 'new', 1, 4);
  expect([...map.keys()]).toEqual(['part8', 'part9', 'part6', 'new']);
  expect(map.get('part6')).toBe(60);
});
