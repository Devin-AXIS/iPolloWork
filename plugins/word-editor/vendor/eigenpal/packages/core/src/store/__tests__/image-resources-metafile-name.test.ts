// A metafile part named for the other metafile format resolves by its own bytes.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { imageResourceLookupFor, type ImageDecodePort } from '../package/image-resources.ts';
import { readOoxmlPackage } from '../package/ooxml-package.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const IMAGE_REL = `${R}/image`;
const EMF_MIN = new Uint8Array([0x01, 0x00, 0x00, 0x00, ...new Array(40).fill(0)]);
const WMF_MIN = new Uint8Array([0xd7, 0xcd, 0xc6, 0x9a, ...new Array(40).fill(0)]);
/** Metafiles never reach the raster decoder. */
const NO_DECODE: ImageDecodePort = {
  decode: () => Promise.reject(new Error('no raster decode')),
};

function metafilePackage(file: string, bytes: Uint8Array) {
  return readOoxmlPackage(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT_NS}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="emf" ContentType="image/x-emf"/>' +
          '<Default Extension="wmf" ContentType="image/x-wmf"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" ` +
          `Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body><w:p/></w:body></w:document>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL_NS}"><Relationship Id="rId2" ` +
          `Type="${IMAGE_REL}" Target="media/${file}"/></Relationships>`
      ),
      [`word/media/${file}`]: bytes,
    })
  );
}

describe('metafile part names', () => {
  test.each([
    ['EMF bytes in a .wmf part', 'image1.wmf', EMF_MIN, 'image/x-emf'],
    ['WMF bytes in an .emf part', 'image1.emf', WMF_MIN, 'image/x-wmf'],
  ] as const)('%s resolve as the sniffed format', async (_label, file, bytes, sniffed) => {
    const loaded = metafilePackage(file, bytes);
    if (!loaded.ok) throw new Error(loaded.reason);
    const lookup = imageResourceLookupFor(loaded.package, { decodePort: NO_DECODE });
    const state = await lookup.resolveEmbedded('/word/document.xml', 'rId2');
    expect(state).toEqual(expect.objectContaining({ mime: sniffed }));
    expect(state).not.toEqual(expect.objectContaining({ reason: 'signature-mismatch' }));
  });
});
