import { findNode, parentNodeOf } from '../store/package/ooxml-edit.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-tree.ts';
import {
  normalizeCommentDateValue,
  validateCommentAuthor,
  validateCommentDate,
  validateCommentText,
} from '../store/store/comment-input-validate.ts';
import type { ReviewCommentItem } from '../store/store/review-items.ts';
import type { AutomationCommentWrite } from './document-port.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan.ts';
import type { AutomationErrorCode, AutomationValue } from './protocol.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import { resolveSpanRef, storyOfSpanRef } from './spans.ts';
import { revisionDateNow } from './revision-date.ts';

const PARAGRAPH_BREAKING = /[\r\n\u2028\u2029]/u;
const APPLIED: AutomationValue = Object.freeze({ kind: 'applied' as const });

function refuse(code: AutomationErrorCode, message: string, detail?: string): PlannedOperation {
  return {
    ok: false,
    error: Object.freeze(detail === undefined ? { code, message } : { code, message, detail }),
  };
}

function refuseCommentInput(
  field: 'author' | 'text' | 'date',
  kind: 'comment' | 'reply'
): PlannedOperation {
  const message =
    field === 'author'
      ? 'a comment records who wrote it'
      : field === 'date'
        ? 'a comment date must be a valid ISO-8601 instant'
        : kind === 'reply'
          ? 'a reply says something'
          : 'a comment says something';
  return refuse('unsupported-content', message, field);
}

/** Refuse invalid author, text or date before a comment write is staged. */
export function validatePlannedCommentFields(input: {
  readonly author: unknown;
  readonly text: unknown;
  readonly date?: unknown;
  readonly kind: 'comment' | 'reply';
}): PlannedOperation | null {
  if (validateCommentAuthor(input.author)) return refuseCommentInput('author', input.kind);
  if (validateCommentText(input.text)) return refuseCommentInput('text', input.kind);
  if (typeof input.text === 'string' && PARAGRAPH_BREAKING.test(input.text)) {
    return refuse(
      'unsupported-content',
      input.kind === 'reply'
        ? 'a reply is one paragraph in this slice'
        : 'a comment is one paragraph in this slice',
      'text'
    );
  }
  if (validateCommentDate(input.date)) return refuseCommentInput('date', input.kind);
  return null;
}

/**
 * Canonical `@w:date` for a staged comment write, after validation succeeded. A write that
 * names no date is stamped with the current time, as a tracked change is, so every comment the
 * automation layer creates records when it was written.
 */
export function stagedCommentDate(date: unknown): string {
  if (date === undefined) return revisionDateNow();
  const normalized = normalizeCommentDateValue(date);
  return normalized.ok ? normalized.value : revisionDateNow();
}

/** Innermost table cell containing a paragraph, or null for ordinary story flow. */
function tableCellOf(reads: AutomationStoryReads, paragraphId: string): string | null {
  let node = findNode(reads.part, paragraphId);
  while (node) {
    if (
      node.kind === 'tableCell' ||
      (node.kind !== 'textValue' &&
        node.namespaceUri === WML_NAMESPACE_URI &&
        node.localName === 'tc')
    ) {
      return node.id;
    }
    node = parentNodeOf(reads.part, node.id);
  }
  return null;
}

/** Plan root-comment creation without widening the central operation dispatcher. */
export function planInsertComment(
  operation: Extract<AutomationOperation, { readonly op: 'insertComment' }>,
  handles: AutomationHandleTable,
  packageReads: AutomationPackageReads,
  pinStory: (reads: AutomationStoryReads) => PlannedOperation | null
): PlannedOperation {
  const fields = validatePlannedCommentFields({
    author: operation.author,
    text: operation.text,
    date: operation.date,
    kind: 'comment',
  });
  if (fields) return fields;
  const resolved = resolveSpanRef(operation.span, handles, packageReads);
  if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
  if (resolved.value === null)
    return refuse('invalid-handle', 'an empty story has no comment anchor');
  const story = storyOfSpanRef(operation.span, handles, packageReads);
  if (!story.ok) return refuse(story.code, 'that span is not a place', story.detail);
  // A text box story cannot hold a comment: the selection there offers no comment, and a
  // comment anchored there is dropped when the file opens.
  if (story.value.story.kind === 'textbox')
    return refuse('unsupported-content', 'a comment cannot be anchored in a text box');
  const range = resolved.value;
  if (
    tableCellOf(story.value, range.start.paragraphId) !==
    tableCellOf(story.value, range.end.paragraphId)
  ) {
    return refuse('unsupported-content', 'a comment range cannot cross a table-cell boundary');
  }
  const conflict = pinStory(story.value);
  if (conflict) return conflict;
  const date = stagedCommentDate(operation.date);
  const write: AutomationCommentWrite = {
    kind: 'create',
    anchor: {
      paragraphId: range.start.paragraphId,
      start: range.start.offset,
      end: range.end.offset,
      ...(range.end.paragraphId === range.start.paragraphId
        ? {}
        : { endParagraphId: range.end.paragraphId }),
    },
    text: operation.text,
    author: operation.author,
    date,
  };
  return {
    ok: true,
    kind: 'commentWrite',
    write,
    story: story.value.story,
    answer: (_post, commentId) =>
      commentId === undefined
        ? APPLIED
        : { kind: 'handle', handle: handles.comment(commentId, story.value.story) },
  };
}

/** Plan a story-owned comment deletion without widening the central dispatcher. */
export function planDeleteComment(
  item: ReviewCommentItem,
  reads: AutomationStoryReads,
  pinStory: (reads: AutomationStoryReads) => PlannedOperation | null
): PlannedOperation {
  const conflict = pinStory(reads);
  if (conflict) return conflict;
  const story = reads.story;
  return {
    ok: true,
    kind: 'commentWrite',
    write: {
      kind: 'delete',
      commentId: item.id,
      ...(item.parentId === undefined ? {} : { parentCommentId: item.parentId }),
      ...(story.kind === 'note' ? { noteId: story.noteId } : {}),
    },
    story,
    answer: () => APPLIED,
  };
}
