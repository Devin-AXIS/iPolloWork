// Tests for authored content-type + relationship records (document-engine task
// 2.6). Covers Override>Default precedence, ASCII-case-insensitive matching
// (incl. the Turkish-I regression the OOXML review flagged), conflict/duplicate
// fail-closed, MIME validation, record-count N/N+1, and relationship retention.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  buildContentTypeIndex,
  resolveContentType,
  isValidMime,
  extensionKey,
  type ContentTypeRecords,
  buildRelationshipSet,
  resolveRelationship,
  type RelationshipRecord,
  readOoxmlPackage,
  writeOoxmlPackage,
  resolveContentTypeOf,
} from '../package/index.ts';
import { buildTolerantContentTypeIndex } from '../package/content-types.ts';

const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const OFFICE_DOC =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const FOREIGN_CT = 'http://example.com/foreign-content-types';

function minimalPackage(contentTypesXml: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(contentTypesXml),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>`
    ),
  });
}

const records = (
  defaults: [string, string][],
  overrides: [string, string][] = []
): ContentTypeRecords => ({
  defaults: defaults.map(([extension, contentType], order) => ({ extension, contentType, order })),
  overrides: overrides.map(([partName, contentType], order) => ({ partName, contentType, order })),
});

describe('content-type index', () => {
  test('Override beats Default; Default resolves by extension', () => {
    const r = buildContentTypeIndex(
      records(
        [['xml', 'application/xml']],
        [
          [
            '/word/document.xml',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
          ],
        ]
      )
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(resolveContentType(r.index, '/word/document.xml').source).toBe('override');
    expect(resolveContentType(r.index, '/word/other.xml')).toMatchObject({
      ok: true,
      contentType: 'application/xml',
      source: 'default',
    });
    expect(resolveContentType(r.index, '/word/media/x.bin').ok).toBe(false);
  });

  test('extension matching is ASCII case-insensitive, but not locale-folded', () => {
    const r = buildContentTypeIndex(records([['PNG', 'image/png']]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(resolveContentType(r.index, '/word/media/a.png').contentType).toBe('image/png');
    expect(resolveContentType(r.index, '/word/media/a.PnG').contentType).toBe('image/png');
    // Turkish dotless-i must NOT fold to ASCII 'i' (regression from OOXML review).
    expect(extensionKey('I')).toBe('i');
    expect(extensionKey('İ')).toBe('İ'); // İ stays İ, never 'i'
  });

  test('conflicting Defaults on one extension fail closed', () => {
    const r = buildContentTypeIndex(
      records([
        ['xml', 'application/xml'],
        ['XML', 'text/xml'],
      ])
    );
    expect(r).toMatchObject({
      ok: false,
      error: { code: 'conflicting-default', extension: 'xml' },
    });
  });

  test('identical duplicate Defaults are preserved (no error)', () => {
    const r = buildContentTypeIndex(
      records([
        ['xml', 'application/xml'],
        ['xml', 'application/xml'],
      ])
    );
    expect(r.ok).toBe(true);
  });

  test('duplicate Override part names with different MIME fail closed', () => {
    const r = buildContentTypeIndex(
      records(
        [],
        [
          ['/word/document.xml', 'application/xml'],
          ['/Word/Document.xml', 'text/xml'],
        ]
      )
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'duplicate-override' } });
  });

  test('invalid MIME syntax fails closed', () => {
    expect(isValidMime('application/xml')).toBe(true);
    expect(isValidMime('not-a-mime')).toBe(false);
    expect(buildContentTypeIndex(records([['xml', 'bogus']])).ok).toBe(false);
  });

  test('type and subtype are tokens: every visible ASCII character except separators', () => {
    const separators = '()<>@,;:\\"/[]?={} \t';
    for (let code = 0; code < 128; code++) {
      const character = String.fromCharCode(code);
      const token = code > 32 && code < 127 && !separators.includes(character);
      expect(isValidMime(`${character}type/subtype`)).toBe(token);
      expect(isValidMime(`type/${character}subtype`)).toBe(token);
    }
    expect(isValidMime('image/.jpg')).toBe(true);
    expect(isValidMime('image/.jpg; q=1')).toBe(true);
    for (const value of ['/subtype', 'type/', 'type/sub/type', 'type/subätype']) {
      expect(isValidMime(value)).toBe(false);
    }
  });

  test('extension-style types yield to a conflicting record; conventional ones fail closed', () => {
    const tolerant = (defaults: [string, string][], overrides: [string, string][] = []) =>
      buildTolerantContentTypeIndex({
        defaults: defaults.map(([extension, contentType], order) => ({
          extension,
          contentType,
          order,
        })),
        overrides: overrides.map(([partName, contentType], order) => ({
          partName,
          contentType,
          order,
        })),
      });

    const alone = tolerant([['JPG', 'image/.jpg']]);
    expect(alone.ok && alone.index.defaults.get('jpg')).toBe('image/.jpg');

    const yielded = tolerant([
      ['JPG', 'image/.jpg'],
      ['jpg', 'image/jpeg'],
    ]);
    expect(yielded.ok && yielded.index.defaults.get('jpg')).toBe('image/jpeg');
    expect(yielded.ok && [...yielded.ignored.extensions]).toEqual(['jpg']);

    const bothYield = tolerant([
      ['JPG', 'image/.jpg'],
      ['jpg', 'image/.jpeg'],
    ]);
    expect(bothYield.ok && bothYield.index.defaults.has('jpg')).toBe(false);

    const identical = tolerant([
      ['JPG', 'image/.jpg'],
      ['jpg', 'image/.jpg'],
    ]);
    expect(identical.ok && identical.index.defaults.get('jpg')).toBe('image/.jpg');

    expect(
      tolerant(
        [],
        [
          ['/a.png', 'image/.png'],
          ['/A.png', 'image/png'],
        ]
      )
    ).toMatchObject({ ok: true, ignored: { overrideKeys: new Set(['/a.png']) } });

    expect(tolerant([], [['/a/../b.png', 'image/.png']]).ok).toBe(true);
    expect(tolerant([], [['/a/../b.png', 'image/png']])).toMatchObject({
      ok: false,
      error: { code: 'invalid-override-name' },
    });

    expect(
      tolerant([
        ['jpg', 'image/jpeg'],
        ['JPG', 'image/png'],
        ['jpg', 'image/.jpg'],
      ])
    ).toMatchObject({ ok: false, error: { code: 'conflicting-default', extension: 'jpg' } });
  });

  test('parameters are accepted, and an empty parameter is not', () => {
    expect(isValidMime('text/plain; charset=UTF-8')).toBe(true);
    expect(isValidMime('text/plain;charset=UTF-8;boundary=x')).toBe(true);
    expect(isValidMime('text/plain;')).toBe(false);
    expect(isValidMime('text/plain;;charset=UTF-8')).toBe(false);
    expect(isValidMime('text/plain ')).toBe(false);
    expect(isValidMime(';charset=UTF-8')).toBe(false);
    // The boundaries the hand-written parameter walk has to reproduce exactly, because the
    // single pattern it replaced got them for free.
    expect(isValidMime('text/plain; ')).toBe(true); // a whitespace-only parameter counts
    expect(isValidMime('text/plain \t;charset=UTF-8')).toBe(true); // whitespace before the `;`
    expect(isValidMime('text/plain;charset=UTF-8;')).toBe(false); // trailing empty segment
    expect(isValidMime('text/plain\n')).toBe(false); // `$` does not forgive a final newline
  });

  test('a content type built to make the reader backtrack is answered at once', () => {
    // The shape a crafted `[Content_Types].xml` used. The old group was exponential in the
    // NUMBER of `;`-plus-whitespace segments (and polynomial in each one's length), so the
    // cost is bought with segments, not with size: these 88 characters cost it 1.2 seconds,
    // and 406 characters of the same shape cost it 10.9. The trailing `;` is what forces the
    // walk — it refuses every split the group can try.
    const hostile = `a/b${`;${' '.repeat(20)}`.repeat(4)};`;
    const started = performance.now();
    expect(isValidMime(hostile)).toBe(false);
    expect(performance.now() - started).toBeLessThan(50);
  });

  test('record count enforces N (ok) and N+1 (fail)', () => {
    const many = (n: number): ContentTypeRecords =>
      records(
        Array.from({ length: n }, (_, i) => [`e${i}`, 'application/xml'] as [string, string])
      );
    expect(buildContentTypeIndex(many(3), 3).ok).toBe(true); // N
    expect(buildContentTypeIndex(many(4), 3)).toMatchObject({
      ok: false,
      error: { code: 'too-many-records', limit: 3 },
    });
  });
});

describe('content-types reader namespace awareness', () => {
  test('indexes Default and Override under a prefixed content-types namespace', () => {
    const xml =
      `<ct:Types xmlns:ct="${CT_NS}">` +
      '<ct:Default Extension="png" ContentType="image/png"/>' +
      '<ct:Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '</ct:Types>';
    const loaded = readOoxmlPackage(minimalPackage(xml));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(resolveContentTypeOf(loaded.package, '/word/document.xml')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
    );
    expect(loaded.package.contentTypes.defaults.get('png')).toBe('image/png');
    expect(loaded.package.contentTypes.defaults.has('rels')).toBe(false);
  });

  test('indexes unqualified PartName and ContentType under the default namespace', () => {
    const xml =
      `<Types xmlns="${CT_NS}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>';
    const loaded = readOoxmlPackage(minimalPackage(xml));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.package.contentTypes.overrides.get('/word/document.xml')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
    );
  });

  test('ignores foreign-namespace Override and Lookalike nodes with the same local name', () => {
    const target = '/word/media/decoy.png';
    const xml =
      `<Types xmlns="${CT_NS}" xmlns:foreign="${FOREIGN_CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      `<foreign:Override PartName="${target}" ContentType="image/jpeg"/>` +
      `<foreign:Lookalike PartName="${target}" ContentType="image/jpeg"/>` +
      '</Types>';
    const loaded = readOoxmlPackage(minimalPackage(xml));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.package.contentTypes.overrides.has(target.toLowerCase())).toBe(false);
    expect(resolveContentTypeOf(loaded.package, target)).toBe('image/png');
  });

  test('ignores namespaced PartName and ContentType attributes on real Override elements', () => {
    const target = '/word/media/namespaced.png';
    const xml =
      `<Types xmlns="${CT_NS}" xmlns:ct="${CT_NS}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      `<Override ct:PartName="${target}" ct:ContentType="image/jpeg"/>` +
      '</Types>';
    const loaded = readOoxmlPackage(minimalPackage(xml));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.package.contentTypes.overrides.has(target.toLowerCase())).toBe(false);
    expect(resolveContentTypeOf(loaded.package, target)).toBe('image/png');
  });

  test('skips Override entries missing unqualified ContentType without rejecting the package', () => {
    const target = '/word/media/missing-type.png';
    const xml =
      `<Types xmlns="${CT_NS}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      `<Override PartName="${target}"/>` +
      '</Types>';
    const loaded = readOoxmlPackage(minimalPackage(xml));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.package.contentTypes.overrides.has(target.toLowerCase())).toBe(false);
    expect(resolveContentTypeOf(loaded.package, target)).toBe('image/png');
  });

  test('save/reopen stays valid when foreign and malformed lookalikes coexist with real overrides', () => {
    const xml =
      `<Types xmlns="${CT_NS}" xmlns:foreign="${FOREIGN_CT}" xmlns:ct="${CT_NS}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<foreign:Override PartName="/word/media/decoy.png" ContentType="image/jpeg"/>' +
      '<Override PartName="/word/media/real.png" ContentType="image/png"/>' +
      `<Override PartName="/word/media/malformed.png"/>` +
      `<foreign:Lookalike PartName="/word/media/real.png" ContentType="image/jpeg" ct:PartName="/word/media/real.png" ct:ContentType="image/jpeg"/>` +
      '</Types>';
    const loaded = readOoxmlPackage(minimalPackage(xml));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(resolveContentTypeOf(loaded.package, '/word/media/real.png')).toBe('image/png');
    expect(loaded.package.contentTypes.overrides.has('/word/media/malformed.png')).toBe(false);

    const reopened = readOoxmlPackage(writeOoxmlPackage(loaded.package));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(resolveContentTypeOf(reopened.package, '/word/media/real.png')).toBe('image/png');
    expect(reopened.package.contentTypes.overrides.has('/word/media/malformed.png')).toBe(false);
  });
});

describe('relationship records', () => {
  const rel = (
    id: string,
    rawTarget: string,
    targetMode: 'Internal' | 'External',
    order: number
  ): RelationshipRecord => ({
    ownerPart: '/word/document.xml',
    id,
    type: 'http://example/type',
    rawTarget,
    targetMode,
    order,
  });

  test('groups by owner in order and rejects duplicate ids', () => {
    const ok = buildRelationshipSet([
      rel('rId2', 'media/i.png', 'Internal', 1),
      rel('rId1', 'styles.xml', 'Internal', 0),
    ]);
    expect(ok.ok).toBe(true);
    if (ok.ok)
      expect(ok.byOwner.get('/word/document.xml')!.map((r) => r.id)).toEqual(['rId1', 'rId2']);
    expect(
      buildRelationshipSet([rel('rId1', 'a', 'Internal', 0), rel('rId1', 'b', 'Internal', 1)])
    ).toMatchObject({
      ok: false,
      error: { code: 'duplicate-id' },
    });
  });

  test('internal resolves owner-relative; external retains raw and never resolves', () => {
    const internal = resolveRelationship(rel('rId1', 'media/i.png', 'Internal', 0));
    expect(internal).toMatchObject({ mode: 'Internal', raw: 'media/i.png' });
    if (internal.mode === 'Internal')
      expect(internal.target).toEqual({ ok: true, partName: '/word/media/i.png' });

    const external = resolveRelationship(rel('rId2', 'https://example.com/x', 'External', 1));
    expect(external).toMatchObject({ mode: 'External', raw: 'https://example.com/x' });
    if (external.mode === 'External') expect(external.sinkSafe.ok).toBe(true);

    const unsafe = resolveRelationship(rel('rId3', 'javascript:alert(1)', 'External', 2));
    // raw is retained verbatim even though the sink projection is rejected.
    expect(unsafe.raw).toBe('javascript:alert(1)');
    if (unsafe.mode === 'External') expect(unsafe.sinkSafe.ok).toBe(false);
  });
});
