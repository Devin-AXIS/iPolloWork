// The pin that keeps actor striping honest on the paste path.
//
// Bookmark `@w:id`, revision `@w:id` and `wp:docPr/@id` are all minted by a counter that
// seeds from "one past the highest in the target" and counts up, which is Word's own
// sequence. With no collaboration actor bound that sequence must not move: a solo author's
// saved file is the fidelity baseline, and two concurrent peers are the only reason to
// leave it. Its striped twin lives in
// `packages/pro/src/collaboration/__tests__/document-paste-actor-ids.test.ts`.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage, type OoxmlPackage } from '../package/ooxml-package.ts';
import { type OoxmlElement, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import { carriesRevisionId } from '../store/tree-op-revision-ids.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';
import { attributeValueOf } from '../store/tree-op-nodes.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const DATE = '2026-01-01T00:00:00Z';

function loadPackage(bytes: Uint8Array): OoxmlPackage {
  const result = readOoxmlPackage(bytes);
  if (!result.ok) throw new Error(`package: ${result.reason}`);
  return result.package;
}

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

function bodyOf(part: OoxmlPart): OoxmlElement {
  const body =
    part.root.kind === 'document'
      ? part.root.children.find((child) => child.kind === 'body')
      : null;
  if (!body || !isElement(body)) throw new Error('no body');
  return body;
}

function paragraphIdsUnder(node: OoxmlNode, out: string[] = []): string[] {
  if (node.kind === 'textValue') return out;
  if (node.kind === 'paragraph') out.push(node.id);
  for (const child of node.children) paragraphIdsUnder(child, out);
  return out;
}

function buildPackage(bodyXml: string): OoxmlPackage {
  return loadPackage(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="${REL}"/>`),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${bodyXml}</w:body></w:document>`
      ),
    })
  );
}

function openStore(pkg: OoxmlPackage): TreePackageStore {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) throw new Error('no main');
  return new TreePackageStore(pkg, main);
}

/** Paste two marked paragraphs, each with a picture, into a host whose body ends with `extra`. */
function pasteTwo(extra = '') {
  const png = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
    ),
    (character) => character.charCodeAt(0)
  );
  const picture = (docPrId: string): string =>
    '<w:r><w:drawing><wp:inline>' +
    `<wp:extent cx="190500" cy="190500"/><wp:docPr id="${docPrId}" name="Picture ${docPrId}"/>` +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="p.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId7"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="190500" cy="190500"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic>' +
    '</wp:inline></w:drawing></w:r>';
  const marked = (index: string, docPrId: string): string =>
    '<w:p>' +
    `<w:bookmarkStart w:id="1${index}" w:name="mark${index}"/><w:bookmarkEnd w:id="1${index}"/>` +
    `<w:ins w:id="2${index}" w:author="Source" w:date="${DATE}">` +
    `<w:r><w:t>Pasted ${index}</w:t></w:r></w:ins>` +
    picture(docPrId) +
    '</w:p>';
  const fragmentBytes = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId7" Type="${R}/image" Target="media/image1.png"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}">` +
        `<w:body>${marked('1', '31')}${marked('2', '32')}</w:body></w:document>`
    ),
    'word/media/image1.png': png,
  });

  // The target already holds bookmark 4 and revision 9, so the seeds are 5 and 10. It
  // holds no drawing, so `allocateDrawingPropertyId` seeds the docPr walk at 1.
  const target = buildPackage(
    '<w:p><w:bookmarkStart w:id="4" w:name="host"/><w:bookmarkEnd w:id="4"/>' +
      `<w:ins w:id="9" w:author="Host" w:date="${DATE}"><w:r><w:t>Host</w:t></w:r></w:ins>` +
      `</w:p>${extra}`
  );
  const store = openStore(target);
  const hostId = paragraphIdsUnder(
    bodyOf(store.currentPackage().parts.get(target.mainDocumentPart)!)
  )[0]!;
  const pasted = store.applyFragmentPaste(
    { kind: 'body' },
    { paragraphId: hostId, offset: 0, fragmentBytes, lastMarkCovered: true }
  );
  expect(pasted.ok).toBe(true);

  const part = store.currentPackage().parts.get(target.mainDocumentPart)!;
  const idsOf = (read: (node: OoxmlNode) => string | undefined): number[] => {
    const found = new Set<string>();
    const walk = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      const value = read(node);
      if (value !== undefined) found.add(value);
      for (const child of node.children) walk(child);
    };
    walk(part.root);
    return [...found].map(Number).sort((left, right) => left - right);
  };
  return idsOf;
}

const docPrIds = (node: OoxmlNode): string | undefined =>
  node.kind === 'drawingDocPr'
    ? node.attributes.find(
        (attribute) => attribute.localName === 'id' && attribute.namespaceUri === ''
      )?.value
    : undefined;

describe('a solo paste keeps every id sequence dense', () => {
  test('a solo paste keeps the dense bookmark, revision and docPr sequences', () => {
    const idsOf = pasteTwo();
    // TWO of each namespace travel, so the second id is pinned too.
    expect(
      idsOf((node) => (node.kind === 'bookmarkStart' ? attributeValueOf(node, 'id') : undefined))
    ).toEqual([4, 5, 6]);
    expect(
      idsOf((node) => (carriesRevisionId(node) ? attributeValueOf(node, 'id') : undefined))
    ).toEqual([9, 10, 11]);
    expect(idsOf(docPrIds)).toEqual([1, 2]);
  });

  test('a pasted drawing id skips a legacy VML shape number', () => {
    // Shape automation names the VML box 2, so the second pasted drawing must not take it.
    const idsOf = pasteTwo(
      '<w:p><w:r><w:pict xmlns:v="urn:schemas-microsoft-com:vml"><v:shape id="_x0000_s2" ' +
        'style="width:10pt;height:10pt"/></w:pict></w:r></w:p>'
    );
    expect(idsOf(docPrIds)).toEqual([1, 3]);
  });
});
