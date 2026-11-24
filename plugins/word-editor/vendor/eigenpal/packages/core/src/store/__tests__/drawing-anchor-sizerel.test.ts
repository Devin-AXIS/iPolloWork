// Word emits `wp14:sizeRelH`/`wp14:sizeRelV` (2010 drawing extensions, CT_Anchor trailing
// children) on ordinary anchored pictures. They must not demote the typed anchor — the
// letterhead EMF in real correspondence disappears entirely when they do.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../index.ts';
import { indexInlineDrawingProjectionsInPart } from '../package/drawing-projection.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const WP14 = 'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function anchoredPicture(trailing: string): string {
  return (
    '<w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" ' +
    'relativeHeight="251659264" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>-1985318</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>-1374294</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="7569200" cy="10702290"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:wrapNone/><wp:docPr id="2" name="Bild 1"/>' +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks/></wp:cNvGraphicFramePr>' +
    `<a:graphic><a:graphicData uri="${PIC}">` +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Bild 1"/><pic:cNvPicPr><a:picLocks/></pic:cNvPicPr></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId7"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr bwMode="auto"><a:xfrm><a:off x="0" y="0"/><a:ext cx="7569200" cy="10702290"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    trailing +
    '</wp:anchor></w:drawing>'
  );
}

function parsePart(body: string) {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:wp14="${WP14}" ` +
    `xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`;
  const parsed = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

function drawingKindIn(part: ReturnType<typeof parsePart>): string {
  let kind = 'none';
  const walk = (node: { localName?: string; kind: string; children?: readonly unknown[] }) => {
    if (node.localName === 'drawing') kind = node.kind;
    for (const child of (node.children ?? []) as {
      localName?: string;
      kind: string;
      children?: readonly unknown[];
    }[]) {
      walk(child);
    }
  };
  walk(part.root as never);
  return kind;
}

describe('wp14 sizeRel anchor extensions', () => {
  test('trailing sizeRelH/sizeRelV keep the anchor typed and projecting', () => {
    const part = parsePart(
      `<w:p><w:r>${anchoredPicture(
        '<wp14:sizeRelH relativeFrom="page"><wp14:pctWidth>0</wp14:pctWidth></wp14:sizeRelH>' +
          '<wp14:sizeRelV relativeFrom="page"><wp14:pctHeight>0</wp14:pctHeight></wp14:sizeRelV>'
      )}</w:r></w:p>`
    );
    expect(drawingKindIn(part)).toBe('drawing');
    const atoms = indexInlineDrawingProjectionsInPart(part);
    expect(atoms.size).toBe(1);
    const projection = [...atoms.values()][0]!;
    expect(projection.kind).toBe('anchored');
    expect(projection.relationshipId).toBe('rId7');
  });

  test('without the extensions the anchor still types', () => {
    const part = parsePart(`<w:p><w:r>${anchoredPicture('')}</w:r></w:p>`);
    expect(drawingKindIn(part)).toBe('drawing');
  });

  test('a stray non-extension trailing child still demotes', () => {
    const part = parsePart(
      `<w:p><w:r>${anchoredPicture('<wp:extent cx="1" cy="1"/>')}</w:r></w:p>`
    );
    expect(drawingKindIn(part)).toBe('generic');
  });
});
