import { expect, test } from 'bun:test';
import { resolveRunStyle, runStylesEqual } from '../run-style.ts';
import {
  withRevisionMarkupEmphasis,
  revisionMarkupStyleForEditing,
} from '../revision-markup-style.ts';
import {
  withLayoutDerivedSpacing,
  layoutDerivedSpacingStyleForEditing,
  layoutDerivedSpacingSourcesEqual,
} from '../layout-derived-spacing.ts';

test('repeated line fitting and shaping copies keep the first authored spacing', () => {
  const original = { ...resolveRunStyle([]), characterSpacingPt: 1 };
  const fitted = withLayoutDerivedSpacing(original, -2);
  const second = withLayoutDerivedSpacing({ ...fitted, fontSizePt: 18 }, -4);
  expect(original.characterSpacingPt).toBe(1);
  expect(second.characterSpacingPt).toBe(-4);
  const editing = layoutDerivedSpacingStyleForEditing(second);
  expect(editing.characterSpacingPt).toBe(1);
  expect(editing.fontSizePt).toBe(18);
  expect(Object.getOwnPropertySymbols(editing)).toEqual([]);
  expect(layoutDerivedSpacingStyleForEditing(editing)).toBe(editing);
  expect(layoutDerivedSpacingStyleForEditing(original)).toBe(original);
});

test('visually equal runs retain different source spacing boundaries', () => {
  const base = resolveRunStyle([]);
  const authoredOne = withLayoutDerivedSpacing({ ...base, characterSpacingPt: 1 }, -2);
  const authoredZero = withLayoutDerivedSpacing(base, -2);
  expect(layoutDerivedSpacingSourcesEqual(authoredOne, authoredZero)).toBe(false);
  expect(runStylesEqual(authoredOne, authoredZero)).toBe(false);
  expect(runStylesEqual(authoredZero, { ...authoredZero })).toBe(true);
  expect(layoutDerivedSpacingSourcesEqual(authoredZero, base)).toBe(true);
  expect(runStylesEqual(authoredZero, base)).toBe(false);
});

test('revision emphasis and line fitting restore their separate authored properties', () => {
  const source = resolveRunStyle([]);
  const visible = withLayoutDerivedSpacing(withRevisionMarkupEmphasis(source, 'bold'), -3);
  const editing = layoutDerivedSpacingStyleForEditing(
    revisionMarkupStyleForEditing({ ...visible })
  );
  expect(editing.characterSpacingPt).toBe(0);
  expect(editing.bold).toBe(false);
  expect(visible.characterSpacingPt).toBe(-3);
  expect(visible.bold).toBe(true);
  expect(() => withLayoutDerivedSpacing(source, NaN)).toThrow(RangeError);
  expect(() => withLayoutDerivedSpacing(source, Infinity)).toThrow(RangeError);
});
