/**
 * Provider-neutral observation of one canonical primitive journal per store transaction.
 *
 * Collaboration implementations subscribe here. Core captures the journal without a CRDT.
 */

import type { TreePackageStore } from '../store/store/tree-package-store.ts';
import { observeCanonicalPrimitiveJournal as observeStoreJournal } from '../store/package/canonical-primitive-capture.ts';
import type { CanonicalPrimitiveJournal } from '../store/package/canonical-primitive-journal.ts';

export {
  flushPendingCanonicalJournals,
  pendingCanonicalJournalCount,
  storeHasPendingCanonicalJournals,
} from '../store/package/canonical-primitive-publish.ts';
export {
  historyGroupOfJournal,
  isJournalOutsideUndo,
} from '../store/package/canonical-primitive-journal.ts';

export type {
  CanonicalAttributeName,
  CanonicalBinaryDescriptor,
  CanonicalElementNodeDescriptor,
  CanonicalNodeDescriptor,
  CanonicalPrimitiveEffect,
  CanonicalPrimitiveJournal,
  CanonicalRelationshipRecord,
  CanonicalTextNodeDescriptor,
} from '../store/package/canonical-primitive-journal.ts';

/**
 * Subscribe to one settled journal per committed package-store transaction.
 *
 * Internal observation helper. The public seam is
 * `CollaborationDocumentPort.observePrimitiveJournal`.
 */
export function observeCanonicalPrimitiveJournal(
  store: TreePackageStore,
  listener: (journal: CanonicalPrimitiveJournal) => void
): () => void {
  return observeStoreJournal(store, listener);
}
