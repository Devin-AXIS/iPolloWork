import { inlinePictureExtent } from './inline-picture-extent.ts';
import type { DrawingChartSummary } from '../store/package/chart-summary.ts';
import { revisionMarkupHidesDrawing } from './revision-markup-projection.ts';
// Drawing extents convert from EMUs to points here; intrinsic image dimensions do not resize layout.

import { layoutTextArt, textArtPaintBounds, turnedTextboxBounds } from './drawing-text-art.ts';
import type { DrawingTextArtRecord } from './drawing-text-art.ts';
import { clipBoxToRegion, hitBoundsOf } from './drawing-clip-box.ts';
export { clipBoxHorizontally, clipBoxToRegion } from './drawing-clip-box.ts';

import type { DrawingImageEffects } from '../store/package/drawing-image-effects.ts';
import {
  alignsToCellFrameTop,
  anchorLaidOutInCell,
  type CellAnchorScope,
} from './cell-anchor-layout.ts';
import {
  drawingAccessibility,
  type DrawingAccessibility,
  type DrawingHorizontalReferenceFrame,
  type DrawingProjection,
  type DrawingTransform,
  type DrawingVerticalReferenceFrame,
  type ImageWrapTarget,
  type SourceCrop,
  type VectorShapeProjection,
} from '../store/package/drawing-projection.ts';
import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import type { PictureFrameEffects } from '../store/package/drawing-picture-frame.ts';
import { pageClipRegion } from './drawing-page-clip.ts';
export { columnPaperClip, pageClipRegion } from './drawing-page-clip.ts';
import type { ImageResourceState } from '../store/package/image-resources.ts';
import {
  DEFAULT_REVISION_DISPLAY_MODE,
  projectedRevisions,
  type RevisionAttribution,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';
import { anchorCharacterFrameOffset, anchorCharacterXOnLine } from './anchor-character-offset.ts';
import { chartFallbackFields, chartFallbackResource } from './drawing-chart-fallback.ts';
import {
  drawingGeometryFromProjection,
  clipGeometryToRegion,
  type DrawingGeometry,
} from './drawing-geometry.ts';
import { shiftGeometry } from './inline-drawing-clip.ts';
import type { LayoutBox } from './semantic-records.ts';
import { textboxPlacementProjection } from './textbox-placement.ts';
import { withGroupTextboxStories } from './group-textbox-layout.ts';
import {
  drawingPaintFields,
  type DrawingGroupPictureRecord,
  type DrawingPlaceholderKind,
} from './drawing-paint-fields.ts';
import {
  groupPictureLayerFields,
  groupPictureLayerResources,
} from './drawing-group-picture-layers.ts';
import {
  wrappedParagraphAnchorBottomTop,
  wrappedParagraphAnchorTop,
} from './anchor-content-top.ts';
import {
  anchoredDrawingAtomsInParagraph,
  drawingModelOffsetsInParagraph,
} from './drawing-atom-walk.ts';

export { anchoredDrawingAtomsInParagraph, drawingModelOffsetsInParagraph };

export type { DrawingGeometry } from './drawing-geometry.ts';

/** EMUs per point (914400 EMU = 72pt = 1in). */
export const EMU_PER_POINT = 12_700;

export function emuToPoints(emu: number): number {
  return emu / EMU_PER_POINT;
}

/** Convert EMU to layout points; returns null when the result is non-finite or unusably large. */
export function emuToPointsSafe(emu: number): number | null {
  if (!Number.isFinite(emu)) return null;
  if (Math.abs(emu) > 10_000 * EMU_PER_POINT * 72) return null;
  const points = emu / EMU_PER_POINT;
  return Number.isFinite(points) ? points : null;
}

export interface InlineDrawingMeasure {
  readonly distL: number;
  readonly distR: number;
  readonly distT: number;
  readonly distB: number;
  readonly effectL: number;
  readonly effectR: number;
  readonly effectT: number;
  readonly effectB: number;
  readonly width: number;
  readonly height: number;
  /** Horizontal advance on the line: distL + effectL + width + effectR + distR. */
  readonly totalWidth: number;
  /** Vertical contribution: distT + effectT + height + effectB + distB. */
  readonly lineContribution: number;
}

export function measureInlineDrawing(projection: DrawingProjection): InlineDrawingMeasure {
  // ECMA-376 Part 1 §20.4.2.8: inline dist* attributes are retained for a
  // possible conversion to floating, but do not affect inline placement.
  // Effect extents still contribute to inline geometry.
  const distL = 0;
  const distR = 0;
  const distT = 0;
  const distB = 0;
  const effectL = emuToPoints(projection.effectExtentEmu.left);
  const effectR = emuToPoints(projection.effectExtentEmu.right);
  const effectT = emuToPoints(projection.effectExtentEmu.top);
  const effectB = emuToPoints(projection.effectExtentEmu.bottom);
  const extent = inlinePictureExtent(projection);
  const width = emuToPoints(extent.cx),
    height = emuToPoints(extent.cy);
  return Object.freeze({
    distL,
    distR,
    distT,
    distB,
    effectL,
    effectR,
    effectT,
    effectB,
    width,
    height,
    totalWidth: distL + effectL + width + effectR + distR,
    lineContribution: distT + effectT + height + effectB + distB,
  });
}

export interface InlineDrawingVerticalLayout {
  /** Top of the extent box relative to the line top. */
  readonly extentTopY: number;
  /** Total line box height once for this drawing contribution. */
  readonly lineHeight: number;
  /** Text baseline within the line box — never double-counts distT. */
  readonly baseline: number;
}

/**
 * Position an inline drawing against a text baseline without double-counting distT.
 *
 * The line box is `max(textLineHeight, extentTopY + height + distB)` where extentTopY is
 * `max(distT, baseline - height)` so distT is minimum clearance above the extent, not added
 * again to line height.
 */
export function inlineDrawingVerticalLayout(
  textBaseline: number,
  textLineHeight: number,
  measure: InlineDrawingMeasure
): InlineDrawingVerticalLayout {
  const extentTopY = Math.max(measure.distT + measure.effectT, textBaseline - measure.height);
  const lineHeight = Math.max(
    textLineHeight,
    extentTopY - measure.effectT + measure.height + measure.effectB + measure.distB
  );
  const drawingBottom = extentTopY + measure.height + measure.effectB;
  return Object.freeze({
    extentTopY,
    lineHeight,
    baseline: Math.max(textBaseline, drawingBottom),
  });
}

/** @deprecated Prefer {@link inlineDrawingVerticalLayout}. */
export function inlineDrawingTopY(baseline: number, measure: InlineDrawingMeasure): number {
  return inlineDrawingVerticalLayout(baseline, measure.lineContribution, measure).extentTopY;
}

/**
 * Translate a placed inline drawing rigidly by (dx, dy) — record origin, advance, paint/hit
 * boxes AND geometry move together. Paint derives the image frame and clip-path from
 * `geometry` relative to `paintBounds`, so shifting one without the other clips the image
 * out of its own box.
 */
export function shiftInlineDrawingRecord(
  drawing: InlineDrawingRecord,
  dx: number,
  dy: number
): InlineDrawingRecord {
  if (Math.abs(dx) < 0.000_1 && Math.abs(dy) < 0.000_1) return drawing;
  return Object.freeze({
    ...drawing,
    x: drawing.x + dx,
    y: drawing.y + dy,
    advanceStart: drawing.advanceStart + dx,
    advanceEnd: drawing.advanceEnd + dx,
    paintBounds: Object.freeze({
      ...drawing.paintBounds,
      x: drawing.paintBounds.x + dx,
      y: drawing.paintBounds.y + dy,
    }),
    hitBounds: Object.freeze({
      ...drawing.hitBounds,
      x: drawing.hitBounds.x + dx,
      y: drawing.hitBounds.y + dy,
    }),
    geometry: shiftGeometry(drawing.geometry, dx, dy),
  });
}

export function repositionInlineDrawingsForBaseline(
  drawings: readonly InlineDrawingRecord[],
  baseline: number
): readonly InlineDrawingRecord[] {
  if (drawings.length === 0) return drawings;
  return drawings.map((drawing) => {
    const effectB = drawing.geometry.effectInsets.bottom;
    const extentTopY = baseline - drawing.height - effectB;
    const dy = extentTopY - drawing.y;
    if (Math.abs(dy) < 0.000_1 && drawing.baselineOffset === baseline) return drawing;
    return Object.freeze({
      ...drawing,
      y: extentTopY,
      baselineOffset: baseline,
      geometry: shiftGeometry(drawing.geometry, 0, dy),
      paintBounds: Object.freeze({ ...drawing.paintBounds, y: drawing.paintBounds.y + dy }),
      hitBounds: Object.freeze({ ...drawing.hitBounds, y: drawing.hitBounds.y + dy }),
    });
  });
}

export interface InlineDrawingRecord {
  readonly kind: 'inlineDrawing';
  readonly drawingNodeId: string;
  readonly paragraphId: string;
  readonly ownerPartName: string;
  readonly start: number;
  /** Left edge of the extent box (slot + distL). */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly distL: number;
  readonly distR: number;
  readonly distT: number;
  readonly distB: number;
  /** Caret/hit advance start (slot left, before distL). */
  readonly advanceStart: number;
  /** Caret/hit advance end (slot + totalWidth). */
  readonly advanceEnd: number;
  readonly baselineOffset: number;
  readonly paintBounds: LayoutBox;
  readonly hitBounds: LayoutBox;
  readonly geometry: DrawingGeometry;
  readonly resource: ImageResourceState;
  readonly accessibility: DrawingAccessibility;
  /** Sanitized external hyperlink projection; inert until an explicit gesture activates it. */
  readonly hyperlinkHref: string | null;
  readonly effects: DrawingImageEffects;
  readonly crop: SourceCrop;
  readonly transform: DrawingTransform;
  /** Graphic kind of a non-picture drawing, naming its placeholder; null for pictures. */
  readonly placeholderGraphicKind: DrawingPlaceholderKind | null;
  /**
   * The title and plot types of a drawing that holds a chart whose chart part can be read, and
   * how the page shows it (`shownAs`): drawn, by its saved fallback, or as a placeholder.
   */
  readonly chart?: DrawingChartSummary;
  /**
   * The resource of the picture saved in a chart's `mc:Fallback`, whichever branch the page
   * shows, for an output that exports a chart as its saved picture. Absent without one.
   *
   * @internal
   */
  readonly chartFallbackResource?: ImageResourceState;
  /** Typed solid-geometry payload for a renderable `wps:wsp` shape; null otherwise. */
  readonly vectorShape: VectorShapeProjection | null;
  /** Legacy text art on the line, fitted to its box. */
  readonly textArt?: DrawingTextArtRecord;
  /** A picture's reflection and soft edges, in the extent's EMU; absent when it has none. */
  readonly frameEffects?: PictureFrameEffects;
  /**
   * Present when the image is the picture member of a drawing group. The image then fills
   * the bounds of `geometry.imageTransformCorners`, not `geometry.contentBounds`, and paints
   * below `vectorShape`, which holds the group's other members. `placeholderGraphicKind`
   * stays non-null, as for a vector shape, so image commands do not treat the group as a
   * picture. The group paints whole or not at all: when the picture cannot paint, an output
   * shows no part of the group.
   */
  readonly groupPicture?: DrawingGroupPictureRecord;
  /**
   * The group's other picture members, in document order. Each paints above the record's
   * own image and the layers before it, and below `vectorShape`. Absent for one picture.
   */
  readonly groupPictureLayers?: readonly import('./drawing-group-picture-layers.ts').DrawingGroupPictureLayerRecord[];
  /**
   * The revision wrappers enclosing the owning run, outermost first — the same stack spans
   * carry, so paint and review chrome give a tracked picture the same cues as tracked text.
   * Absent when the drawing is untracked.
   */
  readonly revisions?: readonly RevisionAttribution[];
  /**
   * The picture's resolved Unicode bidi level in a right-to-left or mixed-direction paragraph.
   * An odd level reads right to left: its logical start is its right edge. Absent when the
   * paragraph needed no bidi resolution.
   */
  readonly bidiLevel?: number;
  /** The run-direction group of a picture in a `w:bdo` override or a wrapper's group; else its level's. */
  readonly bidiRunDirection?: 'ltr' | 'rtl';
  /**
   * Laid-out textbox story for a `wps:txbx` drawing; paint renders it clipped inside the
   * extent instead of a placeholder. Absent when the drawing carries no story or the host
   * did not thread story layout (the record then degrades to the placeholder path). An
   * inline text box carries one too: its story sits inside the extent the line reserves.
   */
  readonly textboxStory?: import('./textbox-story-layout.ts').TextboxStoryLayout;
  /** Read-only stories of a group's text box members, each placed in its member box. */
  readonly groupTextboxStories?: readonly import('./group-textbox-layout.ts').GroupTextboxStoryRecord[];
}

export type LineLayoutAtom =
  | {
      readonly kind: 'text';
      readonly start: number;
      readonly end: number;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly kind: 'inlineDrawing';
      readonly start: number;
      readonly width: number;
      readonly height: number;
      readonly drawingNodeId: string;
    };

/** Merge spans and inline drawings on one line into reading-order atoms for tests. */
export function lineLayoutAtoms(
  line: Readonly<{
    readonly range: { readonly start: number; readonly end: number };
    readonly spans: readonly {
      readonly range: { readonly start: number; readonly end: number };
      readonly box: LayoutBox;
    }[];
    readonly drawings?: readonly InlineDrawingRecord[];
  }>
): readonly LineLayoutAtom[] {
  const atoms: LineLayoutAtom[] = [];
  for (const span of line.spans) {
    if (span.range.end <= span.range.start) continue;
    atoms.push({
      kind: 'text',
      start: span.range.start,
      end: span.range.end,
      width: span.box.width,
      height: span.box.height,
    });
  }
  for (const drawing of line.drawings ?? []) {
    atoms.push({
      kind: 'inlineDrawing',
      start: drawing.start,
      width: drawing.width,
      height: drawing.height,
      drawingNodeId: drawing.drawingNodeId,
    });
  }
  atoms.sort((left, right) => left.start - right.start || (left.kind === 'text' ? -1 : 1));
  return Object.freeze(atoms);
}

export interface InlineDrawingLayoutInput {
  readonly drawingNodeId: string;
  readonly ownerPartName: string;
  readonly projection: DrawingProjection;
  readonly resource: ImageResourceState;
  /** The resources of the projection's `groupPictureLayers`, in the same order. */
  readonly groupPictureLayerResources?: readonly ImageResourceState[];
  /** The resource of the projection's `chartFallbackPicture`. */
  readonly chartFallbackResource?: ImageResourceState;
}

export interface InlineDrawingLayoutContext {
  readonly ownerPartName: string;
  /** Precomputed run-level atom id (`w:drawing` or MC wrapper) → projection. */
  readonly projectionForAtom?: (atomNodeId: string) => DrawingProjection | null;
  readonly project: (
    drawing: import('../store/package/ooxml-tree.ts').OoxmlDrawingNode
  ) => DrawingProjection | null;
  readonly resourceOf: (projection: DrawingProjection) => ImageResourceState;
  /**
   * Resolve a numbering picture bullet's image by relationship id.
   *
   * The owner is the NUMBERING part, not this context's story part: `w:numPicBullet` lives in
   * `numbering.xml` and its `r:id` names a relationship of that part. The resolver answers the
   * owner it used so a sink can key the resource without assuming the part name. Absent on a
   * context whose host resolves no image resources, which degrades a picture bullet to its
   * level's `w:lvlText`.
   */
  readonly pictureBulletResource?: (
    relationshipId: string
  ) => { readonly ownerPartName: string; readonly resource: ImageResourceState } | null;
}

export {
  clipInlineDrawingRecordToRegion,
  clipInlineDrawingRecordVertically,
  clipInlineDrawingToBodyBand,
} from './inline-drawing-clip.ts';

export type DrawingAnchorStoryKind = 'body' | 'header' | 'footer' | 'footnote' | 'endnote';

/** Named fallback when a positioning frame cannot be resolved (OpenSpec 4.6). */
export type AnchoredDrawingLayoutFallback = 'unresolvable-frame' | 'page-defer-exhausted';

const HORIZONTAL_FRAMES: ReadonlySet<string> = new Set([
  'character',
  'column',
  'insideMargin',
  'leftMargin',
  'margin',
  'outsideMargin',
  'page',
  'rightMargin',
]);

const VERTICAL_FRAMES: ReadonlySet<string> = new Set([
  'bottomMargin',
  'insideMargin',
  'line',
  'margin',
  'outsideMargin',
  'page',
  'paragraph',
  'topMargin',
]);

export interface DrawingAnchorFrameContext {
  readonly pageNumber: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly marginLeft: number;
  readonly marginRight: number;
  /**
   * Authored `w:pgMar` bottom. The ONLY reader is the `bottomMargin` frame, whose origin is
   * the top edge of the bottom margin band — a page-setup landmark, so a footer taller than
   * that margin must not move it. The `topMargin` band needs no twin: its top edge is the
   * sheet edge, which {@link DrawingAnchorFrameContext.contentInsetTop} already gives.
   */
  readonly marginBottom: number;
  /**
   * Distance from the frame origin (the body content box top) up to the sheet top, and from
   * the content box bottom down to the sheet bottom. NOT the authored `w:pgMar` values: a
   * header taller than the top margin pushes the body content box down, and a page-relative
   * anchor resolved against the authored margin then lands that difference too low (#274).
   * HF stories keep authored page/landmark insets; attached pages supply effective margin frames.
   * Horizontal insets stay authored because nothing pushes the content box sideways; future
   * gutters or binding offsets need their own field.
   */
  readonly contentInsetTop: number;
  readonly contentInsetBottom: number;
  readonly contentWidth: number;
  readonly verticalMarginFrame?: { readonly top: number; readonly height: number };
  /** Sheet top in header story coordinates. Body stories use their content inset. */
  readonly topMarginFrameOrigin?: number;
  /** Body flow height on the current page (may shrink for notes/HF reserves). */
  readonly contentHeight: number;
  /** Content band between the insets: pageHeight − contentInsetTop − contentInsetBottom. */
  readonly contentBandHeight: number;
  readonly paragraphBox: LayoutBox;
  readonly anchorLineBox: LayoutBox;
  readonly anchorCharacterX: number;
  readonly columnBox: LayoutBox;
  readonly cellBox: LayoutBox | null;
  /** Cell text column, excluding padding; the physical cell still owns clipping. */
  readonly cellContentBox?: LayoutBox;
  readonly layoutInCell: boolean;
  /** The cell box is a real table cell, not a header, footer or text-box story box. */
  readonly inTableCell?: boolean;
  readonly ownerPartName: string;
  readonly storyKind: DrawingAnchorStoryKind;
  /**
   * A wrapping body object positioned from its paragraph never starts above the content box
   * top (`wrappedAnchorsStayBelowTopMargin`). Set by the body frame base in modern modes.
   */
  readonly wrappedParagraphAnchorsBelowContentTop?: boolean;
  /** A column `left`/`right` alignment keeps the paragraph indents (legacy modes). */
  readonly columnAlignmentFollowsIndents?: boolean;
  /**
   * Where a wrapping body object positioned from its paragraph or line must end: the content
   * box bottom in modern modes (`wrappedAnchorsEndAtBottomMargin`), the sheet bottom in legacy
   * modes (`wrappedAnchorsEndOnSheet`). Set only by the body frame base, so a story without a
   * real sheet never lifts an object.
   */
  readonly wrappedParagraphAnchorBottom?: 'margin' | 'sheet';
  /**
   * Called whenever a frame or alignment resolution reads the parity of
   * {@link pageNumber}. Incremental layout listens so it knows a section's
   * geometry depends on where in the document its pages start.
   */
  readonly onPageParityRead?: () => void;
}

export interface ResolvedAnchoredPosition {
  readonly x: number;
  readonly y: number;
  readonly horizontalFrame: DrawingHorizontalReferenceFrame;
  readonly verticalFrame: DrawingVerticalReferenceFrame;
  /** Left edge of the horizontal reference frame in page-content coordinates. */
  readonly horizontalFrameOrigin: number;
  /** Top edge of the vertical reference frame in page-content coordinates. */
  readonly verticalFrameOrigin: number;
  readonly layoutFallback?: AnchoredDrawingLayoutFallback;
}

export interface AnchoredDrawingRecord extends Omit<
  InlineDrawingRecord,
  'kind' | 'baselineOffset' | 'advanceStart' | 'advanceEnd' | 'distL' | 'distR' | 'distT' | 'distB'
> {
  readonly kind: 'anchoredDrawing';
  readonly anchorParagraphId: string;
  readonly horizontalFrame: DrawingHorizontalReferenceFrame;
  readonly verticalFrame: DrawingVerticalReferenceFrame;
  readonly horizontalFrameOrigin: number;
  readonly verticalFrameOrigin: number;
  readonly behindDocument: boolean;
  readonly allowOverlap: boolean;
  /**
   * Whether the object is laid out in the box it flows in. For an anchor in a table cell this
   * is the layout's reading: `true` from compatibility mode 15, which ignores
   * `layoutInCell="0"`. Everywhere else it is the authored `wp:anchor/@layoutInCell`.
   */
  readonly layoutInCell: boolean;
  readonly relativeHeight: number;
  readonly wrap: Exclude<ImageWrapTarget, 'inline'>;
  readonly layoutFallback?: AnchoredDrawingLayoutFallback;
  /** Canonical document traversal index within the owner story part. */
  readonly sourceOrder?: number;
  /** Floating VML text art fitted to the box; paint draws it instead of a resource. */
  readonly textArt?: DrawingTextArtRecord;
}

/** Every parity read goes through here so the host learns the layout depends on it. */
function isOddPageOf(ctx: DrawingAnchorFrameContext): boolean {
  ctx.onPageParityRead?.();
  return ctx.pageNumber % 2 === 1;
}

function usesCellLayoutBox(
  _frame: DrawingHorizontalReferenceFrame | DrawingVerticalReferenceFrame,
  ctx: DrawingAnchorFrameContext
): boolean {
  if (!ctx.layoutInCell || ctx.cellBox === null) return false;
  if (!Number.isFinite(ctx.cellBox.height) || ctx.cellBox.height <= 0) return false;
  if (!Number.isFinite(ctx.cellBox.width) || ctx.cellBox.width <= 0) return false;
  return true;
}

function horizontalEdges(
  frame: DrawingHorizontalReferenceFrame,
  ctx: DrawingAnchorFrameContext
): { readonly left: number; readonly right: number; readonly center: number } | null {
  if (usesCellLayoutBox(frame, ctx)) {
    const cellBox = ctx.cellBox;
    if (!cellBox) return null;
    const { x, width } = cellBox;
    // The cell stands in for the page: `page` is the whole cell, `margin` and `column` its
    // text area inside the cell margins, and the side margin bands lie between the two.
    const content = ctx.cellContentBox ?? cellBox;
    const contentRight = content.x + content.width;
    switch (frame) {
      case 'column':
      case 'margin':
        return { left: content.x, right: contentRight, center: content.x + content.width / 2 };
      case 'page':
        return { left: x, right: x + width, center: x + width / 2 };
      case 'leftMargin':
        return { left: x, right: content.x, center: (x + content.x) / 2 };
      case 'rightMargin':
        return { left: contentRight, right: x + width, center: (contentRight + x + width) / 2 };
      case 'character':
        return {
          left: ctx.anchorCharacterX,
          right: ctx.anchorCharacterX,
          center: ctx.anchorCharacterX,
        };
      case 'insideMargin':
        return isOddPageOf(ctx)
          ? { left: x, right: x + width, center: x + width / 2 }
          : { left: x + width, right: x + width, center: x + width };
      case 'outsideMargin':
        return isOddPageOf(ctx)
          ? { left: x + width, right: x + width, center: x + width }
          : { left: x, right: x + width, center: x + width / 2 };
      default:
        return null;
    }
  }

  const pageLeft = -ctx.marginLeft;
  const pageRight = ctx.contentWidth + ctx.marginRight;
  const contentLeft = 0;
  const contentRight = ctx.contentWidth;
  const columnLeft = ctx.columnBox.x;
  const columnRight = ctx.columnBox.x + ctx.columnBox.width;

  switch (frame) {
    case 'page':
      return { left: pageLeft, right: pageRight, center: (pageLeft + pageRight) / 2 };
    case 'margin':
      return { left: contentLeft, right: contentRight, center: contentLeft + ctx.contentWidth / 2 };
    case 'column':
      return { left: columnLeft, right: columnRight, center: columnLeft + ctx.columnBox.width / 2 };
    case 'character':
      return {
        left: ctx.anchorCharacterX,
        right: ctx.anchorCharacterX,
        center: ctx.anchorCharacterX,
      };
    case 'leftMargin':
      return { left: pageLeft, right: pageLeft, center: pageLeft };
    case 'rightMargin':
      return { left: pageRight, right: pageRight, center: pageRight };
    case 'insideMargin':
      return isOddPageOf(ctx)
        ? { left: contentLeft, right: contentLeft, center: contentLeft }
        : { left: contentRight, right: contentRight, center: contentRight };
    case 'outsideMargin':
      return isOddPageOf(ctx)
        ? { left: pageRight, right: pageRight, center: pageRight }
        : { left: pageLeft, right: pageLeft, center: pageLeft };
    default:
      return null;
  }
}

function verticalEdges(
  frame: DrawingVerticalReferenceFrame,
  ctx: DrawingAnchorFrameContext
): { readonly top: number; readonly bottom: number; readonly center: number } | null {
  if (usesCellLayoutBox(frame, ctx)) {
    const cellBox = ctx.cellBox;
    if (!cellBox) return null;
    const { y, height } = cellBox;
    switch (frame) {
      case 'page':
      case 'margin':
      case 'topMargin':
      case 'bottomMargin': {
        // Every page-like frame starts at the top of the cell's text area, below its margin.
        const content = ctx.cellContentBox ?? cellBox;
        return {
          top: content.y,
          bottom: content.y + content.height,
          center: content.y + content.height / 2,
        };
      }
      case 'paragraph':
        return {
          top: ctx.paragraphBox.y,
          bottom: ctx.paragraphBox.y + ctx.paragraphBox.height,
          center: ctx.paragraphBox.y + ctx.paragraphBox.height / 2,
        };
      case 'line':
        return {
          top: ctx.anchorLineBox.y,
          bottom: ctx.anchorLineBox.y + ctx.anchorLineBox.height,
          center: ctx.anchorLineBox.y + ctx.anchorLineBox.height / 2,
        };
      case 'insideMargin':
        return isOddPageOf(ctx)
          ? { top: y, bottom: y + height, center: y + height / 2 }
          : { top: y + height, bottom: y + height, center: y + height };
      case 'outsideMargin':
        return isOddPageOf(ctx)
          ? { top: y + height, bottom: y + height, center: y + height }
          : { top: y, bottom: y + height, center: y + height / 2 };
      default:
        return null;
    }
  }

  const pageTop = -ctx.contentInsetTop;
  const contentBandHeight = ctx.contentBandHeight;
  /**
   * Top edge of the bottom margin band, off the AUTHORED margin.
   *
   * Deriving it from the content band instead would let an oversized footer drag it up with
   * the shrinking text area, which is the same class of bug as #274 read backwards: the
   * margin frames exist so an anchor does NOT follow the furniture.
   */
  const pageBottomInner = pageTop + ctx.pageHeight - ctx.marginBottom;
  /** Physical sheet bottom above the outer page edge. */
  const pageBottomSheet = contentBandHeight + ctx.contentInsetBottom;
  const contentTop = 0;
  const contentBottom = ctx.contentHeight;
  const marginTop = ctx.verticalMarginFrame?.top ?? contentTop;
  const marginBottom = marginTop + (ctx.verticalMarginFrame?.height ?? ctx.contentHeight);
  const topMarginTop = ctx.topMarginFrameOrigin ?? pageTop;
  switch (frame) {
    case 'page':
      return { top: pageTop, bottom: pageBottomSheet, center: (pageTop + pageBottomSheet) / 2 };
    case 'margin':
      return { top: marginTop, bottom: marginBottom, center: (marginTop + marginBottom) / 2 };
    case 'paragraph': {
      // An object a table cell anchors but lays out against the page (§20.4.2.3
      // `layoutInCell="0"`) measures a paragraph offset from the top of its row, not from
      // the paragraph: cell margins, borders and earlier paragraphs of the cell do not move it.
      const row = ctx.inTableCell && !ctx.layoutInCell ? ctx.cellBox : null;
      if (row && Number.isFinite(row.y))
        return { top: row.y, bottom: row.y + row.height, center: row.y + row.height / 2 };
      return {
        top: ctx.paragraphBox.y,
        bottom: ctx.paragraphBox.y + ctx.paragraphBox.height,
        center: ctx.paragraphBox.y + ctx.paragraphBox.height / 2,
      };
    }
    case 'line':
      return {
        top: ctx.anchorLineBox.y,
        bottom: ctx.anchorLineBox.y + ctx.anchorLineBox.height,
        center: ctx.anchorLineBox.y + ctx.anchorLineBox.height / 2,
      };
    case 'topMargin':
      return { top: topMarginTop, bottom: topMarginTop, center: topMarginTop };
    case 'bottomMargin':
      return { top: pageBottomInner, bottom: pageBottomInner, center: pageBottomInner };
    case 'insideMargin':
      return isOddPageOf(ctx)
        ? { top: contentTop, bottom: contentTop, center: contentTop }
        : { top: contentBottom, bottom: contentBottom, center: contentBottom };
    case 'outsideMargin':
      return isOddPageOf(ctx)
        ? { top: pageBottomSheet, bottom: pageBottomSheet, center: pageBottomSheet }
        : { top: pageTop, bottom: pageTop, center: pageTop };
    default:
      return null;
  }
}

function axisOffsetPoints(offsetEmu: number | null): number | null {
  if (offsetEmu === null) return 0;
  return emuToPointsSafe(offsetEmu);
}

function resolveInsideOutsideHorizontalAlign(
  align: string,
  objectWidth: number,
  ctx: DrawingAnchorFrameContext
): number | null {
  const odd = isOddPageOf(ctx);
  if (
    ctx.layoutInCell &&
    ctx.cellBox &&
    Number.isFinite(ctx.cellBox.width) &&
    ctx.cellBox.width > 0
  ) {
    const { x, width } = ctx.cellBox;
    if (align === 'inside') return odd ? x : x + width - objectWidth;
    if (align === 'outside') return odd ? x + width - objectWidth : x;
    return null;
  }
  if (align === 'inside') return odd ? 0 : ctx.contentWidth - objectWidth;
  if (align === 'outside') return odd ? ctx.contentWidth - objectWidth : 0;
  return null;
}

function resolveInsideOutsideVerticalAlign(
  align: string,
  objectHeight: number,
  ctx: DrawingAnchorFrameContext
): number | null {
  const odd = isOddPageOf(ctx);
  // THE TEXT AREA, deliberately — the opposite choice from `pageBottomInner` two functions up.
  // `inside`/`outside` align WITHIN a band rather than measuring from a page landmark, so on an
  // odd page `inside` is the content box top and `outside` puts the object on the content box
  // bottom. Reading the flow height here instead would differ only on a page carrying a note
  // reserve, and would shrink the band the notes took away from the text.
  const bandHeight = ctx.contentBandHeight;
  if (
    ctx.layoutInCell &&
    ctx.cellBox &&
    Number.isFinite(ctx.cellBox.height) &&
    ctx.cellBox.height > 0
  ) {
    const { y, height } = ctx.cellBox;
    if (align === 'inside') return odd ? y : y + height - objectHeight;
    if (align === 'outside') return odd ? y + height - objectHeight : y;
    return null;
  }
  if (align === 'inside') return odd ? 0 : bandHeight - objectHeight;
  if (align === 'outside') return odd ? bandHeight - objectHeight : 0;
  return null;
}

/** The anchor paragraph's indents inside the box it flows in: its cell text area or column. */
function columnAlignmentIndents(
  ctx: DrawingAnchorFrameContext
): { readonly left: number; readonly right: number } | null {
  if (ctx.columnAlignmentFollowsIndents !== true) return null;
  const home = ctx.cellBox === null ? ctx.columnBox : (ctx.cellContentBox ?? ctx.cellBox);
  const text = ctx.paragraphBox;
  return { left: text.x - home.x, right: home.x + home.width - (text.x + text.width) };
}

function positionFromHorizontal(
  frame: DrawingHorizontalReferenceFrame,
  align: string | null,
  offsetEmu: number | null,
  objectWidth: number,
  ctx: DrawingAnchorFrameContext
): number | null {
  const edges = horizontalEdges(frame, ctx);
  if (!edges) return null;
  const offset = axisOffsetPoints(offsetEmu);
  if (offset === null) return null;
  const indents = frame === 'column' ? columnAlignmentIndents(ctx) : null;
  if (align === 'left') return edges.left + (indents?.left ?? 0) + offset;
  if (align === 'center') return edges.center - objectWidth / 2 + offset;
  if (align === 'right') return edges.right - (indents?.right ?? 0) - objectWidth + offset;
  if (align === 'inside' || align === 'outside') {
    const resolved = resolveInsideOutsideHorizontalAlign(align, objectWidth, ctx);
    if (resolved !== null) return resolved + offset;
  }
  return edges.left + offset;
}

function positionFromVertical(
  frame: DrawingVerticalReferenceFrame,
  align: string | null,
  offsetEmu: number | null,
  objectHeight: number,
  ctx: DrawingAnchorFrameContext
): number | null {
  const edges = verticalEdges(frame, ctx);
  if (!edges) return null;
  const offset = axisOffsetPoints(offsetEmu);
  if (offset === null) return null;
  const cellTop = ctx.inTableCell === true && usesCellLayoutBox(frame, ctx);
  if (align === 'top' || (cellTop && alignsToCellFrameTop(frame, align))) return edges.top + offset;
  if (align === 'center') return edges.center - objectHeight / 2 + offset;
  if (align === 'bottom') return edges.bottom - objectHeight + offset;
  if (align === 'inside' || align === 'outside') {
    const resolved = resolveInsideOutsideVerticalAlign(align, objectHeight, ctx);
    if (resolved !== null) return resolved + offset;
  }
  return edges.top + offset;
}

/** Resolve anchored x/y in page-content coordinates. */
export function resolveAnchoredDrawingPosition(
  projection: DrawingProjection,
  ctx: DrawingAnchorFrameContext
): ResolvedAnchoredPosition {
  const measure = measureInlineDrawing(projection);
  const position = projection.position;
  const anchorMeta = projection.anchor;
  const fallbackFrameH: DrawingHorizontalReferenceFrame = 'page';
  const fallbackFrameV: DrawingVerticalReferenceFrame = 'page';

  if (!position || !anchorMeta) {
    return Object.freeze({
      x: 0,
      y: 0,
      horizontalFrame: fallbackFrameH,
      verticalFrame: fallbackFrameV,
      horizontalFrameOrigin: 0,
      verticalFrameOrigin: 0,
      layoutFallback: 'unresolvable-frame',
    });
  }

  if (anchorMeta.simplePos) {
    const xPoints = emuToPointsSafe(position.simplePosition.xEmu);
    const yPoints = emuToPointsSafe(position.simplePosition.yEmu);
    if (xPoints === null || yPoints === null) {
      return Object.freeze({
        x: 0,
        y: 0,
        horizontalFrame: position.horizontal.relativeFrom,
        verticalFrame: position.vertical.relativeFrom,
        horizontalFrameOrigin: 0,
        verticalFrameOrigin: 0,
        layoutFallback: 'unresolvable-frame',
      });
    }
    return Object.freeze({
      x: xPoints - ctx.marginLeft,
      y: yPoints - ctx.contentInsetTop,
      horizontalFrame: position.horizontal.relativeFrom,
      verticalFrame: position.vertical.relativeFrom,
      horizontalFrameOrigin: 0,
      verticalFrameOrigin: 0,
    });
  }

  const horizontalFrame = position.horizontal.relativeFrom;
  const verticalFrame = position.vertical.relativeFrom;
  const horizontalEdgesResolved = horizontalEdges(horizontalFrame, ctx);
  const verticalEdgesResolved = verticalEdges(verticalFrame, ctx);
  const horizontalFrameOrigin = horizontalEdgesResolved?.left ?? 0;
  const verticalFrameOrigin = verticalEdgesResolved?.top ?? 0;
  if (!HORIZONTAL_FRAMES.has(horizontalFrame) || !VERTICAL_FRAMES.has(verticalFrame)) {
    return Object.freeze({
      x: 0,
      y: 0,
      horizontalFrame: HORIZONTAL_FRAMES.has(horizontalFrame) ? horizontalFrame : fallbackFrameH,
      verticalFrame: VERTICAL_FRAMES.has(verticalFrame) ? verticalFrame : fallbackFrameV,
      horizontalFrameOrigin,
      verticalFrameOrigin,
      layoutFallback: 'unresolvable-frame',
    });
  }

  const x = positionFromHorizontal(
    horizontalFrame,
    position.horizontal.align,
    position.horizontal.offsetEmu,
    measure.width,
    ctx
  );
  const y = positionFromVertical(
    verticalFrame,
    position.vertical.align,
    position.vertical.offsetEmu,
    measure.height,
    ctx
  );
  if (x === null || y === null) {
    return Object.freeze({
      x: 0,
      y: 0,
      horizontalFrame,
      verticalFrame,
      horizontalFrameOrigin,
      verticalFrameOrigin,
      layoutFallback: 'unresolvable-frame',
    });
  }

  return Object.freeze({
    x,
    y: wrappedParagraphAnchorBottomTop(
      wrappedParagraphAnchorTop(y, verticalFrame, projection.wrap, ctx),
      measure.height,
      verticalFrame,
      projection.wrap,
      ctx
    ),
    horizontalFrame,
    verticalFrame,
    horizontalFrameOrigin,
    verticalFrameOrigin,
  });
}

export function clipAnchoredDrawingRecordToRegion(
  drawing: AnchoredDrawingRecord,
  region: LayoutBox
): AnchoredDrawingRecord {
  const extentBox = Object.freeze({
    x: drawing.x,
    y: drawing.y,
    width: drawing.width,
    height: drawing.height,
  });
  const paintBounds = clipBoxToRegion(extentBox, region);
  const hitBounds = hitBoundsOf(paintBounds);
  return Object.freeze({
    ...drawing,
    paintBounds,
    hitBounds,
    geometry: clipGeometryToRegion(drawing.geometry, region),
  });
}

export function buildAnchoredDrawingRecord(options: {
  readonly input: InlineDrawingLayoutInput;
  readonly anchorParagraphId: string;
  readonly start: number;
  readonly resolved: ResolvedAnchoredPosition;
  readonly layoutInCell: boolean;
  readonly clipRegion?: LayoutBox;
  readonly sourceOrder?: number;
  readonly textboxStory?: import('./textbox-story-layout.ts').TextboxStoryLayout | null;
  readonly revisions?: readonly RevisionAttribution[];
  readonly measurer?: import('./semantic-records.ts').TextMeasurer;
}): AnchoredDrawingRecord {
  const projection = options.input.projection;
  const anchorMeta = projection.anchor;
  const measure = measureInlineDrawing(projection);
  const textArt = projection.textArt
    ? layoutTextArt(projection.textArt, measure.width, measure.height, options.measurer)
    : null;
  const geometry = drawingGeometryFromProjection({
    projection,
    anchorX: options.resolved.x,
    anchorY: options.resolved.y,
    extentWidth: measure.width,
    extentHeight: measure.height,
  });
  // Turned text or a turned text box reaches past its box; the painted area holds the turn.
  const turned = textArt
    ? textArtPaintBounds(geometry.paintBounds, textArt)
    : turnedTextboxBounds(geometry.paintBounds, options.textboxStory, geometry.contentBounds);
  const paintBounds = options.clipRegion ? clipBoxToRegion(turned, options.clipRegion) : turned;
  const hitBounds = hitBoundsOf(paintBounds);
  return Object.freeze({
    kind: 'anchoredDrawing',
    drawingNodeId: options.input.drawingNodeId,
    paragraphId: options.anchorParagraphId,
    anchorParagraphId: options.anchorParagraphId,
    ownerPartName: options.input.ownerPartName,
    start: options.start,
    x: options.resolved.x,
    y: options.resolved.y,
    width: measure.width,
    height: measure.height,
    horizontalFrame: options.resolved.horizontalFrame,
    verticalFrame: options.resolved.verticalFrame,
    horizontalFrameOrigin: options.resolved.horizontalFrameOrigin,
    verticalFrameOrigin: options.resolved.verticalFrameOrigin,
    behindDocument: anchorMeta?.behindDocument ?? false,
    allowOverlap: anchorMeta?.allowOverlap ?? true,
    layoutInCell: options.layoutInCell,
    relativeHeight: anchorMeta?.relativeHeight ?? 0,
    wrap: projection.wrap === 'inline' ? 'inFront' : projection.wrap,
    ...(options.sourceOrder !== undefined ? { sourceOrder: options.sourceOrder } : {}),
    ...(options.resolved.layoutFallback ? { layoutFallback: options.resolved.layoutFallback } : {}),
    ...(options.textboxStory ? { textboxStory: options.textboxStory } : {}),
    ...(options.revisions && options.revisions.length > 0 ? { revisions: options.revisions } : {}),
    paintBounds,
    hitBounds,
    geometry: options.clipRegion ? clipGeometryToRegion(geometry, options.clipRegion) : geometry,
    resource: options.input.resource,
    accessibility: drawingAccessibility(projection),
    ...drawingPaintFields(projection),
    ...groupPictureLayerFields(projection, options.input.groupPictureLayerResources),
    ...chartFallbackFields(options.input.chartFallbackResource),
    ...(textArt ? { textArt } : {}),
  });
}

/** Column content box for one column of a multi-column section. */
export function columnBoxForSection(options: {
  readonly contentWidth: number;
  readonly paragraphY: number;
  readonly paragraphHeight: number;
  readonly columnCount: number;
  readonly columnGapPt: number;
  readonly columnIndex?: number;
}): LayoutBox {
  const count = Math.max(1, options.columnCount);
  const gap = count > 1 ? options.columnGapPt : 0;
  const columnWidth =
    count > 1 ? (options.contentWidth - gap * (count - 1)) / count : options.contentWidth;
  const index = Math.max(0, Math.min(count - 1, options.columnIndex ?? 0));
  const x = index * (columnWidth + gap);
  return Object.freeze({
    x,
    y: options.paragraphY,
    width: columnWidth,
    height: options.paragraphHeight,
  });
}
export function shiftAnchoredDrawingRecords(
  drawings: AnchoredDrawingRecord[],
  paragraphId: string,
  dy: number
): void {
  if (Math.abs(dy) <= 0.001) return;
  for (let index = 0; index < drawings.length; index += 1) {
    const drawing = drawings[index]!;
    if (drawing.anchorParagraphId !== paragraphId) continue;
    if (!drawing.layoutInCell && !['paragraph', 'line'].includes(drawing.verticalFrame)) continue;
    drawings[index] = Object.freeze({
      ...drawing,
      y: drawing.y + dy,
      geometry: shiftGeometry(drawing.geometry, 0, dy),
      paintBounds: Object.freeze({ ...drawing.paintBounds, y: drawing.paintBounds.y + dy }),
      hitBounds: Object.freeze({ ...drawing.hitBounds, y: drawing.hitBounds.y + dy }),
    });
  }
}

/**
 * A cell box always travels with the scope that reads its anchors' `layoutInCell`, so a
 * publisher cannot pass one without the other and silently read the flag as authored.
 */
type PublishCellScope =
  | { readonly cellBox: null; readonly cellAnchorScope: null }
  | { readonly cellBox: LayoutBox; readonly cellAnchorScope: CellAnchorScope };

export function publishAnchoredDrawingsForParagraph(
  options: {
    readonly paragraph: OoxmlNode;
    readonly paragraphId: string;
    readonly paragraphBox: LayoutBox;
    readonly fragmentRange?: { readonly start: number; readonly end: number };
    readonly lines: readonly {
      readonly range: { readonly start: number; readonly end: number };
      readonly box: LayoutBox;
      readonly spans: readonly {
        readonly range: { readonly start: number; readonly end: number };
        readonly box: LayoutBox;
        readonly text?: string;
        readonly style?: import('./run-style.ts').ResolvedRunStyle;
      }[];
    }[];
    readonly drawingLayout: InlineDrawingLayoutContext;
    readonly frameBase: Omit<
      DrawingAnchorFrameContext,
      | 'paragraphBox'
      | 'anchorLineBox'
      | 'anchorCharacterX'
      | 'columnBox'
      | 'cellBox'
      | 'layoutInCell'
    >;
    readonly columnBox: LayoutBox;
    readonly cellContentBox?: LayoutBox;
    readonly pageClip: LayoutBox;
    readonly measurer?: import('./semantic-records.ts').TextMeasurer;
    readonly sourceOrderOf?: (drawingNodeId: string) => number | undefined;
    /**
     * Which revisions are resolved before publishing. A deleted anchor survives `all-markup`
     * (marked, like deleted text) and disappears from the proposed result; an inserted one
     * disappears from the original. Defaults to `all-markup`, which shows everything.
     */
    readonly displayMode?: RevisionDisplayMode;
    readonly revisionAuthorFilter?: RevisionAuthorFilter;
    /**
     * Lays out a textbox drawing's story (host-supplied closure over flow deps and the page
     * context). Absent hosts degrade textbox drawings to the placeholder path.
     */
    readonly layoutTextboxStory?: (
      projection: DrawingProjection
    ) => import('./textbox-story-layout.ts').TextboxStoryLayout | null;
  } & PublishCellScope
): readonly AnchoredDrawingRecord[] {
  const atoms = anchoredDrawingAtomsInParagraph(options.paragraph, options.drawingLayout);
  if (atoms.length === 0) return [];
  const offsets = drawingModelOffsetsInParagraph(options.paragraph);
  const displayMode = options.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE;
  const records: AnchoredDrawingRecord[] = [];
  for (const atom of atoms) {
    const projection = atom.projection;
    if (
      projection.hidden ||
      revisionMarkupHidesDrawing(atom.revisions, displayMode, options.revisionAuthorFilter)
    )
      continue;
    const revisions = projectedRevisions(atom.revisions, displayMode, options.revisionAuthorFilter);
    if (revisions === null) continue;
    const start = offsets.get(atom.atomId);
    if (start === undefined) continue;
    if (
      options.fragmentRange &&
      (start < options.fragmentRange.start || start >= options.fragmentRange.end)
    ) {
      continue;
    }
    const anchorLine = options.lines.find(
      (line) => start >= line.range.start && start < line.range.end
    );
    if (!anchorLine) continue;
    // Outside any cell box the authored flag is only recorded; nothing reads it.
    const layoutInCell =
      options.cellBox === null
        ? (projection.anchor?.layoutInCell ?? true)
        : anchorLaidOutInCell(projection, options.cellAnchorScope);
    const horizontalFrame = projection.position?.horizontal.relativeFrom;
    const characterFrameOffset =
      horizontalFrame === 'character' ? anchorCharacterFrameOffset(anchorLine, start) : start;
    const frameContext: DrawingAnchorFrameContext = Object.freeze({
      ...options.frameBase,
      paragraphBox: options.paragraphBox,
      anchorLineBox: anchorLine.box,
      anchorCharacterX: anchorCharacterXOnLine(anchorLine, characterFrameOffset, options.measurer),
      columnBox: options.columnBox,
      cellBox: options.cellBox,
      cellContentBox: options.cellContentBox,
      layoutInCell,
      inTableCell: options.cellAnchorScope?.inTableCell === true,
    });
    // An unwrapped text box sizes its own width, so its story lays out before placement.
    const textboxStory =
      projection.textboxStory && options.layoutTextboxStory
        ? options.layoutTextboxStory(projection)
        : undefined;
    const placed = textboxPlacementProjection(projection, textboxStory);
    const resolved = resolveAnchoredDrawingPosition(placed, frameContext);
    const clipToCell =
      projection.wrap !== 'inFront' &&
      projection.wrap !== 'behind' &&
      layoutInCell &&
      options.cellBox !== null &&
      Number.isFinite(options.cellBox.height) &&
      options.cellBox.height > 0 &&
      Number.isFinite(options.cellBox.width) &&
      options.cellBox.width > 0;
    const pageClip =
      projection.position?.vertical.relativeFrom === 'margin'
        ? options.pageClip
        : pageClipRegion(options.frameBase);
    const clipRegion = clipToCell ? options.cellBox! : pageClip;
    const record = buildAnchoredDrawingRecord({
      input: Object.freeze({
        drawingNodeId: atom.atomId,
        ownerPartName: options.drawingLayout.ownerPartName,
        projection: placed,
        resource: options.drawingLayout.resourceOf(projection),
        groupPictureLayerResources: groupPictureLayerResources(
          projection,
          options.drawingLayout.resourceOf
        ),
        chartFallbackResource: chartFallbackResource(projection, options.drawingLayout.resourceOf),
      }),
      anchorParagraphId: options.paragraphId,
      start: characterFrameOffset,
      resolved,
      layoutInCell,
      clipRegion,
      revisions,
      measurer: options.measurer,
      ...(options.sourceOrderOf
        ? { sourceOrder: options.sourceOrderOf(projection.drawingNodeId) }
        : {}),
      ...(textboxStory !== undefined ? { textboxStory } : {}),
    });
    records.push(withGroupTextboxStories(record, projection, options.layoutTextboxStory));
  }
  return Object.freeze(records);
}

export function buildInlineDrawingRecord(options: {
  readonly input: InlineDrawingLayoutInput;
  readonly paragraphId: string;
  readonly start: number;
  readonly slotX: number;
  readonly y: number;
  readonly baseline: number;
  readonly contentLeft: number;
  readonly contentRight: number;
  readonly contentTop?: number;
  readonly contentBottom?: number;
  /** @internal Line placement applies the horizontal clip later. */
  readonly deferHorizontalClip?: boolean;
  readonly revisions?: readonly RevisionAttribution[];
  /** The resolved bidi shaping of the drawing's piece; absent without bidi resolution. */
  readonly bidiShaping?: {
    readonly level: number;
    readonly runDirection?: 'ltr' | 'rtl';
    readonly override?: 'ltr' | 'rtl';
    readonly wrapperGroup?: true;
  };
  /** Lays out a text-box story; called only for a drawing that carries one. */
  readonly layoutTextboxStory?: import('./inline-textbox-flow.ts').TextboxStoryLayouter;
  /** Fits legacy text art; without it, text art on the line paints nothing. */
  readonly measurer?: import('./semantic-records.ts').TextMeasurer;
}): InlineDrawingRecord {
  // A hidden box paints nothing, so its story is never laid out or reported.
  const textboxStory =
    options.input.projection.textboxStory && !drawingAccessibility(options.input.projection).hidden
      ? options.layoutTextboxStory?.(options.input.projection)
      : undefined;
  const measure = measureInlineDrawing(options.input.projection);
  const art = options.input.projection.textArt;
  const textArt =
    art && options.measurer
      ? layoutTextArt(art, measure.width, measure.height, options.measurer)
      : null;
  const extentX = options.slotX + measure.distL + measure.effectL;
  const geometry = drawingGeometryFromProjection({
    projection: options.input.projection,
    anchorX: extentX,
    anchorY: options.y,
    extentWidth: measure.width,
    extentHeight: measure.height,
  });
  // A turned, shadowed or outlined text box, or turned text art, reaches past its extent; the
  // clip keeps that reach.
  const reach = textArt
    ? textArtPaintBounds(geometry.paintBounds, textArt)
    : turnedTextboxBounds(geometry.paintBounds, textboxStory, geometry.contentBounds);
  const horizontalClip = options.deferHorizontalClip
    ? { x: reach.x, width: reach.width }
    : { x: options.contentLeft, width: Math.max(0, options.contentRight - options.contentLeft) };
  // Text art draws its whole ink, as a floating shape does, even where it reaches over the
  // content top or bottom.
  const clipRegion =
    options.contentTop !== undefined && options.contentBottom !== undefined && !textArt
      ? Object.freeze({
          ...horizontalClip,
          y: options.contentTop,
          height: Math.max(0, options.contentBottom - options.contentTop),
        })
      : Object.freeze({
          ...horizontalClip,
          y: reach.y,
          height: reach.height,
        });
  const paintBounds = clipBoxToRegion(reach, clipRegion);
  const hitBounds = hitBoundsOf(paintBounds);
  const record: InlineDrawingRecord = Object.freeze({
    kind: 'inlineDrawing',
    drawingNodeId: options.input.drawingNodeId,
    paragraphId: options.paragraphId,
    ownerPartName: options.input.ownerPartName,
    start: options.start,
    x: extentX,
    y: options.y,
    width: measure.width,
    height: measure.height,
    distL: measure.distL,
    distR: measure.distR,
    distT: measure.distT,
    distB: measure.distB,
    advanceStart: options.slotX,
    advanceEnd: options.slotX + measure.totalWidth,
    baselineOffset: options.baseline,
    paintBounds,
    hitBounds,
    // The line and column clip is no region a shape stays cut at: a shape that paints past its
    // extent paints over the margins, and a cell clips it again (semantic-table-layout.ts).
    geometry: clipGeometryToRegion(geometry, clipRegion, false),
    resource: options.input.resource,
    accessibility: drawingAccessibility(options.input.projection),
    ...drawingPaintFields(options.input.projection),
    ...groupPictureLayerFields(options.input.projection, options.input.groupPictureLayerResources),
    ...chartFallbackFields(options.input.chartFallbackResource),
    ...(options.revisions && options.revisions.length > 0 ? { revisions: options.revisions } : {}),
    ...(options.bidiShaping ? { bidiLevel: options.bidiShaping.level } : {}),
    ...((options.bidiShaping?.override || options.bidiShaping?.wrapperGroup) &&
    options.bidiShaping.runDirection
      ? { bidiRunDirection: options.bidiShaping.runDirection }
      : {}),
    ...(textboxStory ? { textboxStory } : {}),
    ...(textArt ? { textArt } : {}),
  });
  return withGroupTextboxStories(record, options.input.projection, options.layoutTextboxStory);
}
