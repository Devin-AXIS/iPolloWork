import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDrawingPreviewPackage, inspectDrawingSupport, readOoxmlPackage } from '../index.ts';
import { smartArtDocx } from './smartart-fixture.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

/** A picture with an external link and an embedded object beside it, plus styles. */
function pictureDocx(): Uint8Array {
  const picture =
    '<w:drawing><wp:inline><wp:extent cx="635000" cy="635000"/><wp:docPr id="1" name="Picture">' +
    '<a:hlinkClick r:id="rIdLink"/></wp:docPr><a:graphic><a:graphicData uri="' +
    PIC +
    '"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="635000" cy="635000"/></a:xfrm>' +
    '<a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';
  const object =
    '<w:object><v:shape style="width:20pt;height:20pt"><v:imagedata r:id="rIdImage"/></v:shape>' +
    '<o:OLEObject Type="Embed" ProgID="Package" r:id="rIdOle"/></w:object>';
  const ns =
    `xmlns:w="${W}" xmlns:r="${R}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:pic="${PIC}" ` +
    'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"';
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
        '<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rIdImage" Type="${R}/image" Target="media/image1.png"/>` +
        `<Relationship Id="rIdLink" Type="${R}/hyperlink" Target="https://example.com/" TargetMode="External"/>` +
        `<Relationship Id="rIdOle" Type="${R}/oleObject" Target="embeddings/object1.bin"/>` +
        `<Relationship Id="rIdStyles" Type="${R}/styles" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}"/>`),
    'word/media/image1.png': PNG,
    'word/embeddings/object1.bin': strToU8('embedded file'),
    'word/document.xml': strToU8(
      `<w:document ${ns}><w:body><w:p><w:r>${picture}</w:r><w:r>${object}</w:r></w:p>` +
        '<w:sectPr><w:pgSz w:w="9000" w:h="7000"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
  });
}

function open(bytes: Uint8Array) {
  const read = readOoxmlPackage(bytes);
  if (!read.ok) throw new Error(read.reason);
  return read.package;
}

test('a SmartArt diagram travels with its diagram parts and theme, and renders again', () => {
  const pkg = open(
    smartArtDocx({ shapes: [{ preset: 'rect', off: [1000, 2000], ext: [3000, 4000] }] })
  );
  const entry = inspectDrawingSupport(pkg).entries[0]!;
  const result = createDrawingPreviewPackage(pkg, entry);
  if (!result.ok) throw new Error(result.reason);
  expect(result.copiedParts).toEqual(
    expect.arrayContaining([
      '/word/diagrams/data1.xml',
      '/word/diagrams/drawing1.xml',
      '/word/diagrams/layout1.xml',
    ])
  );
  const reopened = inspectDrawingSupport(open(result.docx)).entries;
  expect(reopened.map((item) => [item.graphicKind, item.state, item.support])).toEqual([
    ['diagram', 'projected', 'native'],
  ]);
});

test('a picture keeps its image, page size, and styles but drops external and embedded targets', () => {
  const pkg = open(pictureDocx());
  const [picture, object] = inspectDrawingSupport(pkg).entries;
  const result = createDrawingPreviewPackage(pkg, picture!);
  if (!result.ok) throw new Error(result.reason);
  const files = unzipSync(result.docx);
  expect(Object.keys(files).sort()).toEqual([
    '[Content_Types].xml',
    '_rels/.rels',
    'word/_rels/document.xml.rels',
    'word/document.xml',
    'word/media/image1.png',
    'word/styles.xml',
  ]);
  expect(files['word/media/image1.png']).toEqual(PNG);
  const rels = strFromU8(files['word/_rels/document.xml.rels']!);
  expect(rels).toContain('Id="rIdImage"');
  expect(rels).not.toContain('example.com');
  const document = strFromU8(files['word/document.xml']!);
  // A 635000 EMU picture is 1000 twips: the page fits it, with no margins.
  expect(document).toContain('<w:pgSz w:w="1000" w:h="1120"/>');
  expect(document).toContain('w:top="0"');
  expect(document).not.toContain('OLEObject');
  expect(document).toContain('r:embed="rIdImage"');
  expect(inspectDrawingSupport(open(result.docx)).entries[0]!.state).toBe('projected');

  // The embedded object keeps its picture, and its file stays behind.
  const objectPreview = createDrawingPreviewPackage(pkg, object!);
  if (!objectPreview.ok) throw new Error(objectPreview.reason);
  const objectFiles = Object.keys(unzipSync(objectPreview.docx));
  expect(objectFiles).toContain('word/media/image1.png');
  expect(objectFiles).not.toContain('word/embeddings/object1.bin');
});

test('missing targets and exceeded limits refuse with a reason', () => {
  const pkg = open(pictureDocx());
  const entry = inspectDrawingSupport(pkg).entries[0]!;
  expect(
    createDrawingPreviewPackage(pkg, { ownerPartName: '/word/document.xml', nodeId: 'missing' })
  ).toEqual({ ok: false, reason: 'drawing-not-found' });
  expect(createDrawingPreviewPackage(pkg, { ...entry, ownerPartName: '/word/none.xml' })).toEqual({
    ok: false,
    reason: 'drawing-not-found',
  });
  expect(createDrawingPreviewPackage(pkg, entry, { maxParts: 1 })).toEqual({
    ok: false,
    reason: 'too-many-parts',
  });
  expect(createDrawingPreviewPackage(pkg, entry, { maxBytes: 10 })).toEqual({
    ok: false,
    reason: 'too-large',
  });
});

test('a compatibility wrapper keeps the prefixes its Requires attribute names', async () => {
  const { previewDocument, previewShape } = await import('./drawing-support-fixtures.ts');
  const pkg = open(
    previewDocument(
      `<mc:AlternateContent><mc:Choice Requires="wps">${previewShape()}</mc:Choice>` +
        '<mc:Fallback><w:pict><v:rect style="width:100pt;height:50pt"/></w:pict></mc:Fallback>' +
        '</mc:AlternateContent>'
    )
  );
  const entry = inspectDrawingSupport(pkg).entries[0]!;
  const result = createDrawingPreviewPackage(pkg, entry);
  if (!result.ok) throw new Error(result.reason);
  const document = strFromU8(unzipSync(result.docx)['word/document.xml']!);
  expect(document).toContain('Requires="wps"');
  expect(document).toMatch(
    /xmlns:wps="http:\/\/schemas\.microsoft\.com\/office\/word\/2010\/wordprocessingShape"/
  );
  const reopened = inspectDrawingSupport(open(result.docx)).entries[0]!;
  expect([reopened.graphicKind, reopened.state]).toEqual(['textbox', 'projected']);
});

test('a floating drawing is placed on the line of a page that fits it', async () => {
  const { previewDocument, previewShape } = await import('./drawing-support-fixtures.ts');
  const floating = previewShape()
    .replace(
      '<wp:inline><wp:extent cx="1270000" cy="635000"/>',
      '<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="1" ' +
        'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
        '<wp:positionH relativeFrom="page"><wp:posOffset>3000000</wp:posOffset></wp:positionH>' +
        '<wp:positionV relativeFrom="page"><wp:posOffset>3000000</wp:posOffset></wp:positionV>' +
        '<wp:extent cx="1270000" cy="635000"/><wp:wrapSquare wrapText="bothSides"/>'
    )
    .replace('</wp:inline>', '</wp:anchor>');
  const pkg = open(previewDocument(floating));
  const entry = inspectDrawingSupport(pkg).entries[0]!;
  const result = createDrawingPreviewPackage(pkg, entry);
  if (!result.ok) throw new Error(result.reason);
  const document = strFromU8(unzipSync(result.docx)['word/document.xml']!);
  expect(document).toContain(':inline distB="0" distL="114300" distR="114300" distT="0">');
  expect(document).not.toContain('positionH');
  expect(document).toContain('<w:pgSz w:w="2000" w:h="1120"/>');
  // The source document keeps its floating drawing.
  expect(inspectDrawingSupport(pkg).entries[0]!.source).toBe(entry.source);
  const reopened = inspectDrawingSupport(open(result.docx)).entries[0]!;
  expect([reopened.graphicKind, reopened.state]).toEqual(['textbox', 'projected']);
});

test('package bytes are deterministic, and legacy VML pages fit when its size is known', async () => {
  const { previewDocument } = await import('./drawing-support-fixtures.ts');
  const pkg = open(pictureDocx());
  const entry = inspectDrawingSupport(pkg).entries[0]!;
  const first = createDrawingPreviewPackage(pkg, entry);
  const second = createDrawingPreviewPackage(open(pictureDocx()), entry);
  if (!first.ok || !second.ok) throw new Error('not packaged');
  expect(second.docx).toEqual(first.docx);
  expect(first.pageFitsDrawing).toBe(true);
  // A floating legacy VML shape takes its size from its style and sits on the line.
  const vml = open(
    previewDocument(
      '<w:pict><v:rect style="position:absolute;margin-left:300pt;margin-top:200pt;width:100pt;height:50pt;z-index:2"/></w:pict>'
    )
  );
  const legacy = createDrawingPreviewPackage(vml, inspectDrawingSupport(vml).entries[0]!);
  if (!legacy.ok) throw new Error(legacy.reason);
  expect(legacy.pageFitsDrawing).toBe(true);
  const legacyXml = strFromU8(unzipSync(legacy.docx)['word/document.xml']!);
  expect(legacyXml).toContain('style="width:100pt;height:50pt"');
  expect(legacyXml).toContain('<w:pgSz w:w="2000" w:h="1120"/>');
  // Without a size in its style, the page keeps the document's size.
  const unsized = open(previewDocument('<w:pict><v:rect fillcolor="red"/></w:pict>'));
  const fallback = createDrawingPreviewPackage(unsized, inspectDrawingSupport(unsized).entries[0]!);
  if (!fallback.ok) throw new Error(fallback.reason);
  expect(fallback.pageFitsDrawing).toBe(false);
  const fallbackXml = strFromU8(unzipSync(fallback.docx)['word/document.xml']!);
  expect(fallbackXml).toContain('w:top="0" w:right="0" w:bottom="0" w:left="0"');
});

test('a VML shape after its shape type sizes the page to its rotated bounding box', async () => {
  const { previewDocument } = await import('./drawing-support-fixtures.ts');
  const pkg = open(
    previewDocument(
      '<w:pict><v:shapetype id="t1" coordsize="21600,21600"/>' +
        '<v:shape type="#t1" style="position:absolute;width:100pt;height:100pt;rotation:45"/></w:pict>'
    )
  );
  const result = createDrawingPreviewPackage(pkg, inspectDrawingSupport(pkg).entries[0]!);
  if (!result.ok) throw new Error(result.reason);
  expect(result.pageFitsDrawing).toBe(true);
  // 100pt at 45 degrees spans about 141.4pt: 2829 twips, plus the room below the line.
  expect(strFromU8(unzipSync(result.docx)['word/document.xml']!)).toContain(
    '<w:pgSz w:w="2829" w:h="2949"/>'
  );
});
