import type { BlockFragmentRecord } from './semantic-records.ts';

// Review attribution and drawing presence can stay unchanged when text and geometry move.
// Empty tokens retain neither previous block arrays nor earlier layout records.
const identities = new WeakMap<readonly BlockFragmentRecord[], object>();
export function blockMetadataIdentity(blocks: readonly BlockFragmentRecord[]): object {
  let identity = identities.get(blocks);
  if (!identity) identities.set(blocks, (identity = {}));
  return identity;
}

/** Caller proves identical attribution order and drawing presence on every block. */
export function carryBlockMetadataIdentity(
  previous: readonly BlockFragmentRecord[],
  next: readonly BlockFragmentRecord[]
): void {
  identities.set(next, blockMetadataIdentity(previous));
}
