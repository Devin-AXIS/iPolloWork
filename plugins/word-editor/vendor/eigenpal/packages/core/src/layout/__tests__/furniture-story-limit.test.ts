// A header or footer story holds at most half the sheet height. The first line that would end
// past that limit, and everything after it, is cut; anchored objects stay.

import { expect, test } from 'bun:test';
import { furnitureStoryLimit, limitFurnitureStory } from '../furniture-story-limit.ts';
import type { HeaderFooterStoryLayout } from '../hf-layout.ts';
import type { BlockFragmentRecord } from '../semantic-records.ts';

const box = (y: number, height: number) => ({ x: 0, y, width: 400, height });

/** A paragraph fragment whose lines have the given heights, stacked from `top`. */
function paragraph(id: string, top: number, heights: readonly number[]): BlockFragmentRecord {
  let y = top;
  const lines = heights.map((height, index) => {
    const line = { id: `${id}-${index}`, box: box(y, height) };
    y += height;
    return line;
  });
  return { kind: 'paragraph', id, lines, box: box(top, y - top) } as unknown as BlockFragmentRecord;
}

function story(fragments: readonly BlockFragmentRecord[]): HeaderFooterStoryLayout {
  let flowHeight = 0;
  for (const fragment of fragments)
    flowHeight = Math.max(flowHeight, fragment.box.y + fragment.box.height);
  const self: HeaderFooterStoryLayout = {
    fragments,
    flowHeight,
    withPageContext: () => self,
  } as unknown as HeaderFooterStoryLayout;
  return self;
}

const A4 = 841.9;

test('the limit is half the sheet height', () => {
  expect(furnitureStoryLimit(A4)).toBeCloseTo(420.95, 6);
  expect(furnitureStoryLimit(1000)).toBeCloseTo(500, 6);
});

test('a story within the limit is returned as it is', () => {
  const short = story([paragraph('a', 0, [25, 25]), paragraph('b', 50, [345])]);
  expect(limitFurnitureStory(short, A4)).toBe(short);
});

test('a picture line that crosses the limit is cut with everything after it', () => {
  // Two text lines, an empty line, a 360pt picture line that ends at 423.4pt, then text.
  const tall = story([
    paragraph('title', 0, [25.4, 25.4]),
    paragraph('empty', 50.8, [12.6]),
    paragraph('picture', 63.4, [360]),
    paragraph('tail', 423.4, [12.6]),
  ]);
  const limited = limitFurnitureStory(tall, A4);
  expect(limited.fragments.map((fragment) => fragment.id)).toEqual(['title', 'empty']);
  expect(limited.flowHeight).toBeCloseTo(63.4, 6);
});

test('a paragraph keeps the lines that fit before the one that crosses', () => {
  const tall = story([paragraph('logos', 0, [300, 300])]);
  const limited = limitFurnitureStory(tall, A4);
  expect(limited.fragments).toHaveLength(1);
  const kept = limited.fragments[0]!;
  expect(kept.kind === 'paragraph' && kept.lines.length).toBe(1);
  expect(limited.flowHeight).toBeCloseTo(300, 6);
});

test('a page-context layout of a cut story is cut too', () => {
  const tall = story([paragraph('title', 0, [20]), paragraph('picture', 20, [500])]);
  const limited = limitFurnitureStory(tall, A4);
  expect(limited.withPageContext({} as never)).toBe(limited);
});
