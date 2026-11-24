// A picture whose part has an extension-style content type (`image/.png`) copies and pastes
// like any other picture. The signature still decides: a claim the bytes contradict drops.

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { serializeOoxmlPart } from '../package/ooxml-tree.ts';
import { extractFragmentPackage } from '../store/clipboard-fragment-extract.ts';
import {
  bodyOf,
  buildPackage,
  fullBodyCoverage,
  loadPackage,
  openStore,
  paragraphIdsUnder,
} from './clipboard-fragment-fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const ONE_PIXEL_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);
const MINIMAL_TIFF = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);

function pictureSource(declaredType: string, extension: string, bytes: Uint8Array): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        `<Default Extension="${extension}" ContentType="${declaredType}"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId7" Type="${R}/image" Target="media/image1.${extension}"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}">` +
        '<w:body><w:p><w:r><w:t>keepme</w:t></w:r>' +
        '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
        '<wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name=""/>' +
        `<a:graphic><a:graphicData uri="${PIC}"><pic:pic>` +
        '<pic:nvPicPr><pic:cNvPr id="0" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
        '<pic:blipFill><a:blip r:embed="rId7"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic>' +
        '</wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
    ),
    [`word/media/image1.${extension}`]: bytes,
  });
}

function copyAndPaste(declaredType: string, extension = 'PNG', bytes = ONE_PIXEL_PNG) {
  const source = loadPackage(pictureSource(declaredType, extension, bytes));
  const extracted = extractFragmentPackage(source, fullBodyCoverage(source));
  if (!extracted.ok) throw new Error('extraction failed');
  const target = buildPackage('<w:p/>');
  const store = openStore(target);
  const hostId = paragraphIdsUnder(
    bodyOf(store.currentPackage().parts.get(target.mainDocumentPart)!)
  )[0]!;
  const pasted = store.applyFragmentPaste(
    { kind: 'body' },
    { paragraphId: hostId, offset: 0, fragmentBytes: extracted.bytes, lastMarkCovered: true }
  );
  expect(pasted.ok).toBe(true);
  const after = store.currentPackage();
  return {
    documentXml: serializeOoxmlPart(after.parts.get(after.mainDocumentPart)!),
    media: [...after.partBytes.keys()].filter((name) => name.includes('/media/')),
  };
}

describe('clipboard media with an extension-style content type', () => {
  test.each(['image/png', 'image/.png', 'image/.PNG'])(
    'a picture declared %s survives copy and paste',
    (declaredType) => {
      const { documentXml, media } = copyAndPaste(declaredType);
      expect(documentXml).toContain('keepme');
      expect(documentXml).toContain('w:drawing');
      expect(media).toEqual(['/word/media/image1.png']);
    }
  );

  test('the copied package declares the standard type, so any reader admits the picture', () => {
    const source = loadPackage(pictureSource('image/.png', 'PNG', ONE_PIXEL_PNG));
    const extracted = extractFragmentPackage(source, fullBodyCoverage(source));
    if (!extracted.ok) throw new Error('extraction failed');
    const types = strFromU8(unzipSync(extracted.bytes)['[Content_Types].xml']!);
    expect(types).toContain('ContentType="image/png"');
    expect(types).not.toContain('image/.png');
  });

  test('a TIFF picture declared image/.tif survives copy and paste', () => {
    const { documentXml, media } = copyAndPaste('image/.tif', 'tif', MINIMAL_TIFF);
    expect(documentXml).toContain('w:drawing');
    expect(media).toHaveLength(1);
  });

  test('a picture whose extension-style claim contradicts its bytes drops', () => {
    const { documentXml, media } = copyAndPaste('image/.jpg');
    expect(documentXml).toContain('keepme');
    expect(documentXml.includes('w:drawing')).toBe(false);
    expect(media).toEqual([]);
  });
});
