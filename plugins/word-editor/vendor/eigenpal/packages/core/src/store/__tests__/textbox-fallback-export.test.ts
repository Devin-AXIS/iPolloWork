// A text box's VML fallback story follows its DrawingML story on save (issue #1070).
//
// Word writes both `w:txbxContent` copies identically. An edit changes the DrawingML copy, so
// the saved file carries that copy in the fallback too. Copies that already agree are written
// back unchanged.

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { readOoxmlPackage, writeOoxmlPackage } from '../package/ooxml-package.ts';
import { textboxStoriesInPart } from '../package/textbox-stories.ts';
import { withPart } from '../package/ooxml-package.ts';
import { applyTreeOp } from '../store/tree-ops.ts';
import type { OoxmlNode } from '../package/ooxml-tree.ts';

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" ' +
  'xmlns:x99="urn:example:unsupported"';

const story = (text: string) =>
  `<w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:txbxContent>`;

function docx(modern: string, legacy: string, requires = 'wps'): Uint8Array {
  const box =
    `<mc:AlternateContent><mc:Choice Requires="${requires}"><w:drawing>` +
    '<wp:anchor distT="0" distB="0" ' +
    'distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" ' +
    'layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH ' +
    'relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV ' +
    'relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent ' +
    'cx="2743200" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare ' +
    'wrapText="bothSides"/><wp:docPr id="1" name="Text Box 1"/><wp:cNvGraphicFramePr/><a:graphic>' +
    '<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
    '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext ' +
    'cx="2743200" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    `</wps:spPr><wps:txbx>${story(modern)}</wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData>` +
    '</a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape ' +
    `id="Text Box 1" type="#_x0000_t202" style="width:3in;height:36pt"><v:textbox>${story(legacy)}` +
    '</v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent>';
  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>` +
    `<w:p><w:r><w:t>Cover</w:t></w:r><w:r>${box}</w:r></w:p><w:sectPr/></w:body></w:document>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ' +
        'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    ),
    'word/document.xml': strToU8(document),
  });
}

function storyTexts(bytes: Uint8Array): { modern: string; legacy: string } {
  const xml = strFromU8(unzipSync(bytes)['word/document.xml']!);
  const text = (segment: string) =>
    [...segment.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]).join('');
  return {
    modern: text(xml.match(/<mc:Choice[\s\S]*?<\/mc:Choice>/)![0]),
    legacy: text(xml.match(/<mc:Fallback[\s\S]*?<\/mc:Fallback>/)![0]),
  };
}

function textValueIn(node: OoxmlNode, wanted: string): OoxmlNode | null {
  if (node.kind === 'textValue') return node.value === wanted ? node : null;
  for (const child of node.children) {
    const hit = textValueIn(child, wanted);
    if (hit) return hit;
  }
  return null;
}

describe('text box fallback stories on save', () => {
  test('an edit to the DrawingML story reaches the VML fallback', () => {
    const loaded = readOoxmlPackage(docx('Client: Acme Holdings', 'Client: Acme Holdings'));
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const [box] = textboxStoriesInPart(part);
    const paragraph = box!.root.children.find((child) => child.kind === 'paragraph')!;
    let edited = applyTreeOp(part, {
      op: 'deleteText',
      paragraphId: paragraph.id,
      start: 8,
      end: 21,
    });
    if (!edited.ok) throw new Error(edited.reason);
    edited = applyTreeOp(edited.part, {
      op: 'insertText',
      paragraphId: paragraph.id,
      offset: 8,
      text: 'Beta Logistics',
    });
    if (!edited.ok) throw new Error(edited.reason);
    const saved = writeOoxmlPackage(withPart(loaded.package, edited.part));
    expect(storyTexts(saved)).toEqual({
      modern: 'Client: Beta Logistics',
      legacy: 'Client: Beta Logistics',
    });
    const reopened = readOoxmlPackage(saved);
    expect(reopened.ok).toBe(true);
  });

  test('an edit after an earlier save still reaches the VML fallback', () => {
    const loaded = readOoxmlPackage(docx('First', 'First'));
    if (!loaded.ok) throw new Error(loaded.reason);
    // The first save scans the part and remembers which blocks hold no text box.
    writeOoxmlPackage(loaded.package);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const [box] = textboxStoriesInPart(part);
    const paragraph = box!.root.children.find((child) => child.kind === 'paragraph')!;
    const edited = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: paragraph.id,
      offset: 5,
      text: ' edit',
    });
    if (!edited.ok) throw new Error(edited.reason);
    expect(storyTexts(writeOoxmlPackage(withPart(loaded.package, edited.part)))).toEqual({
      modern: 'First edit',
      legacy: 'First edit',
    });
  });

  test('copies that already agree are written back unchanged', () => {
    const bytes = docx('Same', 'Same');
    const loaded = readOoxmlPackage(bytes);
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const saved = writeOoxmlPackage(loaded.package);
    expect(storyTexts(saved)).toEqual({ modern: 'Same', legacy: 'Same' });
    expect(textValueIn(part.root, 'Same')).not.toBeNull();
    // A second save of the reopened file is stable.
    const again = readOoxmlPackage(saved);
    if (!again.ok) throw new Error(again.reason);
    expect(strFromU8(unzipSync(writeOoxmlPackage(again.package))['word/document.xml']!)).toBe(
      strFromU8(unzipSync(saved)['word/document.xml']!)
    );
  });

  test('a fallback that layout selects is the live copy and is kept', () => {
    const loaded = readOoxmlPackage(docx('Ignored', 'Painted', 'x99'));
    if (!loaded.ok) throw new Error(loaded.reason);
    expect(storyTexts(writeOoxmlPackage(loaded.package))).toEqual({
      modern: 'Ignored',
      legacy: 'Painted',
    });
  });

  test('the live package keeps its own fallback; only the export changes', () => {
    const loaded = readOoxmlPackage(docx('New', 'Old'));
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    writeOoxmlPackage(loaded.package);
    expect(textValueIn(part.root, 'Old')).not.toBeNull();
  });
});
