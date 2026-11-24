// The clipboard fragment content trust boundary: a crafted `data-docx-fragment` reaches
// the merge without the extractor's sanitization, so the merge must neutralize it.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage, type OoxmlPackage } from '../package/ooxml-package.ts';
import { serializeOoxmlPart, type OoxmlNode } from '../package/ooxml-tree.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';
import { sanitizeFragmentBlocks } from '../store/clipboard-fragment-sanitize.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function load(bytes: Uint8Array): OoxmlPackage {
  const r = readOoxmlPackage(bytes);
  if (!r.ok) throw new Error(r.reason);
  return r.package;
}

/** A crafted fragment zip with an arbitrary body. */
function craftedFragment(bodyXml: string, extraRels = ''): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">${extraRels}</Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${bodyXml}</w:body></w:document>`
    ),
  });
}

function blankStore(): { store: TreePackageStore; hostId: string; targetName: string } {
  const target = load(craftedFragment('<w:p/>'));
  const store = new TreePackageStore(target, target.parts.get(target.mainDocumentPart)!);
  const part = store.currentPackage().parts.get(target.mainDocumentPart)!;
  const ids: string[] = [];
  const walk = (n: OoxmlNode): void => {
    if (n.kind === 'textValue') return;
    if (n.kind === 'paragraph') ids.push(n.id);
    for (const c of n.children) walk(c);
  };
  walk(part.root);
  return { store, hostId: ids[0]!, targetName: target.mainDocumentPart };
}

function pastedXml(fragmentBytes: Uint8Array): string {
  const { store, hostId, targetName } = blankStore();
  const pasted = store.applyFragmentPaste(
    { kind: 'body' },
    { paragraphId: hostId, offset: 0, fragmentBytes, lastMarkCovered: true }
  );
  expect(pasted.ok).toBe(true);
  return serializeOoxmlPart(store.currentPackage().parts.get(targetName)!);
}

describe('merge-boundary content sanitization', () => {
  test('a mid-body sectPr in a crafted fragment never lands', () => {
    const xml = pastedXml(
      craftedFragment(
        '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
          '<w:headerReference r:id="rIdEvil"/></w:sectPr></w:pPr>' +
          '<w:r><w:t>keep</w:t></w:r></w:p>'
      )
    );
    expect(xml).toContain('keep');
    expect(xml.includes('sectPr')).toBe(false);
    expect(xml.includes('headerReference')).toBe(false);
  });

  test('a DDEAUTO simple field is unlinked to its cached result', () => {
    const xml = pastedXml(
      craftedFragment(
        '<w:p><w:fldSimple w:instr=" DDEAUTO cmd.exe &quot;/c calc&quot; ">' +
          '<w:r><w:t>cached-result</w:t></w:r></w:fldSimple></w:p>'
      )
    );
    expect(xml).toContain('cached-result');
    expect(xml.includes('DDEAUTO')).toBe(false);
    expect(xml.includes('fldSimple')).toBe(false);
  });

  test('an INCLUDEPICTURE complex field drops its machinery and URL, keeps the result', () => {
    const xml = pastedXml(
      craftedFragment(
        '<w:p>' +
          '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
          '<w:r><w:instrText> INCLUDEPICTURE "http://evil.example/track.png" </w:instrText></w:r>' +
          '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
          '<w:r><w:t>result-text</w:t></w:r>' +
          '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
          '</w:p>'
      )
    );
    expect(xml).toContain('result-text');
    expect(xml.includes('INCLUDEPICTURE')).toBe(false);
    expect(xml.includes('evil.example')).toBe(false);
    expect(xml.includes('fldChar')).toBe(false);
  });

  test('a benign complex field (PAGE) travels intact', () => {
    const xml = pastedXml(
      craftedFragment(
        '<w:p>' +
          '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
          '<w:r><w:instrText> PAGE </w:instrText></w:r>' +
          '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
          '<w:r><w:t>1</w:t></w:r>' +
          '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
          '</w:p>'
      )
    );
    // The PAGE field keeps its begin/instrText/separate/end machinery.
    expect(xml).toContain('fldChar');
    expect(xml).toContain('PAGE');
    expect(xml).toContain('>1<');
  });

  test('altChunk and subDoc external-import elements are stripped', () => {
    const xml = pastedXml(
      craftedFragment(
        '<w:p><w:r><w:t>text</w:t></w:r></w:p>' +
          '<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
          '<w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p>' +
          '<w:altChunk r:id="rIdChunk"/></w:tc></w:tr></w:tbl>'
      )
    );
    expect(xml).toContain('cell');
    expect(xml.includes('altChunk')).toBe(false);
  });

  test('a refused javascript: hyperlink is unwrapped, keeping its text', () => {
    const xml = pastedXml(
      craftedFragment(
        '<w:p><w:hyperlink r:id="rIdJs"><w:r><w:t>click me</w:t></w:r></w:hyperlink></w:p>',
        `<Relationship Id="rIdJs" Type="${R}/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>`
      )
    );
    expect(xml).toContain('click me');
    expect(xml.includes('javascript:')).toBe(false);
    expect(xml.includes('rIdJs')).toBe(false);
  });
});

describe('sanitizeFragmentBlocks is idempotent on clean content', () => {
  test('ordinary paragraphs and tables pass through unchanged', () => {
    const pkg = load(
      craftedFragment('<w:p><w:r><w:t>hi</w:t></w:r></w:p><w:p><w:r><w:t>there</w:t></w:r></w:p>')
    );
    const doc = pkg.parts.get(pkg.mainDocumentPart)!;
    const body = (doc.root as { children: OoxmlNode[] }).children.find(
      (c) => c.kind === 'body'
    ) as { children: OoxmlNode[] };
    const sanitized = sanitizeFragmentBlocks(body.children);
    expect(sanitized).toEqual(body.children);
  });
});
