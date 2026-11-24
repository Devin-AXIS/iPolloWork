import { describe, expect, test } from 'bun:test';
import type { ResolvedFont } from '../../layout/font-resource.ts';
import {
  hasColorGlyphTables,
  orderFallbackFacesForCluster,
  prefersEmojiPresentation,
} from '../export-color-font.ts';

/** A minimal sfnt directory listing the given table tags, with no table data. */
function sfnt(tags: readonly string[], collection = false): Uint8Array {
  const directory = new Uint8Array(12 + 16 * tags.length);
  const view = new DataView(directory.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, tags.length);
  tags.forEach((tag, index) => {
    for (let i = 0; i < 4; i++) directory[12 + index * 16 + i] = tag.charCodeAt(i);
  });
  if (!collection) return directory;
  const out = new Uint8Array(16 + directory.length);
  const header = new DataView(out.buffer);
  out.set([0x74, 0x74, 0x63, 0x66], 0);
  header.setUint32(4, 0x00010000);
  header.setUint32(8, 1);
  header.setUint32(12, 16);
  out.set(directory, 16);
  return out;
}

function face(id: string, bytes: Uint8Array, faceIndex = 0): ResolvedFont {
  return {
    id,
    identity: id,
    family: id,
    bytes,
    faceIndex,
    byteLength: bytes.length,
  } as ResolvedFont;
}

describe('color glyph tables', () => {
  test('a COLR, CBDT or sbix table marks a color face; outlines alone do not', () => {
    expect(hasColorGlyphTables(face('colr', sfnt(['cmap', 'COLR', 'CPAL', 'glyf'])))).toBe(true);
    expect(hasColorGlyphTables(face('cbdt', sfnt(['CBDT', 'CBLC', 'cmap'])))).toBe(true);
    expect(hasColorGlyphTables(face('sbix', sfnt(['cmap', 'sbix'])))).toBe(true);
    expect(hasColorGlyphTables(face('mono', sfnt(['cmap', 'glyf', 'hmtx'])))).toBe(false);
    expect(hasColorGlyphTables(face('ttc', sfnt(['COLR'], true)))).toBe(true);
    expect(hasColorGlyphTables(face('short', new Uint8Array(3)))).toBe(false);
  });
});

describe('emoji presentation', () => {
  test('emoji-default pictographs and VS16 sequences ask for the color face', () => {
    expect(prefersEmojiPresentation('✅')).toBe(true);
    expect(prefersEmojiPresentation('\u{1F600}')).toBe(true);
    expect(prefersEmojiPresentation('❤️')).toBe(true);
    // Text-default symbols stay with the symbol faces.
    expect(prefersEmojiPresentation('❤')).toBe(false);
    expect(prefersEmojiPresentation('✓ ➢')).toBe(false);
    expect(prefersEmojiPresentation('plain')).toBe(false);
  });

  test('faces are reordered by presentation, keeping their relative order', () => {
    const symbols = face('symbols', sfnt(['glyf']));
    const math = face('math', sfnt(['glyf']));
    const emoji = face('emoji', sfnt(['COLR', 'CPAL', 'glyf']));
    const fonts = [symbols, math, emoji];
    expect(orderFallbackFacesForCluster(fonts, '✅')).toEqual([emoji, symbols, math]);
    expect(orderFallbackFacesForCluster(fonts, '✓')).toEqual([symbols, math, emoji]);
    expect(orderFallbackFacesForCluster([symbols, math], '✅')).toEqual([symbols, math]);
  });
});
