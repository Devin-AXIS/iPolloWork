import type { BodyAnchorFrameBase } from './body-flow-helpers.ts';
import { resolveParagraphAnchorPosition } from './paragraph-anchor-position.ts';
import { revisionMarkupHidesDrawing } from './revision-markup-projection.ts';
// Anchored drawing exclusion zones and paint-layer ordering (typed-drawings-and-images task 9).
//
// Wrap exclusions feed paragraph line breaking; behind/inFront wrapNone produce none.

import type { DrawingProjection, ImageWrapTarget } from '../store/package/drawing-projection.ts';
import {
  anchoredDrawingAtomsInParagraph,
  drawingModelOffsetsInParagraph,
  measureInlineDrawing,
  resolveAnchoredDrawingPosition,
  type AnchoredDrawingLayoutFallback,
  type AnchoredDrawingRecord,
  type InlineDrawingLayoutContext,
} from './drawing-layout.ts';
import { anchoredOutOfCell, type CellAnchorScope } from './cell-anchor-layout.ts';
import { drawingGeometryFromProjection } from './drawing-geometry.ts';
import { paintLayerOf, sortDrawingsForPaint, type DrawingPaintLayer } from './drawing-overlap.ts';
import { paragraphBandTop, topAndBottomBandAnchorY } from './top-and-bottom-clearance.ts';
import {
  DEFAULT_REVISION_DISPLAY_MODE,
  revisionsVisible,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import type { DrawingGeometry } from './drawing-geometry.ts';
import {
  availableTextIntervalsOnScanline,
  squareExclusionBounds,
  type ScanlineInterval,
  type WrapExclusionInput,
  wrapExclusionFromProjection,
} from './drawing-wrap.ts';
import type { LayoutBox } from './semantic-records.ts';
import type { TextboxStoryLayouter } from './inline-textbox-flow.ts';
import { textboxPlacementProjection } from './textbox-placement.ts';
import { turnedWrapBox } from './textbox-wrap-box.ts';

export { compareDrawingPaintOrder, paintLayerOf, sortDrawingsForPaint } from './drawing-overlap.ts';
export type { DrawingPaintLayer } from './drawing-overlap.ts';

/** Maximum page-to-page deferrals before publishing with {@link AnchoredDrawingLayoutFallback}. */
export const MAX_ANCHOR_PAGE_DEFERRALS = 8;

/**
 * Maximum full-document reflow passes while wrap exclusions converge.
 *
 * The loop already ends the moment it revisits a zone state, so this budget bounds a LONG
 * NON-REPEATING drift, not an oscillation — and exhausting it refuses the document outright.
 * Eight was too tight to be that guard: `float-wrap-comprehensive-test.docx` with only its
 * font family changed, so the floats and anchors are identical and only the line metrics
 * differ, needs TWELVE passes and then settles. At eight it exported nothing at all.
 *
 * Measured: that document converges at 12, 16, 24 and 64 and fails at 8. Sixteen keeps the
 * guard against genuinely pathological input with headroom over the worst case seen. A pass
 * costs a full layout, but the loop only runs again while the zone map actually changed,
 * which for ordinary documents is once or twice.
 */
export const MAX_DRAWING_EXCLUSION_REFLOW_PASSES = 16;

/** Passages of a quarter inch or less beside a floating table hold no text. */
export const TABLE_WRAP_MIN_PASSAGE_PT = 18;

/**
 * A layout refusal. A body wrap reflow that does not settle raises it only inside a
 * column-balance trial (the band does not fit) or before the hidden-furniture retry; otherwise
 * it publishes its last pass, as a header or footer reflow does
 * (`unsettled-exclusion-layout.ts`). Wrapping page furniture that leaves body text no room
 * raises it too; only the hidden-furniture retry handles that case.
 */
export class DrawingExclusionConvergenceError extends Error {
  readonly name = 'DrawingExclusionConvergenceError';
  constructor(message = 'drawing exclusion reflow did not converge') {
    super(message);
  }
}

export {
  MAX_TOP_AND_BOTTOM_CLEARANCE_ATTEMPTS,
  topAndBottomSkipBeforeLine,
  travellingTopAndBottomSkip,
} from './top-and-bottom-clearance.ts';

/** The header or footer object a furniture exclusion zone comes from. */
export interface FurnitureZoneSource {
  readonly partName: string;
  readonly kind: 'drawing' | 'table';
  readonly nodeId: string;
}

/**
 * One zone's identity across the zones of a page. A body zone is its drawing node; a furniture
 * zone joins its part, kind, and node with U+0000, which no XML id can hold.
 */
export function exclusionZoneIdentity(zone: ExclusionZone): string {
  const source = zone.furnitureSource;
  return source ? `${source.partName}\0${source.kind}\0${source.nodeId}` : zone.drawingNodeId;
}

export interface ExclusionZone {
  /** Objects outside body drawing flow publish their exclusion directly instead of synthesizing it. */
  readonly sourceKind?: 'table' | 'frame' | 'furniture';
  /**
   * Placed by an earlier section on the sheet a `continuous` section continues on. Its anchor
   * is not in the continued section, so the zone reaches every line and column there.
   */
  readonly earlierSection?: boolean;
  /**
   * The header or footer object a `furniture` zone comes from. Node ids are unique only within
   * one part, so a furniture zone is identified by its part, its kind, and its node together
   * (see {@link exclusionZoneIdentity}), never by a composed id string.
   */
  readonly furnitureSource?: FurnitureZoneSource;
  readonly drawingNodeId: string;
  readonly anchorParagraphId: string;
  /** UTF-16 model offset of the anchor atom — exclusions apply at/after this point in the paragraph. */
  readonly anchorModelStart: number;
  /**
   * The band's vertical position is resolved against the page or a margin, not against the
   * anchor's own flow position, so it cannot move when the text beside it reflows.
   *
   * Such a band excludes every line it crosses on its page, including lines that PRECEDE the
   * anchor — a picture pinned to the top of the margin wraps the paragraphs above its anchor
   * exactly as it wraps the ones below. Flow-relative bands (`paragraph`, `line`) stay
   * forward-only: reaching back would move the anchor that positions them.
   */
  readonly pageFramedBand?: boolean;
  /**
   * A text-anchored table raised above its anchor that leaves no text passage beside it. Like a
   * page-framed band it moves the earlier lines it covers on its page below it. Its own position
   * leaves out that move, so it does not chase its anchor.
   */
  readonly reachesEarlierLines?: boolean;
  /**
   * A text-anchored table, beside which text passes, whose band rises above its anchor top: a
   * negative `w:tblpY`, or a `w:topFromText` larger than the offset. The earlier lines on its page
   * that the band crosses wrap beside it. Its own position leaves out the lines that wrap adds
   * (`tableWrapShares` in `paragraph-drawing-wrap.ts`), so it does not chase its anchor.
   */
  readonly wrapsEarlierLines?: boolean;
  /** A later part of a floating table that breaks across pages, not the part placed first. */
  readonly continuedTablePart?: boolean;
  readonly sourceOrder: number;
  readonly paintLayer: DrawingPaintLayer;
  readonly relativeHeight: number;
  readonly allowOverlap: boolean;
  /** Owning column index in a multi-column section — 0 for single-column and HF stories. */
  readonly columnIndex: number;
  /** Resolved top edge in page-content coordinates after overlap displacement. */
  readonly y: number;
  readonly verticalBand: LayoutBox;
  readonly input: WrapExclusionInput;
}

export interface ExclusionColumnLayout {
  readonly columnCount: number;
  readonly columnGapPt: number;
  readonly contentWidth: number;
  readonly columnLefts?: readonly number[];
  readonly columnWidths?: readonly number[];
}

/** Column that owns an anchored drawing's horizontal center in a multi-column section. */
export function columnIndexForDrawing(
  drawing: Pick<AnchoredDrawingRecord, 'x' | 'width'>,
  layout: ExclusionColumnLayout
): number {
  const count = Math.max(1, layout.columnCount);
  if (count <= 1) return 0;
  const centerX = drawing.x + drawing.width / 2;
  if (layout.columnLefts && layout.columnWidths && layout.columnLefts.length === count) {
    for (let index = 0; index < count; index += 1) {
      const left = layout.columnLefts[index]!;
      const right = left + layout.columnWidths[index]!;
      if (centerX >= left - 0.001 && centerX < right + 0.001) return index;
    }
    return count - 1;
  }
  const gap = layout.columnGapPt;
  const columnWidth = (layout.contentWidth - gap * (count - 1)) / count;
  for (let index = 0; index < count; index += 1) {
    const left = index * (columnWidth + gap);
    const right = left + columnWidth;
    if (centerX >= left - 0.001 && centerX < right + 0.001) return index;
  }
  return count - 1;
}

export function wrapProducesExclusion(wrap: ImageWrapTarget): boolean {
  return wrap !== 'inline' && wrap !== 'behind' && wrap !== 'inFront';
}

function exclusionModeFromWrap(wrap: ImageWrapTarget): WrapExclusionInput['mode'] | null {
  switch (wrap) {
    case 'inline':
    case 'behind':
    case 'inFront':
      return null;
    case 'square':
    case 'squareLeft':
    case 'squareRight':
      return 'square';
    case 'tight':
      return 'tight';
    case 'through':
      return 'through';
    case 'topAndBottom':
      return 'topAndBottom';
    default:
      return null;
  }
}

export function wrapExclusionInputForProjection(options: {
  readonly projection: DrawingProjection;
  readonly geometry: DrawingGeometry;
  readonly contentLeft: number;
  readonly contentRight: number;
  readonly anchorX: number;
  readonly anchorY: number;
}): WrapExclusionInput | null {
  const mode = exclusionModeFromWrap(options.projection.wrap);
  if (!mode || !options.projection.wrapGeometry) return null;
  const wrap = options.projection.wrapGeometry;
  const box = {
    x: options.anchorX,
    y: options.anchorY,
    width: options.geometry.contentBounds.width,
    height: options.geometry.contentBounds.height,
  };
  // A turned legacy text box keeps text off both its box and the box turned about its centre.
  const turn = options.projection.textboxStory?.legacyFrame?.rotationDegrees ?? 0;
  const contentBounds = Object.freeze(turn ? turnedWrapBox(box, turn, wrap.distancesEmu) : box);
  return wrapExclusionFromProjection({
    mode,
    contentBounds,
    geometry: options.geometry,
    wrapDistancesEmu: wrap.distancesEmu,
    polygonEmu: wrap.polygon,
    crop: options.projection.picture?.crop ?? { left: 0, top: 0, right: 0, bottom: 0 },
    transform: options.projection.picture?.transform ?? {
      rotationDegrees: 0,
      flipHorizontal: false,
      flipVertical: false,
      offsetEmu: { x: 0, y: 0 },
      extentEmu: { cx: 0, cy: 0 },
    },
    extentWidthPt: options.geometry.contentBounds.width,
    extentHeightPt: options.geometry.contentBounds.height,
    // The wrap element's own `wrapText`: the menu target has no `largest`, which keeps text on
    // the wider side of the float only.
    textSide: wrap.textSide,
    contentLeft: options.contentLeft,
    contentRight: options.contentRight,
  });
}

export function verticalBandOfExclusion(input: WrapExclusionInput): LayoutBox {
  if (input.mode === 'topAndBottom' || input.mode === 'square') {
    return squareExclusionBounds(input.contentBounds, input.effectInsets, input.wrapDistances);
  }
  const ys = [input.contentBounds.y, input.contentBounds.y + input.contentBounds.height];
  if (input.polygon) {
    for (const point of input.polygon) ys.push(point.y);
  }
  const top = Math.min(...ys) - input.effectInsets.top - input.wrapDistances.top;
  const bottom = Math.max(...ys) + input.effectInsets.bottom + input.wrapDistances.bottom;
  return Object.freeze({
    x: input.contentLeft,
    y: top,
    width: Math.max(0, input.contentRight - input.contentLeft),
    height: Math.max(0, bottom - top),
  });
}

/** Vertical frames whose resolved origin does not depend on where the anchor flows. */
export function pageFramedVertically(frame: AnchoredDrawingRecord['verticalFrame']): boolean {
  return frame !== 'paragraph' && frame !== 'line';
}

export function exclusionZoneFromAnchoredDrawing(options: {
  readonly drawing: AnchoredDrawingRecord;
  readonly projection: DrawingProjection;
  readonly sourceOrder: number;
  readonly contentLeft: number;
  readonly contentRight: number;
  readonly columnIndex?: number;
  readonly yOverride?: number;
}): ExclusionZone | null {
  // `behindDoc` controls the paint layer. The wrap target controls text exclusion and
  // already maps `wrapNone` to `behind` or `inFront`.
  if (!wrapProducesExclusion(options.drawing.wrap)) return null;
  const y = options.yOverride ?? options.drawing.y;
  const input = wrapExclusionInputForProjection({
    projection: options.projection,
    geometry: options.drawing.geometry,
    contentLeft: options.contentLeft,
    contentRight: options.contentRight,
    anchorX: options.drawing.x,
    anchorY: y,
  });
  if (!input) return null;
  return Object.freeze({
    drawingNodeId: options.drawing.drawingNodeId,
    anchorParagraphId: options.drawing.anchorParagraphId,
    anchorModelStart: options.drawing.start,
    ...(pageFramedVertically(options.drawing.verticalFrame) ? { pageFramedBand: true } : {}),
    sourceOrder: options.sourceOrder,
    paintLayer: paintLayerOf(options.drawing),
    relativeHeight: options.drawing.relativeHeight,
    allowOverlap: options.drawing.allowOverlap,
    columnIndex: options.columnIndex ?? 0,
    y,
    verticalBand: verticalBandOfExclusion(input),
    input,
  });
}

export function mergeAvailableIntervalsAtY(
  y: number,
  zones: readonly ExclusionZone[],
  contentLeft: number,
  contentRight: number,
  lineHeight = 0
): readonly ScanlineInterval[] {
  let available: ScanlineInterval[] = [{ start: contentLeft, end: contentRight }];
  let wrapsTable = false;
  for (const zone of zones) {
    const band = zone.verticalBand;
    // Rectangular wrapping excludes the whole glyph band, including objects whose top
    // lies below the line's top scanline. Polygon wrapping retains its contour probe.
    const rectangular = zone.input.mode === 'square' && lineHeight > 0;
    if (y >= band.y + band.height || (rectangular ? y + lineHeight <= band.y + 0.001 : y < band.y))
      continue;
    const probeY = rectangular ? Math.max(y, band.y) : y;
    const atY = availableTextIntervalsOnScanline(probeY, zone.input);
    if (
      zone.sourceKind === 'table' &&
      !atY.some((interval) => interval.start <= contentLeft && interval.end >= contentRight)
    )
      wrapsTable = true;
    const next: ScanlineInterval[] = [];
    for (const base of available) {
      for (const clip of atY) {
        const start = Math.max(base.start, clip.start);
        const end = Math.min(base.end, clip.end);
        if (end > start + 0.000_001) next.push(Object.freeze({ start, end }));
      }
    }
    available = next;
    if (available.length === 0) break;
  }
  // Word leaves passages of a quarter inch or less beside floating tables empty,
  // even when individual letters fit. Apply this after all exclusions intersect,
  // so a second float cannot reduce an admitted passage to a column of letters.
  if (wrapsTable)
    available = available.filter(
      (interval) => interval.end - interval.start > TABLE_WRAP_MIN_PASSAGE_PT + 0.001
    );
  return Object.freeze(available);
}

export function remainingWidthAtX(x: number, intervals: readonly ScanlineInterval[]): number {
  for (const interval of intervals) {
    if (x >= interval.start - 0.000_001 && x < interval.end - 0.000_001) {
      return Math.max(0, interval.end - x);
    }
  }
  return 0;
}

/** First text passage whose right edge is strictly past `x`. */
export function firstAvailableIntervalAtOrAfter(
  x: number,
  intervals: readonly ScanlineInterval[]
): ScanlineInterval | null {
  for (const interval of intervals) {
    if (interval.end > x + 0.000_001) return interval;
  }
  return null;
}

/** Snap `x` forward to the start of the first available passage at/after `x`. */
export function snapXToAvailableInterval(
  x: number,
  intervals: readonly ScanlineInterval[]
): { readonly x: number; readonly available: number } | null {
  const interval = firstAvailableIntervalAtOrAfter(x, intervals);
  if (!interval) return null;
  const snapped = Math.max(x, interval.start);
  const available = interval.end - snapped;
  if (available <= 0.001) return null;
  return Object.freeze({ x: snapped, available });
}

function shiftWrapInput(input: WrapExclusionInput, dx: number, dy: number): WrapExclusionInput {
  const bounds = input.contentBounds;
  return Object.freeze({
    ...input,
    contentBounds: Object.freeze({
      ...bounds,
      x: bounds.x + dx,
      y: bounds.y + dy,
    }),
    contentLeft: input.contentLeft + dx,
    contentRight: input.contentRight + dx,
    ...(input.polygon
      ? {
          polygon: input.polygon.map((point) =>
            Object.freeze({ x: point.x + dx, y: point.y + dy })
          ),
        }
      : {}),
    ...(input.clipPolygon
      ? {
          clipPolygon: input.clipPolygon.map((point) =>
            Object.freeze({ x: point.x + dx, y: point.y + dy })
          ),
        }
      : {}),
  });
}

export function withAnchoredDrawingLayoutFallback(
  drawing: AnchoredDrawingRecord,
  layoutFallback: AnchoredDrawingLayoutFallback
): AnchoredDrawingRecord {
  return Object.freeze({ ...drawing, layoutFallback });
}

/** Shift page-content exclusion zones into a cell-local coordinate space. */
export function localizeExclusionZones(
  zones: readonly ExclusionZone[],
  originX: number,
  originY: number,
  contentClip?: { readonly left: number; readonly right: number }
): readonly ExclusionZone[] {
  if (zones.length === 0) return zones;
  return Object.freeze(
    zones.map((zone) => {
      const band = zone.verticalBand;
      const input = zone.input;
      return Object.freeze({
        ...zone,
        y: zone.y - originY,
        verticalBand: Object.freeze({
          ...band,
          x: band.x - originX,
          y: band.y - originY,
        }),
        input: Object.freeze({
          ...shiftWrapInput(input, -originX, -originY),
          contentLeft: contentClip?.left ?? input.contentLeft - originX,
          contentRight: contentClip?.right ?? input.contentRight - originX,
        }),
      });
    })
  );
}

/** Keep only zones whose anchor paragraph is at or before `paragraphOrder` in document order. */
export function filterExclusionZonesForParagraphOrder(
  zones: readonly ExclusionZone[],
  paragraphOrder: number,
  orderOfParagraph: (paragraphId: string) => number | undefined
): readonly ExclusionZone[] {
  return Object.freeze(
    zones.filter((zone) => {
      if (zone.sourceKind === 'furniture' || zone.earlierSection) return true;
      const anchorOrder = orderOfParagraph(zone.anchorParagraphId);
      if (anchorOrder === undefined) return zone.sourceOrder <= paragraphOrder;
      return anchorOrder <= paragraphOrder;
    })
  );
}

/**
 * Placed projections per layouter. Break synthesizes a paragraph's zones once per line, and
 * one layouter serves one layout pass, so the unwrapped story lays out once per drawing.
 */
const placedByLayouter = new WeakMap<
  TextboxStoryLayouter,
  WeakMap<DrawingProjection, DrawingProjection>
>();

export function placedTextboxProjection(
  projection: DrawingProjection,
  layoutTextboxStory: TextboxStoryLayouter | undefined
): DrawingProjection {
  // A story that sizes its box, unwrapped or fitted to its text, sizes the exclusion too.
  const story = projection.textboxStory;
  if (!(story?.noWrap || story?.fitHeightToText) || !layoutTextboxStory) return projection;
  let placed = placedByLayouter.get(layoutTextboxStory);
  if (!placed) {
    placed = new WeakMap();
    placedByLayouter.set(layoutTextboxStory, placed);
  }
  let result = placed.get(projection);
  if (!result) {
    result = textboxPlacementProjection(projection, layoutTextboxStory(projection));
    placed.set(projection, result);
  }
  return result;
}

/** Paragraph-local square/tight/through zones synthesized during break. */
export function synthesizeParagraphWrapExclusionZones(options: {
  readonly frameBase?: BodyAnchorFrameBase;
  readonly paragraph: OoxmlNode;
  readonly paragraphId: string;
  readonly drawingLayout: InlineDrawingLayoutContext;
  readonly contentLeft: number;
  readonly contentRight: number;
  readonly paragraphStartY: number;
  readonly anchorLineTopByModelStart: ReadonlyMap<number, number>;
  readonly sourceOrderOf?: (drawingNodeId: string) => number | undefined;
  readonly anchorCellBox?: LayoutBox | null;
  /** With {@link anchorCellBox}: what decides the cell's anchors' `layoutInCell`. */
  readonly cellAnchorScope?: CellAnchorScope;
  /** Which revisions this pass resolves away — see {@link publishAnchoredDrawingsForParagraph}. */
  readonly displayMode?: RevisionDisplayMode;
  readonly revisionAuthorFilter?: RevisionAuthorFilter;
  /** Lays out a text box story, so an unwrapped box carves the width its text gives it. */
  readonly layoutTextboxStory?: TextboxStoryLayouter;
}): readonly ExclusionZone[] {
  const atoms = anchoredDrawingAtomsInParagraph(options.paragraph, options.drawingLayout);
  if (atoms.length === 0) return Object.freeze([]);
  const offsets = drawingModelOffsetsInParagraph(options.paragraph);
  const displayMode = options.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE;
  const zones: ExclusionZone[] = [];
  for (const atom of atoms) {
    // A drawing the display mode resolves away publishes no record, so it must carve no
    // hole either: the original view must not wrap text around an insertion it hides.
    if (
      !revisionsVisible(atom.revisions, displayMode, options.revisionAuthorFilter) ||
      revisionMarkupHidesDrawing(atom.revisions, displayMode, options.revisionAuthorFilter)
    )
      continue;
    if (anchoredOutOfCell(atom.projection, options)) continue;
    if (!wrapProducesExclusion(atom.projection.wrap) || atom.projection.wrap === 'topAndBottom')
      continue;
    const modelStart = offsets.get(atom.atomId);
    if (modelStart === undefined) continue;
    const lineTop = options.anchorLineTopByModelStart.get(modelStart);
    if (lineTop === undefined) continue;
    const projection = placedTextboxProjection(atom.projection, options.layoutTextboxStory);
    const resolved = resolveParagraphAnchorPosition(projection, {
      ...(options.frameBase ? { frameBase: options.frameBase } : {}),
      contentLeft: options.contentLeft,
      contentRight: options.contentRight,
      lineY: options.frameBase ? options.paragraphStartY + lineTop : lineTop,
      ownerPartName: options.drawingLayout.ownerPartName,
      cellBox: options.anchorCellBox ?? null,
    });
    const anchorY = options.frameBase ? resolved.y : options.paragraphStartY + lineTop;
    const measure = measureInlineDrawing(projection);
    const geometry = drawingGeometryFromProjection({
      projection,
      anchorX: resolved.x,
      anchorY,
      extentWidth: measure.width,
      extentHeight: measure.height,
    });
    const input = wrapExclusionInputForProjection({
      projection,
      geometry,
      contentLeft: options.contentLeft,
      contentRight: options.contentRight,
      anchorX: resolved.x,
      anchorY,
    });
    if (!input) continue;
    zones.push(
      Object.freeze({
        drawingNodeId: atom.atomId,
        anchorParagraphId: options.paragraphId,
        anchorModelStart: modelStart,
        sourceOrder:
          options.sourceOrderOf?.(atom.projection.drawingNodeId) ?? Number.MAX_SAFE_INTEGER,
        paintLayer: atom.projection.anchor?.behindDocument
          ? ('behind' as const)
          : ('inFront' as const),
        relativeHeight: atom.projection.anchor?.relativeHeight ?? 0,
        allowOverlap: atom.projection.anchor?.allowOverlap ?? true,
        columnIndex: 0,
        y: anchorY,
        verticalBand: verticalBandOfExclusion(input),
        input,
      })
    );
  }
  zones.sort((left, right) => left.sourceOrder - right.sourceOrder);
  return Object.freeze(zones);
}

/** Paragraph-local topAndBottom zones synthesized during break (stable across reflow passes). */
export function synthesizeParagraphTopAndBottomZones(options: {
  readonly paragraph: OoxmlNode;
  readonly paragraphId: string;
  readonly drawingLayout: InlineDrawingLayoutContext;
  readonly contentLeft: number;
  readonly contentRight: number;
  readonly paragraphStartY: number;
  readonly anchorLineTopByModelStart: ReadonlyMap<number, number>;
  readonly sourceOrderOf?: (drawingNodeId: string) => number | undefined;
  readonly columnIndex?: number;
  /** Set inside a table cell; with the scope, drops the anchors Word lays out off the cell. */
  readonly anchorCellBox?: LayoutBox | null;
  readonly cellAnchorScope?: CellAnchorScope;
  /** Which revisions this pass resolves away — see {@link publishAnchoredDrawingsForParagraph}. */
  readonly displayMode?: RevisionDisplayMode;
  readonly revisionAuthorFilter?: RevisionAuthorFilter;
  /** The body page's frames, which place a page- or margin-framed band at its own position. */
  readonly frameBase?: BodyAnchorFrameBase;
}): readonly ExclusionZone[] {
  const atoms = anchoredDrawingAtomsInParagraph(options.paragraph, options.drawingLayout);
  if (atoms.length === 0) return Object.freeze([]);
  const offsets = drawingModelOffsetsInParagraph(options.paragraph);
  const displayMode = options.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE;
  const zones: ExclusionZone[] = [];
  for (const atom of atoms) {
    // Same rule as the wrap zones above: no record, no hole.
    if (
      !revisionsVisible(atom.revisions, displayMode, options.revisionAuthorFilter) ||
      revisionMarkupHidesDrawing(atom.revisions, displayMode, options.revisionAuthorFilter)
    )
      continue;
    if (atom.projection.wrap !== 'topAndBottom') continue;
    // The table's rows move below this out-of-cell float instead of the cell text.
    if (
      options.cellAnchorScope?.rowsClearOutOfCellFloats &&
      anchoredOutOfCell(atom.projection, options)
    )
      continue;
    const modelStart = offsets.get(atom.atomId);
    if (modelStart === undefined) continue;
    const lineTop = options.anchorLineTopByModelStart.get(modelStart);
    if (lineTop === undefined) continue;
    const pageFramed = pageFramedBandY(atom.projection, options);
    const paragraphY = options.paragraphStartY;
    const vertical = atom.projection.position?.vertical ?? null;
    const authoredY = topAndBottomBandAnchorY(paragraphY + lineTop, vertical, paragraphY);
    const anchorY = pageFramed ?? paragraphBandTop(authoredY, atom.projection, options);
    const measure = measureInlineDrawing(atom.projection);
    const geometry = drawingGeometryFromProjection({
      projection: atom.projection,
      anchorX: options.contentLeft,
      anchorY,
      extentWidth: measure.width,
      extentHeight: measure.height,
    });
    const input = wrapExclusionInputForProjection({
      projection: atom.projection,
      geometry,
      contentLeft: options.contentLeft,
      contentRight: options.contentRight,
      anchorX: options.contentLeft,
      anchorY,
    });
    if (!input) continue;
    zones.push(
      Object.freeze({
        drawingNodeId: atom.atomId,
        anchorParagraphId: options.paragraphId,
        anchorModelStart: modelStart,
        sourceOrder:
          options.sourceOrderOf?.(atom.projection.drawingNodeId) ?? Number.MAX_SAFE_INTEGER,
        paintLayer: atom.projection.anchor?.behindDocument
          ? ('behind' as const)
          : ('inFront' as const),
        relativeHeight: atom.projection.anchor?.relativeHeight ?? 0,
        allowOverlap: atom.projection.anchor?.allowOverlap ?? true,
        columnIndex: options.columnIndex ?? 0,
        ...(pageFramed !== null ? { pageFramedBand: true } : {}),
        y: anchorY,
        verticalBand: verticalBandOfExclusion(input),
        input,
      })
    );
  }
  zones.sort((left, right) => left.sourceOrder - right.sourceOrder);
  return Object.freeze(zones);
}

/**
 * Page-content y of a body band that the page or a margin positions: where the drawing is
 * placed on the page, whatever line holds its anchor. Null for a band that its anchor's flow
 * positions, and when the caller has no page frames.
 */
function pageFramedBandY(
  projection: DrawingProjection,
  options: {
    readonly frameBase?: BodyAnchorFrameBase;
    readonly contentLeft: number;
    readonly contentRight: number;
    readonly anchorCellBox?: LayoutBox | null;
    readonly cellAnchorScope?: CellAnchorScope;
  }
): number | null {
  const vertical = projection.position?.vertical;
  if (!options.frameBase || !vertical) return null;
  // Header paragraphs use cell flow, but their top-margin bands use the sheet origin.
  const headerTopMargin =
    options.frameBase.storyKind === 'header' &&
    options.cellAnchorScope?.inTableCell === false &&
    vertical.relativeFrom === 'topMargin';
  if (options.anchorCellBox != null && !headerTopMargin) return null;
  if (!pageFramedVertically(vertical.relativeFrom) || projection.anchor?.simplePos) return null;
  const box = Object.freeze({
    x: options.contentLeft,
    y: 0,
    width: Math.max(1, options.contentRight - options.contentLeft),
    height: 0,
  });
  const resolved = resolveAnchoredDrawingPosition(projection, {
    ...options.frameBase,
    paragraphBox: box,
    anchorLineBox: box,
    anchorCharacterX: options.contentLeft,
    columnBox: box,
    cellBox: null,
    layoutInCell: false,
  });
  return resolved.layoutFallback ? null : resolved.y;
}

function intervalToken(intervals: readonly ScanlineInterval[]): string {
  return intervals
    .map((interval) => `${interval.start.toFixed(3)}-${interval.end.toFixed(3)}`)
    .join(',');
}

function wrapInputToken(input: WrapExclusionInput): string {
  const bounds = input.contentBounds;
  const distances = input.wrapDistances;
  const effects = input.effectInsets;
  const polygon =
    input.polygon?.map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`).join(';') ?? '';
  const clip =
    input.clipPolygon?.map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`).join(';') ??
    '';
  return [
    input.mode,
    input.textSide,
    bounds.x.toFixed(3),
    bounds.y.toFixed(3),
    bounds.width.toFixed(3),
    bounds.height.toFixed(3),
    distances.top.toFixed(3),
    distances.right.toFixed(3),
    distances.bottom.toFixed(3),
    distances.left.toFixed(3),
    effects.top.toFixed(3),
    effects.right.toFixed(3),
    effects.bottom.toFixed(3),
    effects.left.toFixed(3),
    polygon,
    clip,
  ].join(':');
}

/**
 * A token for the zones a break sees. `regionBottomY`, when given, joins it: an opening line
 * that would clear its own float past the region bottom keeps to the passages beside it.
 */
export function exclusionLayoutToken(
  zones: readonly ExclusionZone[],
  regionBottomY?: number
): string {
  if (zones.length === 0) return '';
  const token = zones
    .map((zone) => {
      const band = zone.verticalBand;
      const probeY = zone.y + zone.input.contentBounds.height / 2;
      const intervals = mergeAvailableIntervalsAtY(
        probeY,
        [zone],
        zone.input.contentLeft,
        zone.input.contentRight
      );
      return [
        exclusionZoneIdentity(zone),
        `${zone.sourceKind ?? ''}${zone.earlierSection ? '+earlier' : ''}`,
        String(zone.sourceOrder),
        String(zone.columnIndex),
        zone.y.toFixed(3),
        band.x.toFixed(3),
        band.y.toFixed(3),
        band.width.toFixed(3),
        band.height.toFixed(3),
        wrapInputToken(zone.input),
        intervalToken(intervals),
      ].join('|');
    })
    .join('\n');
  return regionBottomY === undefined ? token : `${token}\nbottom:${regionBottomY.toFixed(3)}`;
}

export function paintLayerRecords(
  drawings: readonly AnchoredDrawingRecord[]
): readonly { readonly layer: DrawingPaintLayer; readonly drawing: AnchoredDrawingRecord }[] {
  return Object.freeze(
    sortDrawingsForPaint(drawings).map((drawing) =>
      Object.freeze({ layer: paintLayerOf(drawing), drawing })
    )
  );
}

export function collectExclusionZonesFromDrawings(
  drawings: readonly AnchoredDrawingRecord[],
  drawingLayout: import('./drawing-layout.ts').InlineDrawingLayoutContext,
  contentLeft: number,
  contentRight: number,
  sourceOrderOf?: (drawingNodeId: string) => number | undefined,
  columnLayout?: ExclusionColumnLayout
): readonly ExclusionZone[] {
  const zones: ExclusionZone[] = [];
  for (const drawing of drawings) {
    const projection = drawingLayout.projectionForAtom?.(drawing.drawingNodeId);
    if (!projection) continue;
    const sourceOrder =
      drawing.sourceOrder ?? sourceOrderOf?.(drawing.drawingNodeId) ?? Number.MAX_SAFE_INTEGER;
    const columnIndex =
      columnLayout !== undefined ? columnIndexForDrawing(drawing, columnLayout) : 0;
    const zone = exclusionZoneFromAnchoredDrawing({
      drawing,
      projection,
      sourceOrder,
      contentLeft,
      contentRight,
      columnIndex,
    });
    if (zone) zones.push(zone);
  }
  zones.sort((left, right) => left.sourceOrder - right.sourceOrder);
  return Object.freeze(zones);
}

export function collectExclusionZonesByPage(
  pages: readonly import('./semantic-records.ts').PageRecord[],
  drawingLayout: import('./drawing-layout.ts').InlineDrawingLayoutContext,
  contentWidth: number,
  sourceOrderOf?: (drawingNodeId: string) => number | undefined,
  columnLayout?: ExclusionColumnLayout
): ReadonlyMap<number, readonly ExclusionZone[]> {
  exclusionZoneCollectionObserver?.(drawingLayout);
  const layout: ExclusionColumnLayout =
    columnLayout ?? Object.freeze({ columnCount: 1, columnGapPt: 0, contentWidth });
  const out = new Map<number, readonly ExclusionZone[]>();
  for (const page of pages) {
    const drawings = page.anchoredDrawings ?? [];
    const zones = collectExclusionZonesFromDrawings(
      drawings,
      drawingLayout,
      0,
      contentWidth,
      sourceOrderOf,
      layout
    );
    if (zones.length > 0) out.set(page.index, zones);
  }
  return out;
}

type ExclusionZoneCollectionObserver = (
  drawingLayout: import('./drawing-layout.ts').InlineDrawingLayoutContext
) => void;

let exclusionZoneCollectionObserver: ExclusionZoneCollectionObserver | null = null;

/**
 * Install a scoped observer called once before each zone-map collection.
 * Test-only: inactive by default, and disposal restores the prior observer for safe nesting.
 * @internal
 */
export function observeExclusionZoneCollectionsForTest(
  observer: ExclusionZoneCollectionObserver
): () => void {
  const previous = exclusionZoneCollectionObserver;
  exclusionZoneCollectionObserver = observer;
  return () => {
    if (exclusionZoneCollectionObserver === observer) exclusionZoneCollectionObserver = previous;
  };
}

/**
 * Zone maps memoized on the pages array plus every input that can move a zone.
 *
 * The wrap-exclusion wrapper collects zones from each section's PREVIOUS pages before every
 * pass, and a multi-section document runs that wrapper once per section per keystroke — for
 * unchanged sections the pages array comes back by identity, so the collection is a replay.
 * The column layout is a fresh object per call, so it keys by content, not identity.
 */
interface ExclusionZonesMemoEntry {
  readonly drawingLayout: import('./drawing-layout.ts').InlineDrawingLayoutContext;
  readonly drawingLayoutEpoch: string | undefined;
  readonly contentWidth: number;
  readonly drawingSourceOrder: ReadonlyMap<string, number> | undefined;
  readonly columnToken: string;
  readonly zones: ReadonlyMap<number, readonly ExclusionZone[]>;
}

const exclusionZonesByPageMemos = new WeakMap<
  readonly import('./semantic-records.ts').PageRecord[],
  ExclusionZonesMemoEntry
>();

function columnLayoutToken(layout: ExclusionColumnLayout | undefined): string {
  if (!layout) return '';
  return `${layout.columnCount};${layout.columnGapPt};${layout.contentWidth};${(layout.columnLefts ?? []).join(',')};${(layout.columnWidths ?? []).join(',')}`;
}

export function collectExclusionZonesByPageMemoized(
  pages: readonly import('./semantic-records.ts').PageRecord[],
  drawingLayout: import('./drawing-layout.ts').InlineDrawingLayoutContext,
  /** Projection epoch of the owning part — the context object keeps identity across it. */
  drawingLayoutEpoch: string | undefined,
  contentWidth: number,
  // The source-order LOOKUP is derived here from the keyed map, never passed in: a caller-
  // supplied closure could disagree with the map the memo keys on, and the key could not see
  // it — warm passes would then serve zones computed under a different drawing order.
  drawingSourceOrder: ReadonlyMap<string, number> | undefined,
  columnLayout?: ExclusionColumnLayout
): ReadonlyMap<number, readonly ExclusionZone[]> {
  const columnToken = columnLayoutToken(columnLayout);
  const cached = exclusionZonesByPageMemos.get(pages);
  if (
    cached &&
    cached.drawingLayout === drawingLayout &&
    cached.drawingLayoutEpoch === drawingLayoutEpoch &&
    cached.contentWidth === contentWidth &&
    cached.drawingSourceOrder === drawingSourceOrder &&
    cached.columnToken === columnToken
  ) {
    return cached.zones;
  }
  const zones = collectExclusionZonesByPage(
    pages,
    drawingLayout,
    contentWidth,
    drawingSourceOrder
      ? (drawingNodeId: string) => {
          const projectedId =
            drawingLayout.projectionForAtom?.(drawingNodeId)?.drawingNodeId ?? drawingNodeId;
          return drawingSourceOrder.get(projectedId);
        }
      : undefined,
    columnLayout
  );
  exclusionZonesByPageMemos.set(pages, {
    drawingLayout,
    drawingLayoutEpoch,
    contentWidth,
    drawingSourceOrder,
    columnToken,
    zones,
  });
  return zones;
}

export function exclusionMapsEqual(
  left: ReadonlyMap<number, readonly ExclusionZone[]>,
  right: ReadonlyMap<number, readonly ExclusionZone[]>
): boolean {
  if (left.size !== right.size) return false;
  for (const [page, zones] of left) {
    const other = right.get(page);
    if (!other || exclusionLayoutToken(zones) !== exclusionLayoutToken(other)) return false;
  }
  return true;
}

/** Stable serialization of every page's exclusion zones — used for reflow cycle detection. */
export function exclusionMapsToken(
  zonesByPage: ReadonlyMap<number, readonly ExclusionZone[]>
): string {
  if (zonesByPage.size === 0) return '';
  return [...zonesByPage.entries()]
    .sort(([leftPage], [rightPage]) => leftPage - rightPage)
    .map(([page, zones]) => `${page}:${exclusionLayoutToken(zones)}`)
    .join('\n');
}
