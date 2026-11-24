// Derived indexes (task 4.7) and the save/reopen semantic digest (task 4.8).

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage } from '../package/ooxml-package.ts';
import { deriveOoxmlIndexes, stylesPartOf } from '../package/ooxml-indexes.ts';
import {
  diffSemanticDigests,
  semanticDigest,
  type SemanticDigest,
} from '../package/ooxml-digest.ts';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { replaceChildren } from '../package/ooxml-edit.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOC =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const DOCUMENT =
  `<w:document xmlns:w="${W}" xmlns:a="${A}"><w:body>` +
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr>' +
  '<w:r><w:rPr><w:b/><w:u w:val="double"/></w:rPr><w:t>Title</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t xml:space="preserve">before </w:t></w:r>' +
  '<w:r><w:drawing><a:graphic><a:graphicData uri="urn:clip"/></a:graphic></w:drawing></w:r>' +
  '<w:r><w:t>after</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>tab</w:t><w:tab/><w:t>and</w:t><w:br/><w:t>break</w:t></w:r></w:p>' +
  '</w:body></w:document>';

const STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '</w:styles>';

function build(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId5" Type="${STYLES_REL}" Target="styles.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(DOCUMENT),
    'word/styles.xml': strToU8(STYLES),
  });
}

function loadPackage() {
  const result = readOoxmlPackage(build());
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.package;
}

function loadPart(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function find(part: OoxmlPart, predicate: (node: OoxmlNode) => boolean): OoxmlNode {
  const stack: OoxmlNode[] = [part.root];
  while (stack.length > 0) {
    const node = stack.shift()!;
    if (predicate(node)) return node;
    if (node.kind !== 'textValue') stack.unshift(...node.children);
  }
  throw new Error('node not found');
}

function textElementFor(part: OoxmlPart, value: string): OoxmlNode {
  return find(
    part,
    (node) =>
      node.kind === 'text' &&
      node.children.some((child) => child.kind === 'textValue' && child.value === value)
  );
}

describe('derived semantic indexes (task 4.7)', () => {
  test('paragraph, story, relationship, and style indexes come from the tree', () => {
    const pkg = loadPackage();
    const indexes = deriveOoxmlIndexes(pkg, 7);

    expect(indexes.revision).toBe(7);

    const body = indexes.stories.get('/word/document.xml');
    expect(body?.paragraphs.map((p) => p.text)).toEqual([
      'Title',
      'before after',
      'tab\tand\nbreak',
    ]);
    // Every paragraph is addressable by its stable tree node id.
    expect(indexes.paragraphs.size).toBe(3);
    for (const paragraph of body!.paragraphs) {
      expect(indexes.paragraphs.get(paragraph.nodeId)).toEqual(paragraph);
    }

    expect([...(indexes.relationships.get('/word/document.xml') ?? [])].map((r) => r.id)).toEqual([
      'rId5',
    ]);

    expect(indexes.styles.get('Heading1')).toMatchObject({
      styleId: 'Heading1',
      type: 'paragraph',
      name: 'heading 1',
      basedOn: 'Normal',
    });
  });

  test('the main document styles relationship takes precedence over an unrelated conventional filename', () => {
    const pkg = loadPackage();
    const part = pkg.parts.get('/word/styles.xml')!;
    const relocated = { ...part, name: '/custom/formatting.xml' };
    const decoy = { ...part, root: { ...part.root, children: [] } };
    const changed = {
      ...pkg,
      parts: new Map([...pkg.parts, [part.name, decoy], [relocated.name, relocated]]),
      relationships: new Map([
        ...pkg.relationships,
        [
          pkg.mainDocumentPart,
          pkg.relationships
            .get(pkg.mainDocumentPart)!
            .map((record) => ({ ...record, rawTarget: '../custom/formatting.xml' })),
        ],
      ]),
    };
    expect(stylesPartOf(changed)).toBe(relocated);
    expect(deriveOoxmlIndexes(changed, 1).styles.has('Heading1')).toBe(true);
    const withoutRelationship = { ...changed, relationships: new Map() };
    expect(stylesPartOf(withoutRelationship)).toBe(decoy);
  });

  test('a generic drawing contributes no text but does not drop its run', () => {
    const pkg = loadPackage();
    const indexes = deriveOoxmlIndexes(pkg, 1);
    const second = indexes.stories.get('/word/document.xml')!.paragraphs[1]!;
    // Three runs survive, including the one that holds ONLY unknown content. The legacy
    // model dropped that run entirely, which is how clipart became invisible.
    expect(second.runIds).toHaveLength(3);
    expect(second.text).toBe('before after');
  });

  test('rebuilding from the same revision yields an identical index', () => {
    const pkg = loadPackage();
    const first = deriveOoxmlIndexes(pkg, 3);
    const second = deriveOoxmlIndexes(pkg, 3);
    expect(JSON.stringify([...second.paragraphs])).toBe(JSON.stringify([...first.paragraphs]));
    expect(JSON.stringify([...second.styles])).toBe(JSON.stringify([...first.styles]));
  });

  test('an index is a projection, so an edited tree re-derives rather than mutates', () => {
    const pkg = loadPackage();
    const before = deriveOoxmlIndexes(pkg, 1);
    const part = pkg.parts.get('/word/document.xml')!;
    const target = textElementFor(part, 'Title');
    const edited = replaceChildren(part, target.id, [
      { id: `${part.name}#edit:0`, kind: 'textValue', value: 'Retitled' },
    ]);
    if (!edited.ok) throw new Error(JSON.stringify(edited.issues));

    const after = deriveOoxmlIndexes(
      { ...pkg, parts: new Map([...pkg.parts, [part.name, edited.part]]) },
      2
    );
    expect(after.stories.get('/word/document.xml')!.paragraphs[0]!.text).toBe('Retitled');
    // The earlier index is untouched: it described revision 1 and still does.
    expect(before.stories.get('/word/document.xml')!.paragraphs[0]!.text).toBe('Title');
  });
});

describe('save/reopen semantic digest (task 4.8)', () => {
  const roundTrip = (part: OoxmlPart): SemanticDigest =>
    semanticDigest([loadPart(serializeOoxmlPart(part))]);

  test('an unedited part survives serialize and reopen with no semantic loss', () => {
    const part = loadPart(DOCUMENT);
    const differences = diffSemanticDigests(semanticDigest([part]), roundTrip(part));
    expect(differences).toEqual([]);
  });

  test('BOTH oracles pass for a supported edit', () => {
    const part = loadPart(DOCUMENT);
    const target = textElementFor(part, 'after');
    const edited = replaceChildren(part, target.id, [
      { id: `${part.name}#edit:0`, kind: 'textValue', value: 'AFTER' },
    ]);
    if (!edited.ok) throw new Error(JSON.stringify(edited.issues));

    const reopened = loadPart(serializeOoxmlPart(edited.part));
    // Oracle 1: the canonical tree fingerprint.
    expect(canonicalOoxmlFingerprint(reopened)).toBe(canonicalOoxmlFingerprint(edited.part));
    // Oracle 2: the reopened semantic digest.
    expect(diffSemanticDigests(semanticDigest([edited.part]), semanticDigest([reopened]))).toEqual(
      []
    );
  });

  test('the digest covers accepted run and paragraph properties', () => {
    const digest = semanticDigest([loadPart(DOCUMENT)]);
    const first = digest.stories[0]!.paragraphs[0]!;
    expect(first.paragraphProperties).toEqual(['jc(val=center)', 'pStyle(val=Heading1)']);
    expect(first.runProperties).toEqual([['b', 'u(val=double)']]);
  });

  test('the digest covers generic-node structure', () => {
    const digest = semanticDigest([loadPart(DOCUMENT)]);
    const second = digest.stories[0]!.paragraphs[1]!;
    expect(second.genericStructure).toHaveLength(1);
    expect(second.genericStructure[0]).toEqual(expect.any(String));
  });

  test('a dropped generic subtree is REPORTED, not silently accepted', () => {
    // Exactly the failure this oracle exists for: a "serializer" that loses unknown
    // content produces a self-consistent tree, so a fingerprint of the output against
    // itself would pass. The digest comparison catches it and says where.
    const part = loadPart(DOCUMENT);
    const drawing = find(part, (n) => n.kind === 'generic' && n.localName === 'drawing');
    const stripped = replaceChildren(part, drawing.id, []);
    if (!stripped.ok) throw new Error(JSON.stringify(stripped.issues));

    const differences = diffSemanticDigests(
      semanticDigest([part]),
      semanticDigest([stripped.part])
    );
    expect(differences.length).toBeGreaterThan(0);
    expect(differences[0]!.path).toContain('genericStructure');
  });

  test('lost text is reported with the paragraph that lost it', () => {
    const part = loadPart(DOCUMENT);
    const target = textElementFor(part, 'before ');
    const stripped = replaceChildren(part, target.id, []);
    if (!stripped.ok) throw new Error(JSON.stringify(stripped.issues));
    const differences = diffSemanticDigests(
      semanticDigest([part]),
      semanticDigest([stripped.part])
    );
    expect(differences.some((d) => d.path.endsWith('.p[1].text'))).toBe(true);
  });

  test('one oracle passing cannot cover for the other failing', () => {
    // A tree compared against ITSELF always fingerprints equal, which is precisely why D9
    // makes the reopened digest mandatory rather than optional.
    const part = loadPart(DOCUMENT);
    const drawing = find(part, (n) => n.kind === 'generic' && n.localName === 'drawing');
    const stripped = replaceChildren(part, drawing.id, []);
    if (!stripped.ok) throw new Error(JSON.stringify(stripped.issues));
    expect(canonicalOoxmlFingerprint(stripped.part)).toBe(
      canonicalOoxmlFingerprint(loadPart(serializeOoxmlPart(stripped.part)))
    );
    expect(
      diffSemanticDigests(semanticDigest([part]), semanticDigest([stripped.part])).length
    ).toBeGreaterThan(0);
  });

  test('property ORDER inside rPr is not treated as semantic loss', () => {
    const reordered = DOCUMENT.replace(
      '<w:rPr><w:b/><w:u w:val="double"/></w:rPr>',
      '<w:rPr><w:u w:val="double"/><w:b/></w:rPr>'
    );
    const differences = diffSemanticDigests(
      semanticDigest([loadPart(DOCUMENT)]),
      semanticDigest([loadPart(reordered)])
    );
    expect(differences).toEqual([]);
  });

  test('a changed property VALUE is semantic loss', () => {
    const changed = DOCUMENT.replace('<w:u w:val="double"/>', '<w:u w:val="single"/>');
    const differences = diffSemanticDigests(
      semanticDigest([loadPart(DOCUMENT)]),
      semanticDigest([loadPart(changed)])
    );
    expect(differences.some((d) => d.path.includes('runProperties'))).toBe(true);
  });
});
