// Where an inline insertion at a range edge lands, untracked or as one tracked insertion.
//
// Shared by the planners that insert one atom through an Office.js range method: a field
// (`insertField`) and an equation (`insertOoxml`). Before and Start use the range's start,
// After and End its end. Replace needs one paragraph: untracked, it removes the range and
// inserts at its start; tracked, it strikes the range and proposes the content after it, the
// order a tracked text replacement writes. The pending-revision rules are the ones a tracked
// text insertion follows, so another author's pending structure refuses the same way.

import { effectiveContentLockAt, isBoundAt } from '../store/store/tree-op-nodes.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { segmentsOf } from '../store/store/tree-op-segments.ts';
import type { RevisionAttributionInput } from '../store/store/tree-op-types.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import { revisionDateNow } from './revision-date.ts';
import type { PlannedOperation } from './plan.ts';
import type { AutomationErrorCode } from './protocol.ts';
import type { AutomationStoryReads } from './reads.ts';
import type { ResolvedRange } from './spans.ts';
import { proposalRevisionError } from './proposals.ts';
import { landsInForeignInsertionContainer } from './proposal-foreign-revisions.ts';
import { ownMarkDeletionRefusal } from './plan-proposal.ts';

/** The edge locations an inline insertion accepts. */
export type InlineInsertLocation = 'Before' | 'After' | 'Start' | 'End' | 'Replace';

/** Where the content goes, and the deletion that comes first. */
export interface InlineInsertPlacement {
  readonly paragraphId: string;
  /** The offset the inserted content starts at, once `ops` have applied. */
  readonly at: number;
  /** The removal (untracked) or strike (tracked) of a replaced range, when there is one. */
  readonly ops: readonly TreeDocOp[];
  /** The tracked insertion's attribution, present under `TrackMineOnly`. */
  readonly revision?: RevisionAttributionInput;
}

const refuse = (code: AutomationErrorCode, message: string, detail?: string): PlannedOperation => ({
  ok: false,
  error: { code, message, ...(detail === undefined ? {} : { detail }) },
});

/** Whether `offset` or the replaced range touches a locked or bound inline control. */
function touchesProtectedContent(
  story: AutomationStoryReads,
  paragraphId: string,
  start: number,
  end: number
): boolean {
  if (effectiveContentLockAt(story.part, paragraphId).content) return true;
  if (isBoundAt(story.part, paragraphId)) return true;
  const paragraph = findNode(story.part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return false;
  return segmentsOf(paragraph).some(
    (segment) =>
      (start === end
        ? segment.start < start && segment.end > start
        : segment.start < end && segment.end > start) &&
      (effectiveContentLockAt(story.part, segment.node.id).content ||
        isBoundAt(story.part, segment.node.id))
  );
}

/**
 * The placement for one inline insertion, or the refusal. `what` names the content in messages
 * ("field", "equation"). The paragraph is claimed for this operation.
 */
export function planInlineInsertPlacement(
  what: string,
  location: string,
  range: ResolvedRange,
  story: AutomationStoryReads,
  claim: (story: AutomationStoryReads, paragraphId: string) => PlannedOperation | null,
  trackingAuthor?: string
): InlineInsertPlacement | Extract<PlannedOperation, { ok: false }> {
  const refused = (code: AutomationErrorCode, message: string, detail?: string) =>
    refuse(code, message, detail) as Extract<PlannedOperation, { ok: false }>;
  const { start, end } = range;
  if (!['Before', 'After', 'Start', 'End', 'Replace'].includes(location))
    return refused('unsupported-content', `unsupported ${what} insert location`, 'invalidArgs');
  const replace = location === 'Replace';
  if (replace && start.paragraphId !== end.paragraphId)
    return refused(
      'unsupported-content',
      `${what} replacement requires one paragraph`,
      'invalid-range'
    );
  const point = location === 'After' || location === 'End' ? end : start;
  const paragraphId = point.paragraphId;
  const struck = replace && end.offset > start.offset;
  const from = struck ? start.offset : point.offset;
  const to = struck ? end.offset : point.offset;
  if (touchesProtectedContent(story, paragraphId, from, to))
    return refused('unsupported-content', `${what} insertion touches protected content`, 'locked');
  const claimed = (): Extract<PlannedOperation, { ok: false }> | null => {
    const conflict = claim(story, paragraphId);
    return conflict && !conflict.ok ? conflict : null;
  };
  if (trackingAuthor === undefined) {
    const conflict = claimed();
    if (conflict) return conflict;
    return {
      paragraphId,
      at: point.offset,
      ops: struck ? [{ op: 'deleteText', paragraphId, start: from, end: to }] : [],
    };
  }
  const author = trackingAuthor.trim();
  if (struck && from === 0) {
    const adjacent = ownMarkDeletionRefusal(story.part, paragraphId, author);
    if (adjacent && !adjacent.ok) return adjacent;
  }
  // The same pending-revision rules a tracked text insertion or replacement follows.
  const revisionError = proposalRevisionError(
    story,
    paragraphId,
    from,
    to,
    struck ? undefined : author,
    !struck && to === (story.rawText(paragraphId) ?? '').length,
    struck ? author : undefined,
    { author }
  );
  if (revisionError) return { ok: false, error: revisionError };
  if (landsInForeignInsertionContainer(story, paragraphId, to, author))
    return refused(
      'unsupported-revision',
      `the ${what} would land inside a container within another author's pending insertion`,
      'edit.tracked-foreign-revision-unsupported'
    );
  const conflict = claimed();
  if (conflict) return conflict;
  const revision = { author, date: revisionDateNow() };
  return {
    paragraphId,
    at: to,
    ops: struck ? [{ op: 'deleteText', paragraphId, start: from, end: to, revision }] : [],
    revision,
  };
}
