// Public "lossless round-trip" claims need feature-specific teeth.
//
// The broad real-document census catches a dropped element class, but it does not identify
// constructs that older support-matrix rows used to call partial or unsupported. This fixture
// keeps those constructs beside an ordinary editable paragraph and proves that an unrelated edit
// survives save/reopen without changing their normalized structure or binary payloads.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  readOoxmlPackage,
  withPart,
  writeOoxmlPackage,
  type OoxmlPackage,
} from '../package/ooxml-package.ts';
import {
  canonicalOoxmlFingerprint,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';
import { paragraphTextOf } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const O = 'urn:schemas-microsoft-com:office:office';
const V = 'urn:schemas-microsoft-com:vml';
const B = 'http://schemas.openxmlformats.org/officeDocument/2006/bibliography';

const OFFICE_DOCUMENT = `${R}/officeDocument`;
const NUMBERING = `${R}/numbering`;
const IMAGE = `${R}/image`;
const OLE_OBJECT = `${R}/oleObject`;

const OLE_BYTES = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1, 2, 3, 4]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function documentXml(): string {
  return (
    `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}"` +
    ` xmlns:pic="${PIC}" xmlns:o="${O}" xmlns:v="${V}">` +
    '<w:background w:color="DDEEFF"><w:backgroundImage r:id="rIdImage"/></w:background>' +
    '<w:body>' +
    '<w:p><w:r><w:t>editable</w:t></w:r></w:p>' +
    '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="152400" cy="152400"/><wp:docPr id="1" name="adjusted"/>' +
    '<wp:cNvGraphicFramePr/><a:graphic>' +
    `<a:graphicData uri="${PIC}"><pic:pic>` +
    '<pic:nvPicPr><pic:cNvPr id="1" name="adjusted"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rIdImage">' +
    '<a:lum bright="70000" contrast="20000"/><a:grayscl/>' +
    '</a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:ext cx="152400" cy="152400"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    '<a:effectLst><a:outerShdw blurRad="40000" dist="20000" dir="5400000">' +
    '<a:srgbClr val="000000"><a:alpha val="50000"/></a:srgbClr>' +
    '</a:outerShdw><a:glow rad="30000"><a:srgbClr val="FF0000"/></a:glow></a:effectLst>' +
    '</pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:inline></w:drawing></w:r></w:p>' +
    '<w:p><w:r><w:ink w:id="ink-1"/></w:r></w:p>' +
    '<w:p><w:r><w:pict><v:rect id="rect-1"/><v:line id="line-1"/>' +
    '<v:shape id="shape-1" type="#custom"/></w:pict></w:r></w:p>' +
    '<w:p><w:r><w:object o:progId="Word.Document.8" r:id="rIdOle">' +
    '<o:OLEObject Type="Embed" ProgID="Word.Document.8" r:id="rIdOle"/>' +
    '</w:object></w:r></w:p>' +
    '<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData>' +
    '<w:name w:val="LegacyField"/><w:checkBox><w:checked w:val="1"/></w:checkBox>' +
    '</w:ffData></w:fldChar><w:instrText> FORMCHECKBOX </w:instrText>' +
    '<w:fldChar w:fldCharType="separate"/><w:t>☒</w:t>' +
    '<w:fldChar w:fldCharType="end"/></w:r></w:p>' +
    '<w:p><w:fldSimple w:instr=" CITATION source-1 "><w:r><w:t>[1]</w:t></w:r></w:fldSimple></w:p>' +
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr>' +
    '<w:r><w:t>picture bullet</w:t></w:r></w:p>' +
    '</w:body></w:document>'
  );
}

function buildFixture(): Uint8Array {
  const contentTypes =
    `<Types xmlns="${CT}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
    '</Types>';
  const rootRels =
    `<Relationships xmlns="${REL}">` +
    `<Relationship Id="rId1" Type="${OFFICE_DOCUMENT}" Target="word/document.xml"/>` +
    '</Relationships>';
  const documentRels =
    `<Relationships xmlns="${REL}">` +
    `<Relationship Id="rIdNumbering" Type="${NUMBERING}" Target="numbering.xml"/>` +
    `<Relationship Id="rIdImage" Type="${IMAGE}" Target="media/image1.png"/>` +
    `<Relationship Id="rIdOle" Type="${OLE_OBJECT}" Target="embeddings/oleObject1.bin"/>` +
    '</Relationships>';
  const numbering =
    `<w:numbering xmlns:w="${W}">` +
    '<w:numPicBullet w:numPicBulletId="1"><w:pict><w:shape w:id="bullet-shape"/></w:pict></w:numPicBullet>' +
    '<w:abstractNum w:abstractNumId="4"><w:lvl w:ilvl="0"><w:start w:val="1"/>' +
    '<w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlPicBulletId w:val="1"/>' +
    '</w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="4"/></w:num>' +
    '</w:numbering>';
  const bibliography =
    `<b:Sources xmlns:b="${B}" SelectedStyle="APA.XSL" StyleName="APA">` +
    '<b:Source><b:Tag>source-1</b:Tag><b:SourceType>Book</b:SourceType>' +
    '<b:Title>Preserved title</b:Title></b:Source></b:Sources>';

  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'word/document.xml': strToU8(documentXml()),
    'word/_rels/document.xml.rels': strToU8(documentRels),
    'word/numbering.xml': strToU8(numbering),
    'word/media/image1.png': PNG_BYTES,
    'word/embeddings/oleObject1.bin': OLE_BYTES,
    'customXml/item1.xml': strToU8(bibliography),
  });
}

function* walk(node: OoxmlNode): Generator<OoxmlNode> {
  yield node;
  if (node.kind === 'textValue') return;
  for (const child of node.children) yield* walk(child);
}

function nodesNamed(pkg: OoxmlPackage, localName: string): OoxmlNode[] {
  const nodes: OoxmlNode[] = [];
  for (const part of pkg.parts.values()) {
    for (const node of walk(part.root)) {
      if (node.kind !== 'textValue' && node.localName === localName) nodes.push(node);
    }
  }
  return nodes;
}

function featureFingerprints(pkg: OoxmlPackage, localName: string): string[] {
  return nodesNamed(pkg, localName).map(canonicalOoxmlFingerprint).sort();
}

function mainPart(pkg: OoxmlPackage): OoxmlPart {
  const part = pkg.parts.get(pkg.mainDocumentPart);
  if (!part) throw new Error('missing main document part');
  return part;
}

function editedRoundTrip(): {
  before: OoxmlPackage;
  after: OoxmlPackage;
  editedText: string | null;
} {
  const opened = readOoxmlPackage(buildFixture());
  if (!opened.ok) throw new Error(`open failed: ${opened.reason}`);
  const before = opened.package;
  const store = new TreeDocumentStore(mainPart(before));
  const paragraph = [...walk(store.part.root)].find(
    (node) => node.kind === 'paragraph' && paragraphTextOf(store.part, node.id) === 'editable'
  );
  if (!paragraph || paragraph.kind !== 'paragraph') throw new Error('missing editable paragraph');
  const edited = store.transact((tx) =>
    tx.apply({ op: 'insertText', paragraphId: paragraph.id, offset: 0, text: 'X' })
  );
  if (!edited.ok) throw new Error(`edit failed: ${edited.reason}`);
  const saved = writeOoxmlPackage(withPart(before, store.part));
  const reopened = readOoxmlPackage(saved);
  if (!reopened.ok) throw new Error(`reopen failed: ${reopened.reason}`);
  return {
    before,
    after: reopened.package,
    editedText: paragraphTextOf(mainPart(reopened.package), paragraph.id),
  };
}

describe('disputed feature rows preserve untouched content through an adjacent edit', () => {
  const XML_FEATURES = [
    'background',
    'backgroundImage',
    'lum',
    'grayscl',
    'effectLst',
    'outerShdw',
    'glow',
    'ink',
    'rect',
    'line',
    'shape',
    'object',
    'OLEObject',
    'ffData',
    'checkBox',
    'fldSimple',
    'Sources',
    'Source',
    'numPicBullet',
    'lvlPicBulletId',
  ] as const;

  test('the adjacent edit commits and survives reopen', () => {
    expect(editedRoundTrip().editedText).toBe('Xeditable');
  });

  for (const localName of XML_FEATURES) {
    test(`${localName} keeps its normalized structure`, () => {
      const { before, after } = editedRoundTrip();
      expect(featureFingerprints(before, localName)).not.toEqual([]);
      expect(featureFingerprints(after, localName)).toEqual(featureFingerprints(before, localName));
    });
  }

  test('the OLE binary and image bytes remain byte-identical', () => {
    const { before, after } = editedRoundTrip();
    for (const partName of ['/word/embeddings/oleObject1.bin', '/word/media/image1.png']) {
      expect(after.partBytes.get(partName)).toEqual(before.partBytes.get(partName));
    }
  });
});
