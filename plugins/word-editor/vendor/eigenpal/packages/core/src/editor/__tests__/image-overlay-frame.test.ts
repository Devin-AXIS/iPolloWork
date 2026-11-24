import { waitForDocumentSurface } from './wait-for-document.fixture.ts';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { findDrawingOverlayFrameInLayout } from '../../layout/semantic-hit-test.ts';
import { createDocxEditor } from '../docx-editor.ts';
import { selectedDrawingOverlayTargetOf } from '../drawing-overlay-target.ts';
import { overlayFrameToSheetCssPixels } from '../surface-overlay-coordinates.ts';
import { decodePort } from './image-decode-harness.ts';

const SAMPLE = new Uint8Array(
  readFileSync(new URL('../../../../../examples/vite/public/sample.docx', import.meta.url))
);

test('overlay sheet box matches the painted wrap-square drawing', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: SAMPLE,
    imageDecodePort: decodePort(),
  });
  const surface = await waitForDocumentSurface(editor);

  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  surface.layout();

  let drawingId: string | null = null;
  let paragraphId: string | null = null;
  let start = 0;
  for (const page of surface.publishedLayout().pages) {
    for (const drawing of page.anchoredDrawings ?? []) {
      if (drawing.wrap !== 'square') continue;
      drawingId = drawing.drawingNodeId;
      paragraphId = drawing.anchorParagraphId;
      start = drawing.start;
    }
  }
  if (!drawingId || !paragraphId) throw new Error('no wrapSquare drawing in sample.docx');

  surface.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: start },
  });

  const target = selectedDrawingOverlayTargetOf(surface);
  expect(target).not.toBeNull();
  expect(target!.id).toBe(drawingId);
  expect(target!.kind).toBe('anchored');

  const layout = surface.publishedLayout();
  const frame = findDrawingOverlayFrameInLayout(layout, drawingId);
  expect(frame).not.toBeNull();
  expect(frame!.pageIndex).toBe(target!.pageIndex);
  expect(frame!.x).toBeCloseTo(target!.x, 5);
  expect(frame!.y).toBeCloseTo(target!.y, 5);

  const sheet = overlayFrameToSheetCssPixels(layout, frame!, surface.overlayCoordinates());
  const painted = container.querySelector<HTMLElement>(`[data-drawing-node-id="${drawingId}"]`);
  expect(painted).not.toBeNull();
  const page = painted!.closest<HTMLElement>('.docx-page');
  expect(page).not.toBeNull();
  const paintedLeft = Number.parseFloat(page!.style.left) + Number.parseFloat(painted!.style.left);
  const paintedTop = Number.parseFloat(page!.style.top) + Number.parseFloat(painted!.style.top);
  expect(sheet.left).toBeCloseTo(paintedLeft, 1);
  expect(sheet.top).toBeCloseTo(paintedTop, 1);

  editor.destroy();
  container.remove();
});

test('overlay sheet mapping finds a page by its index, not its array slot', () => {
  const layout = {
    pages: [
      {
        index: 12,
        contentBox: { x: 72, y: 96, width: 468, height: 700 },
      },
    ],
  } as unknown as import('../../layout/semantic-records.ts').SemanticLayout;
  const sheet = overlayFrameToSheetCssPixels(
    layout,
    { pageIndex: 12, x: 10, y: 20, width: 30, height: 40 },
    { paintScale: 1, pageOffsetX: new Map([[12, 5]]) }
  );
  expect(sheet.left).toBe(87);
  expect(sheet.top).toBe(116);
  expect(sheet.width).toBe(30);
  expect(sheet.height).toBe(40);
});
