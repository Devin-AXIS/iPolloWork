import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage, type OoxmlPackage } from '../package/ooxml-package.ts';
import { serializeOoxmlPart, type OoxmlElement, type OoxmlNode } from '../package/ooxml-tree.ts';
import {
  extractFragmentPackage,
  type FragmentCoverage,
} from '../store/clipboard-fragment-extract.ts';
import { paragraphLength } from '../store/tree-op-segments.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function loadPackage(bytes: Uint8Array): OoxmlPackage {
  const result = readOoxmlPackage(bytes);
  if (!result.ok) throw new Error(result.reason);
  return result.package;
}

function buildPackage(
  body: string,
  parts: { readonly styles?: string; readonly numbering?: string } = {}
): OoxmlPackage {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (parts.styles
          ? '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
          : '') +
        (parts.numbering
          ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        (parts.styles
          ? `<Relationship Id="rIdStyles" Type="${R}/styles" Target="styles.xml"/>`
          : '') +
        (parts.numbering
          ? `<Relationship Id="rIdNumbering" Type="${R}/numbering" Target="numbering.xml"/>`
          : '') +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  };
  if (parts.styles) entries['word/styles.xml'] = strToU8(parts.styles);
  if (parts.numbering) entries['word/numbering.xml'] = strToU8(parts.numbering);
  return loadPackage(zipSync(entries));
}

function paragraphIdsUnder(node: OoxmlNode, out: string[] = []): string[] {
  if (node.kind === 'textValue') return out;
  if (node.kind === 'paragraph') out.push(node.id);
  for (const child of node.children) paragraphIdsUnder(child, out);
  return out;
}

function bodyOf(pkg: OoxmlPackage): OoxmlElement {
  const root = pkg.parts.get(pkg.mainDocumentPart)!.root;
  const body =
    root.kind === 'document' ? root.children.find((child) => child.kind === 'body') : null;
  if (!body || body.kind === 'textValue') throw new Error('missing body');
  return body;
}

function fullBodyCoverage(pkg: OoxmlPackage): FragmentCoverage {
  const part = pkg.parts.get(pkg.mainDocumentPart)!;
  const body = bodyOf(pkg);
  const ids = paragraphIdsUnder(body);
  let last: OoxmlElement | null = null;
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph' && node.id === ids[ids.length - 1]) last = node;
    for (const child of node.children) visit(child);
  };
  visit(body);
  if (last === null) throw new Error('missing paragraph');
  return {
    partName: part.name,
    paragraphIds: ids,
    startOffset: 0,
    endOffset: paragraphLength(last),
    coveredParagraphIds: ids,
    fullyCoveredBlockIds: [],
    lastMarkCovered: true,
  };
}

describe('clipboard fragment dependency closure', () => {
  test('numbering style links close styles and numbering to a fixed point', () => {
    const pkg = buildPackage(
      '<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr>' +
        '<w:r><w:t>linked list</w:t></w:r></w:p>',
      {
        styles:
          `<w:styles xmlns:w="${W}">` +
          '<w:style w:type="numbering" w:styleId="LinkedNumbering">' +
          '<w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style></w:styles>',
        numbering:
          `<w:numbering xmlns:w="${W}">` +
          '<w:abstractNum w:abstractNumId="1"><w:numStyleLink w:val="LinkedNumbering"/>' +
          '<w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>' +
          '<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0">' +
          '<w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>' +
          '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>' +
          '<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num></w:numbering>',
      }
    );
    const result = extractFragmentPackage(pkg, fullBodyCoverage(pkg));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fragment = loadPackage(result.bytes);
    const stylesXml = serializeOoxmlPart(fragment.parts.get('/word/styles.xml')!);
    const numberingXml = serializeOoxmlPart(fragment.parts.get('/word/numbering.xml')!);
    expect(stylesXml).toContain('w:styleId="LinkedNumbering"');
    expect(numberingXml).toContain('w:numId="1"');
    expect(numberingXml).toContain('w:numId="2"');
    expect(numberingXml).toContain('w:abstractNumId="2"');
  });

  test('row-aligned coverage keeps wrapped rows and restarts wrapped cells', () => {
    const wrappedCell = (text: string, restart: boolean): string =>
      '<w:customXml w:element="cell"><w:tc><w:tcPr>' +
      `<w:vMerge${restart ? ' w:val="restart"' : ''}/></w:tcPr>` +
      `<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc></w:customXml>`;
    const pkg = buildPackage(
      '<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
        '<w:sdt><w:sdtPr/><w:sdtContent>' +
        `<w:tr>${wrappedCell('top', true)}</w:tr>` +
        `<w:tr>${wrappedCell('bottom', false)}</w:tr>` +
        '</w:sdtContent></w:sdt></w:tbl><w:p/>'
    );
    const part = pkg.parts.get(pkg.mainDocumentPart)!;
    const ids = paragraphIdsUnder(bodyOf(pkg));
    const coverage: FragmentCoverage = {
      partName: part.name,
      paragraphIds: [ids[1]!, ids[2]!],
      startOffset: 0,
      endOffset: 0,
      coveredParagraphIds: [ids[1]!],
      fullyCoveredBlockIds: [],
      lastMarkCovered: false,
    };
    const result = extractFragmentPackage(pkg, coverage);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const documentXml = serializeOoxmlPart(
      loadPackage(result.bytes).parts.get('/word/document.xml')!
    );
    expect(documentXml).toContain('<w:tbl>');
    expect(documentXml).toContain('<w:sdt>');
    expect(documentXml).toContain('<w:customXml');
    expect(documentXml).toContain('bottom');
    expect(documentXml).not.toContain('top');
    expect(documentXml).toContain('w:vMerge w:val="restart"');
  });
});
