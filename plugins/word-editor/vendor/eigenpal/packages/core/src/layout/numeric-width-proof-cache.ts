import type { PendingLine } from './pending-line.ts';
import { widthComparisonProofHolds, type WidthComparisonProof } from './width-comparison-proof.ts';

export interface NumericWidthProof extends WidthComparisonProof {
  readonly minimumAvailable: number;
}

const proofs = new WeakMap<readonly PendingLine[], NumericWidthProof>();

export function numericWidthProofOf(lines: readonly PendingLine[]): NumericWidthProof | undefined {
  return proofs.get(lines);
}

export function numericLinesHoldAtWidth(lines: readonly PendingLine[], available: number): boolean {
  const proof = proofs.get(lines);
  return (
    !!proof && available >= proof.minimumAvailable && widthComparisonProofHolds(proof, available)
  );
}

/** Caller proves the complete numeric paragraph and the actual break decisions. */
export function rememberNumericWidthProof(
  lines: readonly PendingLine[],
  proof: NumericWidthProof
): void {
  proofs.set(lines, proof);
}

/** Copy scalar proof ownership when the cache freezes the same pending lines. */
export function carryNumericWidthProof(
  from: readonly PendingLine[],
  to: readonly PendingLine[]
): void {
  const proof = proofs.get(from);
  if (proof) proofs.set(to, proof);
}
