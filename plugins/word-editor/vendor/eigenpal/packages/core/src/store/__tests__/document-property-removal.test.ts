import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { readOoxmlPackage, writeOoxmlPackage } from '../package/ooxml-package.ts';
import { withoutDocumentProperties } from '../package/document-property-removal.ts';

const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const fixture = () =>
  zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="doc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="core" Type="${REL}/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Keep content</w:t></w:r></w:p></w:body></w:document>`
    ),
    'docProps/core.xml': strToU8(
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"><cp:lastModifiedBy>Reviewer</cp:lastModifiedBy></cp:coreProperties>'
    ),
    'unknown.xml': strToU8('<unknown xmlns="urn:retained">Preserve</unknown>'),
  });

test('property removal keeps the original package and unrelated parts for undo and reopen', () => {
  const parsed = readOoxmlPackage(fixture());
  if (!parsed.ok) throw new Error('Fixture failed to parse');
  const original = writeOoxmlPackage(parsed.package);
  const removed = withoutDocumentProperties(parsed.package);
  expect(removed).not.toBeNull();
  expect(writeOoxmlPackage(parsed.package)).toEqual(original);
  const before = unzipSync(original);
  const after = unzipSync(writeOoxmlPackage(removed!));
  expect(after['docProps/core.xml']).toBeUndefined();
  expect(after['word/document.xml']).toEqual(before['word/document.xml']);
  expect(after['unknown.xml']).toEqual(before['unknown.xml']);
  expect(strFromU8(after['_rels/.rels']!)).not.toContain('core-properties');
  const reopened = readOoxmlPackage(writeOoxmlPackage(removed!));
  if (!reopened.ok) throw new Error('Saved package failed to parse');
  expect(withoutDocumentProperties(reopened.package)).toBe(reopened.package);
});

for (const location of ['relationship', 'override'] as const) {
  for (const [kind, whitespace] of [
    ['xml', ' \t\r\n'],
    ['nbsp', '\u00a0'],
  ] as const) {
    test(`metadata removal handles ${kind} whitespace in ${location}`, () => {
      const files = unzipSync(fixture());
      const name = location === 'relationship' ? '_rels/.rels' : '[Content_Types].xml';
      const pattern =
        location === 'relationship'
          ? /<Relationship\b[^>]*Id="core"[^>]*\/>/
          : /<Override\b[^>]*PartName="\/docProps\/core.xml"[^>]*\/>/;
      files[name] = strToU8(
        strFromU8(files[name]!).replace(pattern, (declaration) =>
          declaration.replace(
            '/>',
            `>${whitespace}</${location === 'relationship' ? 'Relationship' : 'Override'}>`
          )
        )
      );
      const parsed = readOoxmlPackage(zipSync(files));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const before = writeOoxmlPackage(parsed.package);
      const result = withoutDocumentProperties(parsed.package);
      if (kind === 'nbsp') {
        expect(result).toBeNull();
        expect(writeOoxmlPackage(parsed.package)).toEqual(before);
      } else {
        expect(result).not.toBeNull();
        expect(unzipSync(writeOoxmlPackage(result!))['docProps/core.xml']).toBeUndefined();
      }
    });
  }
}

test('metadata removal refuses a companion relationship part with an extended declaration', () => {
  const files = unzipSync(fixture());
  files['docProps/_rels/core.xml.rels'] = strToU8(`<Relationships xmlns="${REL}"/>`);
  files['[Content_Types].xml'] = strToU8(
    strFromU8(files['[Content_Types].xml']!).replace(
      '</Types>',
      '<Override xmlns:x="urn:retained" x:keep="Retain" PartName="/docProps/_rels/core.xml.rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>'
    )
  );
  const parsed = readOoxmlPackage(zipSync(files));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  const before = writeOoxmlPackage(parsed.package);
  expect(withoutDocumentProperties(parsed.package)).toBeNull();
  expect(writeOoxmlPackage(parsed.package)).toEqual(before);
});
