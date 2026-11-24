// The footnote pagination a document gets when it is laid out in one pass, found in the
// background after any other route reached its pagination.
//
// Footnote reserves come from a search that adopts what the pages need until the answer is
// stable, and a document can have more than one stable answer. Which one the search finds
// depends on where it starts: an edit starts from the pagination before the edit, and a large
// open starts each body prefix from the prefix before it. A document laid out in one pass
// starts from no reserves. So the same saved bytes could paginate one way after an edit, a
// second way when opened in prefixes, and a third way on a host that lays out in one pass.
//
// Here, after the visible layout settles, the same pass runs again from no reserves in a fresh
// layout session, a few milliseconds at a time, sharing only the caches that cannot change a
// result. If it finds other reserves than the live session, its session and layout replace
// the live ones. A newer revision drops the background pass; the live session never sees it.
// A layout whose page starts, notes, and reserves equal the last verified one is not checked
// again: an edit that moved none of them, such as typing inside a line, cannot move the answer
// the search reads it from.

import type { LayoutSession } from '../layout/layout-session.ts';
import type { LayoutSteps } from '../layout/layout-steps.ts';
import { footnoteReservesEqual } from '../layout/note-reserves.ts';
import { footnoteReservesFingerprint } from '../layout/note-reserves.ts';
import type { PageRecord, SemanticLayout } from '../layout/semantic-records.ts';

/** Idle time after the last published layout before the background pass starts. */
const START_DELAY_MS = 1000;
/** Background slice length, in milliseconds: short enough to leave room for a frame. */
const SLICE_MS = 12;
/** Wait before checking again while a pass or an opening is still finishing. */
const BUSY_RETRY_MS = 100;

export interface CanonicalLayoutHost {
  now(): number;
  /** Run `run` after `delayMs` on the pages' window; answers a cancel. */
  schedule(run: () => void, delayMs: number): () => void;
  /** The model revision now. */
  revision(): number;
  /** The live layout session. */
  live(): LayoutSession;
  /** The layout on screen now. */
  current(): SemanticLayout | null;
  /** Whether a pass of the live session is still finishing (deferred tail, opening slices). */
  busy(): boolean;
  /** A full layout of `revision` in `session`, as steps. */
  pass(revision: number, session: LayoutSession): LayoutSteps<SemanticLayout>;
  /** A new, empty layout session. */
  createSession(): LayoutSession;
  /** Make `session` the live one and publish its `layout`. */
  adopt(session: LayoutSession, layout: SemanticLayout): void;
}

export interface CanonicalLayout {
  /** A layout of the live session was published: check it again once things are idle. */
  request(): void;
  /**
   * Drop any background pass and stop for good: for teardown. A layout published after it
   * (the flush teardown runs) starts nothing.
   */
  cancel(): void;
}

/** Where each page starts, which notes it holds, and the reserves: what the search reads. */
function pagesSignature(layout: SemanticLayout, reserves: ReadonlyMap<number, number>): string {
  const pageStart = (page: PageRecord): string => {
    const first = page.fragments[0];
    if (!first) return '';
    const line = first.kind === 'paragraph' ? first.lines[0] : undefined;
    return `${first.id}:${line?.range.start ?? ''}`;
  };
  const notes = (page: PageRecord): string =>
    (page.footnotes?.notes ?? [])
      .map((note) => `${note.noteId}${note.continuation ? 'c' : ''}:${note.box.height}`)
      .join(',');
  return `${layout.pages.map((page) => `${pageStart(page)}/${notes(page)}`).join('|')}#${footnoteReservesFingerprint(reserves)}`;
}

export function createCanonicalLayout(host: CanonicalLayoutHost): CanonicalLayout {
  let cancelTimer: (() => void) | null = null;
  let adopting = false;
  let disposed = false;
  /** The signature of the last layout a background pass confirmed or published. */
  let verified: string | null = null;

  const stop = (): void => {
    cancelTimer?.();
    cancelTimer = null;
  };
  const later = (run: () => void, delayMs: number): void => {
    stop();
    if (disposed) return;
    cancelTimer = host.schedule(() => {
      cancelTimer = null;
      if (!disposed) run();
    }, delayMs);
  };

  const start = (): void => {
    if (host.busy()) return later(start, BUSY_RETRY_MS);
    const reserves = host.live().notePageBottomReserves;
    const current = host.current();
    // Only a document with footnote reserves can have more than one stable answer.
    if (!reserves || !current) return;
    const signature = pagesSignature(current, reserves);
    if (signature === verified) return;
    const revision = host.revision();
    const session = host.createSession();
    const steps = host.pass(revision, session);
    const slice = (): void => {
      if (host.revision() !== revision) return;
      const deadline = host.now() + SLICE_MS;
      for (;;) {
        const next = steps.next();
        if (next.done) return settle(next.value);
        if (host.now() >= deadline) break;
      }
      later(slice, 0);
    };
    const settle = (layout: SemanticLayout): void => {
      if (host.revision() !== revision) return;
      // The live answer can still move while its own pass finishes; compare after that.
      if (host.busy()) return later(() => settle(layout), BUSY_RETRY_MS);
      const live = host.live().notePageBottomReserves;
      const found = session.notePageBottomReserves ?? new Map<number, number>();
      if (live && footnoteReservesEqual(live, found)) {
        verified = signature;
        return;
      }
      adopting = true;
      try {
        host.adopt(session, layout);
      } finally {
        adopting = false;
      }
      verified = pagesSignature(layout, found);
    };
    slice();
  };

  return {
    request() {
      if (adopting || disposed) return;
      later(start, START_DELAY_MS);
    },
    cancel() {
      disposed = true;
      stop();
    },
  };
}
