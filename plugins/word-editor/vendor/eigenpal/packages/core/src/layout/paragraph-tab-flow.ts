import type { CellAnchorScope } from './cell-anchor-layout.ts';
import {
  nextTabDestination,
  type TabDestination,
  type ResolvedTabStops,
} from './paragraph-tabs.ts';

/**
 * Whether a tab closes its line before it is placed.
 *
 * A tab on a full line closes it when content follows. In a cell, the real next stop is
 * tested before clamping consumes a wrapped cell tab at the old edge. In body text, a tab
 * whose next default stop lies past the right edge opens the next line, even with nothing
 * after it, and reaches its first stop there. `plain` means left-to-right, not positional,
 * and with no exclusion zone cutting the line short of the right edge.
 */
export function tabClosesLine(
  scope: CellAnchorScope | undefined,
  inTableCell: boolean,
  plain: boolean,
  tabs: ResolvedTabStops,
  currentX: number,
  rightEdge: number,
  lineFull: boolean,
  contentFollows: boolean
): boolean {
  if (!plain) return lineFull && contentFollows;
  const next = nextTabDestination(tabs, currentX, Number.POSITIVE_INFINITY);
  const pastEdge = next.alignment === 'left' && next.positionPt > rightEdge + 1e-6;
  if ((lineFull || (scope?.inTableCell === true && pastEdge)) && contentFollows) return true;
  // A custom stop at the pen counts too: text aligned on a stop at the edge keeps its
  // trailing tabs on its line.
  const customAhead = tabs.stops.some(
    (stop) => !stop.numberingOnly && stop.positionPt >= currentX - 1e-6
  );
  return !inTableCell && !customAhead && pastEdge;
}

/**
 * Choose the ordinary or positional destination without changing either stop policy, and how
 * far the text after the tab may run (`segmentRight`), given the furthest such point so far.
 *
 * An aligned stop's text reaches the stop, up to the margin (`tabEdge`). A left stop may lie
 * past the right indent: it reaches the margin, and its text may run to the margin. With
 * `pastMargin` (a legacy mode) any custom left stop is honoured and its text has no bound.
 */
export function tabDestinationForFlow(
  tabs: ResolvedTabStops,
  stopX: number,
  stopRight: number,
  tabEdge: number,
  currentX: number,
  rightEdge: number,
  positional: TabDestination | null,
  pastMargin = false,
  rtl = false,
  segmentRight = 0
): TabDestination & { readonly segmentRight: number } {
  const authored = nextTabDestination(tabs, stopX, tabEdge);
  // Only a custom stop reaches past the right indent; the default grid stops at it.
  const customAhead = tabs.stops.some((stop) => !stop.numberingOnly && stop.positionPt > stopX);
  const destination =
    positional === null
      ? authored.alignment !== 'left'
        ? authored
        : !customAhead
          ? nextTabDestination(tabs, stopX, stopRight)
          : pastMargin
            ? nextTabDestination(tabs, stopX, Number.POSITIVE_INFINITY)
            : authored
      : Number.isFinite(positional.positionPt) && positional.positionPt > currentX
        ? positional
        : {
            ...nextTabDestination(tabs, currentX, rightEdge),
            ...(positional.leader ? { leader: positional.leader } : {}),
          };
  // Right-to-left stops count from the other edge; their text keeps the measure.
  let right = segmentRight;
  if (!rtl && destination.alignment !== 'left')
    right = Math.max(segmentRight, Math.min(destination.positionPt, tabEdge));
  else if (!rtl && destination.positionPt > stopRight + 1e-6)
    right = Math.max(segmentRight, pastMargin ? Number.POSITIVE_INFINITY : tabEdge);
  return { ...destination, segmentRight: right };
}

/** Repeated tab sequences retain their existing placement across the whole paragraph. */
export function cellTabReplayScope(
  scope: CellAnchorScope | undefined,
  pieces: readonly { readonly text: string }[]
): CellAnchorScope | undefined {
  if (!scope?.inTableCell) return undefined;
  let previousTab = false;
  for (const piece of pieces) {
    for (let offset = 0; offset < piece.text.length; offset += 1) {
      const tab = piece.text[offset] === '\t';
      if (tab && previousTab) return undefined;
      previousTab = tab;
    }
  }
  return scope;
}
