import { describe, expect, test } from 'bun:test';
import { readTwipsMeasure } from '../units.ts';

describe('readTwipsMeasure', () => {
  test.each([
    ['1440', 1440],
    ['00720', 720],
    ['+1440', 1440],
    ['-720', -720],
    ['0', 0],
    ['-0', 0],
  ])('reads the integer %p', (raw, expected) => {
    expect(readTwipsMeasure(raw)).toBe(expected);
  });

  test.each([
    ['4743.74', 4743],
    ['1443.5', 1443],
    ['1443.49', 1443],
    ['1439.9999999999998', 1439],
    ['708.0', 708],
    ['1440.', 1440],
    ['.5', 0],
    ['-720.6', -720],
    ['-720.2', -720],
    ['-0.4', 0],
  ])('truncates the decimal %p toward zero', (raw, expected) => {
    expect(readTwipsMeasure(raw)).toBe(expected);
  });

  test.each([
    ['1in', 1440],
    ['.5in', 720],
    ['1.in', 1440],
    ['+1in', 1440],
    ['72pt', 1440],
    ['0.05pt', 1],
    ['36.049pt', 720],
    ['6pc', 1440],
    ['6pi', 1440],
    ['2.54cm', 1440],
    ['1.27cm', 720],
    ['25.4mm', 1440],
    ['0.35mm', 19],
    ['0.333in', 479],
  ])('converts the universal measure %p exactly, then truncates', (raw, expected) => {
    expect(readTwipsMeasure(raw)).toBe(expected);
  });

  test('ignores the sign of a universal measure', () => {
    expect(readTwipsMeasure('-0.5in')).toBe(720);
  });

  test.each([
    undefined,
    '',
    '.',
    '+',
    '-',
    'in',
    '.in',
    'abc',
    ' 1440',
    '1440 ',
    '1 in',
    '1IN',
    '1.44e3',
    '0x5A0',
    '1440,5',
    '1234567890',
    '1.5px',
    `1.${'5'.repeat(33)}`,
  ])('rejects %p', (raw) => {
    expect(readTwipsMeasure(raw)).toBeNull();
  });

  test('a long hostile value is rejected in linear time', () => {
    const started = performance.now();
    expect(readTwipsMeasure(`${'1'.repeat(50_000)}x`)).toBeNull();
    expect(readTwipsMeasure(`1.${'1'.repeat(50_000)}in`)).toBeNull();
    expect(performance.now() - started).toBeLessThan(250);
  });
});
