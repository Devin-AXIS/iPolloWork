// Round-trip regression: styles.xml with duplicate style ids must preserve every authored
// definition through save/reopen (fingerprint oracle) while the document story digest stays
// stable (semantic oracle).

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage, writeOoxmlPackage } from '../package/ooxml-package.ts';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';
import { buildStyleCascadeTable } from '../../layout/style-cascade.ts';
import { resolveRunStyle } from '../../layout/run-style.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OD = `${R}/officeDocument`;
const STYLES_REL = `${R}/styles`;

const HEADING1_FIRST =
  `<w:style w:type="paragraph" w:styleId="Heading1">` +
  `<w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/>` +
  `<w:rPr><w:color w:val="2E74B5"/><w:sz w:val="32"/></w:rPr></w:style>`;

const HEADING1_LAST =
  `<w:style w:type="paragraph" w:styleId="Heading1">` +
  `<w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/>` +
  `<w:pPr><w:spacing w:before="360" w:after="200"/></w:pPr>` +
  `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/>` +
  `<w:color w:val="1B3A5C"/><w:sz w:val="36"/></w:rPr></w:style>`;

const STYLES_WITH_DUPLICATES =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  HEADING1_FIRST +
  HEADING1_LAST +
  '</w:styles>';

const DOCUMENT =
  `<w:document xmlns:w="${W}"><w:body>` +
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p>' +
  '</w:body></w:document>';

function loadStylesPart(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, {
    name: '/word/styles.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function buildPackage(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId5" Type="${STYLES_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(DOCUMENT),
    'word/styles.xml': strToU8(STYLES_WITH_DUPLICATES),
  });
}

describe('styles.xml save/reopen with duplicate style ids', () => {
  test('both duplicate Heading1 definitions survive part-level serialize → reopen', () => {
    const original = loadStylesPart(STYLES_WITH_DUPLICATES);
    const reopened = loadStylesPart(serializeOoxmlPart(original));
    expect(canonicalOoxmlFingerprint(reopened)).toBe(canonicalOoxmlFingerprint(original));
    const saved = serializeOoxmlPart(original);
    expect(saved.match(/w:styleId="Heading1"/g)?.length).toBe(2);
    expect(saved).toContain('2E74B5');
    expect(saved).toContain('1B3A5C');
  });

  test('package save/reopen preserves styles fingerprint and document semantic digest', () => {
    const loaded = readOoxmlPackage(buildPackage());
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const styles = loaded.package.parts.get('/word/styles.xml')!;
    const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const stylesBefore = canonicalOoxmlFingerprint(styles);
    const digestBefore = semanticDigest([main]);

    const reopened = readOoxmlPackage(writeOoxmlPackage(loaded.package));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;

    const reopenedStyles = reopened.package.parts.get('/word/styles.xml')!;
    const reopenedMain = reopened.package.parts.get(reopened.package.mainDocumentPart)!;
    expect(canonicalOoxmlFingerprint(reopenedStyles)).toBe(stylesBefore);
    expect(diffSemanticDigests(digestBefore, semanticDigest([reopenedMain]))).toEqual([]);

    const table = buildStyleCascadeTable(reopenedStyles.root);
    const heading = table.styles.get('Heading1')!;
    expect(resolveRunStyle(heading.runProperties)).toMatchObject({
      fontFamily: 'Arial',
      fontSizePt: 18,
      bold: true,
      color: '1B3A5C',
    });
  });
});
