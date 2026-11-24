import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { readOoxmlPackage, writeOoxmlPackage, type OoxmlPackage } from '../ooxml-package.ts';
import { readOoxmlPart, serializeOoxmlPart } from '../ooxml-tree.ts';
import { contentTypesPartBytes, withContentTypeOverrides } from '../package-edit.ts';
import { withBinaryParts } from '../drawing-package-edit.ts';
import {
  observeCanonicalPrimitiveJournal,
  runObservedStoreTransaction,
} from '../canonical-primitive-capture.ts';
import type { CanonicalPrimitiveJournal } from '../canonical-primitive-journal.ts';

const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
type Entry = readonly [string, string];

function open(extra = ''): OoxmlPackage {
  const read = readOoxmlPackage(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}" xmlns:x="urn:extension"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`
      ),
    })
  );
  if (!read.ok) throw new Error(read.reason);
  if (!extra) return read.package;
  // Inject duplicate and extension records after the strict package read.
  const entry = contentTypesPartBytes(read.package)!;
  const partBytes = new Map(read.package.partBytes);
  partBytes.set(
    entry.storageKey,
    strToU8(strFromU8(entry.bytes).replace('</Types>', `${extra}</Types>`))
  );
  const parsed = readOoxmlPart(strFromU8(partBytes.get(entry.storageKey)!), {
    name: '/[Content_Types].xml',
    contentType: 'application/xml',
  });
  if (!parsed.ok) throw new Error('Invalid test XML');
  const overrides = new Map(read.package.contentTypes.overrides);
  for (const node of parsed.part.root.children) {
    if (node.kind !== 'generic' || node.namespaceUri !== CT || node.localName !== 'Override')
      continue;
    const name = node.attributes.find(
      (a) => a.localName === 'PartName' && a.namespaceUri === ''
    )?.value;
    const type = node.attributes.find(
      (a) => a.localName === 'ContentType' && a.namespaceUri === ''
    )?.value;
    if (name && type) overrides.set(name.toLowerCase(), type);
  }
  return { ...read.package, partBytes, contentTypes: { ...read.package.contentTypes, overrides } };
}

function xml(pkg: OoxmlPackage): string {
  return strFromU8(contentTypesPartBytes(pkg)!.bytes);
}

function capture(run: () => OoxmlPackage) {
  const store = {};
  const journals: CanonicalPrimitiveJournal[] = [];
  const stop = observeCanonicalPrimitiveJournal(store, (journal) => journals.push(journal));
  try {
    return { pkg: runObservedStoreTransaction(store, run, () => true), journals };
  } finally {
    stop();
  }
}

describe('batched content-type overrides', () => {
  test('preserves authored entries and matches ordered single-entry edits and journals', () => {
    const before = open(
      '<Override PartName="/word/media/A.png" ContentType="image/png" x:keep="first"><x:child/></Override>' +
        '<x:Override PartName="/word/media/A.png" ContentType="foreign"/>' +
        '<Override PartName="/word/media/a.PNG" ContentType="duplicate"/>' +
        '<Override PartName="/word/media/b.png" ContentType="image/png"/>' +
        '<Override PartName="/word/media/b.png" ContentType="untouched-duplicate"/>' +
        '<Override PartName="/word/media/A.png" x:ContentType="malformed"/>'
    );
    const original = xml(before);
    const entries: Entry[] = [
      ['word/media/A.png', 'image/png'],
      ['/word/media/new%20photo.png', 'image/png'],
      ['/word/media/a.PNG', 'image/jpeg'],
      ['/word/media/NEW photo.png', 'image/gif'],
      ['/word/media/a.png', 'image/jpeg'],
      ['/word/media/a.png', 'image/png'],
    ];
    const batch = capture(() => withContentTypeOverrides(before, entries));
    const sequential = capture(() =>
      entries.reduce((pkg, entry) => withContentTypeOverrides(pkg, [entry]), before)
    );
    expect(xml(batch.pkg)).toBe(xml(sequential.pkg));
    expect(batch.pkg.contentTypes).toEqual(sequential.pkg.contentTypes);
    expect(batch.journals).toEqual(sequential.journals);
    expect(xml(before)).toBe(original);
    expect(batch.pkg.parts).toBe(before.parts);
    expect(batch.pkg.relationships).toBe(before.relationships);
    expect(batch.pkg.contentTypes.defaults).toBe(before.contentTypes.defaults);
    expect(xml(batch.pkg)).toContain('x:keep="first"');
    expect(xml(batch.pkg)).toContain('ContentType="foreign"');
    expect(xml(batch.pkg)).toContain('ContentType="untouched-duplicate"');
    expect(xml(batch.pkg)).toContain('x:ContentType="malformed"');
    expect(xml(batch.pkg)).not.toContain('ContentType="duplicate"');
    expect(batch.pkg.contentTypes.overrides.get('/word/media/new photo.png')).toBe('image/gif');
  });

  test('an unchanged batch retains package identity and emits no effects', () => {
    const before = open('<Override PartName="/word/media/A.png" ContentType="image/png"/>');
    const result = capture(() =>
      withContentTypeOverrides(before, [
        ['/word/media/a.PNG', 'image/png'],
        ['/word/media/A.png', 'image/png'],
      ])
    );
    expect(result.pkg).toBe(before);
    expect(result.journals).toEqual([{ effects: [] }]);
    expect(withContentTypeOverrides(before, [])).toBe(before);
  });

  test('rejects unsafe and reserved names without adding overrides', () => {
    const before = open();
    const names = [
      '../bad',
      '/word/../bad',
      '/word/%2e%2e/bad',
      '/word/%2f/bad',
      '/word/__proto__/bad',
      '/[Content_Types].xml',
      '/word/_rels/document.xml.rels',
    ];
    expect(
      withContentTypeOverrides(
        before,
        names.map((name) => [name, 'image/png'])
      )
    ).toBe(before);
    const after = withContentTypeOverrides(before, [
      ...names.map((name): Entry => [name, 'image/png']),
      ['/word/media/good.png', 'image/png'],
    ]);
    expect(after.contentTypes.overrides.size).toBe(before.contentTypes.overrides.size + 1);
  });

  test('forces an explicit override despite a matching Default and escapes XML values', () => {
    const before = open();
    const after = withContentTypeOverrides(before, [
      ['/word/media/a.png', 'image/png'],
      ['/word/media/a&b.bin', 'image/png'],
    ]);
    expect(after.contentTypes.overrides.get('/word/media/a.png')).toBe('image/png');
    const reopened = readOoxmlPackage(writeOoxmlPackage(after));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.package.contentTypes).toEqual(after.contentTypes);
    expect(xml(after)).toContain('a&amp;b.bin');
    const escaped = withContentTypeOverrides(after, [['/word/media/a&b.bin', 'image/test&"value']]);
    expect(xml(escaped)).toContain('image/test&amp;&quot;value');
    expect(
      readOoxmlPart(xml(escaped), { name: '/[Content_Types].xml', contentType: 'application/xml' })
        .ok
    ).toBe(true);
  });

  test('fails closed for missing or malformed content-type XML', () => {
    const before = open();
    const entry = contentTypesPartBytes(before)!;
    for (const bytes of [undefined, strToU8('<Types')]) {
      const partBytes = new Map(before.partBytes);
      if (bytes) partBytes.set(entry.storageKey, bytes);
      else partBytes.delete(entry.storageKey);
      const pkg = { ...before, partBytes };
      expect(withContentTypeOverrides(pkg, [['/word/media/a.png', 'image/png']])).toBe(pkg);
    }
  });

  test('matches single-entry edits over repeated keys and authored duplicate sets', () => {
    for (let seed = 0; seed < 12; seed++) {
      const before = open(
        Array.from(
          { length: 16 },
          (_, i) =>
            `<Override PartName="/word/media/${i % 8}.png" ContentType="image/type${i % 3}"/>`
        ).join('')
      );
      const entries: Entry[] = Array.from({ length: 45 }, (_, i) => [
        `/word/media/${(i * 7 + seed) % 20}.png`,
        `image/type${(i + seed) % 4}`,
      ]);
      const batch = capture(() => withContentTypeOverrides(before, entries));
      const sequential = capture(() =>
        entries.reduce((pkg, entry) => withContentTypeOverrides(pkg, [entry]), before)
      );
      expect(xml(batch.pkg)).toBe(xml(sequential.pkg));
      expect(batch.pkg.contentTypes).toEqual(sequential.pkg.contentTypes);
      expect(batch.journals).toEqual(sequential.journals);
    }
  });
});

describe('batched binary parts', () => {
  test('removes replaced XML trees once and preserves saved bytes and input isolation', () => {
    const before = open();
    const parsed = readOoxmlPart('<old/>', {
      name: '/word/media/a.png',
      contentType: 'application/xml',
    });
    if (!parsed.ok) throw new Error(parsed.reason);
    const parts = new Map(before.parts);
    parts.set('/word/media/A.PNG', parsed.part);
    parts.set('word/media/a.png', parsed.part);
    parts.set('/word/keep.xml', { ...parsed.part, name: '/word/keep.xml' });
    const pkg = { ...before, parts };
    const input = new Uint8Array([1, 2, 3]);
    const after = withBinaryParts(pkg, [
      { partName: '/word/media/a.png', bytes: input, contentType: 'image/png' },
      { partName: '/word/media/b.png', bytes: new Uint8Array([4, 5]), contentType: 'image/png' },
    ]);
    input[0] = 99;
    expect(after.parts.has('/word/media/A.PNG')).toBe(false);
    expect(after.parts.has('word/media/a.png')).toBe(false);
    expect(after.parts.get('/word/keep.xml')).toBe(parts.get('/word/keep.xml'));
    expect(pkg.parts.size).toBe(before.parts.size + 3);
    const saved = unzipSync(writeOoxmlPackage(after));
    expect(saved['word/media/a.png']).toEqual(new Uint8Array([1, 2, 3]));
    expect(saved['word/media/b.png']).toEqual(new Uint8Array([4, 5]));
    expect(strFromU8(saved['word/keep.xml']!)).toBe(
      serializeOoxmlPart(parts.get('/word/keep.xml')!)
    );
    const reopened = readOoxmlPackage(writeOoxmlPackage(after));
    expect(reopened.ok).toBe(true);
    if (reopened.ok) expect(reopened.package.contentTypes).toEqual(after.contentTypes);
  });
});
