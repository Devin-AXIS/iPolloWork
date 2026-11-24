import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { canonicalMediaReferenceCount } from '../package/canonical-media-references.ts';
import { liveDrawingReferenceCount } from '../package/drawing-package-edit.ts';
import { readOoxmlPackage, writeOoxmlPackage } from '../package/ooxml-package.ts';
import { canonicalOoxmlFingerprint, readOoxmlPart, type OoxmlNode } from '../package/ooxml-tree.ts';
import { relationshipsOf } from '../package/package-edit.ts';
import { IMAGE_RELATIONSHIP_TYPE } from '../package/relationships.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const V = 'urn:schemas-microsoft-com:vml';
const O = 'urn:schemas-microsoft-com:office:office';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const MAIN = '/word/document.xml';
const MEDIA = '/word/media/shared.png';
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (character) => character.charCodeAt(0)
);

function picture(): string {
  return (
    '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="12700" cy="12700"/><wp:docPr id="1" name="photo"/>' +
    `<a:graphic><a:graphicData uri="${P}"><pic:pic>` +
    '<pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId2"/></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:ext cx="12700" cy="12700"/></a:xfrm>' +
    '<a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:inline></w:drawing>'
  );
}

function document(content: string): string {
  return (
    `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:alias="${R}" xmlns:wp="${WP}" ` +
    `xmlns:a="${A}" xmlns:pic="${P}" xmlns:v="${V}" xmlns:o="${O}" xmlns:mc="${MC}">` +
    `<w:body><w:p><w:r>${content}</w:r></w:p></w:body></w:document>`
  );
}

function opaqueVml(attribute: string): string {
  // A custom template, shadow and skew stay opaque; the media remains authored content.
  return (
    '<w:pict><v:group style="width:100pt;height:100pt">' +
    `<v:shape type="#custom"><v:imagedata ${attribute}/><v:shadow on="t"/>` +
    '<o:skew on="t"/></v:shape></v:group></w:pict>'
  );
}

function build(content: string, otherId = '') {
  const loaded = readOoxmlPackage(
    zipSync(
      {
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}">` +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="png" ContentType="image/png"/>' +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
        ),
        'word/document.xml': strToU8(document(picture() + content)),
        'word/_rels/document.xml.rels': strToU8(
          `<Relationships xmlns="${REL}">` +
            `<Relationship Id="rId2" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="media/shared.png"/>` +
            (otherId
              ? `<Relationship Id="${otherId}" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="media/shared.png"/>`
              : '') +
            '</Relationships>'
        ),
        'word/media/shared.png': PNG,
      },
      { level: 0 }
    )
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

function find(root: OoxmlNode, localName: string): OoxmlNode {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.kind === 'textValue') continue;
    if (node.localName === localName) return node;
    for (const child of node.children) stack.push(child);
  }
  throw new Error(`missing ${localName}`);
}

describe('canonical VML media retention', () => {
  for (const [name, content, relationshipId] of [
    ['shared relationship', opaqueVml('r:id="rId2"'), 'rId2'],
    ['aliased namespace', opaqueVml('alias:id="rId2"'), 'rId2'],
    ['legacy Office relationship', opaqueVml('o:relid="rId2"'), 'rId2'],
    ['different relationship to the same media', opaqueVml('r:id="rId3"'), 'rId3'],
    [
      'unselected MC fallback',
      '<mc:AlternateContent><mc:Choice Requires="a">' +
        '<w:drawing/></mc:Choice><mc:Fallback>' +
        opaqueVml('r:id="rId2"') +
        '</mc:Fallback></mc:AlternateContent>',
      'rId2',
    ],
  ]) {
    test(`deleting a DrawingML picture preserves ${name} through save and undo`, () => {
      const pkg = build(content!, relationshipId === 'rId3' ? 'rId3' : '');
      const part = pkg.parts.get(MAIN)!;
      const drawing = find(part.root, 'drawing');
      // The primary drawing precedes the opaque content; choose its typed node explicitly.
      const firstRun = find(part.root, 'r');
      if (firstRun.kind === 'textValue') throw new Error('missing run');
      const primary = firstRun.children.find((node) => node.kind === 'drawing') ?? drawing;
      const originalVml = canonicalOoxmlFingerprint(find(part.root, 'pict'));
      const original = canonicalOoxmlFingerprint(part);
      const store = new TreePackageStore(pkg, part);
      expect(store.deleteImage({ kind: 'body' }, primary.id).ok).toBe(true);
      const after = store.currentPackage();
      expect(relationshipsOf(after, MAIN).some((record) => record.id === relationshipId)).toBe(
        true
      );
      expect(after.partBytes.get(MEDIA)).toEqual(PNG);
      expect(liveDrawingReferenceCount(after, MEDIA)).toBe(1);
      expect(canonicalOoxmlFingerprint(find(after.parts.get(MAIN)!.root, 'pict'))).toBe(
        originalVml
      );
      const reopened = readOoxmlPackage(writeOoxmlPackage(after));
      expect(reopened.ok).toBe(true);
      if (!reopened.ok) throw new Error(reopened.reason);
      expect(reopened.package.partBytes.get(MEDIA)).toEqual(PNG);
      expect(
        relationshipsOf(reopened.package, MAIN).some((record) => record.id === relationshipId)
      ).toBe(true);
      expect(canonicalOoxmlFingerprint(reopened.package.parts.get(MAIN)!)).toBe(
        canonicalOoxmlFingerprint(after.parts.get(MAIN)!)
      );
      expect(store.undo()).not.toBeNull();
      expect(canonicalOoxmlFingerprint(store.currentPackage().parts.get(MAIN)!)).toBe(original);
      expect(store.currentPackage().partBytes.get(MEDIA)).toEqual(PNG);
    });
  }

  test('does not keep media for a spoofed relationship prefix', () => {
    const pkg = build(opaqueVml('xmlns:r="urn:foreign" r:id="rId2"'));
    const part = pkg.parts.get(MAIN)!;
    const store = new TreePackageStore(pkg, part);
    expect(store.deleteImage({ kind: 'body' }, find(part.root, 'drawing').id).ok).toBe(true);
    expect(
      relationshipsOf(store.currentPackage(), MAIN).some((record) => record.id === 'rId2')
    ).toBe(false);
    expect(store.currentPackage().partBytes.has(MEDIA)).toBe(false);
  });

  test('bounds traversal and reports uncertainty instead of proving an orphan', () => {
    const parsed = readOoxmlPart(document(opaqueVml('r:id="rId2"')), {
      name: MAIN,
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    });
    if (!parsed.ok) throw new Error(parsed.reason);
    const ids = new Set(['rId2']);
    expect(canonicalMediaReferenceCount(parsed.part.root, ids).count).toBe(1);
    expect(
      canonicalMediaReferenceCount(parsed.part.root, ids, { maxVisited: 3, maxDepth: 64 }).truncated
    ).toBe(true);
    expect(
      canonicalMediaReferenceCount(parsed.part.root, ids, { maxVisited: 100, maxDepth: 2 })
        .truncated
    ).toBe(true);
  });
});
