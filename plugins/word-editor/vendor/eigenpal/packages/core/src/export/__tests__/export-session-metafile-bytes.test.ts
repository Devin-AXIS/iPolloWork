// An exporter gets a metafile's original bytes only for a format refusal: a picture the image
// pipeline turned away for its size or signature stays refused.

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { openDocumentForExport } from '../export-session.ts';
import type { InlineDrawingRecord } from '../../layout/drawing-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** A placeable WMF header followed by an end record. */
function wmf(): Uint8Array {
  const bytes = new Uint8Array(22 + 18 + 6);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x9ac6cdd7, true);
  view.setInt16(10, 200, true);
  view.setInt16(12, 100, true);
  view.setUint16(14, 96, true);
  let checksum = 0;
  for (let at = 0; at < 20; at += 2) checksum ^= view.getUint16(at, true);
  view.setUint16(20, checksum, true);
  [1, 9, 0x0300, 12, 0, 1, 3, 0, 0].forEach((word, index) =>
    view.setUint16(22 + index * 2, word, true)
  );
  [3, 0, 0].forEach((word, index) => view.setUint16(40 + index * 2, word, true));
  return bytes;
}

function docx(): Uint8Array {
  const drawing =
    '<w:drawing xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<wp:inline><wp:extent cx="1270000" cy="635000"/><wp:docPr id="1" name="Picture"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="p"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill>' +
    '<pic:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
    '</a:graphicData></a:graphic></wp:inline></w:drawing>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="wmf" ContentType="image/x-wmf"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rIdImg" Type="${R}/image" Target="media/image1.wmf"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body><w:p><w:r>${drawing}</w:r></w:p></w:body></w:document>`
    ),
    'word/media/image1.wmf': wmf(),
  });
}

test('only a format refusal hands the exporter the metafile bytes', async () => {
  const opened = openDocumentForExport(docx());
  if (!opened.ok) throw new Error(opened.reason);
  const { session } = opened;
  try {
    const layout = await session.layout();
    const drawing = layout.pages
      .flatMap((page) => page.fragments)
      .flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []))
      .flatMap((line) => line.drawings ?? [])[0] as InlineDrawingRecord;
    expect(drawing.resource.kind).toBe('unrenderable');
    expect(session.metafileBytes?.(drawing)?.mime).toBe('image/x-wmf');
    const refused = (reason: string) =>
      ({ ...drawing, resource: { ...drawing.resource, reason } }) as InlineDrawingRecord;
    expect(session.metafileBytes?.(refused('resource-limit'))).toBeNull();
    expect(session.metafileBytes?.(refused('signature-mismatch'))).toBeNull();
  } finally {
    session.dispose();
  }
});
