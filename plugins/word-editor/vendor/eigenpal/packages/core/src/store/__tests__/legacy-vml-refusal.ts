// What a refused legacy drawing projects: nothing on its own, or, on the text line, the
// labelled placeholder that keeps its box (`legacy-vml-placeholder.ts`). Neither paints.

import { expect } from 'bun:test';
import type { DrawingProjection } from '../package/drawing-projection.ts';
import { LEGACY_PLACEHOLDER_DETAIL } from '../package/legacy-vml-placeholder.ts';

/** Whether a projection is the placeholder of a refused legacy drawing. */
export function isLegacyPlaceholder(projection: DrawingProjection): boolean {
  return (
    projection.diagnostics.some((d) => d.detail === LEGACY_PLACEHOLDER_DETAIL) &&
    projection.picture === null &&
    projection.vectorShape === null &&
    projection.groupPicture === null &&
    projection.textboxStory === null &&
    projection.legacyGraphic === undefined &&
    projection.textArt === undefined &&
    projection.groupTextboxes === undefined
  );
}

/** Every projection is a placeholder: the legacy drawing was refused and nothing paints. */
export function expectRefused(projections: readonly DrawingProjection[]): void {
  for (const projection of projections) expect(isLegacyPlaceholder(projection)).toBe(true);
}
