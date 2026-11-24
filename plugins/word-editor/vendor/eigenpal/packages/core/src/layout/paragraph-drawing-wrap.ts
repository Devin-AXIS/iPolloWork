import { withOwnParagraphAnchorZones } from './empty-anchor-exclusion.ts';
import type { BodyAnchorFrameBase } from './body-flow-helpers.ts';
import type { RevisionDisplayMode, RevisionAuthorFilter } from './revision-projection.ts';
import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import { anchoredDrawingAtomsInParagraph } from './drawing-atom-walk.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import {
  localizeExclusionZones,
  verticalBandOfExclusion,
  type ExclusionZone,
} from './drawing-exclusion.ts';
import type { PendingLine } from './pending-line.ts';
import type { ParagraphFrame } from './paragraph-frame.ts';

interface WrapParagraph {
  readonly paragraph: OoxmlElement;
  readonly styleId: string | null;
  readonly contextualSpacing: boolean;
  readonly spacing: { readonly after: number };
  readonly frame?: ParagraphFrame;
}

/** Select paragraph wrap bands and track displacement caused by the following anchor. */
export function createParagraphDrawingWrap(options: {
  readonly drawingLayout?: InlineDrawingLayoutContext;
  readonly paragraphAt: (index: number) => WrapParagraph | undefined;
  readonly paragraphOrder: ReadonlyMap<string, number>;
  readonly paragraphIndex: (id: string) => number;
  /** The block index of an in-flow table that a floating table anchors at, else -1. */
  readonly tableIndex?: (id: string) => number;
  /** The section's text columns, in the zones' coordinates. */
  readonly columns: {
    readonly count: number;
    readonly lefts: readonly number[];
    readonly widths: readonly number[];
  };
  readonly seedForwardOnly?: boolean;
  readonly compatibilityMode?: number;
  readonly displayMode?: RevisionDisplayMode;
  readonly revisionAuthorFilter?: RevisionAuthorFilter;
  /** Sizes unwrapped text boxes before an anchor-only paragraph carves their zones. */
  readonly layoutTextboxStory?: import('./inline-textbox-flow.ts').TextboxStoryLayouter;
}) {
  // A rectangular exclusion anchored at the next paragraph can reach back into the
  // preceding paragraph's after-spacing. Its origin excludes the extra lines that
  // its own wrap caused there, just as a top-and-bottom anchor excludes its own skip.
  const displacements = new Map<string, number>();
  const liftedDisplacements = new Map<string, Map<string, number>>();
  // The lines a rising table band adds to each earlier paragraph on its page, by table anchor.
  const tableWrapShares = new Map<string, Map<string, number>>();
  const followingAnchors = new Map<string, ReadonlySet<string>>();
  const followingAnchor = (zone: ExclusionZone, index: number): boolean => {
    if (
      zone.sourceKind ||
      (zone.input.mode !== 'square' && zone.input.mode !== 'topAndBottom') ||
      zone.anchorModelStart !== 0 ||
      !options.drawingLayout
    )
      return false;
    const next = options.paragraphAt(index + 1);
    if (!next || next.frame || next.paragraph.id !== zone.anchorParagraphId) return false;
    let eligible = followingAnchors.get(next.paragraph.id);
    if (!eligible) {
      eligible = new Set(
        anchoredDrawingAtomsInParagraph(next.paragraph, options.drawingLayout)
          .filter(
            ({ projection }) =>
              projection.position?.vertical.relativeFrom === 'paragraph' &&
              projection.position.vertical.align === null &&
              (projection.position.vertical.offsetEmu ?? 0) >= 0
          )
          .map(({ projection }) => projection.drawingNodeId)
      );
      followingAnchors.set(next.paragraph.id, eligible);
    }
    return eligible.has(zone.drawingNodeId);
  };
  // A topAndBottom drawing that a negative offset lifts above its own paragraph keeps the
  // place its paragraph gives it, and the lines before the anchor that its band crosses move
  // below it. The anchor's origin then excludes that push, so the band does not chase it.
  const liftedAnchors = new Map<string, ReadonlySet<string>>();
  const liftedAnchor = (zone: ExclusionZone, index: number): boolean => {
    if (zone.sourceKind || zone.input.mode !== 'topAndBottom' || !options.drawingLayout)
      return false;
    const anchorOrder = options.paragraphOrder.get(zone.anchorParagraphId);
    const entry = options.paragraphAt(index);
    const entryOrder = entry ? options.paragraphOrder.get(entry.paragraph.id) : undefined;
    if (anchorOrder === undefined || entryOrder === undefined || anchorOrder <= entryOrder)
      return false;
    let eligible = liftedAnchors.get(zone.anchorParagraphId);
    if (!eligible) {
      const anchor = options.paragraphAt(options.paragraphIndex(zone.anchorParagraphId));
      eligible = new Set(
        anchor && !anchor.frame && anchor.paragraph.id === zone.anchorParagraphId
          ? anchoredDrawingAtomsInParagraph(anchor.paragraph, options.drawingLayout)
              .filter(
                ({ projection }) =>
                  projection.wrap === 'topAndBottom' &&
                  projection.position?.vertical.relativeFrom === 'paragraph' &&
                  projection.position.vertical.align === null &&
                  (projection.position.vertical.offsetEmu ?? 0) < 0
              )
              .map(({ projection }) => projection.drawingNodeId)
          : []
      );
      liftedAnchors.set(zone.anchorParagraphId, eligible);
    }
    return eligible.has(zone.drawingNodeId);
  };
  const extent = (lines: readonly PendingLine[]) =>
    lines.reduce((sum, line) => sum + line.height + (line.exclusionSkipBefore ?? 0), 0);
  /** Records the lines each rising table band anchored after paragraph `entryId` adds to it. */
  const measureTableShares = (
    pageIndex: number,
    entryId: string,
    zones: readonly ExclusionZone[],
    lines: readonly PendingLine[],
    breakWithout: (anchorId: string) => readonly PendingLine[]
  ): void => {
    for (const [key, shares] of tableWrapShares)
      if (key.startsWith(`${pageIndex}:`)) shares.delete(entryId);
    const entryOrder = options.paragraphOrder.get(entryId);
    if (entryOrder === undefined || options.seedForwardOnly) return;
    const anchors = new Set<string>();
    for (const zone of zones) {
      const anchorOrder = options.paragraphOrder.get(zone.anchorParagraphId);
      if (zone.wrapsEarlierLines && anchorOrder !== undefined && anchorOrder > entryOrder)
        anchors.add(zone.anchorParagraphId);
    }
    for (const anchorId of anchors) {
      const share = Math.max(0, extent(lines) - extent(breakWithout(anchorId)));
      if (share <= 0.001) continue;
      const key = `${pageIndex}:${anchorId}`;
      const shares = tableWrapShares.get(key) ?? new Map<string, number>();
      shares.set(entryId, share);
      tableWrapShares.set(key, shares);
    }
  };
  return {
    breakZones(
      entry: WrapParagraph,
      index: number,
      columnIndex: number,
      zones: readonly ExclusionZone[],
      frameBase: () => BodyAnchorFrameBase,
      top: number,
      left: number,
      right: number,
      startOffset: number,
      paragraphSpaceBefore: number,
      omittedAnchor?: string
    ): readonly ExclusionZone[] {
      const all = entry.frame
        ? []
        : withOwnParagraphAnchorZones(
            zones,
            entry.paragraph,
            options.drawingLayout,
            frameBase,
            top,
            left,
            right,
            columnIndex,
            startOffset,
            paragraphSpaceBefore,
            options.compatibilityMode,
            options.displayMode ?? 'proposed',
            options.revisionAuthorFilter,
            options.layoutTextboxStory
          );
      const selected = this.select(entry, index, columnIndex, all, { omittedAnchor });
      // Break spans are column-local; placement adds the column origin once.
      return left === 0 ? selected : localizeExclusionZones(selected, left, 0);
    },
    select(
      entry: WrapParagraph,
      index: number,
      columnIndex: number,
      zones: readonly ExclusionZone[],
      selection: {
        readonly placement?: boolean;
        readonly omittedAnchor?: string;
      } = {}
    ): readonly ExclusionZone[] {
      const { placement = false, omittedAnchor } = selection;
      return zones
        .filter((zone) => {
          if (zone.anchorParagraphId === omittedAnchor) return false;
          if (zone.sourceKind === 'furniture' || zone.earlierSection) return true;
          const entryOrder = options.paragraphOrder.get(entry.paragraph.id);
          const anchorOrder = options.paragraphOrder.get(zone.anchorParagraphId);
          // A page- or margin-framed band does not move when the text before it reflows, so it
          // reaches back over the whole page. A flow-framed one would chase its own anchor, except
          // a raised text table, whose position leaves out the move it causes.
          const reachesBack =
            (!options.seedForwardOnly &&
              (zone.pageFramedBand === true ||
                zone.reachesEarlierLines === true ||
                zone.wrapsEarlierLines === true ||
                liftedAnchor(zone, index))) ||
            (!placement && followingAnchor(zone, index));
          if (entryOrder !== undefined && anchorOrder !== undefined) {
            if (anchorOrder > entryOrder && !reachesBack) return false;
          } else {
            const anchorIndex = options.paragraphIndex(zone.anchorParagraphId);
            if (anchorIndex < 0) {
              // A floating table anchored at an in-flow table wraps the text after that table.
              const tableIndex = options.tableIndex?.(zone.anchorParagraphId) ?? -1;
              if (tableIndex < 0 || tableIndex > index) return false;
            } else if (anchorIndex > index && !reachesBack) return false;
          }
          if (
            options.columns.count > 1 &&
            zone.columnIndex !== columnIndex &&
            !reachesAcross(
              zone,
              options.columns.lefts[columnIndex],
              options.columns.widths[columnIndex]
            )
          )
            return false;
          return !(
            placement &&
            !zone.sourceKind &&
            zone.anchorParagraphId === entry.paragraph.id &&
            zone.input.mode === 'topAndBottom'
          );
        })
        .map((zone) => {
          if (placement || !followingAnchor(zone, index)) return zone;
          // Include the trailing gap in the predecessor's wrap probe, without adding
          // that gap to every line's height or moving the published picture. The spacing
          // before its first line is `topAndBottomSkipBeforeLine`'s `spaceAbove`.
          const next = options.paragraphAt(index + 1);
          const after =
            entry.contextualSpacing && entry.styleId !== null && entry.styleId === next?.styleId
              ? 0
              : entry.spacing.after;
          const input = {
            ...zone.input,
            wrapDistances: {
              ...zone.input.wrapDistances,
              top: zone.input.wrapDistances.top + after,
            },
          };
          // Recompute from the same arithmetic as the scanline reader: subtracting the
          // gap separately can round just outside its exclusion edge.
          return { ...zone, input, verticalBand: verticalBandOfExclusion(input) };
        });
    },
    measure(
      pageIndex: number,
      index: number,
      zones: readonly ExclusionZone[],
      lines: readonly PendingLine[],
      breakWithout: (anchorId: string) => readonly PendingLine[]
    ): void {
      // All eligible zones belong to the immediately following paragraph. Omit its
      // complete set once, even when it owns several pictures.
      const zone = zones.find((candidate) => followingAnchor(candidate, index));
      if (zone)
        displacements.set(
          `${pageIndex}:${zone.anchorParagraphId}`,
          Math.max(0, extent(lines) - extent(breakWithout(zone.anchorParagraphId)))
        );
      // A lifted band pushes every earlier paragraph on the page it crosses, not only the
      // preceding one. Each paragraph keeps its own share, replaced when it lays out again.
      const entryId = options.paragraphAt(index)?.paragraph.id;
      if (entryId === undefined) return;
      for (const [key, shares] of liftedDisplacements)
        if (key.startsWith(`${pageIndex}:`)) shares.delete(entryId);
      measureTableShares(pageIndex, entryId, zones, lines, breakWithout);
      if (!lines.some((line) => (line.exclusionSkipBefore ?? 0) > 0.001)) return;
      const anchors = new Set(
        zones
          .filter((candidate) => !options.seedForwardOnly && liftedAnchor(candidate, index))
          .map((candidate) => candidate.anchorParagraphId)
      );
      for (const anchorId of anchors) {
        const share = Math.max(0, extent(lines) - extent(breakWithout(anchorId)));
        if (share <= 0.001) continue;
        const key = `${pageIndex}:${anchorId}`;
        const shares = liftedDisplacements.get(key) ?? new Map<string, number>();
        shares.set(entryId, share);
        liftedDisplacements.set(key, shares);
      }
    },
    /** The lines rising table bands of `anchorId` added to earlier paragraphs on the page. */
    tablePush(pageIndex: number, anchorId: string): number {
      let push = 0;
      for (const share of tableWrapShares.get(`${pageIndex}:${anchorId}`)?.values() ?? [])
        push += share;
      return push;
    },
    displacement(pageIndex: number, paragraphId: string): number {
      const key = `${pageIndex}:${paragraphId}`;
      let lifted = 0;
      for (const share of liftedDisplacements.get(key)?.values() ?? []) lifted += share;
      return (displacements.get(key) ?? 0) + lifted;
    },
  };
}

/**
 * A raised table that moves the earlier lines it covers moves them in every column its band
 * crosses, not only in the column of its anchor.
 */
function reachesAcross(
  zone: ExclusionZone,
  left: number | undefined,
  width: number | undefined
): boolean {
  if (zone.reachesEarlierLines !== true || left === undefined || width === undefined) return false;
  const band = zone.verticalBand;
  return band.x < left + width && band.x + band.width > left;
}
