// The caret at the offset AFTER a picture that owns its whole line.
//
// That offset is shared by two lines: the drawing-only line it ends and the text line it
// opens. `caretAt` used to keep the first match — the picture's right edge — so a click
// before the following text resolved the right offset but painted the caret a full picture
// away, and no click ever showed a caret at the text's start. The rule now mirrors the
// hard-break one: a drawing-only line's end belongs to the line the drawing opened, and the
// picture's right edge stays the answer only when the picture ends its paragraph.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { caretAt, hitTestSemantic } from '../../layout/index.ts';
import {
  CT_NS,
  DRAWING_NS,
  IMG_REL,
  OD_REL,
  PNG_1X1,
  REL_NS,
  decodePort,
  picture,
  settle,
} from './image-decode-harness.ts';

/** A 460pt-wide inline picture: too wide to share a 468pt line with any text. */
function wideInlinePicture(id: number): string {
  return (
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="5842000" cy="1270000"/><wp:docPr id="${id}" name="pic"/>` +
    `${picture(id)}</wp:inline></w:drawing></w:r>`
  );
}

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OD_REL}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL_NS}"><Relationship Id="rIdImg" Type="${IMG_REL}" Target="media/image1.png"/></Relationships>`
    ),
    'word/media/image1.png': PNG_1X1,
    'word/document.xml': strToU8(`<w:document ${DRAWING_NS}><w:body>${body}</w:body></w:document>`),
  });
}

async function mount(body: string): Promise<{ surface: PaginatedSurface; container: HTMLElement }> {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(body), {
    scale: 1,
    imageDecodePort: decodePort(),
  });
  if (!opened.ok) throw new Error(opened.reason);
  await settle();
  return { surface: opened.surface, container };
}

describe('the caret after a picture that owns its line', () => {
  test('paints before the following text, where the click that placed it landed', async () => {
    const { surface, container } = await mount(
      `<w:p>${wideInlinePicture(5)}<w:r><w:t xml:space="preserve">1.1 Basic Text Formatting</w:t></w:r></w:p>`
    );
    try {
      const layout = surface.layout();
      const [p1] = surface.session.paragraphIds();
      const lines = layout.pages[0]!.fragments.flatMap((block) =>
        block.kind === 'paragraph' ? block.lines : []
      );
      // The premise: the picture owns line 1 outright, the text opens line 2 at offset 1.
      expect(lines[0]!.range).toMatchObject({ start: 0, end: 1 });
      expect(lines[1]!.range.start).toBe(1);

      const caret = caretAt(layout, { paragraphId: p1!, offset: 1 })!;
      expect(caret.lineId).toBe(lines[1]!.id);
      expect(caret.y).toBe(lines[1]!.box.y);
      expect(caret.x).toBe(0);

      // The click before the "1" resolves the same offset AND the same geometry.
      const hit = hitTestSemantic(layout, { x: 1, y: lines[1]!.box.y + 2, pageIndex: 0 })!;
      expect(hit.position).toEqual({ paragraphId: p1!, offset: 1 });
      expect(hit.lineId).toBe(caret.lineId);
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('keeps the picture-edge answer when the picture ends its paragraph', async () => {
    const { surface, container } = await mount(`<w:p>${wideInlinePicture(5)}</w:p>`);
    try {
      const layout = surface.layout();
      const [p1] = surface.session.paragraphIds();
      const caret = caretAt(layout, { paragraphId: p1!, offset: 1 })!;
      expect(caret).not.toBeNull();
      expect(caret.x).toBe(460);
      expect(caret.y).toBe(0);
    } finally {
      surface.destroy();
      container.remove();
    }
  });
});
