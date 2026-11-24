// Session-scoped content-control enumeration cache and warm-path recorder.
//
// Kept separate from `content-controls.ts` so the facade module stays under the line cap.

import type { ContentControlSummary } from '../contracts/document.ts';
import type { TreeDocxSessionView } from '../binding/tree-session.ts';
import { DEPENDENCY_KEY_IDS, ORIGIN_IDS } from '../store/registry/frozen-ids.ts';
import type { TreeModelChange } from '../store/store/tree-store.ts';

interface ContentControlEnumerationCache {
  summaries: readonly ContentControlSummary[] | null;
  subscribed: boolean;
}

let contentControlEnumerationRebuilds = 0;
let contentControlTopLevelVisits = 0;
let contentControlTraversalVisits = 0;

/** @internal Warm-path recorder for content-control enumeration tests. */
export function contentControlEnumerationTestRecorder(): {
  readonly rebuilds: number;
  readonly topLevelVisits: number;
  readonly controlVisits: number;
  reset(): void;
} {
  return {
    get rebuilds() {
      return contentControlEnumerationRebuilds;
    },
    get topLevelVisits() {
      return contentControlTopLevelVisits;
    },
    get controlVisits() {
      return contentControlTraversalVisits;
    },
    reset() {
      contentControlEnumerationRebuilds = 0;
      contentControlTopLevelVisits = 0;
      contentControlTraversalVisits = 0;
    },
  };
}

const enumerationCacheBySession = new WeakMap<
  TreeDocxSessionView,
  ContentControlEnumerationCache
>();

function preservesContentControlEnumeration(change: TreeModelChange): boolean {
  if (!change.story) return false;
  if (change.origin === ORIGIN_IDS.mutationUndo || change.origin === ORIGIN_IDS.mutationRedo) {
    return false;
  }
  if (change.impact !== 'text-local') return false;
  if (change.created.length > 0 || change.deleted.length > 0 || change.splitJoin.length > 0) {
    return false;
  }
  if (change.dependencyKeys.some((key) => key !== DEPENDENCY_KEY_IDS.story)) return false;
  return true;
}

function onContentControlModelChange(
  entry: ContentControlEnumerationCache,
  change: TreeModelChange
): void {
  if (preservesContentControlEnumeration(change)) return;
  entry.summaries = null;
}

function ensureContentControlSubscription(
  session: TreeDocxSessionView,
  entry: ContentControlEnumerationCache
): void {
  if (entry.subscribed) return;
  entry.subscribed = true;
  session.subscribe((change) => onContentControlModelChange(entry, change));
}

/** Record one top-level story walk during a cold enumeration rebuild. */
export function noteContentControlEnumerationTopLevelVisit(): void {
  contentControlTopLevelVisits += 1;
}

/** Record control entries visited during a cold enumeration rebuild. */
export function noteContentControlEnumerationControlVisits(count: number): void {
  contentControlTraversalVisits += count;
}

/**
 * Cached full-document content-control summaries for one session.
 *
 * `rebuild` performs the cold walk; this module owns invalidation and reuse.
 */
export function cachedContentControlSummaries(
  session: TreeDocxSessionView,
  rebuild: () => readonly ContentControlSummary[]
): readonly ContentControlSummary[] {
  let entry = enumerationCacheBySession.get(session);
  if (!entry) {
    entry = { summaries: null, subscribed: false };
    enumerationCacheBySession.set(session, entry);
  }
  ensureContentControlSubscription(session, entry);
  if (!entry.summaries) {
    contentControlEnumerationRebuilds += 1;
    entry.summaries = rebuild();
  }
  return entry.summaries;
}
