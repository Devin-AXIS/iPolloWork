// `Field.result.insertText(text, 'Replace')`: write a field's cached result.
//
// The text is caller data, written as the result runs' text and never evaluated. The field's
// anchor gains `w:dirty="true"`, so a reader that evaluates fields recomputes the result.
// Untracked, the field must sit outside every revision. Under `TrackMineOnly`, the field must
// be the runtime author's own pending insertion: the new result joins that `w:ins`, so one
// Reject removes the field with its result. A tracked rewrite of any other field's result has
// no supported form and refuses; it is never applied untracked instead. A result that holds
// anything but plain runs refuses too.

import {
  fieldResultWriteRefusal,
  writableFieldResultText,
} from '../store/store/tree-op-field-result-write.ts';
import type { AutomationHandleTarget } from './handles.ts';
import type { AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan.ts';
import type { AutomationErrorCode } from './protocol.ts';
import type { AutomationStoryReads } from './reads.ts';
import { revisionDateNow } from './revision-date.ts';

type SetFieldResultOperation = Extract<AutomationOperation, { op: 'setFieldResult' }>;

const refuse = (code: AutomationErrorCode, message: string, detail: string): PlannedOperation => ({
  ok: false,
  error: { code, message, detail },
});

export function planFieldResultWrite(
  operation: SetFieldResultOperation,
  story: AutomationStoryReads,
  target: Extract<AutomationHandleTarget, { kind: 'field' }>,
  claim: (story: AutomationStoryReads, paragraphId: string) => PlannedOperation | null,
  trackingAuthor?: string
): PlannedOperation {
  if (!writableFieldResultText(operation.text))
    return refuse(
      'unsupported-content',
      'a field result is plain text of at most 2048 characters, with no line or paragraph break',
      'invalidArgs'
    );
  const author = trackingAuthor?.trim();
  const refusal = fieldResultWriteRefusal(
    story.part,
    target.paragraphId,
    target.fieldNodeId,
    author
  );
  if (refusal === 'locked' || refusal === 'bound')
    return refuse('unsupported-content', 'field is protected', refusal);
  if (refusal === 'field-result-unsupported')
    return refuse(
      'unsupported-capability',
      'this field result holds content other than plain runs',
      'unsupported'
    );
  if (refusal === 'unsupported-revision')
    return author === undefined
      ? refuse(
          'unsupported-revision',
          'this field is inside a pending revision; write its result with TrackMineOnly as its author',
          'unsupported-revision'
        )
      : refuse(
          'unsupported-capability',
          'TrackMineOnly writes a result only for a field that is your own pending insertion; no permanent edit was applied',
          'change-tracking-operation-unsupported'
        );
  if (refusal) return refuse('invalid-handle', 'that field no longer exists', refusal);
  const conflict = claim(story, target.paragraphId);
  if (conflict) return conflict;
  return {
    ok: true,
    kind: 'command',
    story: story.story,
    ops: [
      {
        op: 'setFieldResult',
        paragraphId: target.paragraphId,
        fieldNodeId: target.fieldNodeId,
        text: operation.text,
        ...(author === undefined ? {} : { revision: { author, date: revisionDateNow() } }),
      },
    ],
    answer: () => ({ kind: 'applied' }),
  };
}
