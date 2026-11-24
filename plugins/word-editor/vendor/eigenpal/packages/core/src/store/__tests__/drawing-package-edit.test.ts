import { describe, expect, test } from 'bun:test';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { sha256FontBytes } from '../../layout/font-resource.ts';
import {
  allocateDrawingPropertyId,
  withBinaryPart,
  fetchExternalImageBytes,
  withEmbeddedImage,
  withoutUnreferencedImagePart,
  type ExternalImageFetchPort,
} from '../package/drawing-package-edit.ts';
import {
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlPackage,
} from '../package/ooxml-package.ts';
import {
  contentTypesPartBytes,
  relationshipsOf,
  resolveContentTypeOf,
} from '../package/package-edit.ts';
import { IMAGE_RELATIONSHIP_TYPE } from '../package/relationships.ts';
import { imageResourceLookupFor } from '../package/image-resources.ts';
import { normalizePartName, partNameKey, resolveInternalTarget } from '../package/opc-names.ts';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOC =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const FOREIGN_CT = 'http://example.com/foreign-content-types';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

const JPEG_1X1 = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11,
  0x00, 0xff, 0xd9,
]);

function contentTypes(extra = ''): string {
  return (
    `<Types xmlns="${CT_NS}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
    '<Default Extension="jpg" ContentType="image/jpeg"/>' +
    '<Default Extension="gif" ContentType="image/gif"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    extra +
    '</Types>'
  );
}

function drawingBody(docPrAttrs: string): string {
  return (
    `<w:body><w:p><w:r><w:drawing><wp:inline xmlns:wp="${WP}">` +
    `<wp:extent cx="914400" cy="914400"/>` +
    `<wp:docPr ${docPrAttrs}/>` +
    '</wp:inline></w:drawing></w:r></w:p></w:body>'
  );
}

function buildPackage(
  options: {
    readonly document?: string;
    readonly header?: { readonly name: string; readonly xml: string; readonly rels: string };
    readonly media?: Record<string, Uint8Array>;
    readonly docRels?: string;
    readonly contentTypesXml?: string;
  } = {}
): OoxmlPackage {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(options.contentTypesXml ?? contentTypes()),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      options.document ??
        `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>empty</w:t></w:r></w:p></w:body></w:document>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      options.docRels ?? `<Relationships xmlns="${REL_NS}"></Relationships>`
    ),
  };
  for (const [name, bytes] of Object.entries(options.media ?? {})) {
    entries[name] = bytes;
  }
  if (options.header) {
    entries[options.header.name] = strToU8(options.header.xml);
    entries[`word/_rels/${options.header.name.slice('word/'.length)}.rels`] = strToU8(
      options.header.rels
    );
    entries['[Content_Types].xml'] = strToU8(
      contentTypes(
        `<Override PartName="/${options.header.name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`
      )
    );
  }
  const loaded = readOoxmlPackage(zipSync(entries));
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

function relationshipTargetsPart(pkg: OoxmlPackage, partName: string): boolean {
  const key = partNameKey(partName);
  for (const records of pkg.relationships.values()) {
    for (const record of records) {
      if (record.targetMode === 'External') continue;
      const resolved = resolveInternalTarget(record.ownerPart, record.rawTarget);
      if (resolved.ok && partNameKey(resolved.partName) === key) return true;
    }
  }
  return false;
}

function partBytesPresent(pkg: OoxmlPackage, partName: string): boolean {
  const normalized = normalizePartName(partName);
  if (!normalized.ok) return false;
  const key = partNameKey(normalized.partName);
  for (const name of pkg.partBytes.keys()) {
    const candidate = normalizePartName(name);
    if (candidate.ok && partNameKey(candidate.partName) === key) return true;
  }
  return false;
}

function partBytesFor(pkg: OoxmlPackage, partName: string): Uint8Array | null {
  const normalized = normalizePartName(partName);
  if (!normalized.ok) return null;
  const key = partNameKey(normalized.partName);
  for (const [name, bytes] of pkg.partBytes) {
    const candidate = normalizePartName(name);
    if (candidate.ok && partNameKey(candidate.partName) === key) return bytes;
  }
  return null;
}

function hashPartBytes(pkg: OoxmlPackage, partName: string): string | null {
  const bytes = partBytesFor(pkg, partName);
  return bytes === null ? null : sha256FontBytes(bytes);
}

function mockDecodePort() {
  const calls = { n: 0 };
  return {
    get calls() {
      return calls.n;
    },
    decode: async () => {
      calls.n += 1;
      return { pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 };
    },
  };
}

function publicFetchPort(
  handler: (url: string) => Promise<{
    status: number;
    location: string | null;
    contentType: string | null;
    body: AsyncIterable<Uint8Array>;
  }>
): ExternalImageFetchPort {
  return {
    requestPublicHttps: async (url) => {
      const response = await handler(url);
      return { ...response, connectedUrl: url };
    },
  };
}

function withoutOwnerRelationships(
  pkg: OoxmlPackage,
  ownerPart: string,
  relationshipIds: readonly string[]
): OoxmlPackage {
  const drop = new Set(relationshipIds);
  const existing = pkg.relationships.get(ownerPart) ?? [];
  return Object.freeze({
    ...pkg,
    relationships: new Map([
      ...pkg.relationships,
      [ownerPart, existing.filter((record) => !drop.has(record.id))],
    ]),
  });
}

function countOverridesForPart(xml: string, partName: string): number {
  const key = partNameKey(partName);
  let count = 0;
  const pattern = /<(?:[\w]+:)?Override\b[^>]*\bPartName="([^"]+)"/g;
  for (const match of xml.matchAll(pattern)) {
    if (partNameKey(match[1] ?? '') === key) count += 1;
  }
  return count;
}

function adversarialContentTypes(targetPart: string): string {
  return (
    `<Types xmlns="${CT_NS}" xmlns:foreign="${FOREIGN_CT}" xmlns:ct="${CT_NS}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
    '<Default Extension="jpg" ContentType="image/jpeg"/>' +
    '<Default Extension="gif" ContentType="image/gif"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    `<foreign:Override PartName="/word/media/decoy.png" ContentType="image/jpeg" foreign:marker="keep-foreign-override">` +
    '<foreign:child xml:space="preserve"> nested </foreign:child>' +
    '</foreign:Override>' +
    `<foreign:Lookalike PartName="${targetPart}" ContentType="image/jpeg" foreign:marker="keep-unqualified-lookalike" ct:PartName="${targetPart}" ct:ContentType="image/jpeg"/>` +
    `<Override PartName="${targetPart}" ContentType="image/jpeg" data-preserve="alpha"/>` +
    `<Override PartName="${targetPart}" ContentType="image/jpeg" data-preserve="beta"/>` +
    '</Types>'
  );
}

function adversarialContentTypesMissingContentType(targetPart: string): string {
  return (
    `<Types xmlns="${CT_NS}" xmlns:foreign="${FOREIGN_CT}" xmlns:ct="${CT_NS}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
    '<Default Extension="jpg" ContentType="image/jpeg"/>' +
    '<Default Extension="gif" ContentType="image/gif"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    `<foreign:Override PartName="/word/media/decoy.png" ContentType="image/jpeg" foreign:marker="keep-foreign-override">` +
    '<foreign:child xml:space="preserve"> nested </foreign:child>' +
    '</foreign:Override>' +
    `<foreign:Lookalike PartName="${targetPart}" ContentType="image/jpeg" foreign:marker="keep-unqualified-lookalike" ct:PartName="${targetPart}" ct:ContentType="image/jpeg"/>` +
    `<Override PartName="${targetPart}" data-preserve="missing-type"/>` +
    '</Types>'
  );
}

function readContentTypesPart(pkg: OoxmlPackage): OoxmlPart | null {
  const entry = contentTypesPartBytes(pkg);
  if (!entry) return null;
  const parsed = readOoxmlPart(strFromU8(entry.bytes), {
    name: '/[Content_Types].xml',
    contentType: 'application/xml',
  });
  return parsed.ok ? parsed.part : null;
}

function unqualifiedAttribute(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue') return undefined;
  return node.attributes.find(
    (attribute) => attribute.localName === localName && attribute.namespaceUri === ''
  )?.value;
}

function isRealTargetOverride(node: OoxmlNode, targetPart: string): boolean {
  if (node.kind !== 'generic') return false;
  if (node.namespaceUri !== CT_NS || node.localName !== 'Override') return false;
  const partName = unqualifiedAttribute(node, 'PartName');
  const contentType = unqualifiedAttribute(node, 'ContentType');
  return (
    partName !== undefined &&
    contentType !== undefined &&
    partNameKey(partName) === partNameKey(targetPart)
  );
}

function preservedContentTypesFingerprints(part: OoxmlPart, targetPart: string): readonly string[] {
  const root = part.root;
  if (root.kind !== 'generic') return [];
  return root.children
    .filter((child) => !isRealTargetOverride(child, targetPart))
    .map((child) => canonicalOoxmlFingerprint(child));
}

function realTargetOverrides(part: OoxmlPart, targetPart: string): readonly OoxmlNode[] {
  const root = part.root;
  if (root.kind !== 'generic') return [];
  return root.children.filter((child) => isRealTargetOverride(child, targetPart));
}

function buildSharedMediaPackage(
  options: {
    readonly documentRef?: boolean;
    readonly headerRef?: boolean;
    readonly nestedRelativeRef?: boolean;
  } = {}
): OoxmlPackage {
  const documentRef = options.documentRef !== false;
  const headerRef = options.headerRef !== false;
  const nestedRelativeRef = options.nestedRelativeRef === true;

  const docRels: string[] = [];
  if (documentRef) {
    docRels.push(
      `<Relationship Id="rId2" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="media/shared.png"/>`
    );
  }

  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes()),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>body</w:t></w:r></w:p></w:body></w:document>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">${docRels.join('')}</Relationships>`
    ),
    'word/media/shared.png': PNG_1X1,
  };

  if (headerRef) {
    entries['word/header1.xml'] = strToU8(
      `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>h</w:t></w:r></w:p></w:hdr>`
    );
    entries['word/_rels/header1.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId2" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="media/shared.png"/>` +
        '</Relationships>'
    );
    entries['[Content_Types].xml'] = strToU8(
      contentTypes(
        `<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`
      )
    );
  }

  if (nestedRelativeRef) {
    entries['word/nested/owner.xml'] = strToU8('<x/>');
    entries['word/nested/_rels/owner.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId9" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="../media/shared.png"/>` +
        '</Relationships>'
    );
  }

  const loaded = readOoxmlPackage(zipSync(entries));
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

describe('allocates docPr ids', () => {
  test('starts at 1 on an empty package', () => {
    const pkg = buildPackage();
    expect(allocateDrawingPropertyId(pkg)).toEqual({ ok: true, id: 1 });
  });

  test('allocates above the highest valid id rather than filling a lower gap', () => {
    const pkg = buildPackage({
      document: `<w:document xmlns:w="${W}" xmlns:wp="${WP}">${drawingBody('id="1" name="a"')}${drawingBody('id="100" name="b"')}</w:document>`,
    });
    expect(allocateDrawingPropertyId(pkg)).toEqual({ ok: true, id: 101 });
  });

  test('ignores zero, negative, duplicate, and out-of-range authored ids', () => {
    const pkg = buildPackage({
      document:
        `<w:document xmlns:w="${W}" xmlns:wp="${WP}">` +
        drawingBody('id="0" name="zero"') +
        drawingBody('id="-3" name="neg"') +
        drawingBody('id="4294967296" name="oor"') +
        drawingBody('id="5" name="a"') +
        drawingBody('id="5" name="dup"') +
        drawingBody('id="not-a-number" name="nan"') +
        '</w:document>',
    });
    expect(allocateDrawingPropertyId(pkg)).toEqual({ ok: true, id: 6 });
  });

  test('never takes a legacy VML shape number', () => {
    const vml = (id: string) =>
      `<w:p><w:r><w:pict xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">` +
      `<v:shape ${id} style="width:10pt;height:10pt"/></w:pict></w:r></w:p>`;
    const pkg = buildPackage({
      document:
        `<w:document xmlns:w="${W}" xmlns:wp="${WP}">` +
        drawingBody('id="1025" name="a"').replace(
          '</w:body>',
          `${vml('id="_x0000_s1026"')}${vml('id="Text Box 3" o:spid="_x0000_s1027"')}` +
            `${vml('id="_x0000_i4000"')}</w:body>`
        ) +
        '</w:document>',
    });
    // The numbers are skipped, not raised past: the next drawing id stays dense.
    expect(allocateDrawingPropertyId(pkg)).toEqual({ ok: true, id: 1028 });
  });

  test('counts valid ids in headers and footers', () => {
    const pkg = buildPackage({
      document: `<w:document xmlns:w="${W}" xmlns:wp="${WP}">${drawingBody('id="3" name="body"')}</w:document>`,
      header: {
        name: 'word/header1.xml',
        xml: `<w:hdr xmlns:w="${W}" xmlns:wp="${WP}"><w:p><w:r><w:drawing><wp:inline xmlns:wp="${WP}"><wp:docPr id="2147483647" name="hdr"/></wp:inline></w:drawing></w:r></w:p></w:hdr>`,
        rels: `<Relationships xmlns="${REL_NS}"></Relationships>`,
      },
    });
    expect(allocateDrawingPropertyId(pkg)).toEqual({ ok: true, id: 2147483648 });
  });

  test('scans generic preserved wp:docPr nodes', () => {
    const pkg = buildPackage({
      document:
        `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:drawing>` +
        `<wp:inline xmlns:wp="${WP}"><wp:docPr id="42" name="typed"/></wp:inline>` +
        `<wp:anchor xmlns:wp="${WP}"><wp:docPr id="43" name="generic"/></wp:anchor>` +
        '</w:drawing></w:r></w:p></w:body></w:document>',
    });
    expect(allocateDrawingPropertyId(pkg)).toEqual({ ok: true, id: 44 });
  });

  test('is deterministic for repeated calls on the same package snapshot', () => {
    const pkg = buildPackage({
      document: `<w:document xmlns:w="${W}" xmlns:wp="${WP}">${drawingBody('id="9" name="x"')}</w:document>`,
    });
    expect(allocateDrawingPropertyId(pkg)).toEqual(allocateDrawingPropertyId(pkg));
  });

  test('returns invalidArgs at unsigned 32-bit exhaustion without scanning billions of ids', () => {
    const pkg = buildPackage({
      document: `<w:document xmlns:w="${W}" xmlns:wp="${WP}">${drawingBody('id="4294967295" name="max"')}</w:document>`,
    });
    const started = performance.now();
    expect(allocateDrawingPropertyId(pkg)).toEqual({ ok: false, reason: 'invalidArgs' });
    expect(performance.now() - started).toBeLessThan(50);
  });

  test('accepts xsd:unsignedInt whitespace, optional plus, and leading zeroes', () => {
    const pkg = buildPackage({
      document:
        `<w:document xmlns:w="${W}" xmlns:wp="${WP}">` +
        drawingBody('id="  +0000000042  " name="ws"') +
        drawingBody('id="0000000042" name="lead"') +
        '</w:document>',
    });
    expect(allocateDrawingPropertyId(pkg)).toEqual({ ok: true, id: 43 });
  });

  test('rejects huge digit strings without duplicate allocation', () => {
    const huge = `+${'0'.repeat(50_000)}12345678901`;
    const pkg = buildPackage({
      document:
        `<w:document xmlns:w="${W}" xmlns:wp="${WP}">` +
        drawingBody(`id="${huge}" name="huge"`) +
        drawingBody('id="5" name="real"') +
        '</w:document>',
    });
    const started = performance.now();
    expect(allocateDrawingPropertyId(pkg)).toEqual({ ok: true, id: 6 });
    expect(performance.now() - started).toBeLessThan(50);
  });

  test('rejects internal whitespace and signed negatives without counting toward max', () => {
    const pkg = buildPackage({
      document:
        `<w:document xmlns:w="${W}" xmlns:wp="${WP}">` +
        drawingBody('id="42 0" name="space"') +
        drawingBody('id="-7" name="neg"') +
        drawingBody('id="4294967296" name="oor"') +
        drawingBody('id="7" name="valid"') +
        '</w:document>',
    });
    expect(allocateDrawingPropertyId(pkg)).toEqual({ ok: true, id: 8 });
  });

  test('ignores namespaced and foreign id attributes on typed and generic docPr nodes', () => {
    const pkg = buildPackage({
      document:
        `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:r="${R}" xmlns:a="${A}">` +
        `<w:body><w:p><w:r><w:drawing>` +
        `<wp:inline xmlns:wp="${WP}"><wp:docPr id="11" r:id="99" a:id="88" name="typed"/></wp:inline>` +
        `<wp:anchor xmlns:wp="${WP}"><wp:docPr r:id="77" name="generic"/></wp:anchor>` +
        `</w:drawing></w:r></w:p></w:body></w:document>`,
    });
    expect(allocateDrawingPropertyId(pkg)).toEqual({ ok: true, id: 12 });
  });
});

describe('embeds image package state', () => {
  test('withBinaryPart stores bytes and an exact content type override', () => {
    const before = buildPackage();
    const partName = 'word/media/custom.bin';
    const bytes = new Uint8Array([1, 2, 3]);
    const after = withBinaryPart(before, partName, bytes, 'application/octet-stream');
    expect(after).not.toBe(before);
    expect(partBytesPresent(after, partName)).toBe(true);
    expect(resolveContentTypeOf(after, '/word/media/custom.bin')).toBe('application/octet-stream');

    const reopened = readOoxmlPackage(writeOoxmlPackage(after));
    expect(reopened.ok).toBe(true);
    if (reopened.ok) {
      expect(resolveContentTypeOf(reopened.package, '/word/media/custom.bin')).toBe(
        'application/octet-stream'
      );
    }
  });

  test('withEmbeddedImage validates bytes, adds media, relationship, and docPr id', () => {
    const pkg = buildPackage();
    const result = withEmbeddedImage(pkg, '/word/document.xml', {
      bytes: PNG_1X1,
      mime: 'image/png',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.docPrId).toBe(1);
    expect(result.partName).toMatch(/\/word\/media\/image1\.png$/i);
    expect(partBytesPresent(result.pkg, result.partName)).toBe(true);
    expect(resolveContentTypeOf(result.pkg, result.partName)).toBe('image/png');

    const rel = relationshipsOf(result.pkg, '/word/document.xml').find(
      (record) => record.id === result.relationshipId
    );
    expect(rel?.type).toBe(IMAGE_RELATIONSHIP_TYPE);
    expect(rel?.rawTarget).toBe('media/image1.png');

    const resolved = resolveInternalTarget('/word/document.xml', rel!.rawTarget);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(partNameKey(resolved.partName)).toBe(partNameKey(result.partName));
    }

    const reopened = readOoxmlPackage(writeOoxmlPackage(result.pkg));
    expect(reopened.ok).toBe(true);
    if (reopened.ok) {
      expect(partBytesPresent(reopened.package, result.partName)).toBe(true);
    }
  });

  test('withEmbeddedImage rejects invalid image bytes', () => {
    const pkg = buildPackage();
    const result = withEmbeddedImage(pkg, '/word/document.xml', {
      bytes: new Uint8Array([0, 1, 2]),
      mime: 'image/png',
    });
    expect(result).toEqual({ ok: false, reason: 'invalid-image' });
    expect(relationshipsOf(pkg, '/word/document.xml').length).toBe(0);
  });

  test('withEmbeddedImage picks the next collision-free media name', () => {
    const pkg = buildPackage({
      media: {
        'word/media/image1.png': PNG_1X1,
        'word/media/image2.jpeg': JPEG_1X1,
      },
      docRels:
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId2" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="media/image1.png"/>` +
        `<Relationship Id="rId3" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="media/image2.jpeg"/>` +
        '</Relationships>',
    });
    const png = withEmbeddedImage(pkg, '/word/document.xml', { bytes: PNG_1X1, mime: 'image/png' });
    expect(png.ok).toBe(true);
    if (!png.ok) return;
    expect(png.partName).toMatch(/image2\.png$/i);

    const jpeg = withEmbeddedImage(png.pkg, '/word/document.xml', {
      bytes: JPEG_1X1,
      mime: 'image/jpeg',
    });
    expect(jpeg.ok).toBe(true);
    if (!jpeg.ok) return;
    expect(jpeg.partName).toMatch(/image1\.jpeg$/i);
  });

  test('withoutUnreferencedImagePart removes an orphaned media part and override', () => {
    const embedded = withEmbeddedImage(buildPackage(), '/word/document.xml', {
      bytes: PNG_1X1,
      mime: 'image/png',
    });
    expect(embedded.ok).toBe(true);
    if (!embedded.ok) return;

    const rels = relationshipsOf(embedded.pkg, '/word/document.xml');
    const withoutRel = Object.freeze({
      ...embedded.pkg,
      relationships: new Map([
        ...embedded.pkg.relationships,
        ['/word/document.xml', rels.filter((record) => record.id !== embedded.relationshipId)],
      ]),
    });

    const cleaned = withoutUnreferencedImagePart(withoutRel, embedded.partName);
    expect(cleaned).not.toBe(withoutRel);
    expect(partBytesPresent(cleaned, embedded.partName)).toBe(false);
    const normalized = normalizePartName(embedded.partName);
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(cleaned.contentTypes.overrides.has(partNameKey(normalized.partName))).toBe(false);
    }
  });

  test('withoutUnreferencedImagePart is a no-op while any relationship still targets the part', () => {
    const embedded = withEmbeddedImage(buildPackage(), '/word/document.xml', {
      bytes: PNG_1X1,
      mime: 'image/png',
    });
    expect(embedded.ok).toBe(true);
    if (!embedded.ok) return;
    expect(relationshipTargetsPart(embedded.pkg, embedded.partName)).toBe(true);
    expect(withoutUnreferencedImagePart(embedded.pkg, embedded.partName)).toBe(embedded.pkg);
  });

  test('withBinaryPart copies bytes so input mutation cannot alias package storage', () => {
    const before = buildPackage();
    const input = new Uint8Array([1, 2, 3]);
    const after = withBinaryPart(before, 'word/media/copy.png', input, 'image/png');
    const beforeHash = hashPartBytes(before, 'word/media/copy.png');
    const afterHash = hashPartBytes(after, 'word/media/copy.png');
    expect(beforeHash).toBeNull();
    expect(afterHash).not.toBeNull();

    input[0] = 99;
    expect(hashPartBytes(before, 'word/media/copy.png')).toBe(beforeHash);
    expect(hashPartBytes(after, 'word/media/copy.png')).toBe(afterHash);
    expect(afterHash).not.toBe(sha256FontBytes(input));
  });

  test('withEmbeddedImage snapshot isolates bytes from cache state after input mutation', async () => {
    const input = new Uint8Array(PNG_1X1);
    const embedded = withEmbeddedImage(buildPackage(), '/word/document.xml', {
      bytes: input,
      mime: 'image/png',
    });
    expect(embedded.ok).toBe(true);
    if (!embedded.ok) return;

    const hashBefore = hashPartBytes(embedded.pkg, embedded.partName);
    const decode = mockDecodePort();
    const lookup = imageResourceLookupFor(embedded.pkg, { decodePort: decode });
    const ready = await lookup.resolveEmbedded('/word/document.xml', embedded.relationshipId);
    expect(ready.kind).toBe('ready');
    if (ready.kind !== 'ready') return;

    input[10] = input[10]! ^ 0xff;
    expect(hashPartBytes(embedded.pkg, embedded.partName)).toBe(hashBefore);
    const again = await lookup.resolveEmbedded('/word/document.xml', embedded.relationshipId);
    expect(again).toBe(ready);
    expect(decode.calls).toBe(1);
  });

  test('withoutUnreferencedImagePart refuses non-image and non-media parts by identity', () => {
    const pkg = buildPackage({
      media: { 'word/custom.xml': strToU8('<x/>') },
    });
    expect(withoutUnreferencedImagePart(pkg, 'word/custom.xml')).toBe(pkg);

    const binary = withBinaryPart(
      pkg,
      'word/media/custom.bin',
      new Uint8Array([1]),
      'application/octet-stream'
    );
    expect(withoutUnreferencedImagePart(binary, 'word/media/custom.bin')).toBe(binary);
  });

  test('withEmbeddedImage avoids uppercase media name collisions', () => {
    const pkg = buildPackage({
      media: { 'word/media/IMAGE1.png': PNG_1X1 },
      docRels:
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId2" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="media/IMAGE1.png"/>` +
        '</Relationships>',
    });
    const added = withEmbeddedImage(pkg, '/word/document.xml', {
      bytes: PNG_1X1,
      mime: 'image/png',
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.partName).toMatch(/image2\.png$/i);
  });

  test('cleanup stays blocked across owners and succeeds only when all internal refs are gone', () => {
    const both = buildSharedMediaPackage({ documentRef: true, headerRef: true });
    expect(resolveInternalTarget('/word/document.xml', 'media/shared.png').ok).toBe(true);
    expect(resolveInternalTarget('/word/header1.xml', 'media/shared.png').ok).toBe(true);
    expect(withoutUnreferencedImagePart(both, '/word/media/shared.png')).toBe(both);

    const headerOnly = withoutOwnerRelationships(both, '/word/document.xml', ['rId2']);
    expect(withoutUnreferencedImagePart(headerOnly, '/word/media/shared.png')).toBe(headerOnly);

    const none = withoutOwnerRelationships(headerOnly, '/word/header1.xml', ['rId2']);
    const cleaned = withoutUnreferencedImagePart(none, '/word/media/shared.png');
    expect(cleaned).not.toBe(none);
    expect(partBytesPresent(cleaned, '/word/media/shared.png')).toBe(false);
  });

  test('normalized ../media target blocks cleanup for the owner that resolves it', () => {
    const pkg = buildSharedMediaPackage({
      documentRef: false,
      headerRef: false,
      nestedRelativeRef: true,
    });
    const resolved = resolveInternalTarget('/word/nested/owner.xml', '../media/shared.png');
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(partNameKey(resolved.partName)).toBe(partNameKey('/word/media/shared.png'));
    }
    expect(withoutUnreferencedImagePart(pkg, '/word/media/shared.png')).toBe(pkg);

    const unref = withoutOwnerRelationships(pkg, '/word/nested/owner.xml', ['rId9']);
    const cleaned = withoutUnreferencedImagePart(unref, '/word/media/shared.png');
    expect(cleaned).not.toBe(unref);
    expect(partBytesPresent(cleaned, '/word/media/shared.png')).toBe(false);
  });

  test('external same-string target does not block orphan image cleanup', () => {
    const embedded = withEmbeddedImage(buildPackage(), '/word/document.xml', {
      bytes: PNG_1X1,
      mime: 'image/png',
    });
    expect(embedded.ok).toBe(true);
    if (!embedded.ok) return;

    const rels = relationshipsOf(embedded.pkg, '/word/document.xml');
    const externalOnly = Object.freeze({
      ...embedded.pkg,
      relationships: new Map([
        ...embedded.pkg.relationships,
        [
          '/word/document.xml',
          [
            ...rels.filter((record) => record.id !== embedded.relationshipId),
            {
              ownerPart: '/word/document.xml',
              id: 'rIdExternal',
              type: IMAGE_RELATIONSHIP_TYPE,
              rawTarget: 'media/image1.png',
              targetMode: 'External' as const,
              order: rels.length,
            },
          ],
        ],
      ]),
    });

    const cleaned = withoutUnreferencedImagePart(externalOnly, embedded.partName);
    expect(cleaned).not.toBe(externalOnly);
    expect(partBytesPresent(cleaned, embedded.partName)).toBe(false);
  });

  test('withBinaryPart writes an explicit Override even when a Default already matches', () => {
    const after = withBinaryPart(buildPackage(), 'word/media/image9.png', PNG_1X1, 'image/png');
    const normalized = normalizePartName('word/media/image9.png');
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(after.contentTypes.overrides.get(partNameKey(normalized.partName))).toBe('image/png');

    const entry = contentTypesPartBytes(after);
    expect(entry).not.toBeNull();
    if (!entry) return;
    const xml = strFromU8(entry.bytes);
    expect(xml).toContain('PartName="/word/media/image9.png"');
    expect(xml).toContain('ContentType="image/png"');
    expect(xml).toContain('<Override');
    expect(countOverridesForPart(xml, normalized.partName)).toBe(1);
  });

  test('withBinaryPart replaces an existing different Override without duplicating', () => {
    const partName = '/word/media/retyped.png';
    const seeded = withBinaryPart(buildPackage(), partName, PNG_1X1, 'image/jpeg');
    const entryBefore = contentTypesPartBytes(seeded);
    expect(entryBefore).not.toBeNull();
    if (!entryBefore) return;
    expect(countOverridesForPart(strFromU8(entryBefore.bytes), partName)).toBe(1);

    const retyped = withBinaryPart(seeded, partName, PNG_1X1, 'image/png');
    expect(resolveContentTypeOf(retyped, partName)).toBe('image/png');
    const entryAfter = contentTypesPartBytes(retyped);
    expect(entryAfter).not.toBeNull();
    if (!entryAfter) return;
    const xml = strFromU8(entryAfter.bytes);
    expect(countOverridesForPart(xml, partName)).toBe(1);
    expect(xml).toMatch(
      new RegExp(
        `<Override[^>]*ContentType="image/png"[^>]*PartName="${partName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`
      )
    );

    const reopened = readOoxmlPackage(writeOoxmlPackage(retyped));
    expect(reopened.ok).toBe(true);
    if (reopened.ok) {
      expect(resolveContentTypeOf(reopened.package, partName)).toBe('image/png');
    }
  });

  test('withBinaryPart does not duplicate Override when the same type is forced again', () => {
    const partName = '/word/media/stable.png';
    const once = withBinaryPart(buildPackage(), partName, PNG_1X1, 'image/png');
    const twice = withBinaryPart(once, partName, PNG_1X1, 'image/png');
    expect(twice).toBe(once);
    const entry = contentTypesPartBytes(twice);
    expect(entry).not.toBeNull();
    if (!entry) return;
    expect(countOverridesForPart(strFromU8(entry.bytes), partName)).toBe(1);
    expect([...twice.contentTypes.defaults.entries()]).toEqual([
      ...once.contentTypes.defaults.entries(),
    ]);
  });

  test('withBinaryPart retypes only real OPC Override nodes and preserves foreign lookalikes', () => {
    const targetPart = '/word/media/target.png';
    const seeded = buildPackage({
      contentTypesXml: adversarialContentTypes(targetPart),
      media: { 'word/media/target.png': JPEG_1X1 },
    });
    expect(resolveContentTypeOf(seeded, targetPart)).toBe('image/jpeg');
    const beforePart = readContentTypesPart(seeded);
    expect(beforePart).not.toBeNull();
    if (!beforePart) return;
    expect(realTargetOverrides(beforePart, targetPart)).toHaveLength(2);
    const preservedBefore = preservedContentTypesFingerprints(beforePart, targetPart);

    const retyped = withBinaryPart(seeded, targetPart, PNG_1X1, 'image/png');
    expect(resolveContentTypeOf(retyped, targetPart)).toBe('image/png');
    const afterPart = readContentTypesPart(retyped);
    expect(afterPart).not.toBeNull();
    if (!afterPart) return;

    expect(preservedContentTypesFingerprints(afterPart, targetPart)).toEqual(preservedBefore);
    const surviving = realTargetOverrides(afterPart, targetPart);
    expect(surviving).toHaveLength(1);
    expect(unqualifiedAttribute(surviving[0]!, 'ContentType')).toBe('image/png');
    expect(unqualifiedAttribute(surviving[0]!, 'PartName')).toBe(targetPart);
    const preserve =
      surviving[0]!.kind === 'generic'
        ? surviving[0].attributes.find(
            (attribute) => attribute.localName === 'data-preserve' && attribute.namespaceUri === ''
          )?.value
        : undefined;
    expect(preserve).toBe('alpha');

    const entry = contentTypesPartBytes(retyped);
    expect(entry).not.toBeNull();
    if (!entry) return;
    const xml = strFromU8(entry.bytes);
    expect(xml).toContain('foreign:marker="keep-foreign-override"');
    expect(xml).toContain('foreign:marker="keep-unqualified-lookalike"');
    expect(xml).toContain('<foreign:child');
    expect(xml).not.toMatch(
      new RegExp(
        `<Override[^>]*ContentType="image/jpeg"[^>]*PartName="${targetPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`
      )
    );

    const reopened = readOoxmlPackage(writeOoxmlPackage(retyped));
    expect(reopened.ok).toBe(true);
    if (reopened.ok) {
      expect(resolveContentTypeOf(reopened.package, targetPart)).toBe('image/png');
    }
  });

  test('withBinaryPart appends Override in the OPC namespace with unqualified attributes', () => {
    const partName = '/word/media/fresh.png';
    const after = withBinaryPart(buildPackage(), partName, PNG_1X1, 'image/png');
    const part = readContentTypesPart(after);
    expect(part).not.toBeNull();
    if (!part) return;
    const root = part.root;
    expect(root.kind).toBe('generic');
    if (root.kind !== 'generic') return;

    const appended = root.children.find((child) => isRealTargetOverride(child, partName));
    expect(appended?.kind).toBe('generic');
    if (appended?.kind !== 'generic') return;
    expect(appended.namespaceUri).toBe(CT_NS);
    expect(appended.localName).toBe('Override');
    expect(unqualifiedAttribute(appended, 'PartName')).toBe(partName);
    expect(unqualifiedAttribute(appended, 'ContentType')).toBe('image/png');
    for (const name of ['PartName', 'ContentType'] as const) {
      const attribute = appended.attributes.find((candidate) => candidate.localName === name);
      expect(attribute?.namespaceUri).toBe('');
    }
  });

  test('withBinaryPart appends a real Override when only malformed same-part lookalikes exist', () => {
    const targetPart = '/word/media/target.png';
    const seeded = buildPackage({
      contentTypesXml: adversarialContentTypesMissingContentType(targetPart),
      media: { 'word/media/target.png': JPEG_1X1 },
    });
    expect(resolveContentTypeOf(seeded, targetPart)).toBe('image/png');
    const beforePart = readContentTypesPart(seeded);
    expect(beforePart).not.toBeNull();
    if (!beforePart) return;
    expect(realTargetOverrides(beforePart, targetPart)).toHaveLength(0);
    const preservedBefore = preservedContentTypesFingerprints(beforePart, targetPart);

    const after = withBinaryPart(seeded, targetPart, PNG_1X1, 'image/png');
    expect(resolveContentTypeOf(after, targetPart)).toBe('image/png');
    const afterPart = readContentTypesPart(after);
    expect(afterPart).not.toBeNull();
    if (!afterPart) return;

    expect(preservedContentTypesFingerprints(afterPart, targetPart)).toEqual(preservedBefore);
    const realOverrides = realTargetOverrides(afterPart, targetPart);
    expect(realOverrides).toHaveLength(1);
    expect(unqualifiedAttribute(realOverrides[0]!, 'ContentType')).toBe('image/png');
    expect(unqualifiedAttribute(realOverrides[0]!, 'PartName')).toBe(targetPart);

    const entry = contentTypesPartBytes(after);
    expect(entry).not.toBeNull();
    if (!entry) return;
    const xml = strFromU8(entry.bytes);
    expect(xml).toContain('data-preserve="missing-type"');
    expect(xml).toContain('foreign:marker="keep-foreign-override"');
    expect(xml).toContain('foreign:marker="keep-unqualified-lookalike"');
    expect(realTargetOverrides(afterPart, targetPart)).toHaveLength(1);

    const reopened = readOoxmlPackage(writeOoxmlPackage(after));
    expect(reopened.ok).toBe(true);
    if (reopened.ok) {
      expect(resolveContentTypeOf(reopened.package, targetPart)).toBe('image/png');
    }
  });
});

function firstParagraphId(part: OoxmlPart): string {
  const body = part.root.children.find((child) => child.kind === 'body');
  if (!body || body.kind === 'textValue') throw new Error('no body');
  const paragraph = body.children.find((child) => child.kind === 'paragraph');
  if (!paragraph) throw new Error('no paragraph');
  return paragraph.id;
}

function countDrawings(part: OoxmlPart): number {
  let count = 0;
  const walk = (node: OoxmlPart['root']): void => {
    if (node.kind === 'drawing') count += 1;
    if (node.kind === 'textValue') return;
    for (const child of node.children) walk(child as OoxmlPart['root']);
  };
  walk(part.root);
  return count;
}

function docPrIdOf(part: OoxmlPart): string | undefined {
  const walk = (node: OoxmlPart['root']): string | undefined => {
    if (node.kind === 'drawingDocPr') {
      return node.attributes.find((a) => a.localName === 'id' && a.namespaceUri === '')?.value;
    }
    if (node.kind === 'textValue') return undefined;
    for (const child of node.children) {
      const found = walk(child as OoxmlPart['root']);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return walk(part.root);
}

describe('inserts an image atomically', () => {
  test('commits one event, one history entry, media, rel, override, and docPr', async () => {
    const { TreePackageStore } = await import('../store/tree-package-store.ts');
    const { semanticDigest, diffSemanticDigests } = await import('../package/ooxml-digest.ts');
    const pkg = buildPackage({
      document: `<w:document xmlns:w="${W}"><w:body><w:p><w:r></w:r></w:p></w:body></w:document>`,
    });
    const main = pkg.parts.get('/word/document.xml');
    if (!main) throw new Error('no main');
    const store = new TreePackageStore(pkg, main);
    const paragraphId = firstParagraphId(store.bodyStore().part);
    const revisions: number[] = [];
    store.subscribe((change) => revisions.push(change.toRevision));

    const inserted = await store.insertImage(
      { kind: 'body' },
      {
        paragraphId,
        offset: 0,
        bytes: PNG_1X1,
        mime: 'image/png',
        widthPoints: 12,
        heightPoints: 12,
        title: 'Title',
        description: 'Description',
        expectedPackageRevision: store.packageRevision,
        expectedPackageRevision: store.packageRevision,

        decodePort: mockDecodePort(),
      }
    );
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    expect(revisions).toHaveLength(1);
    expect(store.canUndo).toBe(true);
    expect(store.bodyStore().historyDepth).toBe(0);

    const after = store.currentPackage();
    expect(countDrawings(after.parts.get('/word/document.xml')!)).toBe(1);
    expect(docPrIdOf(after.parts.get('/word/document.xml')!)).toBe('1');
    expect(relationshipsOf(after, '/word/document.xml').length).toBe(1);
    expect(partBytesPresent(after, '/word/media/image1.png')).toBe(true);
    expect(resolveContentTypeOf(after, '/word/media/image1.png')).toBe('image/png');

    const reopened = readOoxmlPackage(writeOoxmlPackage(after));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(canonicalOoxmlFingerprint(reopened.package.parts.get('/word/document.xml')!)).toBe(
      canonicalOoxmlFingerprint(after.parts.get('/word/document.xml')!)
    );
    expect(
      diffSemanticDigests(
        semanticDigest([after.parts.get('/word/document.xml')!]),
        semanticDigest([reopened.package.parts.get('/word/document.xml')!])
      )
    ).toEqual([]);

    store.undo();
    expect(countDrawings(store.currentPackage().parts.get('/word/document.xml')!)).toBe(0);
    expect(partBytesPresent(store.currentPackage(), '/word/media/image1.png')).toBe(false);

    store.redo();
    expect(countDrawings(store.currentPackage().parts.get('/word/document.xml')!)).toBe(1);
    expect(partBytesPresent(store.currentPackage(), '/word/media/image1.png')).toBe(true);
  });

  test('refuses invalid bytes without publishing', async () => {
    const { TreePackageStore } = await import('../store/tree-package-store.ts');
    const pkg = buildPackage({
      document: `<w:document xmlns:w="${W}"><w:body><w:p><w:r></w:r></w:p></w:body></w:document>`,
    });
    const main = pkg.parts.get('/word/document.xml')!;
    const store = new TreePackageStore(pkg, main);
    const paragraphId = firstParagraphId(store.bodyStore().part);
    const revisions: number[] = [];
    store.subscribe((change) => revisions.push(change.toRevision));

    const refused = await store.insertImage(
      { kind: 'body' },
      {
        paragraphId,
        offset: 0,
        bytes: new Uint8Array([1, 2, 3]),
        mime: 'image/png',
        widthPoints: 12,
        heightPoints: 12,
        expectedPackageRevision: store.packageRevision,
        expectedPackageRevision: store.packageRevision,

        decodePort: mockDecodePort(),
      }
    );
    expect(refused.ok).toBe(false);
    expect(revisions).toHaveLength(0);
    expect(store.canUndo).toBe(false);
    expect(countDrawings(store.currentPackage().parts.get('/word/document.xml')!)).toBe(0);
  });
});

describe('replaces shared and unshared image media', () => {
  test('keeps shared bytes until the last reference is replaced', async () => {
    const { TreePackageStore } = await import('../store/tree-package-store.ts');
    const { readOoxmlPart } = await import('../package/ooxml-tree.ts');
    const sharedXml =
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      '<w:body><w:p><w:r><w:drawing>' +
      '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="12700" cy="12700"/>' +
      '<wp:docPr id="1" name=""/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId2"/></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:ext cx="12700" cy="12700"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>';
    const bodyPart = readOoxmlPart(sharedXml, {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    });
    if (!bodyPart.ok) throw new Error(bodyPart.reason);
    let pkg = buildPackage({
      media: { 'word/media/shared.png': PNG_1X1 },
      docRels:
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId2" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="media/shared.png"/>` +
        '</Relationships>',
    });
    pkg = { ...pkg, parts: new Map([...pkg.parts, ['/word/document.xml', bodyPart.part]]) };
    const store = new TreePackageStore(pkg, bodyPart.part);
    const drawingId = store
      .bodyStore()
      .part.root.children.find((c) => c.kind === 'body')!
      .children.find((c) => c.kind === 'paragraph')!
      .children.find((c) => c.kind === 'run')!
      .children.find((c) => c.kind === 'drawing')!.id;

    const replaced = await store.replaceImage(
      { kind: 'body' },
      drawingId,
      JPEG_1X1,
      'image/jpeg',
      mockDecodePort(),
      { expectedPackageRevision: store.packageRevision }
    );
    expect(replaced.ok).toBe(true);
    expect(partBytesPresent(store.currentPackage(), '/word/media/shared.png')).toBe(false);
    expect(partBytesPresent(store.currentPackage(), '/word/media/image1.jpeg')).toBe(true);

    store.undo();
    expect(partBytesPresent(store.currentPackage(), '/word/media/shared.png')).toBe(true);
    expect(hashPartBytes(store.currentPackage(), '/word/media/shared.png')).toBe(
      sha256FontBytes(PNG_1X1)
    );
  });
});

describe('deletes image media only when orphaned', () => {
  test('removes sole-reference media and keeps shared media', async () => {
    const { TreePackageStore } = await import('../store/tree-package-store.ts');
    const pkg = buildSharedMediaPackage({ documentRef: true, headerRef: true });
    const main = pkg.parts.get('/word/document.xml')!;
    const store = new TreePackageStore(pkg, main);

    const inserted = await store.insertImage(
      { kind: 'body' },
      {
        paragraphId: firstParagraphId(store.bodyStore().part),
        offset: 0,
        bytes: PNG_1X1,
        mime: 'image/png',
        widthPoints: 6,
        heightPoints: 6,
        expectedPackageRevision: store.packageRevision,
        expectedPackageRevision: store.packageRevision,

        decodePort: mockDecodePort(),
      }
    );
    expect(inserted.ok).toBe(true);
    if (!inserted.ok || !inserted.drawingNodeId) return;

    store.deleteImage({ kind: 'body' }, inserted.drawingNodeId);
    expect(partBytesPresent(store.currentPackage(), '/word/media/shared.png')).toBe(true);

    const sole = await store.insertImage(
      { kind: 'body' },
      {
        paragraphId: firstParagraphId(store.bodyStore().part),
        offset: 0,
        bytes: JPEG_1X1,
        mime: 'image/jpeg',
        widthPoints: 6,
        heightPoints: 6,
        expectedPackageRevision: store.packageRevision,
        expectedPackageRevision: store.packageRevision,

        decodePort: mockDecodePort(),
      }
    );
    expect(sole.ok).toBe(true);
    if (!sole.ok || !sole.drawingNodeId || !sole.mediaPartName) return;
    store.deleteImage({ kind: 'body' }, sole.drawingNodeId);
    expect(partBytesPresent(store.currentPackage(), sole.mediaPartName)).toBe(false);
  });
});

describe('embeds external image only after explicit command', () => {
  test('never publishes on refused fetch', async () => {
    const { TreePackageStore } = await import('../store/tree-package-store.ts');
    const { readOoxmlPart } = await import('../package/ooxml-tree.ts');
    const linkedXml =
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      '<w:body><w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="12700" cy="12700"/><wp:docPr id="1" name=""/>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:link="rId2"/></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:ext cx="12700" cy="12700"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>';
    const bodyPart = readOoxmlPart(linkedXml, {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    });
    if (!bodyPart.ok) throw new Error(bodyPart.reason);
    let pkg = buildPackage({
      docRels:
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId2" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="https://example.com/x.png" TargetMode="External"/>` +
        '</Relationships>',
    });
    pkg = Object.freeze({
      ...pkg,
      externalTargets: Object.freeze([
        {
          ownerPart: '/word/document.xml',
          id: 'rId2',
          type: IMAGE_RELATIONSHIP_TYPE,
          rawTarget: 'https://example.com/x.png',
          sinkSafe: true,
        },
      ]),
      parts: new Map([...pkg.parts, ['/word/document.xml', bodyPart.part]]),
    });
    const store = new TreePackageStore(pkg, bodyPart.part);
    const drawingId = store
      .bodyStore()
      .part.root.children.find((c) => c.kind === 'body')!
      .children.find((c) => c.kind === 'paragraph')!
      .children.find((c) => c.kind === 'run')!
      .children.find((c) => c.kind === 'drawing')!.id;
    const revisions: number[] = [];
    store.subscribe((change) => revisions.push(change.toRevision));

    const port = publicFetchPort(async () => ({
      status: 302,
      location: 'javascript:alert(1)',
      contentType: 'image/png',
      body: (async function* () {
        yield PNG_1X1;
      })(),
    }));

    const refused = await store.embedExternalImage(
      { kind: 'body' },
      drawingId,
      'https://example.com/x.png',
      port,
      new AbortController().signal,
      mockDecodePort()
    );
    expect(refused.ok).toBe(false);
    expect(revisions).toHaveLength(0);
    expect(partBytesPresent(store.currentPackage(), '/word/media/image1.png')).toBe(false);
  });

  test('embeds after successful fetch with manual redirect hop', async () => {
    const { TreePackageStore } = await import('../store/tree-package-store.ts');
    const { readOoxmlPart } = await import('../package/ooxml-tree.ts');
    const {
      projectDrawing,
      DEFAULT_DRAWING_PROJECTION_LIMITS,
      DEFAULT_SUPPORTED_MC_REQUIRES,
      createDrawingRelationshipResolver,
    } = await import('../package/drawing-projection.ts');
    const linkedXml =
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      '<w:body><w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="12700" cy="12700"/><wp:docPr id="1" name=""/>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:link="rId2"/></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:ext cx="12700" cy="12700"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>';
    const bodyPart = readOoxmlPart(linkedXml, {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    });
    if (!bodyPart.ok) throw new Error(bodyPart.reason);
    let pkg = buildPackage({
      docRels:
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId2" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="https://example.com/x.png" TargetMode="External"/>` +
        '</Relationships>',
    });
    pkg = Object.freeze({
      ...pkg,
      externalTargets: Object.freeze([
        {
          ownerPart: '/word/document.xml',
          id: 'rId2',
          type: IMAGE_RELATIONSHIP_TYPE,
          rawTarget: 'https://example.com/x.png',
          sinkSafe: true,
        },
      ]),
      parts: new Map([...pkg.parts, ['/word/document.xml', bodyPart.part]]),
    });
    const store = new TreePackageStore(pkg, bodyPart.part);
    const drawingId = store
      .bodyStore()
      .part.root.children.find((c) => c.kind === 'body')!
      .children.find((c) => c.kind === 'paragraph')!
      .children.find((c) => c.kind === 'run')!
      .children.find((c) => c.kind === 'drawing')!.id;
    const revisions: number[] = [];
    store.subscribe((change) => revisions.push(change.toRevision));

    let hop = 0;
    const port = publicFetchPort(async (url: string) => {
      if (hop === 0) {
        hop += 1;
        expect(url).toBe('https://example.com/x.png');
        return {
          status: 302,
          location: 'https://cdn.example.com/final.png',
          contentType: null,
          body: (async function* () {})(),
        };
      }
      expect(url).toBe('https://cdn.example.com/final.png');
      return {
        status: 200,
        location: null,
        contentType: 'image/png',
        body: (async function* () {
          yield PNG_1X1;
        })(),
      };
    });

    const embedded = await store.embedExternalImage(
      { kind: 'body' },
      drawingId,
      'https://example.com/x.png',
      port,
      new AbortController().signal,
      mockDecodePort()
    );
    expect(embedded.ok).toBe(true);
    expect(revisions).toHaveLength(1);
    expect(partBytesPresent(store.currentPackage(), '/word/media/image1.png')).toBe(true);

    const after = store.currentPackage();
    const projection = projectDrawing(
      after.parts
        .get('/word/document.xml')!
        .root.children.find((c) => c.kind === 'body')!
        .children.find((c) => c.kind === 'paragraph')!
        .children.find((c) => c.kind === 'run')!
        .children.find(
          (c) => c.kind === 'drawing'
        )! as import('../package/ooxml-tree.ts').OoxmlDrawingNode,
      {
        ownerPartName: '/word/document.xml',
        supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
        limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
        resolveRelationship: createDrawingRelationshipResolver(after, '/word/document.xml'),
      }
    );
    expect(projection?.picture?.embeddedRelationshipId).toBeTruthy();
    expect(projection?.picture?.linkedRelationshipId).toBeNull();

    store.undo();
    expect(partBytesPresent(store.currentPackage(), '/word/media/image1.png')).toBe(false);
  });
});

describe('fetchExternalImageBytes', () => {
  test('refuses content-type spoof and byte overflow without publishing', async () => {
    const { fetchExternalImageBytes } = await import('../package/drawing-package-edit.ts');
    const { resolveImageResourceLimits } = await import('../runtime/limits.ts');
    const limits = resolveImageResourceLimits();

    const spoof = await fetchExternalImageBytes(
      publicFetchPort(async () => ({
        status: 200,
        location: null,
        contentType: 'image/jpeg',
        body: (async function* () {
          yield PNG_1X1;
        })(),
      })),
      'https://example.com/spoof.png',
      new AbortController().signal
    );
    expect(spoof.ok).toBe(false);
    if (!spoof.ok) expect(spoof.detail).toBe('content-type-spoof');

    const oversized = new Uint8Array(limits.maxEncodedBytes + 1);
    oversized.fill(0xff);
    oversized[0] = 0x89;
    oversized[1] = 0x50;
    oversized[2] = 0x4e;
    oversized[3] = 0x47;
    const overflow = await fetchExternalImageBytes(
      publicFetchPort(async () => ({
        status: 200,
        location: null,
        contentType: 'image/png',
        body: (async function* () {
          yield oversized;
        })(),
      })),
      'https://example.com/huge.png',
      new AbortController().signal,
      limits
    );
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.detail).toBe('byte-limit');
  });
});

describe('creates drawing hyperlink in package transaction', () => {
  test('setDrawingMetadataWithHyperlink adds external rel and hlinkClick', async () => {
    const { TreePackageStore } = await import('../store/tree-package-store.ts');
    const { relationshipTargetIn } = await import('../package/hyperlink-part.ts');
    const { HYPERLINK_RELATIONSHIP_TYPE } = await import('../package/hyperlink.ts');
    const pkg = buildPackage({
      document: `<w:document xmlns:w="${W}"><w:body><w:p><w:r></w:r></w:p></w:body></w:document>`,
    });
    const main = pkg.parts.get('/word/document.xml')!;
    const store = new TreePackageStore(pkg, main);
    const paragraphId = firstParagraphId(store.bodyStore().part);
    const inserted = await store.insertImage(
      { kind: 'body' },
      {
        paragraphId,
        offset: 0,
        bytes: PNG_1X1,
        mime: 'image/png',
        widthPoints: 8,
        heightPoints: 8,
        expectedPackageRevision: store.packageRevision,
        expectedPackageRevision: store.packageRevision,

        decodePort: mockDecodePort(),
      }
    );
    expect(inserted.ok).toBe(true);
    if (!inserted.ok || !inserted.drawingNodeId) return;

    const revisions: number[] = [];
    store.subscribe((change) => revisions.push(change.toRevision));

    const linked = store.setDrawingMetadataWithHyperlink(
      { kind: 'body' },
      inserted.drawingNodeId,
      'Alt title',
      'Alt description',
      'https://example.com/target'
    );
    expect(linked.ok).toBe(true);
    expect(revisions).toHaveLength(1);

    const after = store.currentPackage();
    const hlinkExternal = after.externalTargets.find(
      (entry) => entry.type === HYPERLINK_RELATIONSHIP_TYPE
    );
    expect(hlinkExternal?.rawTarget).toBe('https://example.com/target');
    expect(relationshipTargetIn(after, '/word/document.xml', hlinkExternal!.id)?.target).toBe(
      'https://example.com/target'
    );

    const docXml = strFromU8(unzipSync(writeOoxmlPackage(after))['word/document.xml']!);
    expect(docXml).toContain('hlinkClick');
    expect(docXml).toContain('descr="Alt description"');
    expect(docXml).toContain('title="Alt title"');

    store.undo();
    expect(
      store
        .currentPackage()
        .externalTargets.some((entry) => entry.type === HYPERLINK_RELATIONSHIP_TYPE)
    ).toBe(false);
  });
});

describe('D9 package image fidelity', () => {
  test('resize, crop, wrap, and metadata leave media byte-identical through save/reopen', async () => {
    const { TreePackageStore } = await import('../store/tree-package-store.ts');
    const { semanticDigest, diffSemanticDigests } = await import('../package/ooxml-digest.ts');
    const pkg = buildPackage({
      document: `<w:document xmlns:w="${W}"><w:body><w:p><w:r></w:r></w:p></w:body></w:document>`,
    });
    const main = pkg.parts.get('/word/document.xml')!;
    const store = new TreePackageStore(pkg, main);
    const paragraphId = firstParagraphId(store.bodyStore().part);
    const inserted = await store.insertImage(
      { kind: 'body' },
      {
        paragraphId,
        offset: 0,
        bytes: PNG_1X1,
        mime: 'image/png',
        widthPoints: 24,
        heightPoints: 24,
        title: 'Before',
        description: 'Before desc',
        expectedPackageRevision: store.packageRevision,
        expectedPackageRevision: store.packageRevision,

        decodePort: mockDecodePort(),
      }
    );
    expect(inserted.ok).toBe(true);
    if (!inserted.ok || !inserted.drawingNodeId || !inserted.mediaPartName) return;

    const mediaHash = hashPartBytes(store.currentPackage(), inserted.mediaPartName);
    expect(mediaHash).toBe(sha256FontBytes(PNG_1X1));

    const drawingId = inserted.drawingNodeId;
    expect(
      store.transact({ kind: 'body' }, (ctx) => {
        ctx.apply({
          op: 'resizeDrawing',
          drawingNodeId: drawingId,
          extentEmu: { cx: 1_828_800, cy: 914_400 },
        });
      }).ok
    ).toBe(true);
    expect(hashPartBytes(store.currentPackage(), inserted.mediaPartName)).toBe(mediaHash);

    expect(
      store.transact({ kind: 'body' }, (ctx) => {
        ctx.apply({
          op: 'cropDrawing',
          drawingNodeId: drawingId,
          crop: { left: 5000, top: 10000, right: 15000, bottom: 20000 },
        });
      }).ok
    ).toBe(true);
    expect(hashPartBytes(store.currentPackage(), inserted.mediaPartName)).toBe(mediaHash);

    expect(
      store.transact({ kind: 'body' }, (ctx) => {
        ctx.apply({ op: 'setDrawingWrap', drawingNodeId: drawingId, wrap: 'square' });
      }).ok
    ).toBe(true);
    expect(hashPartBytes(store.currentPackage(), inserted.mediaPartName)).toBe(mediaHash);

    expect(
      store.setDrawingMetadataWithHyperlink(
        { kind: 'body' },
        drawingId,
        'After title',
        'After desc',
        'https://example.com/image-link'
      ).ok
    ).toBe(true);
    expect(hashPartBytes(store.currentPackage(), inserted.mediaPartName)).toBe(mediaHash);

    const saved = store.currentPackage();
    const reopened = readOoxmlPackage(writeOoxmlPackage(saved));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;

    expect(hashPartBytes(reopened.package, inserted.mediaPartName)).toBe(mediaHash);
    expect(canonicalOoxmlFingerprint(reopened.package.parts.get('/word/document.xml')!)).toBe(
      canonicalOoxmlFingerprint(saved.parts.get('/word/document.xml')!)
    );
    expect(
      diffSemanticDigests(
        semanticDigest([saved.parts.get('/word/document.xml')!]),
        semanticDigest([reopened.package.parts.get('/word/document.xml')!])
      )
    ).toEqual([]);
  });
});
