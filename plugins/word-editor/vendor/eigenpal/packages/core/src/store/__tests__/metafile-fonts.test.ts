// The faces EMF and WMF pictures name in their font records join the document's font request.

import { expect, test } from 'bun:test';
import { metafileFontFamilies } from '../package/metafile-fonts.ts';
import { validFontFamily } from '../package/run-defaults.ts';

function emf(faces: readonly string[]): Uint8Array {
  const records: number[][] = [];
  const u32 = (value: number) => [
    value & 255,
    (value >> 8) & 255,
    (value >> 16) & 255,
    value >>> 24,
  ];
  records.push([...u32(1), ...u32(16), ...u32(0), ...u32(0)]);
  for (const face of faces) {
    const logfont = new Array(28).fill(0);
    const name = new Array(64).fill(0);
    [...face].forEach((char, index) => (name[index * 2] = char.charCodeAt(0)));
    const body = [...u32(1), ...logfont, ...name];
    records.push([...u32(82), ...u32(8 + body.length), ...body]);
  }
  records.push([...u32(14), ...u32(8)]);
  return Uint8Array.from(records.flat());
}

function wmf(face: string): Uint8Array {
  const u16 = (value: number) => [value & 255, (value >> 8) & 255];
  const header = [
    ...u16(1),
    ...u16(9),
    ...u16(0x0300),
    0,
    0,
    0,
    0,
    ...u16(1),
    0,
    0,
    0,
    0,
    ...u16(0),
  ];
  const name = new Array(32).fill(0);
  [...face].forEach((char, index) => (name[index] = char.charCodeAt(0)));
  const body = [...new Array(18).fill(0), ...name];
  const words = (6 + body.length) / 2;
  const record = [...u16(words), ...u16(0), ...u16(0x02fb), ...body];
  const end = [...u16(3), ...u16(0), ...u16(0)];
  return Uint8Array.from([...header, ...record, ...end]);
}

test('EMF and WMF story pictures name faces; System, the thumbnail and the glossary do not', () => {
  const partBytes = new Map<string, Uint8Array>([
    ['/word/media/image1.emf', emf(['Tahoma', 'System', 'tahoma'])],
    ['/word/media/image2.wmf', wmf('Arial Narrow')],
    ['/word/media/image3.png', emf(['Ignored'])],
    ['/docProps/thumbnail.emf', emf(['Thumbnail Face'])],
    ['/word/glossary/media/image1.emf', emf(['Glossary Face'])],
  ]);
  expect(metafileFontFamilies({ partBytes }, validFontFamily)).toEqual(['Tahoma', 'Arial Narrow']);
});

test('truncated or foreign bytes name nothing', () => {
  const partBytes = new Map<string, Uint8Array>([
    ['/word/media/a.emf', emf(['Tahoma']).slice(0, 30)],
    ['/word/media/b.wmf', Uint8Array.from([1, 2, 3])],
  ]);
  expect(metafileFontFamilies({ partBytes }, validFontFamily)).toEqual([]);
});
