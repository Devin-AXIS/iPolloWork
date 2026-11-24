// Custom-node write through the package coordinator, so collaboration can journal it.
//
// `insertCustomNodeWrite` commits on the story store. The coordinator then grafts the new
// customXml parts onto the package. That path never entered `TreePackageStore.transact`, so
// a bound control replicated as a `w:sdt` whose store a peer never received.
//
// Capture is armed around the story write when the package store has observers. The graft,
// shell replace, and publish stay the sequence the session already used.

import {
  packageTransactionPublished,
  runObservedStoreTransaction,
} from '../package/canonical-primitive-capture.ts';
import {
  insertCustomNodeWrite,
  removeCustomNodeWrite,
  type CustomNodeWriteResult,
  type InsertCustomNodeWrite,
} from './custom-node-writes.ts';
import type { TreeDocumentStore } from './tree-store.ts';
import type { StoryScope, TreePackageStore } from './tree-package-store.ts';
import type { HistoryGroup } from './history-group.ts';

const BODY: StoryScope = { kind: 'body' };

function publishCustomNodeWrite(
  packageStore: TreePackageStore,
  scope: StoryScope,
  run: (store: TreeDocumentStore) => CustomNodeWriteResult,
  historyGroup?: HistoryGroup
): CustomNodeWriteResult {
  const resolved = scope.kind === 'body' ? null : packageStore.resolveStory(scope);
  const store = resolved?.ok ? resolved.store : packageStore.bodyStore();
  const beforePackage = packageStore.currentPackage();
  const checkpoint = store.checkpoint();
  store.graftPackage(() => packageStore.currentPackage());
  return runObservedStoreTransaction(
    packageStore,
    () => {
      const result = run(store);
      if (!result.ok) return result;
      store.restoreHistoryStacks(checkpoint);
      packageStore.replacePackageShell(store.package);
      packageStore.adoptGroupedPackageUnit(beforePackage, historyGroup);
      packageStore.publishStoryWrite(result.change);
      return result;
    },
    (result) => packageTransactionPublished(result),
    historyGroup
  );
}

/**
 * Insert a custom node on one story and publish the new package shell.
 *
 * The store hangs off the main document part even when the control lands in a header:
 * Word enumerates data stores from that part and nowhere else.
 */
export function insertPackageCustomNode(
  packageStore: TreePackageStore,
  write: InsertCustomNodeWrite,
  scope: StoryScope = BODY,
  historyGroup?: HistoryGroup
): CustomNodeWriteResult {
  return publishCustomNodeWrite(
    packageStore,
    scope,
    (store) => insertCustomNodeWrite(store, write, packageStore.bodyStore().part.name),
    historyGroup
  );
}

/** Remove a custom node and the payload it bound, then publish the new package shell. */
export function removePackageCustomNode(
  packageStore: TreePackageStore,
  controlNodeId: string,
  scope: StoryScope = BODY
): CustomNodeWriteResult {
  return publishCustomNodeWrite(packageStore, scope, (store) =>
    removeCustomNodeWrite(store, controlNodeId)
  );
}
