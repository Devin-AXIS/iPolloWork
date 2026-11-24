// The prefixes a large open lays out are sized by content, so every machine lays out the same
// prefixes and publishes the same pagination.

import { describe, expect, test } from 'bun:test';
import { bodyBlockWeight, nextPrefixLimit } from '../surface-progressive-open.ts';

const text = (value: string) => ({ kind: 'textValue', value });
const paragraph = (length: number) => ({ kind: 'paragraph', children: [text('x'.repeat(length))] });

describe('nextPrefixLimit', () => {
  test('a step holds a fixed amount of text, at least a few blocks', () => {
    const blocks = Array.from({ length: 10_000 }, () => paragraph(1_000));
    const first = nextPrefixLimit(0, blocks.length, (index) => blocks[index]);
    expect(first).toBe(60);
    expect(nextPrefixLimit(first, blocks.length, (index) => blocks[index])).toBe(120);
    const short = Array.from({ length: 100 }, () => paragraph(1));
    expect(nextPrefixLimit(0, short.length, (index) => short[index])).toBe(100);
  });

  test('heavy blocks still advance by the minimum step, light ones by the maximum', () => {
    const heavy = Array.from({ length: 100 }, () => paragraph(500_000));
    expect(nextPrefixLimit(10, heavy.length, (index) => heavy[index])).toBe(26);
    const light = Array.from({ length: 20_000 }, () => paragraph(0));
    expect(nextPrefixLimit(0, light.length, (index) => light[index])).toBe(4096);
  });

  test('the weight of a block is its text, counted once per block', () => {
    const block = { kind: 'table', children: [paragraph(10), paragraph(20)] };
    expect(bodyBlockWeight(block)).toBe(31);
    expect(bodyBlockWeight(block)).toBe(31);
  });
});
