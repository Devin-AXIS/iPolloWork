// Bounded OPC loading into canonical trees (task 4.4). Adversarial coverage for the four
// classes the spec names: LIMITS, PATHS, ENTITIES, and EXTERNAL TARGETS.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage } from '../package/ooxml-package.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOC =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

const CONTENT_TYPES =
  `<Types xmlns="${CT_NS}">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="png" ContentType="image/png"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>';

const ROOT_RELS =
  `<Relationships xmlns="${REL_NS}">` +
  `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
  '</Relationships>';

const DOCUMENT = `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:body></w:document>`;

function build(overrides: Record<string, string | Uint8Array> = {}): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(DOCUMENT),
  };
  for (const [name, value] of Object.entries(overrides)) {
    entries[name] = typeof value === 'string' ? strToU8(value) : value;
  }
  return zipSync(entries);
}

function utf16Le(value: string): Uint8Array {
  const bytes = new Uint8Array(2 + value.length * 2);
  bytes.set([0xff, 0xfe]);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < value.length; i += 1) view.setUint16(2 + i * 2, value.charCodeAt(i), true);
  return bytes;
}

describe('bounded OPC loading into canonical trees (task 4.4)', () => {
  test('loads parts as canonical trees and resolves the main document', () => {
    const result = readOoxmlPackage(build());
    if (!result.ok) throw new Error(`unexpected rejection: ${result.reason}`);
    expect(result.package.mainDocumentPart).toBe('/word/document.xml');
    const main = result.package.parts.get('/word/document.xml');
    expect(main?.root.localName).toBe('document');
    // The paragraph text reached the tree through typed nodes.
    expect(JSON.stringify(main)).toContain('hello');
    // Relationship parts are XML and load as trees too; the root rels owner is `/`.
    expect([...(result.package.relationships.get('/') ?? [])].map((r) => r.id)).toEqual(['rId1']);
  });

  test('loads a UTF-16LE XML part with a byte-order mark', () => {
    const types = CONTENT_TYPES.replace(
      '</Types>',
      '<Override PartName="/customXml/item1.xml" ContentType="application/xml"/></Types>'
    );
    const customXml = utf16Le(
      '<?xml version="1.0" encoding="utf-16"?><properties><documentid>LEGAL!1</documentid></properties>'
    );

    const result = readOoxmlPackage(
      build({ '[Content_Types].xml': types, 'customXml/item1.xml': customXml })
    );

    if (!result.ok)
      throw new Error(`unexpected rejection: ${result.reason}: ${result.detail ?? ''}`);
    expect(result.package.parts.get('/customXml/item1.xml')?.root.localName).toBe('properties');
    expect(JSON.stringify(result.package.parts.get('/customXml/item1.xml'))).toContain('LEGAL!1');
  });

  test('a declared non-ASCII part name resolves through the canonical content-type key', () => {
    const partName = 'word/café.xml';
    const types = CONTENT_TYPES.replace(
      '</Types>',
      '<Override PartName="/word/café.xml" ContentType="application/xml"/></Types>'
    );
    const result = readOoxmlPackage(
      build({
        '[Content_Types].xml': types,
        [partName]: '<root><value>kept</value></root>',
      })
    );
    if (!result.ok) throw new Error(`unexpected rejection: ${result.reason}`);
    expect(result.package.parts.get('/word/café.xml')?.root.localName).toBe('root');
  });

  test('a non-XML part keeps its bytes and gets no tree', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
    const result = readOoxmlPackage(build({ 'word/media/image1.png': png }));
    if (!result.ok) throw new Error(result.reason);
    expect(result.package.parts.has('/word/media/image1.png')).toBe(false);
    expect(result.package.partBytes.get('/word/media/image1.png')).toEqual(png);
  });

  describe('limits', () => {
    test('too many XML parts fails closed', () => {
      const extra: Record<string, string> = {};
      for (let i = 0; i < 5; i += 1) extra[`word/extra${i}.xml`] = '<a/>';
      const types = CONTENT_TYPES.replace(
        '</Types>',
        '<Default Extension="xml" ContentType="application/xml"/></Types>'
      );
      const result = readOoxmlPackage(build({ ...extra, '[Content_Types].xml': types }), {
        maxXmlParts: 3,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('too-many-xml-parts');
    });

    test('too many relationships fails closed', () => {
      const rels = [`<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>`];
      for (let i = 2; i < 12; i += 1) {
        rels.push(`<Relationship Id="rId${i}" Type="${IMAGE_REL}" Target="media/i${i}.png"/>`);
      }
      const result = readOoxmlPackage(
        build({
          '_rels/.rels': `<Relationships xmlns="${REL_NS}">${rels.join('')}</Relationships>`,
        }),
        { maxRelationships: 5 }
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('too-many-relationships');
    });

    test('an oversized part fails closed before tree construction', () => {
      const result = readOoxmlPackage(build(), { xml: { maxBytes: 32 } });
      expect(result.ok).toBe(false);
    });

    test('a zip entry-count limit fails closed', () => {
      const result = readOoxmlPackage(build(), {
        zip: { maxEntries: 1, maxTotalBytes: 1_000_000 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('too-many-entries');
    });
  });

  describe('paths', () => {
    test('a traversing internal relationship target is refused', () => {
      const rels =
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="../../../../etc/passwd"/>` +
        '</Relationships>';
      const result = readOoxmlPackage(build({ '_rels/.rels': rels }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('bad-relationship-target');
        expect(result.detail).toContain('traversal-escape');
      }
    });

    test('a percent-encoded separator in a target is refused', () => {
      const rels =
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="media%2f..%2f..%2fsecret.png"/>` +
        '</Relationships>';
      const result = readOoxmlPackage(build({ '_rels/.rels': rels }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('bad-relationship-target');
    });

    test('a traversing zip entry name is refused by the reader', () => {
      const result = readOoxmlPackage(build({ '../escape.xml': '<a/>' }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('bad-name');
    });

    test('a duplicate relationship id fails closed', () => {
      const rels =
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        `<Relationship Id="rId1" Type="${IMAGE_REL}" Target="media/a.png"/>` +
        '</Relationships>';
      const result = readOoxmlPackage(build({ '_rels/.rels': rels }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('duplicate-relationship-id');
    });

    test('a missing main document relationship fails closed', () => {
      const result = readOoxmlPackage(
        build({ '_rels/.rels': `<Relationships xmlns="${REL_NS}"></Relationships>` })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('no-main-document');
    });
  });

  describe('entities', () => {
    test('a DTD with an external entity never expands', () => {
      const evil =
        '<!DOCTYPE doc [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>' +
        `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>&xxe;</w:t></w:r></w:p></w:body></w:document>`;
      const result = readOoxmlPackage(build({ 'word/document.xml': evil }));
      // Either the read refuses the DTD outright, or it loads with the entity UNEXPANDED.
      // What must never happen is the file's contents appearing in the tree.
      if (result.ok) {
        expect(JSON.stringify([...result.package.parts.values()])).not.toContain('root:');
      } else {
        expect(typeof result.reason).toBe('string');
      }
    });

    test('a billion-laughs nesting never expands', () => {
      const bomb =
        '<!DOCTYPE lolz [<!ENTITY lol "lol">' +
        '<!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">' +
        '<!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]>' +
        `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>&lol3;</w:t></w:r></w:p></w:body></w:document>`;
      const result = readOoxmlPackage(build({ 'word/document.xml': bomb }));
      if (result.ok) {
        const serialized = JSON.stringify([...result.package.parts.values()]);
        expect(serialized.length).toBeLessThan(100_000);
      } else {
        expect(typeof result.reason).toBe('string');
      }
    });
  });

  describe('external targets', () => {
    test('an external relationship is recorded, never resolved into a part', () => {
      const rels =
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        `<Relationship Id="rId9" Type="${IMAGE_REL}" Target="https://evil.example/track.png" TargetMode="External"/>` +
        '</Relationships>';
      const result = readOoxmlPackage(build({ '_rels/.rels': rels }));
      if (!result.ok) throw new Error(result.reason);
      expect(result.package.externalTargets).toEqual([
        {
          ownerPart: '/',
          id: 'rId9',
          type: IMAGE_REL,
          rawTarget: 'https://evil.example/track.png',
          sinkSafe: true,
        },
      ]);
      // Recorded only. It is not a part, so nothing downstream can load it by name.
      expect(result.package.parts.has('https://evil.example/track.png')).toBe(false);
      expect(result.package.partBytes.has('https://evil.example/track.png')).toBe(false);
    });

    test('an unsafe external scheme loads but is marked unsafe rather than fetched', () => {
      const rels =
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        `<Relationship Id="rId9" Type="${IMAGE_REL}" Target="javascript:alert(1)" TargetMode="External"/>` +
        '</Relationships>';
      const result = readOoxmlPackage(build({ '_rels/.rels': rels }));
      if (!result.ok) throw new Error(result.reason);
      expect(result.package.externalTargets[0]!.sinkSafe).toBe(false);
      expect(result.package.externalTargets[0]!.rawTarget).toBe('javascript:alert(1)');
    });

    test('an external target does NOT have to resolve as a part name', () => {
      // The whole point of the Internal/External split: an external target is never run
      // through owner-relative part resolution, so it cannot fail the load the way a
      // traversing INTERNAL target does.
      const rels =
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        `<Relationship Id="rId9" Type="${IMAGE_REL}" Target="../../../outside" TargetMode="External"/>` +
        '</Relationships>';
      const result = readOoxmlPackage(build({ '_rels/.rels': rels }));
      if (!result.ok) throw new Error(result.reason);
      expect(result.package.externalTargets[0]!.sinkSafe).toBe(false);
    });
  });
});

describe('package writer (cutover step 2)', () => {
  test('an unedited package round-trips through both D9 oracles', async () => {
    const { canonicalOoxmlFingerprint } = await import('../package/ooxml-tree.ts');
    const { semanticDigest, diffSemanticDigests } = await import('../package/ooxml-digest.ts');
    const { writeOoxmlPackage } = await import('../package/ooxml-package.ts');

    const original = readOoxmlPackage(build());
    if (!original.ok) throw new Error(original.reason);
    const reopened = readOoxmlPackage(writeOoxmlPackage(original.package));
    if (!reopened.ok) throw new Error(`${reopened.reason}: ${reopened.detail ?? ''}`);

    const before = original.package.parts.get('/word/document.xml')!;
    const after = reopened.package.parts.get('/word/document.xml')!;
    expect(canonicalOoxmlFingerprint(after)).toBe(canonicalOoxmlFingerprint(before));
    expect(diffSemanticDigests(semanticDigest([before]), semanticDigest([after]))).toEqual([]);
  });

  test('a part the loader never modeled passes through untouched', async () => {
    const { writeOoxmlPackage } = await import('../package/ooxml-package.ts');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7, 7, 7]);
    const original = readOoxmlPackage(build({ 'word/media/image1.png': png }));
    if (!original.ok) throw new Error(original.reason);
    const reopened = readOoxmlPackage(writeOoxmlPackage(original.package));
    if (!reopened.ok) throw new Error(reopened.reason);
    // Byte-for-byte: the engine claims nothing about this part, so it must not touch it.
    expect(reopened.package.partBytes.get('/word/media/image1.png')).toEqual(png);
  });

  test('an edited tree is what gets written', async () => {
    const { withPart, writeOoxmlPackage } = await import('../package/ooxml-package.ts');
    const { applyTreeOp } = await import('../store/tree-ops.ts');
    const { deriveOoxmlIndexes } = await import('../package/ooxml-indexes.ts');

    const original = readOoxmlPackage(build());
    if (!original.ok) throw new Error(original.reason);
    const part = original.package.parts.get('/word/document.xml')!;
    const paragraphId = deriveOoxmlIndexes(original.package, 0).stories.get('/word/document.xml')!
      .paragraphs[0]!.nodeId;

    const edited = applyTreeOp(part, {
      op: 'insertText',
      paragraphId,
      offset: 5,
      text: ' EDITED',
    });
    if (!edited.ok) throw new Error(edited.reason);

    const bytes = writeOoxmlPackage(withPart(original.package, edited.part));
    const reopened = readOoxmlPackage(bytes);
    if (!reopened.ok) throw new Error(reopened.reason);
    const text = deriveOoxmlIndexes(reopened.package, 0).stories.get('/word/document.xml')!
      .paragraphs[0]!.text;
    expect(text).toBe('hello EDITED');
  });

  test('media bytes and image relationships survive a nearby body edit', async () => {
    const { canonicalOoxmlFingerprint } = await import('../package/ooxml-tree.ts');
    const { withPart, writeOoxmlPackage } = await import('../package/ooxml-package.ts');
    const { applyTreeOp } = await import('../store/tree-ops.ts');
    const { deriveOoxmlIndexes } = await import('../package/ooxml-indexes.ts');

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
    const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
    const drawing =
      `<w:p>` +
      '<w:r><w:t>before </w:t></w:r>' +
      `<w:r><w:drawing><wp:inline xmlns:wp="${WP}">` +
      `<wp:extent cx="914400" cy="914400"/>` +
      `<a:graphic xmlns:a="${A}"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:blipFill><a:blip r:embed="rId2" xmlns:r="${R}"/></pic:blipFill>` +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>' +
      '<w:r><w:t>after</w:t></w:r>' +
      '</w:p>';
    const types = CONTENT_TYPES.replace(
      '</Types>',
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    );
    const docRels =
      `<Relationships xmlns="${REL_NS}">` +
      `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="media/image1.png"/>` +
      '</Relationships>';
    const document = `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${drawing}</w:body></w:document>`;

    const original = readOoxmlPackage(
      build({
        '[Content_Types].xml': types,
        'word/_rels/document.xml.rels': docRels,
        'word/document.xml': document,
        'word/media/image1.png': png,
      })
    );
    if (!original.ok) throw new Error(original.reason);
    expect(original.package.partBytes.get('/word/media/image1.png')).toEqual(png);
    expect(
      [...(original.package.relationships.get('/word/document.xml') ?? [])].map((r) => r.id)
    ).toEqual(['rId2']);

    const part = original.package.parts.get('/word/document.xml')!;
    const paragraphId = deriveOoxmlIndexes(original.package, 0).stories.get('/word/document.xml')!
      .paragraphs[0]!.nodeId;
    const edited = applyTreeOp(part, {
      op: 'insertText',
      paragraphId,
      offset: 0,
      text: 'X',
    });
    if (!edited.ok) throw new Error(edited.reason);

    const reopened = readOoxmlPackage(writeOoxmlPackage(withPart(original.package, edited.part)));
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(reopened.package.partBytes.get('/word/media/image1.png')).toEqual(png);
    expect(
      [...(reopened.package.relationships.get('/word/document.xml') ?? [])].map((r) => r.id)
    ).toEqual(['rId2']);
    const relsXml = new TextDecoder().decode(
      reopened.package.partBytes.get('/word/_rels/document.xml.rels')!
    );
    expect(relsXml).toContain('Target="media/image1.png"');
    expect(relsXml).toContain(`xmlns="${REL_NS}"`);
    expect(relsXml).not.toMatch(/<ns\d+:Relationships/);
    const drawingJson = JSON.stringify(reopened.package.parts.get('/word/document.xml'));
    expect(drawingJson).toContain('"localName":"embed"');
    expect(drawingJson).toContain('"value":"rId2"');
    expect(
      deriveOoxmlIndexes(reopened.package, 0).stories.get('/word/document.xml')!.paragraphs[0]!.text
    ).toContain('Xbefore');
    expect(canonicalOoxmlFingerprint(reopened.package.parts.get('/word/document.xml')!)).toBe(
      canonicalOoxmlFingerprint(edited.part)
    );
  });

  test('mc:Ignorable and AlternateContent survive package save/reopen', async () => {
    const { canonicalOoxmlFingerprint, serializeOoxmlPart } =
      await import('../package/ooxml-tree.ts');
    const { writeOoxmlPackage } = await import('../package/ooxml-package.ts');

    const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
    const document =
      `<w:document xmlns:w="${W}" xmlns:mc="${MC}" xmlns:w14="urn:word14" mc:Ignorable="w14">` +
      '<w:body><w:p><w:r>' +
      `<mc:AlternateContent>` +
      `<mc:Choice Requires="w14"><w14:widget/></mc:Choice>` +
      `<mc:Fallback><w:t>fallback</w:t></mc:Fallback>` +
      `</mc:AlternateContent>` +
      '</w:r></w:p></w:body></w:document>';

    const original = readOoxmlPackage(build({ 'word/document.xml': document }));
    if (!original.ok) throw new Error(original.reason);
    const main = original.package.parts.get('/word/document.xml')!;
    const fingerprintBefore = canonicalOoxmlFingerprint(main);

    const reopened = readOoxmlPackage(writeOoxmlPackage(original.package));
    if (!reopened.ok) throw new Error(reopened.reason);
    const reopenedMain = reopened.package.parts.get('/word/document.xml')!;
    expect(canonicalOoxmlFingerprint(reopenedMain)).toBe(fingerprintBefore);

    const savedXml = serializeOoxmlPart(reopenedMain);
    expect(savedXml).toContain('mc:Ignorable');
    expect(savedXml).toContain('mc:AlternateContent');
    expect(savedXml).toContain('mc:Choice');
    expect(savedXml).toContain('mc:Fallback');
    expect(savedXml).toContain('widget');
    expect(savedXml).toContain('fallback');
  });
});

describe('drawing resources', () => {
  test('resolves embedded media through owner-relative relationships without fetch', async () => {
    const { createImageResourceCache } = await import('../package/image-resources.ts');
    const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
    const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
    const png = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
      ),
      (c) => c.charCodeAt(0)
    );
    const drawing =
      `<w:p><w:r><w:drawing><wp:inline xmlns:wp="${WP}">` +
      `<wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="pic"/>` +
      `<a:graphic xmlns:a="${A}"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:pic xmlns:pic="${PIC}"><pic:blipFill><a:blip r:embed="rId2" xmlns:r="${R}"/></pic:blipFill></pic:pic>` +
      `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    const loaded = readOoxmlPackage(
      build({
        'word/_rels/document.xml.rels':
          `<Relationships xmlns="${REL_NS}">` +
          `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="media/image1.png"/>` +
          '</Relationships>',
        'word/document.xml': `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${drawing}</w:body></w:document>`,
        'word/media/image1.png': png,
      })
    );
    if (!loaded.ok) throw new Error(loaded.reason);
    const decodeCalls = { n: 0 };
    const cache = createImageResourceCache(loaded.package, {
      decodePort: {
        decode: async () => {
          decodeCalls.n += 1;
          return { pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 };
        },
      },
    });
    const state = await cache.resolveEmbedded('/word/document.xml', 'rId2');
    expect(state.kind).toBe('ready');
    expect(decodeCalls.n).toBe(1);
    cache.dispose();
  });
});
