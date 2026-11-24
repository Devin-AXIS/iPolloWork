// Footnote reserve maps: page-slot → bottom reserve height (points). The compute lives in
// note-pagination.ts (computeFootnoteReserves); this module holds the pure map algebra and
// the shared reserve constants the reflow loop and the section context keys share.

/**
 * Minimum body band (points) retained when computing footnote bottom reserves.
 *
 * Reserving the full content column would shrink body flow to 1pt and chase blank
 * sheets as every reference line fails to land. Oversized notes split/continue into
 * the shared overflow budget instead of evacuating the referencing page.
 */
export const MIN_FOOTNOTE_BODY_BAND_PT = 14;

/**
 * The tallest footnote stack a page can host beside the minimum body band. ONE formula:
 * the eviction guard ("could this note fit whole on a page?") and the hold-out's
 * oversized-note test must be exact complements, or a note is neither evicted nor held
 * out and the reflow loop orbits.
 */
export function noteColumnBudgetPt(contentHeight: number, separatorHeight: number): number {
  return Math.max(0, contentHeight - MIN_FOOTNOTE_BODY_BAND_PT - separatorHeight);
}

/**
 * Half-point back-off applied to reserves derived from an observed line boundary (eviction,
 * hold-out), so the body budget falls mid-line instead of edge-to-edge on a kept line's
 * exact bottom, where the body pass's strict fit compare flips on float drift.
 */
export const RESERVE_BOUNDARY_BACKOFF_PT = 0.5;

/**
 * How far apart two reserve values may sit and still count as "the same hold". A re-derived
 * hold differs from the applied one by at most the boundary back-off plus float drift, so
 * the tolerance is stated in terms of the back-off rather than as a free constant.
 */
export const HELD_RESERVE_TOLERANCE_PT = 2 * RESERVE_BOUNDARY_BACKOFF_PT;

/**
 * The note-reserve slice of one section's layout context key.
 *
 * The reserve map is keyed by DOCUMENT page index (`computeFootnoteReserves`), while a
 * section's pass reads it at `pageIndexStart + localSlot` as it opens pages. The key folds
 * exactly the entries that pass can read — document slots in
 * `[pageIndexStart, pageIndexStart + pageBound)` — so a reserve on another section's pages
 * cannot invalidate this one. `pageBound` is EXCLUSIVE and section-LOCAL: the highest local
 * page slot the pass can read, plus one.
 *
 * Entries are emitted at their LOCAL slot (`documentSlot - pageIndexStart`), not the document
 * one. The document page index is deliberately absent from a section's context key (an Enter
 * that adds a page above must not re-lay every section below), and the local slot is what the
 * pass's reads actually depend on: two passes whose readable windows carry the same heights
 * at the same local offsets read identically wherever the section sits, so a section whose
 * reserves shift down a sheet with it reconverges to its stored key once the reflow loop has
 * recomputed the map, while a reserve that stays at a fixed document page as the section
 * moves lands on a different local slot and invalidates.
 *
 * Entries are sorted by slot so two content-equal maps render one canonical key regardless
 * of insertion order. `Infinity` folds every entry from `pageIndexStart` on (a pass with no
 * prior page count cannot bound its reads). A window with no entries keys like no map at
 * all: both mean every read returns zero, and two encodings of that would invalidate every
 * untouched section when a document's last note disappears.
 */
export function notesReserveContextKey(
  reserves: ReadonlyMap<number, number> | undefined,
  pageIndexStart: number,
  pageBound: number
): string {
  if (!reserves) return '';
  const entries: [number, number][] = [];
  for (const [pageSlot, height] of reserves) {
    const localSlot = pageSlot - pageIndexStart;
    if (localSlot >= 0 && localSlot < pageBound) entries.push([localSlot, height]);
  }
  if (entries.length === 0) return '';
  entries.sort((a, b) => a[0] - b[0]);
  return `|nr:${entries.map(([localSlot, height]) => `${localSlot}=${height}`).join(',')}`;
}

/**
 * Merge one entry into a reserve map: monotonic per-slot maximum, and non-positive heights
 * are OMITTED rather than stored — convergence compares maps by key set, and body layout
 * treats a missing slot as zero.
 */
export function recordFootnoteReserve(
  reserves: Map<number, number>,
  pageIndex: number,
  height: number
): void {
  if (height <= 0) return;
  reserves.set(pageIndex, Math.max(reserves.get(pageIndex) ?? 0, height));
}

/** Drop non-positive heights so missing and zero compare equal. */
export function compactFootnoteReserves(
  reserves: ReadonlyMap<number, number>
): Map<number, number> {
  const next = new Map<number, number>();
  for (const [pageIndex, height] of reserves) {
    if (height > 0) next.set(pageIndex, height);
  }
  return next;
}

/** True when both maps list the same page → height pairs (zeros ignored). */
export function footnoteReservesEqual(
  a: ReadonlyMap<number, number>,
  b: ReadonlyMap<number, number>
): boolean {
  const left = compactFootnoteReserves(a);
  const right = compactFootnoteReserves(b);
  if (left.size !== right.size) return false;
  for (const [pageIndex, height] of left) {
    if ((right.get(pageIndex) ?? 0) !== height) return false;
  }
  return true;
}

/** Monotonic union: each page keeps the larger of the two heights. */
export function growFootnoteReserves(
  base: ReadonlyMap<number, number>,
  computed: ReadonlyMap<number, number>
): Map<number, number> {
  const next = compactFootnoteReserves(base);
  for (const [pageIndex, height] of computed) {
    if (height <= 0) continue;
    next.set(pageIndex, Math.max(next.get(pageIndex) ?? 0, height));
  }
  return next;
}

/** Canonical content fingerprint, for cycle detection over adopted maps. */
export function footnoteReservesFingerprint(reserves: ReadonlyMap<number, number>): string {
  return [...compactFootnoteReserves(reserves)]
    .map(([pageIndex, height]) => `${pageIndex}=${height}`)
    .sort()
    .join(',');
}

/** Seed reserves a multi-section pass moved to its own page indices, per layout session. */
const movedSeedReserves = new WeakMap<object, ReadonlyMap<number, number>>();

/** Record the reserves a seeded pass actually used, at the page indices it laid out. */
export function recordMovedSeedReserves(
  session: object,
  reserves: ReadonlyMap<number, number>
): void {
  movedSeedReserves.set(session, reserves);
}

/** The reserves the last seeded pass on `session` used, once; undefined when none moved. */
export function takeMovedSeedReserves(
  session: object | undefined
): ReadonlyMap<number, number> | undefined {
  if (!session) return undefined;
  const moved = movedSeedReserves.get(session);
  movedSeedReserves.delete(session);
  return moved;
}
