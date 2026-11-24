import { expect, test } from 'bun:test';
import { cmapMapsCodePoint, unicodeCmapSubtable } from '../sfnt-cmap-coverage.ts';

/** A one-table sfnt whose cmap holds `subtable` under (platform, encoding). */
function sfnt(subtable: number[], platform = 3, encoding = 1): Uint8Array {
  const cmap = [
    0,
    0,
    0,
    1,
    platform >> 8,
    platform & 0xff,
    encoding >> 8,
    encoding & 0xff,
    0,
    0,
    0,
    12,
  ];
  const tableOffset = 12 + 16;
  const header = [0, 1, 0, 0, 0, 1, 0, 16, 0, 0, 0, 0];
  const record = [
    0x63,
    0x6d,
    0x61,
    0x70,
    0,
    0,
    0,
    0,
    ...be32(tableOffset),
    ...be32(cmap.length + subtable.length),
  ];
  return new Uint8Array([...header, ...record, ...cmap, ...subtable]);
}
const be16 = (value: number) => [(value >> 8) & 0xff, value & 0xff];
const be32 = (value: number) => [
  (value >>> 24) & 0xff,
  (value >> 16) & 0xff,
  (value >> 8) & 0xff,
  value & 0xff,
];

/** Format 4: U+2010 and U+2013-U+2014 by delta, U+3042 through the glyph array, then 0xFFFF. */
function format4(): number[] {
  const segments = [
    { start: 0x2010, end: 0x2010, delta: 5 - 0x2010, range: 0 },
    { start: 0x2013, end: 0x2014, delta: 6 - 0x2013, range: 0 },
    { start: 0x3042, end: 0x3043, delta: 0, range: 'array' as const },
    { start: 0xffff, end: 0xffff, delta: 1, range: 0 },
  ];
  const count = segments.length;
  const out = [...be16(4), ...be16(0), ...be16(0), ...be16(count * 2), 0, 0, 0, 0, 0, 0];
  for (const s of segments) out.push(...be16(s.end));
  out.push(0, 0);
  for (const s of segments) out.push(...be16(s.start));
  for (const s of segments) out.push(...be16(s.delta & 0xffff));
  // The array segment points past the remaining range offsets to two glyph ids: 9, then notdef.
  segments.forEach((s, index) => out.push(...be16(s.range === 'array' ? (count - index) * 2 : 0)));
  out.push(...be16(9), ...be16(0));
  const length = out.length;
  out[2] = length >> 8;
  out[3] = length & 0xff;
  return out;
}

test('format 4 maps by delta and through the glyph array, and notdef counts as missing', () => {
  const bytes = sfnt(format4());
  const subtable = unicodeCmapSubtable(bytes, 0)!;
  expect(subtable.format).toBe(4);
  const maps = (cp: number) => cmapMapsCodePoint(bytes, subtable, cp);
  expect(maps(0x2010)).toBe(true);
  expect(maps(0x2011)).toBe(false);
  expect(maps(0x2013)).toBe(true);
  expect(maps(0x2014)).toBe(true);
  expect(maps(0x3042)).toBe(true);
  expect(maps(0x3043)).toBe(false);
  expect(maps(0x1f600)).toBe(false);
});

test('format 12 is preferred and maps supplementary code points', () => {
  const groups = [
    [0x2010, 0x2010, 4],
    [0x1f600, 0x1f601, 10],
  ];
  const sub = [
    ...be16(12),
    0,
    0,
    ...be32(16 + groups.length * 12),
    ...be32(0),
    ...be32(groups.length),
  ];
  for (const [start, end, glyph] of groups)
    sub.push(...be32(start!), ...be32(end!), ...be32(glyph!));
  const bytes = sfnt(sub, 3, 10);
  const subtable = unicodeCmapSubtable(bytes, 0)!;
  expect(subtable.format).toBe(12);
  expect(cmapMapsCodePoint(bytes, subtable, 0x2010)).toBe(true);
  expect(cmapMapsCodePoint(bytes, subtable, 0x2011)).toBe(false);
  expect(cmapMapsCodePoint(bytes, subtable, 0x1f601)).toBe(true);
});

test('a symbol cmap has no Unicode subtable to read', () => {
  expect(unicodeCmapSubtable(sfnt(format4(), 3, 0), 0)).toBeNull();
});

test('truncated or garbage bytes answer missing without reading out of bounds', () => {
  const full = sfnt(format4());
  for (let length = 0; length < full.length; length += 1) {
    const bytes = full.slice(0, length);
    const subtable = unicodeCmapSubtable(bytes, 0);
    if (subtable) expect(typeof cmapMapsCodePoint(bytes, subtable, 0x3042)).toBe('boolean');
  }
  expect(unicodeCmapSubtable(new Uint8Array([0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0]), 3)).toBeNull();
});
