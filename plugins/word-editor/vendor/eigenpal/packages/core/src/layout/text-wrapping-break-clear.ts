// Restart location of text wrapping breaks: `w:br w:clear` (ECMA-376 §17.3.3.1, §17.18.3).
//
// A line break with `w:clear` resumes its text on the next line that the floating objects on
// the named side do not interrupt. `none`, an absent value, and page or column breaks lay out as
// ordinary breaks. The attribute stays in the tree either way, so saving keeps it.

import type { BodyAnchorFrameBase } from './body-flow-helpers.ts';
import { resolveParagraphAnchorPosition } from './paragraph-anchor-position.ts';
import {
  WML_NAMESPACE_URI,
  hardBreakKind,
  type HardBreakKind,
  type OoxmlHardBreakNode,
} from '@docx-editor.dev/core/store';
import {
  exclusionZoneIdentity,
  mergeAvailableIntervalsAtY,
  snapXToAvailableInterval,
  verticalBandOfExclusion,
  wrapExclusionInputForProjection,
  type ExclusionZone,
} from './drawing-exclusion.ts';
import {
  anchoredDrawingAtomsInParagraph,
  drawingModelOffsetsInParagraph,
  emuToPointsSafe,
  measureInlineDrawing,
  type InlineDrawingLayoutContext,
} from './drawing-layout.ts';
import { drawingGeometryFromProjection } from './drawing-geometry.ts';
import { revisionMarkupHidesDrawing } from './revision-markup-projection.ts';
import {
  revisionsVisible,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';
import type { OoxmlNode } from '@docx-editor.dev/core/store';

/** The floating objects a text wrapping break restarts below. */
export type TextWrappingBreakClear = 'left' | 'right' | 'all';

const EPSILON = 0.001;

/** The `w:clear` side of a line break, or undefined for an ordinary break. */
export function textWrappingBreakClearOf(
  node: OoxmlHardBreakNode
): TextWrappingBreakClear | undefined {
  // `w:cr` has no `w:clear`, and a page or column break ignores it.
  if (node.localName !== 'br' || hardBreakKind(node) !== 'line') return undefined;
  for (const attribute of node.attributes) {
    if (attribute.namespaceUri !== WML_NAMESPACE_URI || attribute.localName !== 'clear') continue;
    const value = attribute.value;
    return value === 'left' || value === 'right' || value === 'all' ? value : undefined;
  }
  return undefined;
}

/** Whether a paragraph holds a line break that clears floating objects. */
export function holdsClearingBreak(paragraph: OoxmlNode): boolean {
  const stack: OoxmlNode[] = [paragraph];
  // Bounded by the tree's own node count; every node is visited once.
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.kind === 'hardBreak') {
      if (textWrappingBreakClearOf(node)) return true;
      continue;
    }
    if ('children' in node) for (const child of node.children) stack.push(child);
  }
  return false;
}

/** Break fields a layout piece carries for a typed `w:br` / `w:cr`. */
export function hardBreakPieceFields(node: OoxmlHardBreakNode): {
  readonly breakKind: HardBreakKind;
  readonly breakClear?: TextWrappingBreakClear;
} {
  const breakClear = textWrappingBreakClearOf(node);
  return { breakKind: hardBreakKind(node), ...(breakClear ? { breakClear } : {}) };
}

/** Copy the break fields of piece extras onto the piece they decorate. */
export function breakPieceFields(
  extras:
    { readonly breakKind?: HardBreakKind; readonly breakClear?: TextWrappingBreakClear } | undefined
): { readonly breakKind?: HardBreakKind; readonly breakClear?: TextWrappingBreakClear } {
  if (!extras?.breakKind) return {};
  return {
    breakKind: extras.breakKind,
    ...(extras.breakClear ? { breakClear: extras.breakClear } : {}),
  };
}

/** The line a break sits on: its band, its measure, and the pen where the break was placed. */
export interface BreakLineGeometry {
  readonly y: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
  readonly penX: number;
}

/** The parts of `[left, right]` one zone blocks on a line band. */
function blockedGaps(
  zone: ExclusionZone,
  at: BreakLineGeometry
): readonly { readonly start: number; readonly end: number }[] {
  const open = mergeAvailableIntervalsAtY(at.y, [zone], at.left, at.right, at.height);
  const gaps: { start: number; end: number }[] = [];
  let x = at.left;
  for (const interval of open) {
    if (interval.start > x + EPSILON) gaps.push({ start: x, end: interval.start });
    x = Math.max(x, interval.end);
  }
  if (at.right > x + EPSILON) gaps.push({ start: x, end: at.right });
  return gaps;
}

/**
 * The floating objects a break clears, chosen on the line that holds the break.
 *
 * `all` takes every zone. A float is on the left when it blocks the start of the break line,
 * and on the right when it blocks the line after the pen. A float the break line does not meet
 * is on neither side.
 */
export function zonesClearedByBreak(
  clear: TextWrappingBreakClear,
  zones: readonly ExclusionZone[],
  at: BreakLineGeometry
): readonly ExclusionZone[] {
  if (clear === 'all' || zones.length === 0) return zones;
  const open = mergeAvailableIntervalsAtY(at.y, zones, at.left, at.right, at.height);
  const pen = snapXToAvailableInterval(at.penX, open)?.x ?? at.penX;
  return zones.filter((zone) =>
    blockedGaps(zone, at).some((gap) =>
      clear === 'left' ? gap.start <= at.left + EPSILON : gap.end > pen + EPSILON
    )
  );
}

/** Own clearing bands built without the sheet's frames, whose X is only a stand-in. */
const horizontallyUnresolved = new WeakSet<ExclusionZone>();

/** Give `copy`, such as a zone's mirror image, the horizontal resolution of `source`. */
export function carryHorizontalResolution(source: ExclusionZone, copy: ExclusionZone): void {
  if (horizontallyUnresolved.has(source)) horizontallyUnresolved.add(copy);
}

/** Choose the zones a break clears on its own line; the result picks them from a later list. */
export function breakClearSelector(
  clear: TextWrappingBreakClear,
  zones: readonly ExclusionZone[],
  at: BreakLineGeometry
): (current: readonly ExclusionZone[]) => readonly ExclusionZone[] {
  if (clear === 'all') return (current) => current;
  const ids = new Set(zonesClearedByBreak(clear, zones, at).map(exclusionZoneIdentity));
  return (current) =>
    ids.size === 0 ? [] : current.filter((zone) => ids.has(exclusionZoneIdentity(zone)));
}

/**
 * How far a line at `y` must move down so that no cleared zone meets its band of `height`.
 *
 * One pass over the zones in top order. A zone that meets the band at the current position
 * still meets it anywhere above its own bottom, so the line has to pass that bottom. A zone
 * that starts at or below the foot of the band cannot be met, and neither can any later one.
 * Only zones that block some part of `[left, right]` count.
 */
export function breakClearanceSkip(
  y: number,
  height: number,
  zones: readonly ExclusionZone[],
  left: number,
  right: number
): number {
  if (zones.length === 0 || !(right > left)) return 0;
  const band = Math.max(height, EPSILON);
  const crossing = zones
    .filter((zone) => {
      const box = zone.verticalBand;
      if (!(box.height > EPSILON)) return false;
      // A band whose X is not known counts on its vertical extent alone.
      if (horizontallyUnresolved.has(zone)) return true;
      const open = mergeAvailableIntervalsAtY(box.y, [zone], left, right, box.height);
      return !(
        open.length === 1 &&
        open[0]!.start <= left + EPSILON &&
        open[0]!.end >= right - EPSILON
      );
    })
    .sort((a, b) => a.verticalBand.y - b.verticalBand.y);
  let current = y;
  for (const zone of crossing) {
    if (zone.verticalBand.y >= current + band - EPSILON) break;
    const bottom = zone.verticalBand.y + zone.verticalBand.height;
    if (bottom > current + EPSILON) current = bottom;
  }
  return current - y;
}

/**
 * Bands of the paragraph's own floats that are placed from the paragraph's top
 * (`wp:positionV relativeFrom="paragraph"` with an offset), measured from `paragraphTop`.
 *
 * The page's zones hold a float where an earlier pass placed its paragraph. When the paragraph
 * moves to another page or column, those zones are missing, and a clearing break would restart
 * on the picture. These bands move with the paragraph. With the sheet's frames the band takes
 * the float's resolved X. Without them it starts at `contentLeft`, so it clears whatever its
 * vertical band meets (see {@link breakClearanceSkip}) and is never used to wrap.
 */
export function ownParagraphFramedClearZones(options: {
  /** The sheet's frames. With them the band resolves its real X; without, see below. */
  readonly frameBase?: BodyAnchorFrameBase;
  readonly paragraph: OoxmlNode;
  readonly paragraphId: string;
  readonly drawingLayout: InlineDrawingLayoutContext;
  readonly contentLeft: number;
  readonly contentRight: number;
  readonly paragraphTop: number;
  readonly displayMode: RevisionDisplayMode;
  readonly revisionAuthorFilter?: RevisionAuthorFilter;
}): readonly ExclusionZone[] {
  const atoms = anchoredDrawingAtomsInParagraph(options.paragraph, options.drawingLayout);
  if (atoms.length === 0) return [];
  const offsets = drawingModelOffsetsInParagraph(options.paragraph);
  const zones: ExclusionZone[] = [];
  for (const atom of atoms) {
    const { projection } = atom;
    const vertical = projection.position?.vertical;
    if (
      !vertical ||
      vertical.relativeFrom !== 'paragraph' ||
      vertical.align !== null ||
      projection.anchor?.simplePos ||
      !revisionsVisible(atom.revisions, options.displayMode, options.revisionAuthorFilter) ||
      revisionMarkupHidesDrawing(atom.revisions, options.displayMode, options.revisionAuthorFilter)
    )
      continue;
    const modelStart = offsets.get(atom.atomId);
    const offset = emuToPointsSafe(vertical.offsetEmu ?? 0);
    if (modelStart === undefined || offset === null) continue;
    const anchorY = options.paragraphTop + offset;
    // The X the page zone for this float gets, so the band clears what that zone would.
    const anchorX = options.frameBase
      ? resolveParagraphAnchorPosition(projection, {
          frameBase: options.frameBase,
          contentLeft: options.contentLeft,
          contentRight: options.contentRight,
          lineY: options.paragraphTop,
          ownerPartName: options.drawingLayout.ownerPartName,
        }).x
      : options.contentLeft;
    const measure = measureInlineDrawing(projection);
    const geometry = drawingGeometryFromProjection({
      projection,
      anchorX,
      anchorY,
      extentWidth: measure.width,
      extentHeight: measure.height,
    });
    const input = wrapExclusionInputForProjection({
      projection,
      geometry,
      contentLeft: options.contentLeft,
      contentRight: options.contentRight,
      anchorX,
      anchorY,
    });
    if (!input) continue;
    const zone: ExclusionZone = Object.freeze({
      drawingNodeId: atom.atomId,
      anchorParagraphId: options.paragraphId,
      anchorModelStart: modelStart,
      sourceOrder: 0,
      paintLayer: projection.anchor?.behindDocument ? ('behind' as const) : ('inFront' as const),
      relativeHeight: projection.anchor?.relativeHeight ?? 0,
      allowOverlap: projection.anchor?.allowOverlap ?? true,
      columnIndex: 0,
      y: anchorY,
      verticalBand: verticalBandOfExclusion(input),
      input,
    });
    // Without the sheet's frames the X is the content edge, which is not where the float is.
    if (!options.frameBase) horizontallyUnresolved.add(zone);
    zones.push(zone);
  }
  return zones;
}

/** The page's zones, plus each own float in `own` that the page does not hold. */
export function withOwnClearZones(
  zones: readonly ExclusionZone[],
  own: readonly ExclusionZone[]
): readonly ExclusionZone[] {
  if (own.length === 0) return zones;
  const placed = new Set(zones.map(exclusionZoneIdentity));
  const missing = own.filter((zone) => !placed.has(exclusionZoneIdentity(zone)));
  return missing.length === 0 ? zones : [...zones, ...missing];
}
