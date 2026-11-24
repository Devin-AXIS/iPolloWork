import { frozenLine, type PendingLine } from './pending-line.ts';
import { carryNumericWidthProof } from './numeric-width-proof-cache.ts';
import type { ParagraphLayoutCache } from './layout-cache.ts';

/** Preserve snapshot ownership and scalar break proofs at both cache write boundaries. */
export function storePendingLines(
  cache: ParagraphLayoutCache<readonly PendingLine[]> | undefined,
  key: string | null,
  lines: readonly PendingLine[]
): void {
  if (!cache || key === null) return;
  const retained = cache.retainAcrossPasses === false ? lines : lines.map(frozenLine);
  carryNumericWidthProof(lines, retained);
  cache.set(key, retained);
}
