// A block placed again with nothing changed keeps its painted element; any difference repaints.

import { describe, expect, test } from 'bun:test';
import type { BlockFragmentRecord } from '../../layout/semantic-records.ts';
import { equalBlockElement } from '../semantic-paint-block-reuse.ts';

const props = { styleId: 'Body' };

function fragment(id: string, y: number, text = 'word '): BlockFragmentRecord {
  return {
    kind: 'paragraph',
    id,
    paragraphId: id,
    props,
    box: { x: 0, y, width: 100, height: 12 },
    lines: [{ id: `${id}:0`, spans: [{ text, box: { x: 0, y: 0, width: 20, height: 12 } }] }],
  } as unknown as BlockFragmentRecord;
}

const element = (): HTMLElement => ({}) as HTMLElement;

describe('equalBlockElement', () => {
  test('an equal record of the same block keeps the element', () => {
    const painted = element();
    const previous = new Map([[fragment('p1', 10), painted]]);
    expect(equalBlockElement(previous, fragment('p1', 10), [])).toBe(painted);
  });

  test('a moved, changed or other block is repainted', () => {
    const previous = new Map([[fragment('p1', 10), element()]]);
    expect(equalBlockElement(previous, fragment('p1', 11), [])).toBeUndefined();
    expect(equalBlockElement(previous, fragment('p1', 10, 'other '), [])).toBeUndefined();
    expect(equalBlockElement(previous, fragment('p2', 10), [])).toBeUndefined();
  });

  test('an element already in use is not handed out twice', () => {
    const painted = element();
    const previous = new Map([[fragment('p1', 10), painted]]);
    expect(equalBlockElement(previous, fragment('p1', 10), [painted])).toBeUndefined();
  });

  test('objects that are not plain data compare by identity only', () => {
    const withMap = (map: Map<string, string>) =>
      ({ ...fragment('p1', 10), extra: map }) as unknown as BlockFragmentRecord;
    const previous = new Map([[withMap(new Map([['a', '1']])), element()]]);
    expect(equalBlockElement(previous, withMap(new Map([['a', '2']])), [])).toBeUndefined();
  });
});
