// Transaction-local journal capture. Allocation happens only while a store transaction
// has at least one observer. Primitive call sites check the active capture before they
// build an effect, so a disabled observer path does not allocate a journal.
//
// Capture isolation is a synchronous frame stack. Every store transaction pushes one
// frame, including an unobserved transaction nested under an observed one. Recording
// targets only the top observed frame. Suppression is local to that frame.

import type {
  CanonicalAttributeName,
  CanonicalBinaryDescriptor,
  CanonicalNodeDescriptor,
  CanonicalPrimitiveEffect,
  CanonicalPrimitiveJournal,
} from './canonical-primitive-journal.ts';
import {
  bindCanonicalPrimitiveJournalListeners,
  publishCanonicalPrimitiveJournal,
} from './canonical-primitive-publish.ts';
import { partNameKey } from './opc-names.ts';
import type { RelationshipRecord } from './relationships.ts';
import type { HistoryGroup } from '../store/history-group.ts';

export {
  flushPendingCanonicalJournals,
  pendingCanonicalJournalCount,
  storeHasPendingCanonicalJournals,
} from './canonical-primitive-publish.ts';

interface CaptureFrame {
  readonly observed: boolean;
  readonly effects: CanonicalPrimitiveEffect[] | null;
  /** The gesture the transaction named, carried onto the journal it publishes. */
  readonly historyGroup: HistoryGroup | undefined;
  /** Opened inside `runOutsideSharedUndo`: the journal is marked to stay out of undo. */
  readonly outsideUndo: boolean;
  suppressDepth: number;
}

let outsideUndoArmed = false;

/**
 * Run `body`, one store transaction, so that the journal it publishes is marked outside
 * shared undo (`isJournalOutsideUndo`). Only that transaction's frame takes the mark: a
 * transaction a subscriber opens while it publishes is an ordinary one. Local history is the
 * caller's own choice; this marks only the published journal.
 */
export function runOutsideSharedUndo<T>(body: () => T): T {
  const previous = outsideUndoArmed;
  outsideUndoArmed = true;
  try {
    return body();
  } finally {
    outsideUndoArmed = previous;
  }
}

const observersByStore = new WeakMap<object, Set<(journal: CanonicalPrimitiveJournal) => void>>();

const frames: CaptureFrame[] = [];
let allocationCount = 0;

/** How many journals this process has allocated. Tests use this for the disabled path. */
export function canonicalPrimitiveJournalAllocationCount(): number {
  return allocationCount;
}

function topFrame(): CaptureFrame | undefined {
  return frames[frames.length - 1];
}

/** Length of the current observed frame's effect list. Used to drop a capture that then failed. */
export function journalCaptureMark(): number {
  return topFrame()?.effects?.length ?? 0;
}

/** Drop effects recorded after {@link journalCaptureMark}, when the edit that produced them failed. */
export function truncateJournalCapture(mark: number): void {
  const frame = topFrame();
  if (!frame?.effects || frame.effects.length <= mark) return;
  frame.effects.length = mark;
}

let spliceHints: ReadonlyMap<string, number> | null = null;

/**
 * Run an edit with the offset in each text value where it inserts. A text compared before and
 * after cannot tell which of two equal letters is new, so the lowering asks these first.
 */
export function withTextSpliceHints<T>(hints: ReadonlyMap<string, number>, run: () => T): T {
  const outer = spliceHints;
  spliceHints = hints;
  try {
    return run();
  } finally {
    spliceHints = outer;
  }
}

/** Where the running edit inserts into a text value, when it said. */
export function textSpliceHint(logicalId: string): number | undefined {
  return spliceHints?.get(logicalId);
}

/** True only while the top frame is observed and that frame is not suppressed. */
export function isCanonicalPrimitiveCaptureActive(): boolean {
  const frame = topFrame();
  return frame !== undefined && frame.observed && frame.suppressDepth === 0;
}

/**
 * Subscribe to one settled journal per committed `TreePackageStore` transaction.
 *
 * No journal is allocated until a later observed transaction starts.
 */
export function observeCanonicalPrimitiveJournal(
  store: object,
  listener: (journal: CanonicalPrimitiveJournal) => void
): () => void {
  let listeners = observersByStore.get(store);
  if (!listeners) {
    listeners = new Set();
    observersByStore.set(store, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) observersByStore.delete(store);
  };
}

bindCanonicalPrimitiveJournalListeners((store) => observersByStore.get(store));

function storeObserverCount(store: object): number {
  return observersByStore.get(store)?.size ?? 0;
}

function pushFrame(observed: boolean, historyGroup: HistoryGroup | undefined): void {
  const effects = observed ? [] : null;
  if (observed) allocationCount += 1;
  const outsideUndo = outsideUndoArmed;
  outsideUndoArmed = false;
  frames.push({ observed, effects, historyGroup, outsideUndo, suppressDepth: 0 });
}

function popFrame(): CaptureFrame | undefined {
  return frames.pop();
}

/**
 * Run one store transaction. Capture is armed only when that store has observers.
 *
 * A rejected or identity result discards the journal and notifies nobody. A committed one
 * publishes here, in this frame: the journal's positions describe the tree this transaction
 * just left behind, and nothing else may move that tree first.
 */
export function runObservedStoreTransaction<T>(
  store: object,
  run: () => T,
  committed: (result: NoInfer<T>) => boolean,
  historyGroup?: HistoryGroup
): T {
  const observed = storeObserverCount(store) > 0;
  pushFrame(observed, historyGroup);
  try {
    const result = run();
    const frame = popFrame();
    if (observed && frame?.effects && committed(result)) {
      publishCanonicalPrimitiveJournal(store, frame.effects, frame.historyGroup, frame.outsideUndo);
    }
    return result;
  } catch (error) {
    popFrame();
    throw error;
  }
}

/** Whether a package transact result published a change. */
export function packageTransactionPublished(
  result: { readonly ok: false } | { readonly ok: true; readonly change: unknown }
): boolean {
  return result.ok && result.change != null;
}

/**
 * Run a nested package hook without recording its inner tree splices.
 *
 * Relationship, content-type, part-delete, and binary hooks are first-class effects.
 * Suppression applies only to the current frame.
 */
export function runWithoutJournalCapture<T>(run: () => T): T {
  const frame = topFrame();
  if (!frame) return run();
  frame.suppressDepth += 1;
  try {
    return run();
  } finally {
    frame.suppressDepth -= 1;
  }
}

function record(effect: CanonicalPrimitiveEffect): void {
  const frame = topFrame();
  if (!frame || !frame.observed || frame.suppressDepth !== 0 || !frame.effects) return;
  frame.effects.push(effect);
}

export function recordPutNode(descriptor: CanonicalNodeDescriptor): void {
  record({ kind: 'putNode', descriptor });
}

export function recordSpliceText(
  logicalId: string,
  utf16Start: number,
  deleteCount: number,
  insert: string
): void {
  if (deleteCount === 0 && insert.length === 0) return;
  record({ kind: 'spliceText', logicalId, utf16Start, deleteCount, insert });
}

export function recordSetAttribute(
  logicalId: string,
  qname: CanonicalAttributeName,
  value: string | null
): void {
  record({ kind: 'setAttribute', logicalId, qname, value });
}

export function recordSetNamespaceBinding(
  logicalId: string,
  prefix: string,
  uri: string | null
): void {
  record({ kind: 'setNamespaceBinding', logicalId, prefix, uri });
}

export function recordSpliceChildren(
  parentLogicalId: string,
  start: number,
  deleteCount: number,
  childLogicalIds: readonly string[]
): void {
  if (deleteCount === 0 && childLogicalIds.length === 0) return;
  record({
    kind: 'spliceChildren',
    parentLogicalId,
    start,
    deleteCount,
    childLogicalIds,
  });
}

export function recordMoveNode(
  logicalId: string,
  destinationParentLogicalId: string,
  destinationIndex: number
): void {
  record({
    kind: 'moveNode',
    logicalId,
    destinationParentLogicalId,
    destinationIndex,
  });
}

export function recordPutXmlPart(name: string, rootLogicalId: string): void {
  record({ kind: 'putXmlPart', name, rootLogicalId });
}

export function recordDeleteXmlPart(name: string): void {
  record({ kind: 'deleteXmlPart', name });
}

export function recordPutRelationship(owner: string, recordValue: RelationshipRecord): void {
  record({ kind: 'putRelationship', owner, record: recordValue });
}

export function recordDeleteRelationship(owner: string, relationshipId: string): void {
  record({ kind: 'deleteRelationship', owner, relationshipId });
}

export function recordPutContentTypeOverride(partName: string, mediaType: string): void {
  // The package index stores Override keys case-folded. Recording the authored spelling
  // left `/customXml/itemProps1.xml` in the journal; a peer looks up
  // `/customxml/itemprops1.xml` and falls through to Default `application/xml`. Then
  // `findCustomXmlDataPart` refuses the props part, and a bound control names a store
  // the reader will not load.
  record({ kind: 'putContentTypeOverride', partName: partNameKey(partName), mediaType });
}

export function recordDeleteContentTypeOverride(partName: string): void {
  record({ kind: 'deleteContentTypeOverride', partName: partNameKey(partName) });
}

export function recordPutBinary(descriptor: CanonicalBinaryDescriptor): void {
  record({ kind: 'putBinary', descriptor });
}

export function recordDeleteBinary(storageKey: string): void {
  record({ kind: 'deleteBinary', storageKey });
}
