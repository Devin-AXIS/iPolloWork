import { expect, test } from 'bun:test';
import { ReviewAnchorIndex } from '../review-anchor-index.ts';
import type { ReviewParagraphAnchor } from '../../layout/review-support.ts';

const anchor = (n: number): ReviewParagraphAnchor => ({ pageIndex: n, contentY: n, fragmentY: n });

test('block updates retain map order and never change earlier indexes', () => {
  const source = new Map(Array.from({ length: 150 }, (_, n) => [`p${n}`, anchor(n)] as const));
  const first = ReviewAnchorIndex.from(source);
  const changes = new Map([0, 63, 64, 127, 149].map((n) => [`p${n}`, anchor(n + 1000)] as const));
  const second = first.updated(changes);
  const expected = new Map(source);
  for (const [id, value] of changes) expected.set(id, value);
  expect([...first]).toEqual([...source]);
  expect([...second]).toEqual([...expected]);
  expect([...second.keys()]).toEqual([...expected.keys()]);
  expect([...second.values()]).toEqual([...expected.values()]);
  expect(second.size).toBe(150);
  expect(second.get('missing')).toBeUndefined();
  expect(second.has('missing')).toBe(false);
  expect(second.has('p64')).toBe(true);
  expect(second.get('p65')).toBe(first.get('p65'));
  expect(second.updated(changes)).toBe(second);
  expect(second.updated(new Map())).toBe(second);
  const seen: [string, ReviewParagraphAnchor][] = [];
  const receiver = {};
  second.forEach(function (this: object, value, key, map) {
    expect(this).toBe(receiver);
    expect(map).toBe(second);
    seen.push([key, value]);
  }, receiver);
  expect(seen).toEqual([...expected]);
  expect(() => second.updated(new Map([['missing', anchor(1)]]))).toThrow();
});
