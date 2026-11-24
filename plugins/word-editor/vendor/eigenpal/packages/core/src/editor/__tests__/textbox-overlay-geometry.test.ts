import { expect, test } from 'bun:test';
import {
  computeImageResizeResult,
  resizePreservesAspect,
  finalizeImageOverlayInteraction,
} from '../surface-overlay-coordinates.ts';
import { pointsToEmu, type ImageInteractionSession } from '../docx-editor-images.ts';

const transform = { rotationDegrees: 0, flipHorizontal: false, flipVertical: false };
const bounds = { x: 40, y: 90, width: 540, height: 63 };

test('resizing an aligned textbox keeps the opposite edge in its positioning frame', () => {
  const result = computeImageResizeResult({
    handle: 'e',
    startWidthEmu: pointsToEmu(540),
    startHeightEmu: pointsToEmu(63),
    startBounds: bounds,
    startPosition: {
      mode: 'frame',
      relativeToH: 'page',
      relativeToV: 'paragraph',
      verticalEmu: pointsToEmu(20),
    },
    anchorFrameOrigin: { x: -36, y: 70 },
    deltaXPt: -45,
    deltaYPt: 0,
    transform,
    preserveAspect: false,
    kind: 'anchored',
  });
  expect(result.widthEmu).toBe(pointsToEmu(495));
  expect(result.previewBounds.x).toBe(40);
  expect(result.position).toEqual({
    mode: 'frame',
    relativeToH: 'page',
    relativeToV: 'paragraph',
    horizontalEmu: pointsToEmu(76),
    verticalEmu: pointsToEmu(20),
  });
});

test('drag converts aligned coordinates to offsets in both original reference frames', () => {
  const session: ImageInteractionSession = {
    drawingNodeId: 'box',
    startBounds: bounds,
    startWidthEmu: pointsToEmu(540),
    startHeightEmu: pointsToEmu(63),
    startPosition: { mode: 'frame', relativeToH: 'page', relativeToV: 'margin' },
    anchorFrameOrigin: { x: -36, y: 0 },
    transform,
    mode: 'move',
    handle: null,
    preconditions: {
      mountGeneration: 0,
      packageRevision: 0,
      drawingNodeId: 'box',
      selectionParagraphId: 'p',
      selectionOffset: 0,
    },
    layoutRevision: 0,
    packageRevision: 0,
    kind: 'anchored',
  };
  const result = finalizeImageOverlayInteraction({
    session,
    deltaXPt: 15,
    deltaYPt: 20,
    accumulatedScrollPt: 5,
    aspectLocked: false,
    shiftKey: false,
    anchorFrameOrigin: session.anchorFrameOrigin,
  });
  expect(result.previewBounds).toEqual({ x: 55, y: 115, width: 540, height: 63 });
  expect(result.position).toEqual({
    mode: 'frame',
    relativeToH: 'page',
    relativeToV: 'margin',
    horizontalEmu: pointsToEmu(91),
    verticalEmu: pointsToEmu(115),
  });
});

test('textbox corner resizing is free unless Shift or an authored lock constrains it', () => {
  expect(resizePreservesAspect('se', false, false, true)).toBe(false);
  expect(resizePreservesAspect('se', false, true, true)).toBe(true);
  expect(resizePreservesAspect('se', true, false, true)).toBe(true);
  expect(resizePreservesAspect('e', false, true, true)).toBe(false);
  expect(resizePreservesAspect('se', false, false)).toBe(true);
});
