export { createFixedMeasurer } from './fixed-measurer.ts';
// Boundary records live in their own module; the editor facade and tests import them here.
export {
  attachContentControlBoundaries,
  contentControlContextToken,
} from './content-control-boundary-layout.ts';
export type { ContentControlBoundaryWork } from './content-control-boundary-layout.ts';
export { observeExclusionLayoutPassesForTest } from './exclusion-pass-observer.ts';
export {
  createLayoutSession,
  type LayoutSession,
  type LayoutSessionStats,
} from './layout-session.ts';
// Both types moved to `page-furniture-insets.ts` with the per-page resolution that reads them;
// they are re-exported from `semantic-layout.ts`, the import site every caller already has.
export { type HeaderFooterVariantName, type PageFurniture } from './page-furniture-insets.ts';
export type { SemanticLayoutOptions } from './semantic-layout-options.ts';
export type { SectionPrepass } from './section-prepass-types.ts';
