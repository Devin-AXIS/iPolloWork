import type { TableFlowDeps } from './semantic-table-layout.ts';

/** Remove every live publication sink from a speculative table-row placement. */
export function stripAnchorSinksForProbe(deps: TableFlowDeps): TableFlowDeps {
  return {
    ...deps,
    measuringOnly: true,
    collectAnchoredDrawings: undefined,
    publishAnchoredDrawings: undefined,
    deferAnchoredDrawings: undefined,
    onAnchorRepublish: undefined,
    onAnchorShift: undefined,
    anchorDeferOnly: true,
  };
}

/** Probe deps for a layout that is measured and discarded: no sinks, throwaway line ids. */
export function measuringFlowDeps(deps: TableFlowDeps, keepExclusions: boolean): TableFlowDeps {
  let lineCounter = 0;
  return {
    ...stripAnchorSinksForProbe(deps),
    ...(keepExclusions ? {} : { pageExclusionZones: undefined }),
    nextLineId: () => `probe-${lineCounter++}`,
  };
}

/**
 * The same deps with every anchored-drawing sink removed, and nothing else changed. A second
 * layout of placed content uses this, so its drawings are not published twice.
 */
export function withoutAnchorSinks(deps: TableFlowDeps): TableFlowDeps {
  return {
    ...deps,
    collectAnchoredDrawings: undefined,
    publishAnchoredDrawings: undefined,
    deferAnchoredDrawings: undefined,
    onAnchorRepublish: undefined,
    onAnchorShift: undefined,
  };
}
