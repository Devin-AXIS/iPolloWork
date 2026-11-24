import { waitForDocumentSurface } from './wait-for-document.fixture.ts';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { validateRasterHeader, type ImageDecodePort } from '../../store/package/image-resources.ts';
import { resolveImageResourceLimits } from '../../store/runtime/limits.ts';
import type { SemanticLayout } from '../../layout/index.ts';
import { createDocxEditor } from '../docx-editor.ts';

// The demo document, because the bug needs its shape: a multi-section body whose balanced
// section lays out more than once inside one pass. The balancing attempt advances the
// section session, the final call identity-returns against it, and the span-reuse gate in
// `layoutMultiSectionDocument` then republished the PREVIOUS pass's sheets — the image
// repainted at the new size while the published fragment kept the pre-resize frame.
const SAMPLE = new Uint8Array(
  readFileSync(new URL('../../../../../examples/vite/public/sample.docx', import.meta.url))
);

function testDecodePort(): ImageDecodePort {
  return Object.freeze({
    async decode(bytes: Uint8Array, mime: string) {
      const header = validateRasterHeader(bytes, mime as never);
      if (!header) throw new Error('invalid image');
      const limits = resolveImageResourceLimits();
      if (header.pixelWidth * header.pixelHeight > limits.maxPixels) throw new Error('too large');
      return Object.freeze({
        pixelWidth: header.pixelWidth,
        pixelHeight: header.pixelHeight,
        dpiX: 96,
        dpiY: 96,
      });
    },
  });
}

function inlineFrameOf(
  layout: SemanticLayout,
  id: string
): { readonly w: number; readonly h: number } | null {
  for (const page of layout.pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'paragraph') continue;
      for (const line of fragment.lines) {
        for (const drawing of line.drawings ?? []) {
          if (drawing.drawingNodeId === id) return { w: drawing.width, h: drawing.height };
        }
      }
    }
  }
  return null;
}

test('a resize in a multi-section document publishes the new frame synchronously', async () => {
  const container = document.createElement('div');
  const editor = createDocxEditor({
    container,
    document: SAMPLE,
    imageDecodePort: testDecodePort(),
  });
  const surface = await waitForDocumentSurface(editor);

  // Let drawing resources settle the way the browser does, so the pass under test starts
  // from a fully settled layout instead of a resource-invalidation churn.
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  surface.layout();

  // The widest inline drawing in the document — a block image well past icon size.
  let drawingId: string | null = null;
  let paragraphId: string | null = null;
  let start = 0;
  for (const page of surface.publishedLayout().pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'paragraph') continue;
      for (const line of fragment.lines) {
        for (const drawing of line.drawings ?? []) {
          if (drawing.width > 150 && !drawing.chart && drawing.placeholderGraphicKind === null) {
            drawingId = drawing.drawingNodeId;
            paragraphId = drawing.paragraphId;
            start = drawing.start;
          }
        }
      }
    }
  }
  if (!drawingId || !paragraphId) throw new Error('no wide inline drawing in sample.docx');

  surface.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: start },
  });
  expect(editor.getSelectedImage()).not.toBeNull();

  const result = editor.exec({
    type: 'setImageProperties',
    widthEmu: 1_143_000,
    heightEmu: 304_800,
  });
  expect(result).toEqual({ ok: true, changed: true });

  // No timer flush between the exec and this read: the commit itself must publish pages
  // that carry the resized frame. 1143000 x 304800 EMU is 90 x 24 points.
  const frame = inlineFrameOf(surface.publishedLayout(), drawingId);
  expect(frame).not.toBeNull();
  expect(frame!.w).toBeCloseTo(90, 3);
  expect(frame!.h).toBeCloseTo(24, 3);

  // The surface registers document-level listeners; the serial run shares one document.
  editor.destroy();
});
