// Which `replaceAllMatches` ranges the store would refuse, asked BEFORE any commit.
//
// A refused commit is found only by running it, and each run applies the ops and lays the
// story out. Asking the store's own rules per range first keeps a normal run to one commit
// per story, however many locked or struck matches the document holds.

import { findNode } from '../store/package/ooxml-edit.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import { rangeTouchesContentRestriction } from '../store/store/tree-op-validate-controls.ts';
import type { TreeOpRejection } from '../store/store/tree-op-rejection.ts';
import { rangeOverlapsRemovedText } from './removed-text-spans.ts';

/** Why a range is skipped: struck text, or the store rule (a lock, a binding) that refuses it. */
export type MatchRangeSkip = 'deleted' | TreeOpRejection;

/**
 * Why one match cannot be replaced in place, or null. `landing` is where its insertion goes.
 * Struck text is skipped in every mode: replacing it again would stack a second proposal on a
 * removed word, and editing mode would turn a pending deletion into plain text.
 */
export function matchRangeSkip(
  part: OoxmlPart,
  paragraphId: string,
  start: number,
  end: number,
  landing: number
): MatchRangeSkip | null {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return 'locked';
  if (rangeOverlapsRemovedText(paragraph, start, end)) return 'deleted';
  return (
    rangeTouchesContentRestriction(part, paragraph, start, end) ??
    rangeTouchesContentRestriction(part, paragraph, landing, landing)
  );
}
