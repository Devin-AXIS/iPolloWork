// Round-trip regression: complex PAGE / NUMPAGES field markup must survive serialize and
// package save without losing the w:fldChar / w:instrText structure that layout projects.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';
import { readOoxmlPackage, writeOoxmlPackage } from '../package/ooxml-package.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = `${R}/officeDocument`;

const COMPLEX_PAGE_FIELDS =
  `<w:p>` +
  `<w:r><w:t>Page </w:t></w:r>` +
  `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
  `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r>` +
  `<w:r><w:t> of </w:t></w:r>` +
  `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>NUMPAGES</w:instrText>` +
  `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r>` +
  `</w:p>`;

function parseDocument(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(`document read failed: ${result.reason}`);
  return result.part;
}

function collectInstrText(root: OoxmlNode): string[] {
  const found: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === 'instrText' && node.namespaceUri === W) {
      const text = node.children.find((child) => child.kind === 'textValue');
      if (text?.kind === 'textValue') found.push(text.value);
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return found;
}

function collectFldCharTypes(root: OoxmlNode): string[] {
  const found: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === 'fldChar' && node.namespaceUri === W) {
      const type = node.attributes.find(
        (attribute) => attribute.localName === 'fldCharType'
      )?.value;
      if (type) found.push(type);
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return found;
}

function buildPackage(bodyInner: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${bodyInner}<w:sectPr/></w:body></w:document>`
    ),
  });
}

describe('complex PAGE / NUMPAGES field round-trip', () => {
  test('preserves fldChar sequence and instrText through serialize → reopen', () => {
    const original = parseDocument(
      `<w:document xmlns:w="${W}"><w:body>${COMPLEX_PAGE_FIELDS}<w:sectPr/></w:body></w:document>`
    );
    expect(collectInstrText(original.root)).toEqual(['PAGE', 'NUMPAGES']);
    expect(collectFldCharTypes(original.root)).toEqual([
      'begin',
      'separate',
      'end',
      'begin',
      'separate',
      'end',
    ]);

    const reopened = parseDocument(serializeOoxmlPart(original));
    expect(collectInstrText(reopened.root)).toEqual(['PAGE', 'NUMPAGES']);
    expect(collectFldCharTypes(reopened.root)).toEqual(collectFldCharTypes(original.root));
    expect(canonicalOoxmlFingerprint(reopened)).toBe(canonicalOoxmlFingerprint(original));
    expect(diffSemanticDigests(semanticDigest([original]), semanticDigest([reopened]))).toEqual([]);
  });

  test('preserves complex fields through writeOoxmlPackage save and reopen', () => {
    const loaded = readOoxmlPackage(buildPackage(COMPLEX_PAGE_FIELDS));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    expect(collectInstrText(main.root)).toEqual(['PAGE', 'NUMPAGES']);

    const reopened = readOoxmlPackage(writeOoxmlPackage(loaded.package));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;

    const reopenedMain = reopened.package.parts.get(reopened.package.mainDocumentPart)!;
    expect(collectInstrText(reopenedMain.root)).toEqual(['PAGE', 'NUMPAGES']);
    expect(collectFldCharTypes(reopenedMain.root)).toEqual(collectFldCharTypes(main.root));
    expect(canonicalOoxmlFingerprint(reopenedMain)).toBe(canonicalOoxmlFingerprint(main));
    expect(diffSemanticDigests(semanticDigest([main]), semanticDigest([reopenedMain]))).toEqual([]);
  });

  test('footer part complex fields survive package save', () => {
    const footerBody = COMPLEX_PAGE_FIELDS;
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId8" Type="${R}/footer" Target="footer1.xml"/></Relationships>`
      ),
      'word/footer1.xml': strToU8(`<w:ftr xmlns:w="${W}">${footerBody}</w:ftr>`),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          '<w:p><w:r><w:t>body</w:t></w:r></w:p>' +
          '<w:sectPr><w:footerReference w:type="default" r:id="rId8"/></w:sectPr>' +
          '</w:body></w:document>'
      ),
    });
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const footer = loaded.package.parts.get('/word/footer1.xml')!;
    expect(collectInstrText(footer.root)).toEqual(['PAGE', 'NUMPAGES']);

    const reopened = readOoxmlPackage(writeOoxmlPackage(loaded.package));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;

    const reopenedFooter = reopened.package.parts.get('/word/footer1.xml')!;
    expect(collectInstrText(reopenedFooter.root)).toEqual(['PAGE', 'NUMPAGES']);
    expect(canonicalOoxmlFingerprint(reopenedFooter)).toBe(canonicalOoxmlFingerprint(footer));
    expect(diffSemanticDigests(semanticDigest([footer]), semanticDigest([reopenedFooter]))).toEqual(
      []
    );
  });
});
