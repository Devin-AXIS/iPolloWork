// Each symbol face maps its bytes through its own table: Webdings and Wingdings 3 do not share
// the Wingdings and Wingdings 2 encodings.

import { expect, test } from 'bun:test';
import { mapSymbolPuaText } from '../package/symbol-encoding.ts';

const pua = (byte: number) => String.fromCodePoint(0xf000 + byte);

test.each([
  ['Webdings', 0x31, '\u{1f5d6}'],
  ['Webdings', 0x72, '\u{1f5d9}'],
  ['Wingdings 2', 0x35, '▢'],
  ['Wingdings 2', 0xa3, '□'],
  ['Wingdings 2', 0x52, '☑'],
  ['Wingdings 2', 0xa7, '▣'],
  ['Wingdings 2', 0xb7, '◆'],
  ['Wingdings 3', 0xa7, '⬅'],
  ['Wingdings', 0xa8, '◻'],
  ['Wingdings', 0xfe, '☑'],
])('%s byte %d maps to the glyph the face draws', (font, byte, expected) => {
  expect(mapSymbolPuaText(pua(byte), font)).toBe(expected);
});

test('a byte a face does not list keeps its private-use code', () => {
  expect(mapSymbolPuaText(pua(0x6c), 'Webdings')).toBe(pua(0x6c));
  expect(mapSymbolPuaText(pua(0xb7), 'Wingdings 3')).toBe(pua(0xb7));
});

test('an available face draws its own glyph', () => {
  expect(mapSymbolPuaText(pua(0x31), 'Webdings', () => true)).toBe(pua(0x31));
});
