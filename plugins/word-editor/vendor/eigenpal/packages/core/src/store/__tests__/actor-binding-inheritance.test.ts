// Nesting rule for the transaction actor binding.
//
// `TreeDocumentStore.transact` binds through `runWithTransactionActor` on EVERY call, and most
// callers pass no actor. If that cleared the binding, an actor bound by an outer boundary would
// be gone for the mints inside the transaction — the exact place ids are minted — and both
// replicas would go back to computing the same "one past the highest" value.
//
// `resolveAllocationActor` is the seam every mint site resolves through, so asserting on it is
// asserting on what the minters see.

import { describe, expect, it } from 'bun:test';
import {
  resolveAllocationActor,
  runWithTransactionActor,
  transactionActorId,
} from '../package/actor-scoped-ids.ts';

describe('transaction actor binding', () => {
  it('inherits the enclosing actor when a nested bind supplies none', () => {
    runWithTransactionActor('actor-a', () => {
      expect(transactionActorId()).toBe('actor-a');
      runWithTransactionActor(undefined, () => {
        expect(transactionActorId()).toBe('actor-a');
        // What a mint inside that nested transaction would use.
        expect(resolveAllocationActor()).toBe('actor-a');
      });
      expect(transactionActorId()).toBe('actor-a');
    });
  });

  it('lets a nested bind override with its own actor and restores the outer one', () => {
    runWithTransactionActor('actor-a', () => {
      runWithTransactionActor('actor-b', () => {
        expect(transactionActorId()).toBe('actor-b');
      });
      expect(transactionActorId()).toBe('actor-a');
    });
    expect(transactionActorId()).toBeUndefined();
  });

  it('restores the previous actor even when the body throws', () => {
    runWithTransactionActor('actor-a', () => {
      expect(() =>
        runWithTransactionActor('actor-b', () => {
          throw new Error('boom');
        })
      ).toThrow('boom');
      expect(transactionActorId()).toBe('actor-a');
    });
    expect(transactionActorId()).toBeUndefined();
  });

  it('resolves to no actor outside any binding, which is the solo Word-like path', () => {
    expect(transactionActorId()).toBeUndefined();
    expect(resolveAllocationActor()).toBeUndefined();
  });

  it('prefers an explicitly supplied actor over the bound one', () => {
    runWithTransactionActor('actor-a', () => {
      expect(resolveAllocationActor('actor-explicit')).toBe('actor-explicit');
    });
  });
});
