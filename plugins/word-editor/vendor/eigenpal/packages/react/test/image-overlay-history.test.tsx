// History keys on the focused picture overlay. Focus sits on the overlay, not the text
// surface, so the overlay must forward undo and redo itself.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance, ImageDecodePort } from '@docx-editor.dev/core/editor';
import { resolveImageResourceLimits, validateRasterHeader } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

function inlinePictureDocument(): Uint8Array {
  const drawing =
    '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="914400" cy="914400"/>' +
    '<wp:docPr id="1" name="green" descr="Green square"/>' +
    '<wp:cNvGraphicFramePr/>' +
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}">` +
    `<pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    '<pic:blipFill><a:blip r:embed="rIdImage"><a:stretch><a:fillRect/></a:stretch></a:blip></pic:blipFill>' +
    '<pic:spPr><a:xfrm rot="0"><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline>';
  const body =
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:body><w:p><w:r><w:t>before</w:t></w:r><w:r><w:drawing>${drawing}</w:drawing></w:r><w:r><w:t>after</w:t></w:r></w:p></w:body></w:document>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(body),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdImage" Type="${R}/image" Target="media/image1.png"/></Relationships>`
    ),
    'word/media/image1.png': PNG_1X1,
  });
}

const decodePort: ImageDecodePort = {
  async decode(bytes, mime) {
    const header = validateRasterHeader(bytes, mime);
    if (!header) throw new Error('invalid image');
    if (header.pixelWidth * header.pixelHeight > resolveImageResourceLimits().maxPixels) {
      throw new Error('too large');
    }
    return Object.freeze({
      pixelWidth: header.pixelWidth,
      pixelHeight: header.pixelHeight,
      dpiX: 96,
      dpiY: 96,
    });
  },
};

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Put the selection on the picture and wait until the editor reports it. */
async function selectDrawing(editor: DocxEditorInstance): Promise<void> {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  act(() => {
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 6 },
      head: { paragraphId, offset: 6 },
    });
  });
  for (let attempt = 0; attempt < 50 && !editor.getSelectedImage(); attempt++) {
    editor.surface!.layout();
    await settle();
  }
  await settle();
}

function overlayRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>('.docx-image-selection-overlay');
  if (!root) throw new Error('overlay missing');
  return root;
}

afterEach(cleanup);

test('Mod+Z on the overlay undoes a resize, and Mod+Shift+Z redoes it', async () => {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={inlinePictureDocument()}
      imageDecodePort={decodePort}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  for (let attempt = 0; attempt < 50 && !instance?.surface; attempt++) await settle();
  const editor = instance!;
  await selectDrawing(editor);
  const beforeWidth = editor.getSelectedImage()!.widthEmu;
  fireEvent.keyDown(overlayRoot(view.container), { key: 'ArrowRight', altKey: true });
  await selectDrawing(editor);
  const resizedWidth = editor.getSelectedImage()!.widthEmu;
  expect(resizedWidth).toBeGreaterThan(beforeWidth);

  const undo = fireEvent.keyDown(overlayRoot(view.container), { key: 'z', metaKey: true });
  // Handled here, so the browser does not run its own undo on the focused control.
  expect(undo).toBe(false);
  await selectDrawing(editor);
  expect(editor.getSelectedImage()!.widthEmu).toBe(beforeWidth);

  fireEvent.keyDown(overlayRoot(view.container), { key: 'Z', ctrlKey: true, shiftKey: true });
  await selectDrawing(editor);
  expect(editor.getSelectedImage()!.widthEmu).toBe(resizedWidth);
});
