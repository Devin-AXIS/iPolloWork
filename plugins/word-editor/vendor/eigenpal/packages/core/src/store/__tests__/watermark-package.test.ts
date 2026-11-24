import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage, writeOoxmlPackage } from '../package/ooxml-package.ts';
import { serializeOoxmlPart } from '../package/ooxml-serialize.ts';
import { applyPackageWatermark, type PackageWatermarkWrite } from '../package/watermark-package.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const HEADER = '/word/header1.xml';
const IMAGE = '/word/media/shared.png';
const BYTES = new Uint8Array([137, 80, 78, 71]);

function load(bytes: Uint8Array) {
  const read = readOoxmlPackage(bytes);
  if (!read.ok) throw new Error(read.reason);
  return read.package;
}

function fixture(sharedImage: boolean) {
  const sibling = sharedImage
    ? '<v:shape id="Logo" style="width:20pt;height:20pt"><v:imagedata r:id="rIdImage"/></v:shape>'
    : '<v:shape id="OrdinaryShape" style="width:20pt;height:20pt"/>';
  return load(
    zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="png" ContentType="image/png"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          `<Override PartName="${HEADER}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="main" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body><w:p/><w:sectPr><w:headerReference w:type="default" r:id="hdr"/></w:sectPr></w:body></w:document>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="hdr" Type="${R}/header" Target="header1.xml"/></Relationships>`
      ),
      'word/header1.xml': strToU8(
        `<w:hdr xmlns:w="${W}" xmlns:r="${R}" xmlns:v="urn:schemas-microsoft-com:vml"><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Header text</w:t><w:pict><v:shape id="WordPictureWatermark1" style="width:200pt;height:100pt"><v:imagedata r:id="rIdImage"/></v:shape>${sibling}</w:pict><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p></w:hdr>`
      ),
      'word/_rels/header1.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rIdImage" Type="${R}/image" Target="media/shared.png"/></Relationships>`
      ),
      'word/media/shared.png': BYTES,
    })
  );
}

const replacement: PackageWatermarkWrite = {
  kind: 'text',
  text: 'DRAFT',
  fontFamily: 'Calibri',
  fontSizePt: null,
  bold: false,
  italic: false,
  colorHex: 'C0C0C0',
  opacity: 0.5,
  diagonal: true,
  widthPt: 200,
  heightPt: 100,
};

describe('watermark removal preserves shared runs', () => {
  for (const sharedImage of [false, true]) {
    for (const watermark of [null, replacement]) {
      test(`${watermark ? 'replace' : 'remove'} preserves siblings with shared image ${sharedImage}`, () => {
        const original = fixture(sharedImage);
        const result = applyPackageWatermark(original, watermark, () => null);
        if (!result.ok) throw new Error(result.detail);
        for (const pkg of [result.package, load(writeOoxmlPackage(result.package))]) {
          const xml = serializeOoxmlPart(pkg.parts.get(HEADER)!);
          expect(xml).toContain('Header text');
          expect(xml).toContain('<w:b/>');
          expect(xml).toContain('PAGE');
          expect(xml).toContain('fldCharType="begin"');
          expect(xml).not.toContain('WordPictureWatermark');
          expect(xml).toContain(sharedImage ? 'id="Logo"' : 'id="OrdinaryShape"');
          expect(xml.includes('string="DRAFT"')).toBe(watermark !== null);
          expect(pkg.relationships.get(HEADER)?.some((rel) => rel.id === 'rIdImage') ?? false).toBe(
            sharedImage
          );
          expect(pkg.partBytes.has(IMAGE)).toBe(sharedImage);
          if (sharedImage) expect(pkg.partBytes.get(IMAGE)).toEqual(BYTES);
        }
        expect(serializeOoxmlPart(original.parts.get(HEADER)!)).toContain('WordPictureWatermark');
      });
    }
  }
});
