import type { PendingLine } from './pending-line.ts';

/** An oversized opening word can use the remaining measure after authored leading tabs. */
export function wordFollowsOnlyTabs(line: PendingLine, wordStart: number): boolean {
  if (wordStart <= 0 || line.drawings.length > 0) return false;
  for (let index = 0; index < wordStart; index += 1) {
    const span = line.spans[index]!;
    if (span.text !== '\t' || span.projected || span.fieldAtom || span.noteNav) return false;
  }
  return true;
}
