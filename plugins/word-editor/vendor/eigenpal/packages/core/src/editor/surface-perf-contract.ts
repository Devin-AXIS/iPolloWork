// Surface timing and reuse counters, split out of `paginated-surface-contract.ts`.
//
// Diagnostics, not document state: nothing here describes the document, and nothing here
// is part of what a host programs an EDIT against. It lives in its own file so the surface
// contract keeps room for the vocabulary that does. `paginated-surface-contract.ts`
// re-exports it, so importers keep one entry point.

/**
 * Where the last pass spent its time, and how much work it actually did.
 *
 * The durations are the surface's own three phases — layout, paint, selection sync — timed
 * separately because they fail separately: a full relayout, a full repaint and a forced
 * reflow each have a different fix. The counters come free from machinery that already
 * exists: the layout session says how much was re-placed versus reused, and the scheduler
 * says how often work was thrown away as stale. `placed` equal to `total` on every
 * keystroke is the one-glance sign that incremental layout is not engaging.
 */
export interface PaginatedSurfacePerf {
  /** Time the last layout pass took, in milliseconds. */
  readonly layoutMs: number;
  /** Time the last paint took — building and swapping the page DOM. */
  readonly paintMs: number;
  /** Time the last selection sync took — writing the model selection into the browser. */
  readonly selectionMs: number;
  /** Paragraphs the last pass re-placed, against the number in the document. */
  readonly placed: number;
  readonly total: number;
  /** Pages carried over from the previous layout without being rebuilt. */
  readonly reusedPages: number;
  /** Passes that could not resume and laid the document out from the top. */
  readonly fullPasses: number;
  /** Layouts discarded because the model had already moved on. */
  readonly staleDiscards: number;
  /** Cooperative runs abandoned mid-flight for a newer revision. */
  readonly cancelledRuns: number;
}
