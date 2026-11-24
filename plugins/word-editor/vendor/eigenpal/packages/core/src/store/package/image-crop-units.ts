// Public crop unit conversions between UI percent, OOXML permille, and projection fractions.
//
// - UI / SelectedImageState / setImageProperties: percent 0–100 per edge
// - OOXML a:srcRect / cropDrawing tree op: permille 0–100000 (25% → 25000)
// - Projection SourceCrop / layout: normalized fraction 0–1

import type { SourceCrop } from './drawing-projection.ts';

/** Crop edge in UI percent (0–100). @public */
export interface ImageCropPercent {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Crop edge in OOXML permille (0–100000). */
export interface ImageCropPermille {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export const IMAGE_CROP_PERCENT_MAX = 100;
export const IMAGE_CROP_PERMILLE_MAX = 100_000;

function cropEdges(
  crop: Readonly<{ left: number; top: number; right: number; bottom: number }>
): readonly number[] {
  return [crop.left, crop.top, crop.right, crop.bottom];
}

/** Projection fraction (0–1) → UI percent (0–100). */
export function cropPercentFromSourceCrop(crop: SourceCrop): ImageCropPercent {
  return Object.freeze({
    left: crop.left * IMAGE_CROP_PERCENT_MAX,
    top: crop.top * IMAGE_CROP_PERCENT_MAX,
    right: crop.right * IMAGE_CROP_PERCENT_MAX,
    bottom: crop.bottom * IMAGE_CROP_PERCENT_MAX,
  });
}

/** UI percent (0–100) → projection fraction (0–1). */
export function sourceCropFromCropPercent(crop: ImageCropPercent): SourceCrop {
  return Object.freeze({
    left: crop.left / IMAGE_CROP_PERCENT_MAX,
    top: crop.top / IMAGE_CROP_PERCENT_MAX,
    right: crop.right / IMAGE_CROP_PERCENT_MAX,
    bottom: crop.bottom / IMAGE_CROP_PERCENT_MAX,
  });
}

/** UI percent → OOXML permille. */
export function cropPermilleFromPercent(percent: number): number {
  return Math.round(percent * 1000);
}

/** OOXML permille → UI percent. */
export function cropPercentFromPermille(permille: number): number {
  return permille / 1000;
}

/** UI percent crop → permille for tree ops / a:srcRect. */
export function cropPermilleFromCropPercent(crop: ImageCropPercent): ImageCropPermille {
  return Object.freeze({
    left: cropPermilleFromPercent(crop.left),
    top: cropPermilleFromPercent(crop.top),
    right: cropPermilleFromPercent(crop.right),
    bottom: cropPermilleFromPercent(crop.bottom),
  });
}

/** Permille crop → UI percent. */
export function cropPercentFromCropPermille(crop: ImageCropPermille): ImageCropPercent {
  return Object.freeze({
    left: cropPercentFromPermille(crop.left),
    top: cropPercentFromPermille(crop.top),
    right: cropPercentFromPermille(crop.right),
    bottom: cropPercentFromPermille(crop.bottom),
  });
}

/** Projection fraction → permille. */
export function cropPermilleFromSourceCrop(crop: SourceCrop): ImageCropPermille {
  return cropPermilleFromCropPercent(cropPercentFromSourceCrop(crop));
}

/** Permille → projection fraction. */
export function sourceCropFromCropPermille(crop: ImageCropPermille): SourceCrop {
  return sourceCropFromCropPercent(cropPercentFromCropPermille(crop));
}

/**
 * Whether a crop is expressible: every edge finite and in range, and opposite edges not
 * overlapping.
 *
 * Opposite edges matter — a left plus right crop summing past 100% describes a negative width,
 * which DrawingML has no way to store.
 */
export function validateImageCropPercent(crop: ImageCropPercent): boolean {
  const edges = cropEdges(crop);
  if (edges.some((edge) => !Number.isFinite(edge) || edge < 0 || edge > IMAGE_CROP_PERCENT_MAX)) {
    return false;
  }
  return (
    crop.left + crop.right < IMAGE_CROP_PERCENT_MAX &&
    crop.top + crop.bottom < IMAGE_CROP_PERCENT_MAX
  );
}
