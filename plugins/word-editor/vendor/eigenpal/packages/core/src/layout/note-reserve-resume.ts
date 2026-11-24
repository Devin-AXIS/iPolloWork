// Resuming a section pass when only its footnote reserves moved.
//
// The reserves of a notes pass are part of each section's context key, so a reserve that moved
// on one page made every checkpoint of the section unusable, and the section laid out again
// from its first page on every round of the reserve search. A checkpoint describes the flow
// before one block, with the pages completed so far and one page open. The reserves of those
// pages are the only ones it has read, so it stays valid while they are unchanged.

import type { FlowCheckpoint, LayoutSession } from './layout-session.ts';
import { notesReserveContextKey } from './note-reserves.ts';

interface ReserveContext {
  /** The pass context without its reserve part. */
  readonly base: string;
  /** Section-local page slot -> reserve, every slot the pass could read. */
  readonly reserves: ReadonlyMap<number, number>;
  /** The pages the pass produced. */
  readonly pageCount: number;
}

const reserveContexts = new WeakMap<LayoutSession, ReserveContext>();

function localReserves(
  reserves: ReadonlyMap<number, number> | undefined,
  pageIndexStart: number,
  bound: number
): Map<number, number> {
  const local = new Map<number, number>();
  if (!reserves) return local;
  for (const [pageIndex, height] of reserves) {
    const slot = pageIndex - pageIndexStart;
    if (slot >= 0 && slot < bound && height > 0) local.set(slot, height);
  }
  return local;
}

/** Record the context a pass ran under, for the next pass on `session`. */
export function rememberReserveContext(
  session: LayoutSession,
  base: string,
  reserves: ReadonlyMap<number, number> | undefined,
  pageIndexStart: number,
  pageCount: number
): void {
  reserveContexts.set(session, {
    base,
    reserves: localReserves(reserves, pageIndexStart, pageCount + 1),
    pageCount,
  });
}

/** Save the reserve record behind `session`'s checkpoints; the answer puts it back. */
export function saveReserveContext(session: LayoutSession): () => void {
  const saved = reserveContexts.get(session);
  return () => {
    if (saved) reserveContexts.set(session, saved);
    else reserveContexts.delete(session);
  };
}

/**
 * The first section-local page whose reserve differs from the previous pass, when the rest of
 * the context is the same. Undefined when anything else in the context moved, or when the
 * session holds no record of the previous pass.
 */
export function firstMovedReservePage(
  session: LayoutSession | undefined,
  base: string,
  reserves: ReadonlyMap<number, number> | undefined,
  pageIndexStart: number,
  bound: number
): number | undefined {
  const previous = session ? reserveContexts.get(session) : undefined;
  if (!previous || previous.base !== base) return undefined;
  const next = localReserves(reserves, pageIndexStart, bound);
  let first = Infinity;
  for (const [slot, height] of next) {
    if (previous.reserves.get(slot) !== height) first = Math.min(first, slot);
  }
  for (const [slot, height] of previous.reserves) {
    if (slot < bound && next.get(slot) !== height) first = Math.min(first, slot);
  }
  return first;
}

/**
 * The last block a pass may resume before: its checkpoint has completed fewer pages than
 * `page`, so the page it holds open, and every page before it, kept its reserve.
 */
export function resumeLimitBeforePage(
  checkpoints: readonly FlowCheckpoint[],
  page: number
): number {
  let index = 0;
  while (index + 1 < checkpoints.length && checkpoints[index + 1]!.pageCount < page) index += 1;
  return checkpoints[0] && checkpoints[0].pageCount < page ? index : 0;
}

/**
 * The last page of the previous pass whose reserve differs from this pass's reserve `delta`
 * pages later, or -1 when none does; null when the session holds no previous pass.
 *
 * The previous pass's pages from `fromPage` on can be reused `delta` pages later when this is
 * below `fromPage`: each of them then finds the same reserve at its new page, and no reserve
 * appears on a page that had none. One answer per `delta` serves every `fromPage`, so a pass
 * that converges on many pages compares the reserves once, not once per page.
 */
export function lastTailMismatch(
  session: LayoutSession,
  reserves: ReadonlyMap<number, number> | undefined,
  pageIndexStart: number,
  delta: number
): number | null {
  const previous = reserveContexts.get(session);
  if (!previous) return null;
  // The reused pages land at [fromPage + delta, pageCount + delta]; slots past them belong to
  // another section.
  const next = localReserves(reserves, pageIndexStart, previous.pageCount + delta + 1);
  let last = -1;
  for (const [slot, height] of previous.reserves) {
    if (slot > last && next.get(slot + delta) !== height) last = slot;
  }
  for (const [slot, height] of next) {
    if (slot - delta > last && previous.reserves.get(slot - delta) !== height) last = slot - delta;
  }
  return last;
}

/**
 * The reserve slots a section pass keys on. The pass reads reserves at `pageIndexStart` plus
 * consecutive local page slots as it opens pages, so a bound of "the page count the previous
 * pass produced, plus one" covers every slot an input-identical replay can touch, and keeps a
 * reserve on another section's pages from invalidating this one. A fresh session has no such
 * bound and folds every entry from `pageIndexStart` on (conservative, one full pass).
 */
export function reserveKeyBoundOf(session: LayoutSession | undefined): number {
  return session?.previous ? session.previous.pages.length + 1 : Infinity;
}

/**
 * Store the context of a finished pass on `session`.
 *
 * The reserve part is sliced again with the page count THIS pass produced: a pass that grew
 * past the start-time bound read reserve slots the start-time key never folded, and the next
 * comparison must see them. An input-identical replay produces the same count, so its
 * start-time string IS that string, reused by identity so the next check is a pointer compare.
 */
export function publishPassContext(
  session: LayoutSession,
  contextFor: (notesReserveKey: string) => string,
  context: string,
  reserves: ReadonlyMap<number, number> | undefined,
  pageIndexStart: number,
  startBound: number,
  pageCount: number
): void {
  session.context =
    pageCount + 1 === startBound
      ? context
      : contextFor(notesReserveContextKey(reserves, pageIndexStart, pageCount + 1));
  rememberReserveContext(session, contextFor(''), reserves, pageIndexStart, pageCount);
}

/** The reserve side of one section pass's reuse decisions. */
export interface SectionReserveResume {
  /** The pass context, with the reserve entries this pass can read. */
  readonly context: string;
  /** The first section-local page whose reserve moved, when nothing else did. */
  readonly moved: number | undefined;
  /** `firstChanged`, lowered to a checkpoint the moved reserves left valid. */
  resumeLimit(checkpoints: readonly FlowCheckpoint[], firstChanged: number): number;
  /** Whether the previous tail from `mark` may be reused with this pass at `pageCount` pages. */
  tailHolds(mark: FlowCheckpoint, pageCount: number): boolean;
  /**
   * The reserve of section-local page `page`. A pass seeded with the previous pass's reserves
   * reads each page's reserve where its content stood in that pass: an edit that moved the
   * flow by whole pages moved the notes with it, and the seed keeps every reserve at the page
   * index it had. Each page answers once, and the pass reports what it read; see
   * {@link takeReadReserves}.
   */
  reserveAt(page: number): number | undefined;
  /** The whole pages the flow now runs ahead of the previous pass; a seeded pass reads by it. */
  followShift(shift: number): void;
  /**
   * The reserves under which the previous tail from `mark` may be reused `pageCount -
   * mark.pageCount` pages later, by a seeded pass, or undefined. The tail keeps the reserves
   * it was laid out under, moved with it; the page open at the join was laid out partly under
   * this pass's reserve, so the two passes must agree on that one.
   */
  shiftedTail(mark: FlowCheckpoint, pageCount: number): ReadReserves | undefined;
  /** Use `tail` for this pass's context and report. */
  adoptShiftedTail(tail: ReadReserves): void;
  /** Store this pass's context on `session` once the pass produced `pageCount` pages. */
  publish(session: LayoutSession, pageCount: number): void;
}

/** The reserves a pass used on document pages `[from, to)`, keyed by document page index. */
export interface ReadReserves {
  readonly from: number;
  readonly to: number;
  readonly reserves: ReadonlyMap<number, number>;
}

/** `reserves` with the entries of `read`'s range replaced by its own. */
export function withReadReserves(
  reserves: ReadonlyMap<number, number> | undefined,
  read: ReadReserves
): Map<number, number> {
  const out = new Map<number, number>();
  for (const [index, height] of reserves ?? []) {
    if (index < read.from || index >= read.to) out.set(index, height);
  }
  for (const [index, height] of read.reserves) out.set(index, height);
  return out;
}

/**
 * Collects what each section of a multi-section pass reported reading (`take` after each
 * section), and reports it for the whole pass on its own session (`report`), over `given`:
 * the reserves the sections were handed.
 */
export function sectionReadCollector(): {
  take(session: LayoutSession | undefined): void;
  report(session: LayoutSession | undefined, given: ReadonlyMap<number, number> | undefined): void;
} {
  const reads: ReadReserves[] = [];
  return {
    take: (session) => {
      const read = takeReadReserves(session);
      if (read) reads.push(read);
    },
    report: (session, given) => {
      if (!session || reads.length === 0) return;
      const from = reads.reduce((least, read) => Math.min(least, read.from), Infinity);
      const to = reads.reduce((most, read) => Math.max(most, read.to), -Infinity);
      let all: ReadonlyMap<number, number> = given ?? new Map();
      for (const read of reads) all = withReadReserves(all, read);
      const reserves = new Map([...all].filter(([index]) => index >= from && index < to));
      readReports.set(session, { from, to, reserves });
    },
  };
}

/** What the last seeded pass on a session read where it differs from its seed. */
const readReports = new WeakMap<LayoutSession, ReadReserves>();

/**
 * The reserves the last pass on `session` read on its own pages, once, when it was seeded and
 * read any that differ from its seed; undefined otherwise. The reserve search compares its
 * answer against these, the reserves the pages were actually laid out under.
 */
export function takeReadReserves(session: object | undefined): ReadReserves | undefined {
  if (!session) return undefined;
  const read = readReports.get(session as LayoutSession);
  readReports.delete(session as LayoutSession);
  return read;
}

export function sectionReserveResume(
  session: LayoutSession | undefined,
  contextFor: (notesReserveKey: string) => string,
  reserves: ReadonlyMap<number, number> | undefined,
  pageIndexStart: number,
  seeded = false
): SectionReserveResume {
  const bound = reserveKeyBoundOf(session);
  const context = contextFor(notesReserveContextKey(reserves, pageIndexStart, bound));
  const moved =
    session && session.context !== context
      ? firstMovedReservePage(session, contextFor(''), reserves, pageIndexStart, bound)
      : undefined;
  // A pass starts with nothing reported; see `takeReadReserves`.
  if (session) readReports.delete(session);
  const reading = seeded && reserves !== undefined;
  /** Section-local page -> the reserve it read, for a seeded pass. */
  const reads = new Map<number, number>();
  let shift = 0;
  let tail: ReadReserves | undefined;
  /** By page shift: the last previous page whose reserve the shift breaks; see `tailHolds`. */
  const tailMismatches = new Map<number, number | null>();
  const reserveAt = (page: number): number | undefined => {
    if (!reading) return reserves?.get(pageIndexStart + page);
    let read = reads.get(page);
    if (read === undefined) {
      read = reserves.get(pageIndexStart + page - shift) ?? 0;
      reads.set(page, read);
    }
    return read;
  };
  /** The reserves this pass used, when they differ from the ones it was given. */
  const used = (pageCount: number): Map<number, number> | undefined => {
    if (!reading) return undefined;
    const out = new Map(reserves);
    let differs = false;
    for (const [page, height] of reads) {
      const index = pageIndexStart + page;
      if (page >= pageCount || (reserves.get(index) ?? 0) === height) continue;
      differs = true;
      if (height > 0) out.set(index, height);
      else out.delete(index);
    }
    if (tail) {
      differs = true;
      for (const index of [...out.keys()])
        if (index >= tail.from && index < tail.to) out.delete(index);
      for (const [index, height] of tail.reserves) out.set(index, height);
    }
    return differs ? out : undefined;
  };
  return {
    context,
    moved,
    // At least the last block is placed again. The previous layout a session holds can be the
    // published one, with note sheets minted after the body; handing it back unchanged would
    // pass those sheets off as body pages.
    resumeLimit: (checkpoints, firstChanged) =>
      moved === undefined
        ? firstChanged
        : Math.min(
            firstChanged,
            resumeLimitBeforePage(checkpoints, moved),
            Math.max(0, checkpoints.length - 2)
          ),
    tailHolds: (mark, pageCount) => {
      if (moved === undefined) return true;
      if (session === undefined) return false;
      // Asked at each block of each converging page: the reserves and the previous pass stay
      // as they are for the whole pass, so one comparison per page shift serves them all.
      const delta = pageCount - mark.pageCount;
      let last = tailMismatches.get(delta);
      if (last === undefined) {
        last = lastTailMismatch(session, reserves, pageIndexStart, delta);
        tailMismatches.set(delta, last);
      }
      return last !== null && last < mark.pageCount;
    },
    reserveAt,
    followShift: (next) => {
      shift = next;
    },
    shiftedTail: (mark, pageCount) => {
      const previous = session ? reserveContexts.get(session) : undefined;
      if (!reading || !previous || previous.base !== contextFor('')) return undefined;
      if ((reserveAt(pageCount) ?? 0) !== (previous.reserves.get(mark.pageCount) ?? 0))
        return undefined;
      const delta = pageCount - mark.pageCount;
      const shifted = new Map<number, number>();
      for (const [slot, height] of previous.reserves) {
        if (slot >= mark.pageCount && slot < previous.pageCount)
          shifted.set(pageIndexStart + slot + delta, height);
      }
      return {
        from: pageIndexStart + pageCount,
        to: pageIndexStart + previous.pageCount + delta,
        reserves: shifted,
      };
    },
    adoptShiftedTail: (next) => {
      tail = next;
    },
    publish: (target, pageCount) => {
      const read = used(pageCount);
      if (!read) {
        publishPassContext(target, contextFor, context, reserves, pageIndexStart, bound, pageCount);
        return;
      }
      const from = pageIndexStart;
      const to = pageIndexStart + pageCount;
      const own = new Map([...read].filter(([index]) => index >= from && index < to));
      if (session) readReports.set(session, { from, to, reserves: own });
      publishPassContext(
        target,
        contextFor,
        contextFor(notesReserveContextKey(read, pageIndexStart, bound)),
        read,
        pageIndexStart,
        bound,
        pageCount
      );
    },
  };
}
