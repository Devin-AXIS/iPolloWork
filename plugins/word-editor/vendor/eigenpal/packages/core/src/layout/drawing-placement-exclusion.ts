import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import {
  anchoredDrawingAtomsInParagraph,
  drawingModelOffsetsInParagraph,
} from './drawing-atom-walk.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import {
  pageFramedVertically,
  synthesizeParagraphTopAndBottomZones,
  type ExclusionZone,
} from './drawing-exclusion.ts';
import type { PendingLine } from './pending-line.ts';
import { holdsClearingBreak } from './text-wrapping-break-clear.ts';

// By context first, like `anyAnchorMemo`: whether an atom is anchored, and how it wraps, can
// depend on `projectionForAtom`.
const topAndBottomAnchorMemo = new WeakMap<
  InlineDrawingLayoutContext,
  WeakMap<OoxmlElement, boolean>
>();

/**
 * True when the paragraph anchors a `wrapTopAndBottom` drawing, or anchors a drawing and holds
 * a line break that clears floats. Its own band then depends on the paragraph's spacing before,
 * so the break cache must key that spacing.
 */
export function anchorsSpacingDependentBand(
  paragraph: OoxmlElement,
  context: InlineDrawingLayoutContext | undefined
): boolean {
  if (!context) return false;
  let byParagraph = topAndBottomAnchorMemo.get(context);
  if (!byParagraph) {
    byParagraph = new WeakMap();
    topAndBottomAnchorMemo.set(context, byParagraph);
  }
  let value = byParagraph.get(paragraph);
  if (value === undefined) {
    const atoms = anchoredDrawingAtomsInParagraph(paragraph, context);
    value =
      atoms.some((atom) => atom.projection.wrap === 'topAndBottom') ||
      (atoms.length > 0 && holdsClearingBreak(paragraph));
    byParagraph.set(paragraph, value);
  }
  return value;
}

/** What the break cache keys for a paragraph's own spacing-dependent band. */
export interface OwnBandKeyInputs {
  /** The paragraph synthesizes its own band during the break (see above). */
  readonly anchorsTopAndBottom: boolean;
  /**
   * The band sits at a fixed page position (a page- or margin-framed vertical frame), so the
   * lines around it depend on where the paragraph starts on the page.
   */
  readonly ownBandPageFramed: boolean;
  /**
   * The band sits at a fixed horizontal page position (a page- or margin-framed horizontal
   * frame, or `simplePos`), so its place in the content box moves with the page's margins,
   * which mirrored margins swap between odd and even pages.
   */
  readonly ownBandPageFramedHorizontally: boolean;
}

const NO_OWN_BAND: OwnBandKeyInputs = Object.freeze({
  anchorsTopAndBottom: false,
  ownBandPageFramed: false,
  ownBandPageFramedHorizontally: false,
});
/** Horizontal frames that move with the paragraph's column, not with the page. */
const COLUMN_FRAMES: ReadonlySet<string> = new Set(['column', 'character']);
// By context first, like `anyAnchorMemo`: whether an atom is anchored, and how it is framed,
// can depend on `projectionForAtom`.
const ownBandMemo = new WeakMap<
  InlineDrawingLayoutContext,
  WeakMap<OoxmlElement, OwnBandKeyInputs>
>();

/** The own-band inputs of a paragraph's break key; one frozen answer per paragraph node. */
export function ownBandKeyInputs(
  paragraph: OoxmlElement,
  context: InlineDrawingLayoutContext | undefined
): OwnBandKeyInputs {
  if (!context || !anchorsSpacingDependentBand(paragraph, context)) return NO_OWN_BAND;
  let byParagraph = ownBandMemo.get(context);
  if (!byParagraph) {
    byParagraph = new WeakMap();
    ownBandMemo.set(context, byParagraph);
  }
  let value = byParagraph.get(paragraph);
  if (value === undefined) {
    const atoms = anchoredDrawingAtomsInParagraph(paragraph, context);
    // `simplePos` places the drawing in page coordinates, so it is page-framed on both axes.
    const ownBandPageFramed = atoms.some((atom) => {
      if (atom.projection.anchor?.simplePos) return true;
      const vertical = atom.projection.position?.vertical;
      return !!vertical && pageFramedVertically(vertical.relativeFrom);
    });
    const ownBandPageFramedHorizontally = atoms.some((atom) => {
      if (atom.projection.anchor?.simplePos) return true;
      const horizontal = atom.projection.position?.horizontal;
      return !!horizontal && !COLUMN_FRAMES.has(horizontal.relativeFrom);
    });
    value = Object.freeze({
      anchorsTopAndBottom: true,
      ownBandPageFramed,
      ownBandPageFramedHorizontally,
    });
    byParagraph.set(paragraph, value);
  }
  return value;
}

// By context first: whether an atom is anchored can depend on `projectionForAtom`.
const anyAnchorMemo = new WeakMap<InlineDrawingLayoutContext, WeakMap<OoxmlElement, boolean>>();

/** True when the paragraph anchors any drawing, whose own band then moves with the paragraph. */
export function anchorsAnyDrawing(
  paragraph: OoxmlElement,
  context: InlineDrawingLayoutContext | undefined
): boolean {
  if (!context) return false;
  let byParagraph = anyAnchorMemo.get(context);
  if (!byParagraph) {
    byParagraph = new WeakMap();
    anyAnchorMemo.set(context, byParagraph);
  }
  let value = byParagraph.get(paragraph);
  if (value === undefined) {
    value = anchoredDrawingAtomsInParagraph(paragraph, context).length > 0;
    byParagraph.set(paragraph, value);
  }
  return value;
}

/** Placeholder lines preceding a floating atom do not inherit its placement skip. */
export function anchorLineSkipsExclusion(
  paragraph: OoxmlElement,
  context: InlineDrawingLayoutContext | undefined,
  line: PendingLine
): boolean {
  // A break's clearance belongs to the break, a band that reaches back past its anchor line
  // clears the line it crosses, and an anchor-only paragraph's mark keeps the clearance its
  // break gave it below the rectangles that leave it no passage.
  if (
    !context ||
    line.breakClearance ||
    line.ownBandClearance ||
    line.anchorClearanceBefore !== undefined
  )
    return false;
  const offsets = drawingModelOffsetsInParagraph(paragraph);
  const atoms = anchoredDrawingAtomsInParagraph(paragraph, context);
  const starts = atoms
    .map((atom) => offsets.get(atom.atomId))
    .filter((offset): offset is number => offset !== undefined);
  if (starts.length === 0) return false;
  const first = starts.reduce((minimum, start) => Math.min(minimum, start), Infinity);
  if (line.end <= first) return true;
  return (
    starts.some((start) => start >= line.start && start < line.end) &&
    line.end <= first + 1 &&
    !atoms.some((atom) => {
      const start = offsets.get(atom.atomId);
      return (
        atom.projection.wrap === 'topAndBottom' &&
        start !== undefined &&
        start >= line.start &&
        start < line.end
      );
    })
  );
}

/** Combine page exclusions with anchors encountered earlier in this paragraph fragment. */
export function drawingZonesAtLinePlacement(
  options: Omit<
    Parameters<typeof synthesizeParagraphTopAndBottomZones>[0],
    'anchorLineTopByModelStart'
  > & {
    readonly pageZones: readonly ExclusionZone[];
    readonly brokenLines: readonly PendingLine[];
    readonly lineIndex: number;
    readonly fragmentFirstLine: number;
    readonly appliedSkipByLineIndex: ReadonlyMap<number, number>;
  }
): readonly ExclusionZone[] {
  const { pageZones, brokenLines, lineIndex, fragmentFirstLine, appliedSkipByLineIndex } = options;
  if (lineIndex <= fragmentFirstLine) return pageZones;
  const offsets = drawingModelOffsetsInParagraph(options.paragraph);
  if (offsets.size === 0) return pageZones;
  const anchorLineTopByModelStart = new Map<number, number>();
  let extent = 0;
  for (let index = fragmentFirstLine; index < lineIndex; index++) {
    const line = brokenLines[index]!;
    for (const modelStart of offsets.values()) {
      if (modelStart >= line.start && modelStart < line.end)
        anchorLineTopByModelStart.set(modelStart, extent);
    }
    extent += (appliedSkipByLineIndex.get(index) ?? line.exclusionSkipBefore ?? 0) + line.height;
  }
  if (anchorLineTopByModelStart.size === 0) return pageZones;
  return Object.freeze([
    ...pageZones,
    ...synthesizeParagraphTopAndBottomZones({ ...options, anchorLineTopByModelStart }),
  ]);
}

type PlacementOptions = Parameters<typeof drawingZonesAtLinePlacement>[0];

/** A paragraph entry as line placement reads it. */
interface PlacedParagraphEntry {
  readonly paragraph: OoxmlElement;
  readonly indent: { readonly left: number; readonly right: number };
  readonly available: number;
}

/**
 * {@link drawingZonesAtLinePlacement} bound to a body story: its page zones, the band its
 * anchors resolve across, the paragraph top after earlier bands displaced it, and the frame of
 * the sheet being filled, all read when a line is placed.
 */
export function createLinePlacementZones<Entry extends PlacedParagraphEntry>(story: {
  readonly drawingLayout: InlineDrawingLayoutContext | undefined;
  readonly displayMode: PlacementOptions['displayMode'];
  readonly revisionAuthorFilter?: PlacementOptions['revisionAuthorFilter'];
  readonly pageZones: (entry: Entry, entryIndex: number) => readonly ExclusionZone[];
  readonly band: (entry: Entry) => { readonly left: number; readonly right: number };
  readonly paragraphTop: (paragraphId: string, startY: number) => number;
  readonly columnIndex: () => number;
  readonly frameBase: () => NonNullable<PlacementOptions['frameBase']>;
}) {
  return (
    entry: Entry,
    entryIndex: number,
    brokenLines: readonly PendingLine[],
    lineIndex: number,
    fragmentFirstLine: number,
    fragmentParagraphStartY: number,
    appliedSkipByLineIndex: ReadonlyMap<number, number>
  ): readonly ExclusionZone[] => {
    const pageZones = story.pageZones(entry, entryIndex);
    if (!story.drawingLayout || lineIndex <= fragmentFirstLine) return pageZones;
    if (drawingModelOffsetsInParagraph(entry.paragraph).size === 0) return pageZones;
    const band = story.band(entry);
    return drawingZonesAtLinePlacement({
      paragraph: entry.paragraph,
      paragraphId: entry.paragraph.id,
      drawingLayout: story.drawingLayout,
      contentLeft: band.left,
      contentRight: band.right,
      paragraphStartY: story.paragraphTop(entry.paragraph.id, fragmentParagraphStartY),
      columnIndex: story.columnIndex(),
      displayMode: story.displayMode,
      ...(story.revisionAuthorFilter ? { revisionAuthorFilter: story.revisionAuthorFilter } : {}),
      frameBase: story.frameBase(),
      pageZones,
      brokenLines,
      lineIndex,
      fragmentFirstLine,
      appliedSkipByLineIndex,
    });
  };
}
