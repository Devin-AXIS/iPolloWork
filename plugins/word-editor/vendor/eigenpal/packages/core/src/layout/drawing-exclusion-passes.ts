import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import { anchoredDrawingAtomsInParagraph } from './drawing-atom-walk.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import {
  exclusionLayoutToken,
  exclusionMapsEqual,
  exclusionMapsToken,
  type ExclusionZone,
} from './drawing-exclusion.ts';

type Zones = ReadonlyMap<number, readonly ExclusionZone[]>;

/** What one reflow pass means for the loop: go on, publish this pass, or publish a cycle. */
export type ExclusionTransition =
  | { readonly kind: 'continue' }
  | { readonly kind: 'stable' }
  /** The passes came back to an earlier map; `zones` (see `cycleZones`) is what it publishes. */
  | { readonly kind: 'cycle'; readonly zones: Zones };

/** The reflow loop's pass bookkeeping: budget, pass index, and the maps it has reached. */
export interface DrawingExclusionPasses {
  /** The ordinary pass budget, doubled when anchor pages start seeded forward only. */
  readonly maxPasses: number;
  /** The pass index layout receives: negative while anchor pages are seeded forward only. */
  passIndex(pass: number): number;
  /** Notes a map reached outside `advance`, as the pass seeded from the previous pages is. */
  remember(zones: Zones): void;
  /** Compares the zones a pass collected (`next`) with the ones it was laid out under. */
  advance(previous: Zones, next: Zones, stabilization?: boolean): ExclusionTransition;
}

/** Establish anchor pages before later page bands can displace their predecessors. */
export function createDrawingExclusionPasses(
  blocks: readonly OoxmlElement[],
  drawings: InlineDrawingLayoutContext | undefined,
  maxPasses: number,
  compatibilityMode?: number
): DrawingExclusionPasses {
  // Consecutive anchor-only paragraphs depend on earlier objects for their page.
  // Modern layout seeds those dependencies before later fixed bands wrap earlier text.
  let previousAnchorsOnly = false;
  let seedForwardOnly = false;
  if (drawings && hasCompatibilityRule(compatibilityMode, 'anchorOnlyParagraphSeeding'))
    for (const block of blocks) {
      const atoms =
        block.kind === 'paragraph' ? anchoredDrawingAtomsInParagraph(block, drawings) : [];
      const anchorsOnly =
        block.kind === 'paragraph' &&
        atoms.length > 0 &&
        paragraphOffsetIndex(block).length === atoms.length;
      if (previousAnchorsOnly && anchorsOnly) {
        seedForwardOnly = true;
        break;
      }
      previousAnchorsOnly = anchorsOnly;
    }
  // The maps reached since the start, or since forward-only seeding last stopped, keyed by token
  // in first-visit order. A pass whose map is stable or already visited when it stops seeding
  // records none.
  const visitedMaps = new Map<string, Zones>();
  const stopSeedingForwardOnly = (): void => {
    seedForwardOnly = false;
    visitedMaps.clear();
  };
  return {
    maxPasses: seedForwardOnly ? maxPasses * 2 : maxPasses,
    passIndex: (pass: number): number => {
      if (seedForwardOnly && pass >= maxPasses) stopSeedingForwardOnly();
      return seedForwardOnly ? -pass - 1 : pass;
    },
    remember: (zones: Zones): void => {
      visitedMaps.set(exclusionMapsToken(zones), zones);
    },
    advance(previous: Zones, next: Zones, stabilization = false): ExclusionTransition {
      if (
        seedForwardOnly &&
        (stabilization ||
          !Array.from(next.values()).some((zones) => zones.some((zone) => zone.pageFramedBand)))
      )
        stopSeedingForwardOnly();
      const stable = exclusionMapsEqual(previous, next);
      const token = exclusionMapsToken(next);
      const cycle = visitedMaps.has(token);
      if (seedForwardOnly && (stable || cycle)) {
        stopSeedingForwardOnly();
        return { kind: 'continue' };
      }
      // A stable result already uses its published zones; do not lay it out again.
      if (stable) return { kind: 'stable' };
      if (cycle) {
        // The cycle is every map from the first visit of `next` on.
        const members: Zones[] = [];
        for (const [visited, zones] of visitedMaps)
          if (members.length > 0 || visited === token) members.push(zones);
        return { kind: 'cycle', zones: cycleZones(members) };
      }
      visitedMaps.set(token, next);
      return { kind: 'continue' };
    },
  };
}

/** How many zones one map has that the other lacks, counting both directions. */
export function exclusionZoneChangeCount(previous: Zones, next: Zones): number {
  const tokens = (zonesByPage: Zones): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const [page, zones] of zonesByPage)
      for (const zone of zones) {
        const token = `${page}:${exclusionLayoutToken([zone])}`;
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    return counts;
  };
  const before = tokens(previous);
  let changed = 0;
  for (const [token, count] of tokens(next)) {
    const kept = Math.min(count, before.get(token) ?? 0);
    changed += count - kept;
    if (kept > 0) before.set(token, (before.get(token) ?? 0) - kept);
  }
  for (const count of before.values()) changed += count;
  return changed;
}

/**
 * The zones a reflow cycle publishes under: the map the passes came back to (the first of
 * `cycle`, in visit order) plus every page-framed zone (`ExclusionZone.pageFramedBand`, header
 * and footer zones aside) of the cycle's other maps.
 *
 * Why: a page- or margin-positioned object cycles when it covers its own anchor near the page
 * bottom: the anchor moves on and takes the object along, which frees the anchor again. Its
 * vertical place follows only its page, so under every place the cycle puts it, text clears it
 * wherever it paints; the place it does not paint stays a gap, as at the bottom of the page the
 * anchor left. Zones that follow the text (pictures and text frames positioned against their
 * paragraph, text-anchored tables) come from the first map alone: a zone that moves with its
 * paragraph, taken from another phase, would keep text from a place where nothing paints.
 */
export function cycleZones(cycle: readonly Zones[]): Zones {
  const merged = new Map(cycle[0]!);
  for (const zonesByPage of cycle.slice(1))
    for (const [page, zones] of zonesByPage) {
      const own = merged.get(page) ?? [];
      const known = new Set(own.map((zone) => exclusionLayoutToken([zone])));
      const added = zones.filter(
        (zone) =>
          zone.pageFramedBand === true &&
          zone.sourceKind !== 'furniture' &&
          !known.has(exclusionLayoutToken([zone]))
      );
      if (added.length) merged.set(page, [...own, ...added]);
    }
  return merged;
}
