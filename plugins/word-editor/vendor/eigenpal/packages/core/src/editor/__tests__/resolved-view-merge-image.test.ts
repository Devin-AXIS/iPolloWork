// Selecting an image on a line that carries two paragraphs.
//
// A resolved display mode draws a merged run as one paragraph. Both halves count their
// offsets from zero, so the caret at offset 0 of the second half and an image at offset 0 of
// the first are the same number. The image lookup matched on that number alone and handed
// back the other half's picture — and every command that followed addressed it.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import { resolveSelectedDrawingRecord } from '../docx-editor-images.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const IMG = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS = `xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"`;

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

const inlinePicture = (docPrId: number) =>
  '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  `<wp:extent cx="228600" cy="114300"/><wp:docPr id="${docPrId}" name="pic${docPrId}"/>` +
  `<a:graphic><a:graphicData uri="${PIC}"><pic:pic>` +
  `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
  '<pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:ext cx="228600" cy="114300"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
  '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';

/** Each half opens with its own picture, so both sit at model offset 0. */
function docx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdImg" Type="${IMG}" Target="media/image1.png"/></Relationships>`
    ),
    'word/media/image1.png': PNG_1X1,
    'word/document.xml': strToU8(
      `<w:document ${NS}><w:body>` +
        '<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr>' +
        `${inlinePicture(1)}<w:r><w:t xml:space="preserve">AAA </w:t></w:r></w:p>` +
        `<w:p>${inlinePicture(2)}<w:r><w:t>BBB</w:t></w:r></w:p>` +
        '</w:body></w:document>'
    ),
  });
}

describe('the image at the caret is the one in the caret’s paragraph', () => {
  test('each half selects its own picture', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, docx(), {
      revisionDisplayMode: 'proposed',
    });
    if (!opened.ok) throw new Error(opened.reason);
    const surface = opened.surface;
    try {
      const [absorbed, survivor] = surface.session.paragraphIds();
      const line = surface
        .layout()
        .pages[0]!.fragments.flatMap((block) =>
          block.kind === 'paragraph' ? block.lines : []
        )[0]!;
      const drawings = line.drawings ?? [];
      // The fixture is only interesting while both pictures share a line and an offset.
      expect(drawings).toHaveLength(2);
      expect(drawings[0]!.start).toBe(drawings[1]!.start);

      // The first `idOf` below re-sets the mount-default position, which a same-position
      // write leaves deselected by design. Move the caret off it once, so every `idOf`
      // write MOVES and offset resolution alone is under test.
      surface.setSelection({
        anchor: { paragraphId: survivor!, offset: 1 },
        head: { paragraphId: survivor!, offset: 1 },
      });
      const idOf = (paragraphId: string): string | undefined => {
        surface.setSelection({
          anchor: { paragraphId, offset: 0 },
          head: { paragraphId, offset: 0 },
        });
        const record = resolveSelectedDrawingRecord(surface);
        return record?.kind === 'inlineDrawing' ? record.drawingNodeId : undefined;
      };
      const first = idOf(absorbed!);
      const second = idOf(survivor!);
      expect(first).toBeTruthy();
      expect(second).toBeTruthy();
      expect(first).not.toBe(second);
      // And each is the drawing the records say belongs to that paragraph.
      expect(drawings.find((d) => d.paragraphId === absorbed)!.drawingNodeId).toBe(first);
      expect(drawings.find((d) => d.paragraphId === survivor)!.drawingNodeId).toBe(second);
    } finally {
      surface.destroy();
      container.remove();
    }
  });
});
