import { expect, test } from 'bun:test';
import { automaticTextSpacingBefore, withAutomaticTextSpacing } from '../cjk-automatic-spacing.ts';

test('a zero automatic advance leaves an unmarked span unchanged', () => {
  const span = { range: { start: 4, end: 5 }, text: 'A' };
  const result = withAutomaticTextSpacing(span, 0);
  expect(result).toBe(span);
  expect(result).toEqual(structuredClone(span));
  expect(Reflect.ownKeys(result)).toEqual(Reflect.ownKeys(span));
  expect(automaticTextSpacingBefore(result)).toBe(0);
});

test('clearing an advance preserves the source span and unrelated metadata', () => {
  const other = Symbol('other-layout-metadata');
  const span = { range: { start: 4, end: 5 }, text: 'A', [other]: 'preserved' };
  const spaced = withAutomaticTextSpacing(span, 2.4);
  const result = withAutomaticTextSpacing(spaced, 0);
  expect(result).toEqual(span);
  expect(result.range).toBe(span.range);
  expect(result[other]).toBe('preserved');
  expect(automaticTextSpacingBefore(result)).toBe(0);
  expect(automaticTextSpacingBefore(spaced)).toBe(2.4);
  expect(automaticTextSpacingBefore(span)).toBe(0);
});

test('a nonzero advance survives copies and belongs only to its original start', () => {
  const span = { range: { start: 4, end: 5 }, text: 'A' };
  const spaced = withAutomaticTextSpacing(span, 2.4);
  expect(automaticTextSpacingBefore({ ...spaced })).toBe(2.4);
  const moved = { ...spaced, range: { start: 5, end: 6 } };
  expect(automaticTextSpacingBefore(moved)).toBe(0);
  expect(withAutomaticTextSpacing(moved, 0)).toEqual({ ...span, range: moved.range });
  const changed = withAutomaticTextSpacing(spaced, 1.2);
  expect(automaticTextSpacingBefore(changed)).toBe(1.2);
  expect(automaticTextSpacingBefore(spaced)).toBe(2.4);
});
