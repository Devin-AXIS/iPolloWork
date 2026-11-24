// Immediate journal publication.
//
// A journal carries absolute positions against the tree its transaction committed against, so
// it must reach its listener before anything else can move that tree. Publication is therefore
// part of the commit, not a later task.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  flushPendingCanonicalJournals,
  observeCanonicalPrimitiveJournal,
  storeHasPendingCanonicalJournals,
} from '../../collaboration/primitive-journal.ts';
import {
  packageTransactionPublished,
  recordMoveNode,
  runObservedStoreTransaction,
} from '../package/canonical-primitive-capture.ts';

afterEach(() => {
  flushPendingCanonicalJournals();
});

function commit(host: object, id: string): void {
  runObservedStoreTransaction(
    host,
    () => {
      recordMoveNode(id, 'parent', 0);
      return { ok: true, change: true };
    },
    packageTransactionPublished
  );
}

describe('canonical primitive journal publication', () => {
  test('a committed transaction publishes before it returns', () => {
    const host = {};
    const journals: unknown[] = [];
    observeCanonicalPrimitiveJournal(host, (journal) => journals.push(journal));
    commit(host, 'n1');
    expect(journals).toHaveLength(1);
    expect(storeHasPendingCanonicalJournals(host)).toBe(false);
  });

  test('without observers a committed transaction publishes nothing', () => {
    const host = {};
    runObservedStoreTransaction(
      host,
      () => {
        recordMoveNode('n1', 'parent', 0);
        return { ok: true, change: true };
      },
      packageTransactionPublished
    );
    expect(storeHasPendingCanonicalJournals(host)).toBe(false);
  });

  test('two journals reach one listener in the order they committed', () => {
    const host = {};
    const seen: string[] = [];
    observeCanonicalPrimitiveJournal(host, (journal) => {
      const effect = journal.effects[0];
      seen.push(effect?.kind === 'moveNode' ? effect.logicalId : 'other');
    });
    commit(host, 'first');
    commit(host, 'second');
    expect(seen).toEqual(['first', 'second']);
  });

  test('a listener that edits the store it is publishing keeps its own journal', () => {
    // The nested commit cannot publish from inside the outer notify, so it waits in the FIFO.
    // Stranding it there would drop an edit with no error, which is what the drain loop in
    // `publishStore` exists to prevent.
    const host = {};
    const seen: string[] = [];
    let nested = false;
    observeCanonicalPrimitiveJournal(host, (journal) => {
      const effect = journal.effects[0];
      seen.push(effect?.kind === 'moveNode' ? effect.logicalId : 'other');
      if (nested) return;
      nested = true;
      commit(host, 'from-listener');
    });
    commit(host, 'outer');
    expect(seen).toEqual(['outer', 'from-listener']);
    expect(storeHasPendingCanonicalJournals(host)).toBe(false);
  });
});
