// A picture bullet draws `2 × (marker size − 2)` points tall for a shape as tall as its image in
// pixels; the shape height scales that by its ratio to the image pixel height.

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '@docx-editor.dev/core/store';
import { pictureBulletPixelHeights } from '../picture-bullet-pixels.ts';
import {
  pictureBulletScale,
  resolvePictureBullet,
  type NumberingPictureBullet,
} from '../numbering-picture-bullet.ts';

/** A minimal PNG header: signature and IHDR, which is all the size reader needs. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

const bullet = (width: number, height: number, pixelHeight?: number): NumberingPictureBullet => ({
  picBulletId: '0',
  relationshipId: 'rId1',
  width,
  height,
  ...(pixelHeight !== undefined ? { pixelHeight } : {}),
});

test('a shape as tall as its image draws 2 × (size − 2) points at any pixel height', () => {
  for (const pixels of [9, 18, 90, 732]) {
    expect(resolvePictureBullet(bullet(pixels, pixels, pixels), 12)!.height).toBeCloseTo(20, 6);
    expect(resolvePictureBullet(bullet(pixels, pixels, pixels), 10)!.height).toBeCloseTo(16, 6);
  }
});

test('the shape height scales the drawn height by its ratio to the image pixels', () => {
  expect(resolvePictureBullet(bullet(9, 9, 90), 12)!.height).toBeCloseTo(2, 6);
  const wide = resolvePictureBullet(bullet(869.2, 732.15, 732), 11)!;
  expect(wide.height).toBeCloseTo(18.004, 2);
  expect(wide.width).toBeCloseTo(21.37, 2);
});

test('without a pixel height the 12-pixel scale stays', () => {
  expect(pictureBulletScale(12)).toBeCloseTo(5 / 3, 6);
  expect(pictureBulletScale(12, 12)).toBeCloseTo(5 / 3, 6);
});

test('the pixel height is read from the image the numbering part names', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const loaded = readOoxmlPackage(
    zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="png" ContentType="image/png"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/numbering" Target="numbering.xml"/></Relationships>`
      ),
      'word/_rels/numbering.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/image" Target="media/bullet.png"/></Relationships>`
      ),
      'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body/></w:document>`),
      'word/numbering.xml': strToU8(`<w:numbering xmlns:w="${W}"/>`),
      'word/media/bullet.png': pngHeader(869, 732),
    })
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  const root = loaded.package.parts.get('/word/numbering.xml')!.root;
  const heightOf = pictureBulletPixelHeights(loaded.package, root)!;
  expect(heightOf('rId1')).toBe(732);
  expect(heightOf('rId9')).toBeUndefined();
});
