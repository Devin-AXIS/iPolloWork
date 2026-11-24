// Valid packages that one harmless detail used to refuse: a small entry that compresses
// extremely well, an XML 1.0 name with non-ASCII letters, and a content-type record with
// malformed MIME syntax. Each is checked together with the refusal it must keep.

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { readOoxmlPackage, writeOoxmlPackage } from '../package/ooxml-package.ts';
import { readZip, ZIP_RATIO_EXEMPT_BYTES, type ZipLimits } from '../package/zip.ts';
import { isValidNCName, isValidQName, isXmlNCName } from '../package/qname.ts';
import { canonicalOoxmlFingerprint } from '../package/ooxml-serialize.ts';
import { semanticDigest } from '../package/ooxml-digest.ts';
import { resolveContentTypeOf } from '../package/package-edit.ts';
import { createImageResourceCache } from '../package/image-resources.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOC = `${R}/officeDocument`;
const MAIN_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const STYLES_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml';
const RELS_DEFAULT =
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>';
const XML_DEFAULT = '<Default Extension="xml" ContentType="application/xml"/>';
const MAIN_OVERRIDE = `<Override PartName="/word/document.xml" ContentType="${MAIN_TYPE}"/>`;
const ROOT_RELS =
  `<Relationships xmlns="${REL_NS}">` +
  `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
  '</Relationships>';
const DOCUMENT = `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>body</w:t></w:r></w:p></w:body></w:document>`;
const ONE_PIXEL_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

function contentTypes(...records: string[]): string {
  return `<Types xmlns="${CT_NS}">${records.join('')}</Types>`;
}

function build(entries: Record<string, string | Uint8Array> = {}, level: 0 | 9 = 9): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes(RELS_DEFAULT, XML_DEFAULT, MAIN_OVERRIDE)),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(DOCUMENT),
  };
  for (const [name, value] of Object.entries(entries)) {
    files[name] = typeof value === 'string' ? strToU8(value) : value;
  }
  return zipSync(files, { level });
}

function opened(bytes: Uint8Array) {
  const result = readOoxmlPackage(bytes);
  if (!result.ok) throw new Error(`unexpected rejection: ${result.reason} ${result.detail ?? ''}`);
  return result.package;
}

/** Rewrite one central-directory size field of the named entry. */
function patchCentralSize(
  zip: Uint8Array,
  entryName: string,
  field: 'compressed' | 'uncompressed',
  value: number
): Uint8Array {
  const bytes = new Uint8Array(zip);
  const view = new DataView(bytes.buffer);
  for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(offset + 28, true);
    const name = strFromU8(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name !== entryName) continue;
    view.setUint32(offset + (field === 'compressed' ? 20 : 24), value, true);
    return bytes;
  }
  throw new Error(`no central directory record for ${entryName}`);
}

describe('compression-ratio guard', () => {
  const generous: ZipLimits = { maxEntries: 100, maxTotalBytes: 256 * 1024 * 1024, maxRatio: 200 };

  test('opens a package whose small entry compresses far beyond the ratio', () => {
    const zeros = new Uint8Array(4_700);
    const bytes = build({ 'word/embeddings/blank.bin': zeros });
    let stored = 0;
    unzipSync(bytes, {
      filter: (file) => {
        if (file.name === 'word/embeddings/blank.bin') stored = file.size;
        return false;
      },
    });
    expect(zeros.length / stored).toBeGreaterThan(200);
    const pkg = opened(bytes);
    expect(pkg.partBytes.get('/word/embeddings/blank.bin')?.length).toBe(zeros.length);
  });

  test('opens a package with a megabyte-sized uniform image entry', () => {
    const uniform = new Uint8Array(2 * 1024 * 1024).fill(0x11);
    const bytes = build({ 'word/media/image1.emf': uniform });
    expect(uniform.length / bytes.length).toBeGreaterThan(200);
    expect(opened(bytes).partBytes.get('/word/media/image1.emf')?.length).toBe(uniform.length);
  });

  test('exempts an archive up to the exemption size and applies the ratio one byte past it', () => {
    const lone = (size: number) => zipSync({ 'pad.bin': new Uint8Array(size) }, { level: 9 });
    expect(readZip(lone(ZIP_RATIO_EXEMPT_BYTES), generous).ok).toBe(true);
    expect(readZip(lone(ZIP_RATIO_EXEMPT_BYTES + 1), generous)).toMatchObject({
      ok: false,
      reason: 'too-large',
      limit: 'zip.maxRatio',
    });
  });

  test('applies the ratio exactly at N and N+1 above the exemption', () => {
    const bytes = zipSync({ 'pad.bin': new Uint8Array(ZIP_RATIO_EXEMPT_BYTES + 1024) });
    const ratio = (ZIP_RATIO_EXEMPT_BYTES + 1024) / bytes.byteLength;
    const at = { ...generous, maxRatio: ratio };
    const below = { ...generous, maxRatio: ratio * (1 - 1e-9) };
    expect(readZip(bytes, at).ok).toBe(true);
    expect(readZip(bytes, below)).toMatchObject({ ok: false, limit: 'zip.maxRatio' });
  });

  test('refuses a bomb split across many small entries', () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < 20; i += 1) entries[`part${i}.bin`] = new Uint8Array(1024 * 1024);
    const bytes = zipSync(entries, { level: 9 });
    expect(readZip(bytes)).toMatchObject({ ok: false, reason: 'too-large', limit: 'zip.maxRatio' });
  });

  test('refuses a declared size beyond the total budget before inflating', () => {
    const bytes = patchCentralSize(
      build({ 'word/media/a.bin': new Uint8Array(64) }),
      'word/media/a.bin',
      'uncompressed',
      0xfffffff0
    );
    expect(readOoxmlPackage(bytes)).toMatchObject({
      ok: false,
      reason: 'too-large',
      limit: 'zip.maxTotalBytes',
    });
  });

  test('keeps the total budget at N and N+1', () => {
    const bytes = zipSync({ 'a.bin': new Uint8Array(1000), 'b.bin': new Uint8Array(24) });
    expect(readZip(bytes, { maxEntries: 10, maxTotalBytes: 1024 }).ok).toBe(true);
    expect(readZip(bytes, { maxEntries: 10, maxTotalBytes: 1023 })).toMatchObject({
      ok: false,
      limit: 'zip.maxTotalBytes',
    });
  });

  test('never inflates an entry past its declared size', () => {
    const payload = new Uint8Array(100_000).fill(7);
    const bytes = patchCentralSize(
      zipSync({ 'a.bin': payload }, { level: 9 }),
      'a.bin',
      'uncompressed',
      10
    );
    const result = readZip(bytes);
    if (result.ok) expect(result.entries.get('/a.bin')!.length).toBeLessThanOrEqual(10);
    else expect(result.reason).toBe('inflate-error');
  });

  test('counts a stored entry at its stored size, whatever it declares', () => {
    const bytes = patchCentralSize(
      zipSync({ 'a.bin': new Uint8Array(2000).fill(1) }, { level: 0 }),
      'a.bin',
      'uncompressed',
      1
    );
    expect(readZip(bytes, { maxEntries: 10, maxTotalBytes: 1500 })).toMatchObject({
      ok: false,
      limit: 'zip.maxTotalBytes',
    });
  });
});

describe('XML 1.0 names', () => {
  const ITEM =
    '<Ügyfél xmlns="urn:example:record" xmlns:ü="urn:example:extra">' +
    '<Größe ñ="1">12</Größe><名前>x</名前><ü:Dátum ü:é="2">2</ü:Dátum><a·b/></Ügyfél>';

  test('the read rule accepts XML 1.0 names; the write rule stays ASCII', () => {
    for (const name of ['Dátum', 'Größe', '名前', 'é', 'a·b', 'x́', '_x.y-z']) {
      expect(isXmlNCName(name)).toBe(true);
    }
    for (const name of ['', '1a', '-a', '·a', 'a×b', 'a b', 'a<b', 'a:b', 'a"b', '\uD800']) {
      expect(isXmlNCName(name)).toBe(false);
    }
    expect(isValidNCName('Dátum')).toBe(false);
    expect(isValidQName('ü:Dátum')).toBe(false);
    expect(isXmlNCName(`a${'é'.repeat(100_000)}!`)).toBe(false);
  });

  test('opens, saves, and reopens a custom XML part with non-ASCII names', () => {
    const pkg = opened(build({ 'customXml/item1.xml': ITEM }));
    const part = pkg.parts.get('/customXml/item1.xml');
    expect(part?.root.localName).toBe('Ügyfél');

    const saved = writeOoxmlPackage(pkg);
    const reopened = opened(saved);
    const again = reopened.parts.get('/customXml/item1.xml')!;
    expect(canonicalOoxmlFingerprint(again)).toBe(canonicalOoxmlFingerprint(part!));
    expect(semanticDigest(reopened.parts.values())).toEqual(semanticDigest(pkg.parts.values()));
    const xml = strFromU8(reopened.partBytes.get('/customXml/item1.xml')!);
    for (const name of ['<Ügyfél', '<Größe ñ="1"', '<名前>', ':Dátum', ':é="2"', '<a·b/>']) {
      expect(xml).toContain(name);
    }
  });

  test('still refuses a name outside XML 1.0', () => {
    const result = readOoxmlPackage(build({ 'customXml/item1.xml': '<r><a×b/></r>' }));
    expect(result.ok).toBe(false);
  });
});

describe('malformed content-type records', () => {
  const IMAGE_REL = `${R}/image`;
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
  const pictureDocument =
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
    `<wp:inline xmlns:wp="${WP}"><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="p"/>` +
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}"><pic:pic xmlns:pic="${PIC}">` +
    '<pic:blipFill><a:blip r:embed="rId2"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>' +
    '</wp:inline></w:drawing></w:r></w:p></w:body></w:document>';
  const imageRels =
    `<Relationships xmlns="${REL_NS}">` +
    `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="media/image1.PNG"/>` +
    '</Relationships>';

  test.each([
    ['image/.png', 'image/.png'],
    ['image/', null],
  ])('a Default of %s on an image extension keeps the image rendering', async (type, kept) => {
    const bytes = build({
      '[Content_Types].xml': contentTypes(
        RELS_DEFAULT,
        XML_DEFAULT,
        `<Default Extension="PNG" ContentType="${type}"/>`,
        MAIN_OVERRIDE
      ),
      'word/document.xml': pictureDocument,
      'word/_rels/document.xml.rels': imageRels,
      'word/media/image1.PNG': ONE_PIXEL_PNG,
    });
    const pkg = opened(bytes);
    // A valid token is kept; a malformed one is ignored. The bytes decide the image either way.
    expect(resolveContentTypeOf(pkg, '/word/media/image1.PNG')).toBe(kept);

    const cache = createImageResourceCache(pkg, {
      decodePort: { decode: async () => ({ pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 }) },
    });
    const state = await cache.resolveEmbedded('/word/document.xml', 'rId2');
    expect(state).toMatchObject({ kind: 'ready', mime: 'image/png' });
    cache.dispose();
  });

  test('ignores an invalid Override on an inert image part and keeps the record on save', () => {
    const invalid = '<Override PartName="/extra/images/icon.png" ContentType="image/"/>';
    const bytes = build({
      '[Content_Types].xml': contentTypes(
        RELS_DEFAULT,
        XML_DEFAULT,
        '<Default Extension="png" ContentType="image/png"/>',
        MAIN_OVERRIDE,
        invalid
      ),
      'extra/images/icon.png': ONE_PIXEL_PNG,
    });
    const pkg = opened(bytes);
    // An ignored record is absent: the extension Default decides the part's type.
    expect(resolveContentTypeOf(pkg, '/extra/images/icon.png')).toBe('image/png');

    const saved = writeOoxmlPackage(pkg);
    expect(strFromU8(opened(saved).partBytes.get('/[Content_Types].xml')!)).toContain(invalid);
  });

  test.each(['image/.jpg', 'image/'])(
    'a conventional Default beside a duplicate of %s decides the extension',
    (type) => {
      const pkg = opened(
        build({
          '[Content_Types].xml': contentTypes(
            RELS_DEFAULT,
            XML_DEFAULT,
            `<Default Extension="JPG" ContentType="${type}"/>`,
            '<Default Extension="jpg" ContentType="image/jpeg"/>',
            MAIN_OVERRIDE
          ),
        })
      );
      expect(resolveContentTypeOf(pkg, '/word/media/a.jpg')).toBe('image/jpeg');
    }
  );

  test('a conventional Override beside an extension-style duplicate decides the part', () => {
    const pkg = opened(
      build({
        '[Content_Types].xml': contentTypes(
          RELS_DEFAULT,
          XML_DEFAULT,
          MAIN_OVERRIDE,
          '<Override PartName="/customUI/images/icon.png" ContentType="image/.png"/>',
          '<Override PartName="/customUI/images/icon.png" ContentType="image/png"/>'
        ),
        'customUI/images/icon.png': ONE_PIXEL_PNG,
      })
    );
    expect(resolveContentTypeOf(pkg, '/customUI/images/icon.png')).toBe('image/png');
  });

  test.each([
    [
      '<Default Extension="svg" ContentType="image/.svg+xml"/>',
      'word/media/a.svg',
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x"><svg xmlns="http://www.w3.org/2000/svg"/>',
    ],
    [
      '<Default Extension="bin" ContentType="application/.x+xml"/>',
      'word/embeddings/a.bin',
      '\u0001\u0002',
    ],
    [
      '<Override PartName="/word/media/b.dat" ContentType="*/*+xml"/>',
      'word/media/b.dat',
      'not xml',
    ],
  ])('a part under the extension-style XML type in %s stays bytes', (record, entry, content) => {
    const pkg = opened(
      build({
        '[Content_Types].xml': contentTypes(RELS_DEFAULT, XML_DEFAULT, MAIN_OVERRIDE, record),
        [entry]: content,
      })
    );
    expect(pkg.parts.has(`/${entry}`)).toBe(false);
    const saved = opened(writeOoxmlPackage(pkg));
    expect(strFromU8(saved.partBytes.get(`/${entry}`) ?? saved.partBytes.get(entry)!)).toBe(
      content
    );
  });

  test('conflicting extension-style Defaults are both ignored and kept on save', () => {
    const records = [
      '<Default Extension="JPG" ContentType="image/.jpg"/>',
      '<Default Extension="jpg" ContentType="image/.jpeg"/>',
    ];
    const pkg = opened(
      build({
        '[Content_Types].xml': contentTypes(RELS_DEFAULT, XML_DEFAULT, ...records, MAIN_OVERRIDE),
      })
    );
    expect(resolveContentTypeOf(pkg, '/word/media/a.jpg')).toBeNull();
    const saved = strFromU8(opened(writeOoxmlPackage(pkg)).partBytes.get('/[Content_Types].xml')!);
    for (const record of records) expect(saved).toContain(record);
  });

  test('still refuses conflicting extension-style types on a needed part', () => {
    const bytes = build({
      '[Content_Types].xml': contentTypes(
        RELS_DEFAULT,
        XML_DEFAULT,
        MAIN_OVERRIDE,
        '<Override PartName="/word/styles.xml" ContentType="application/.xml"/>',
        '<Override PartName="/word/styles.xml" ContentType="application/.styles"/>'
      ),
      'word/_rels/document.xml.rels':
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/>` +
        '</Relationships>',
      'word/styles.xml': `<w:styles xmlns:w="${W}"/>`,
    });
    expect(readOoxmlPackage(bytes)).toMatchObject({
      ok: false,
      reason: 'bad-content-types',
      detail: '/word/styles.xml',
    });
  });

  test('still refuses an invalid type on the main document or a relationships part', () => {
    for (const records of [
      [RELS_DEFAULT, XML_DEFAULT, `<Override PartName="/word/document.xml" ContentType="bogus"/>`],
      [RELS_DEFAULT, '<Default Extension="xml" ContentType="application/"/>'],
      ['<Default Extension="rels" ContentType="application/"/>', XML_DEFAULT, MAIN_OVERRIDE],
    ]) {
      expect(
        readOoxmlPackage(build({ '[Content_Types].xml': contentTypes(...records) }))
      ).toMatchObject({ ok: false, reason: 'bad-content-types' });
    }
  });

  test('still refuses an invalid type on a part the main document needs', () => {
    const bytes = build({
      '[Content_Types].xml': contentTypes(
        RELS_DEFAULT,
        XML_DEFAULT,
        MAIN_OVERRIDE,
        '<Override PartName="/word/styles.xml" ContentType="application/"/>'
      ),
      'word/_rels/document.xml.rels':
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/>` +
        '</Relationships>',
      'word/styles.xml': `<w:styles xmlns:w="${W}"/>`,
    });
    expect(readOoxmlPackage(bytes)).toMatchObject({
      ok: false,
      reason: 'bad-content-types',
      detail: '/word/styles.xml',
    });
  });

  test('refuses a dropped Default that decides a non-payload part of the main document', () => {
    const records = [
      RELS_DEFAULT,
      '<Default Extension="xml" ContentType="application/"/>',
      MAIN_OVERRIDE,
    ];
    const related = (type: string) =>
      build({
        '[Content_Types].xml': contentTypes(...records),
        'word/_rels/document.xml.rels':
          `<Relationships xmlns="${REL_NS}">` +
          `<Relationship Id="rId1" Type="${R}/${type}" Target="../customXml/item1.xml"/>` +
          '</Relationships>',
        'customXml/item1.xml': '<r xmlns="urn:example:record"/>',
      });
    expect(readOoxmlPackage(related('customXml'))).toMatchObject({
      ok: false,
      reason: 'bad-content-types',
      detail: '/customXml/item1.xml',
    });
    // The same part as an image payload is identified by its bytes, not its declared type.
    expect(readOoxmlPackage(related('image')).ok).toBe(true);
  });

  test('a conventional Override on a needed part outranks an extension-style duplicate', () => {
    const bytes = build({
      '[Content_Types].xml': contentTypes(
        RELS_DEFAULT,
        XML_DEFAULT,
        MAIN_OVERRIDE,
        '<Override PartName="/word/styles.xml" ContentType="application/.xml"/>',
        `<Override PartName="/word/styles.xml" ContentType="${STYLES_TYPE}"/>`
      ),
      'word/_rels/document.xml.rels':
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/>` +
        '</Relationships>',
      'word/styles.xml': `<w:styles xmlns:w="${W}"/>`,
    });
    expect(opened(bytes).parts.has('/word/styles.xml')).toBe(true);
  });

  test('still refuses conflicting valid Defaults', () => {
    const bytes = build({
      '[Content_Types].xml': contentTypes(
        RELS_DEFAULT,
        XML_DEFAULT,
        '<Default Extension="png" ContentType="image/png"/>',
        '<Default Extension="PNG" ContentType="image/jpeg"/>',
        MAIN_OVERRIDE
      ),
    });
    expect(readOoxmlPackage(bytes)).toMatchObject({ ok: false, reason: 'bad-content-types' });
  });
});
