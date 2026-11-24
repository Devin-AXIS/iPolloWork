import { canTrackContentControl } from '../store/store/tracked-content-control-insert.ts';
import { CONTENT_CONTROL_SUBTYPES, allControlsUnder } from './content-control-input.ts';
import { proposalRevisionError } from './proposals.ts';
import { revisionDateNow } from './revision-date.ts';
import { resolveSpanRef, storyOfSpanRef } from './spans.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation } from './operations.ts';
import type { AutomationErrorCode } from './protocol.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import type { PlannedOperation } from './plan-types.ts';

export function planContentControlInsertion(
  operation: Extract<AutomationOperation, { op: 'insertContentControl' }>,
  handles: AutomationHandleTable,
  packageReads: AutomationPackageReads,
  trackingAuthor: string | undefined,
  trackedRangeReplacement: boolean | undefined,
  claim: (story: AutomationStoryReads, paragraphId: string) => PlannedOperation | null
): PlannedOperation {
  const tracked = !!trackingAuthor;
  const refuse = (
    code: AutomationErrorCode,
    message: string,
    detail?: string
  ): PlannedOperation => ({ ok: false, error: { code, message, ...(detail ? { detail } : {}) } });
  if (tracked && trackedRangeReplacement === false)
    return refuse(
      'unsupported-capability',
      'tracked content-control creation is unsupported in collaboration'
    );
  const resolved = resolveSpanRef(operation.span, handles, packageReads);
  if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
  if (!resolved.value)
    return refuse('invalid-offset', 'that story holds nothing to wrap', 'empty-story');
  const storyResult = storyOfSpanRef(operation.span, handles, packageReads);
  const story = storyResult.ok ? storyResult.value : null;
  if (!story) return refuse('invalid-handle', 'that story is not in this document');
  const range = resolved.value;
  // ONE PARAGRAPH: a control that starts in one paragraph and ends in another is a BLOCK
  // control over both, which is a different wrapper than the inline one this operation
  // authors. Refused rather than guessed, so a caller learns which they asked for.
  if (range.start.paragraphId !== range.end.paragraphId) {
    return refuse(
      'unsupported-content',
      'wrapping several paragraphs in one control is not supported here',
      'multi-paragraph'
    );
  }
  if (!CONTENT_CONTROL_SUBTYPES.has(operation.subtype)) {
    return refuse('unsupported-content', 'that control type cannot be inserted', operation.subtype);
  }
  if (tracked) {
    if (
      !canTrackContentControl(
        story.part,
        range.start.paragraphId,
        range.start.offset,
        range.end.offset
      )
    )
      return refuse(
        'unsupported-capability',
        'tracked controls require a nonempty ordinary text range without existing review markup'
      );
    const error = proposalRevisionError(
      story,
      range.start.paragraphId,
      range.start.offset,
      range.end.offset
    );
    if (error) return { ok: false, error };
  }
  const existingControlIds = new Set(allControlsUnder(story.root).map((node) => node.id));
  const conflict = claim(story, range.start.paragraphId);
  if (conflict) return conflict;
  return {
    ok: true,
    kind: 'command',
    story: story.story,
    ops: [
      {
        op: 'insertContentControl',
        paragraphId: range.start.paragraphId,
        start: range.start.offset,
        end: range.end.offset,
        type: operation.subtype,
        ...(tracked ? { revision: { author: trackingAuthor!, date: revisionDateNow() } } : {}),
        ...(operation.tag === undefined ? {} : { tag: operation.tag }),
        ...(operation.title === undefined ? {} : { alias: operation.title }),
      },
    ],
    answer: (post) => {
      if (!operation.returnHandle) return { kind: 'applied' };
      const after = post.story(story.story);
      // Looked for in the paragraph this operation wrapped, not in the whole story: every
      // operation of a batch plans against the same `existingControlIds`, so a story-wide search
      // answered the FIRST control created by the batch to each of them. The paragraph is
      // claimed by this operation alone, so exactly one new control can be in it. A paragraph a
      // later operation removed has no control to name, and searching the story instead would
      // name another operation's control, so that is refused rather than guessed.
      const paragraph = after?.node(range.start.paragraphId);
      const created = paragraph
        ? allControlsUnder(paragraph).filter((node) => !existingControlIds.has(node.id))
        : [];
      if (created.length !== 1) {
        throw new Error('content control insertion did not create a control');
      }
      return { kind: 'handle', handle: handles.contentControl(created[0]!.id, story.story) };
    },
  };
}
