// Automatic text is white on a dark fill and black on a light one, by measured luma.

import { expect, test } from 'bun:test';
import { automaticTextColor } from '../ooxml-shading.ts';

test('automatic text turns white on fills darker than the measured threshold', () => {
  for (const dark of ['000000', '3B3B3B', '000080', '0000FF', 'C00000', '006000', '800080'])
    expect(automaticTextColor(dark)).toBe('FFFFFF');
  for (const light of ['3C3C3C', '404040', 'C80000', '006600', '1F4E79', 'FF0000', 'FFFFFF'])
    expect(automaticTextColor(light)).toBeNull();
});

test('no fill, or a malformed one, leaves automatic text black', () => {
  expect(automaticTextColor(null)).toBeNull();
  expect(automaticTextColor(undefined)).toBeNull();
  expect(automaticTextColor('auto')).toBeNull();
});
