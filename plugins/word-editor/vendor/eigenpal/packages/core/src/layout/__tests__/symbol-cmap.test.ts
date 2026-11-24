import { expect, test } from 'bun:test';
import { hasSymbolCmap, toSymbolCmapText } from '../symbol-cmap.ts';

/** A one-table sfnt whose cmap lists the given (platform, encoding) subtables. */
function sfnt(encodings: readonly (readonly [number, number])[]): Uint8Array {
  const cmapOffset = 12 + 16;
  const bytes = new Uint8Array(cmapOffset + 4 + encodings.length * 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, 1);
  bytes.set([0x63, 0x6d, 0x61, 0x70], 12);
  view.setUint32(12 + 8, cmapOffset);
  view.setUint32(12 + 12, bytes.length - cmapOffset);
  view.setUint16(cmapOffset + 2, encodings.length);
  encodings.forEach(([platform, encoding], index) => {
    view.setUint16(cmapOffset + 4 + index * 8, platform);
    view.setUint16(cmapOffset + 6 + index * 8, encoding);
  });
  return bytes;
}

test('a face with a symbol cmap is recognised, with or without Unicode subtables', () => {
  expect(hasSymbolCmap(sfnt([[3, 0]]), 0)).toBe(true);
  expect(
    hasSymbolCmap(
      sfnt([
        [0, 3],
        [1, 0],
        [3, 0],
      ]),
      0
    )
  ).toBe(true);
  expect(hasSymbolCmap(sfnt([[3, 1]]), 0)).toBe(false);
  expect(
    hasSymbolCmap(
      sfnt([
        [0, 3],
        [1, 0],
      ]),
      0
    )
  ).toBe(false);
});

test('truncated or empty bytes are not a symbol face', () => {
  expect(hasSymbolCmap(new Uint8Array(0), 0)).toBe(false);
  expect(hasSymbolCmap(sfnt([[3, 0]]).slice(0, 30), 0)).toBe(false);
});

test('plain bytes move to the symbol range and keep their length', () => {
  expect(toSymbolCmapText('q q')).toBe('');
  expect(toSymbolCmapText('\t•')).toBe('\t•');
  const text = 'abÿ';
  expect(toSymbolCmapText(text)).toHaveLength(text.length);
});
