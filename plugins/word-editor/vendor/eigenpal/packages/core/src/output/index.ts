/**
 * `@docx-editor.dev/core/output` — painting a layout into DOM.
 *
 * The painted pages ARE the editable surface, but the DOM is a picture: browser mutations are
 * prevented and re-expressed as tree ops, and selection maps only through `data-paragraph-id`
 * and `data-start`.
 *
 * @packageDocumentation
 * @public
 */
// Lane: output. Responsibilities and dependency rules:
// docs/architecture/production-engine-packages.md.
//
// The semantic-layout painter for the paginated surface. Consumes semantic layout
// records only; never rederives geometry or interprets CSS.

export {
  DEFAULT_FIELD_SHADING,
  paintSemanticLayout,
  type FieldShadingMode,
  type PaintOptions,
} from './semantic-paint.ts';
export type { BreakMarkStrings } from './semantic-break-marks.ts';
// The PDF writer extends a span's marks over the same gaps screen paint draws inside it.
export {
  followingGapPaint,
  paintedGapBetween,
  type GapSpan,
  type PlacedSpan,
} from './semantic-paint-letter-gap.ts';
// TYPES ONLY. The derivations behind them (`authorSlotsOf`, `reviewAuthorsOf`, the ramp
// constant) are engine internals reached through `getReviewAuthors` on the editor; a
// `@public` symbol is a breaking change to withdraw, so they stay off the barrel and the
// two in-package callers import them by module path.
export type {
  ReviewAuthorInfo,
  RevisionAuthorAssignments,
  RevisionAuthorStyle,
  RevisionStyles,
} from './revision-presentation.ts';
export {
  paintSelectionOverlay,
  type OverlayRect,
  type SelectionOverlayOptions,
} from './semantic-selection-overlay.ts';

export {
  observeUnsupportedElements,
  type UnsupportedElement,
  type UnsupportedElementHost,
  type UnsupportedElementLayout,
  type UnsupportedElementRule,
} from './unsupported-elements.ts';

export {
  collectPageChangeBars,
  type PageChangeBars,
  type ChangeBarsMode,
} from './semantic-paint-change-bars.ts';

/**
 * Picture brightness/contrast as one clamped linear transfer per channel. Exporters encode the
 * same line the screen paints.
 *
 * @internal
 */
export { lumTransfer, type LumTransfer } from './drawing-lum-filter.ts';

export type {
  DrawingGraphicKind,
  DrawingSupport,
  DrawingSupportIssue,
} from '../store/package/drawing-support.ts';
