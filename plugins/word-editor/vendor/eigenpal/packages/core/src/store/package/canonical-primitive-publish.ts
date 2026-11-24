// Immediate primitive-journal publication.
//
// A journal's `spliceText` and `spliceChildren` effects carry ABSOLUTE positions, diffed
// against the tree the transaction committed against. Holding one back means it can reach
// shared state that a remote update has already moved. An interior stale offset is still
// inside bounds, so validation admits it: every replica then agrees on text nobody typed, or
// tombstones a node nobody deleted. Deferral traded that for keystroke latency, and the
// latency it bought was measured to be small — see
// `openspec/changes/full-document-yjs-collaboration/local-edit-baseline.md`.
//
// So publication is synchronous. The journal reaches its listener in the same frame as the
// commit, before any transport task can deliver a remote update, and positions always match
// the base state they were diffed against.
//
// The FIFO stays. Order between two journals is load-bearing, and a listener that edits the
// store it is publishing must not have its own journal stranded.

import {
  freezeCanonicalPrimitiveJournal,
  type CanonicalPrimitiveEffect,
  type CanonicalPrimitiveJournal,
} from './canonical-primitive-journal.ts';
import type { HistoryGroup } from '../store/history-group.ts';

interface PendingJournal {
  readonly store: object;
  readonly effects: CanonicalPrimitiveEffect[];
  readonly historyGroup: HistoryGroup | undefined;
  readonly outsideUndo: boolean;
}

type JournalListener = (journal: CanonicalPrimitiveJournal) => void;

const pending: PendingJournal[] = [];
const publishingStores = new Set<object>();
let listenersOf: (store: object) => ReadonlySet<JournalListener> | undefined = () => undefined;

export function bindCanonicalPrimitiveJournalListeners(
  lookup: (store: object) => ReadonlySet<JournalListener> | undefined
): void {
  listenersOf = lookup;
}

function notifyStore(store: object, journal: CanonicalPrimitiveJournal): void {
  const listeners = listenersOf(store);
  if (!listeners || listeners.size === 0) return;
  for (const listener of listeners) listener(journal);
}

function takePending(store?: object): PendingJournal[] {
  if (store === undefined) return pending.splice(0);
  const taken: PendingJournal[] = [];
  let index = 0;
  while (index < pending.length) {
    const item = pending[index]!;
    if (item.store === store) {
      taken.push(item);
      pending.splice(index, 1);
      continue;
    }
    index += 1;
  }
  return taken;
}

/**
 * True when this store has journals that have not been frozen or notified yet.
 *
 * Publication is synchronous, so this reads false immediately after a commit. It stays part
 * of the seam because a listener that transacts on the store it is publishing is the one case
 * that can still leave an item here for a moment.
 */
export function storeHasPendingCanonicalJournals(store: object): boolean {
  return pending.some((item) => item.store === store);
}

/** How many journals wait in the FIFO. Tests use this to watch for unbounded growth. */
export function pendingCanonicalJournalCount(store?: object): number {
  if (store === undefined) return pending.length;
  let count = 0;
  for (const item of pending) if (item.store === store) count += 1;
  return count;
}

/**
 * Publish anything still queued, in the order it was produced.
 *
 * Pass a store to drain only that document. Publication already happens at commit, so this is
 * a no-op on the ordinary path. Teardown and headless hosts keep calling it because a no-op
 * is cheaper than knowing whether the queue can be non-empty.
 */
export function flushPendingCanonicalJournals(store?: object): void {
  if (pending.length === 0) return;
  if (store !== undefined) publishStore(store);
  else for (const queued of distinctPendingStores()) publishStore(queued);
}

function distinctPendingStores(): object[] {
  const stores: object[] = [];
  for (const item of pending) if (!stores.includes(item.store)) stores.push(item.store);
  return stores;
}

/**
 * Re-entrancy is per store, not global.
 *
 * A second document publishing inside the first one's listener is not recursion: two replicas
 * in one process relay through each other, and a global guard dropped the second one's queue
 * on the floor. A server host holding two documents lost the same way.
 *
 * A listener that edits the store it is publishing enqueues from inside the loop below. Its
 * own call returns on the guard, so the item waits here instead of being stranded, and the
 * loop picks it up on the next pass. The loop ends because no listener in the engine answers
 * a journal with another journal: a refused journal republishes shared state through the
 * remote path, and that path records none.
 */
function publishStore(store: object): void {
  if (publishingStores.has(store)) return;
  publishingStores.add(store);
  try {
    for (;;) {
      const taken = takePending(store);
      if (taken.length === 0) return;
      for (const item of taken) {
        notifyStore(
          store,
          freezeCanonicalPrimitiveJournal(item.effects, item.historyGroup, item.outsideUndo)
        );
      }
    }
  } finally {
    publishingStores.delete(store);
  }
}

/**
 * Publish one committed journal.
 *
 * The caller is `runObservedStoreTransaction`, after the store transaction committed and its
 * capture frame was popped. The store is therefore consistent here, and a listener may read
 * it or transact on it again.
 */
export function publishCanonicalPrimitiveJournal(
  store: object,
  effects: CanonicalPrimitiveEffect[],
  historyGroup?: HistoryGroup,
  outsideUndo = false
): void {
  pending.push({ store, effects, historyGroup, outsideUndo });
  publishStore(store);
}
