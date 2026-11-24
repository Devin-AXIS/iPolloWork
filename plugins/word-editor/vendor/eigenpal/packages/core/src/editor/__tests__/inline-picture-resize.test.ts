import { expect, test } from 'bun:test';
import { computeImageResizeResult } from '../surface-overlay-coordinates.ts';
import { pointsToEmu } from '../docx-editor-images.ts';

test.each([90, 270, -90])(
  'quarter-turn %s resize previews use exchanged axes and fixed effects',
  (rotationDegrees) => {
    const result = computeImageResizeResult({
      handle: 'e',
      startWidthEmu: pointsToEmu(30),
      startHeightEmu: pointsToEmu(90),
      startBounds: { x: 10, y: 20, width: 94, height: 36 },
      startPosition: null,
      deltaXPt: 10,
      deltaYPt: 0,
      transform: { rotationDegrees, flipHorizontal: false, flipVertical: false },
      preserveAspect: false,
      kind: 'inline',
    });
    expect(result.widthEmu).toBe(pointsToEmu(30));
    expect(result.heightEmu).toBe(pointsToEmu(100));
    expect(result.previewBounds).toEqual({ x: 10, y: 20, width: 104, height: 36 });
  }
);

test('anchored quarter-turn resize retains existing extent axes', () => {
  const result = computeImageResizeResult({
    handle: 'e',
    startWidthEmu: pointsToEmu(30),
    startHeightEmu: pointsToEmu(90),
    startBounds: { x: 10, y: 20, width: 34, height: 96 },
    startPosition: null,
    deltaXPt: 10,
    deltaYPt: 0,
    transform: { rotationDegrees: 90, flipHorizontal: false, flipVertical: false },
    preserveAspect: false,
    kind: 'anchored',
  });
  expect(result.previewBounds.width).toBe(34);
  expect(result.previewBounds.height).toBeCloseTo((96 * 100) / 90, 8);
});
