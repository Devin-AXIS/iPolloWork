// Tracked inline planning shares the canonical story transaction and snapshot anchors.
import { lineBreakRefusal } from './line-break-text.ts';
import { revisionDateNow } from './revision-date.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import type { AutomationErrorCode } from './protocol.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import {
  resolveParagraphHandle,
  resolveSpanRef,
  storyOfSpanRef,
  spanValue,
  type ResolvedRange,
} from './spans.ts';
import { proposalInputError, proposalRevisionError } from './proposals.ts';
import {
  landsInForeignInsertionContainer,
  trackedLandingOffset,
} from './proposal-foreign-revisions.ts';
import {
  areSiblingParagraphs,
  followsOwnMarkDeletion,
  markStrikeRefusal,
  nextSiblingParagraph,
} from './tracked-paragraph-marks.ts';

/**
 * The proposal a tracked text or paragraph edit makes, or the refusal that ends it.
 *
 * Deleting a paragraph strikes its text and its paragraph mark. That is a deletion up to the
 * start of the next paragraph, so it needs a next paragraph in the same container. The last
 * paragraph of a story, table cell, or content control has no mark a reviewer can remove.
 */
export function trackedProposalOf(
  operation: AutomationOperation,
  author: string,
  handles: AutomationHandleTable,
  packageReads: AutomationPackageReads
): AutomationOperation | PlannedOperation {
  if (operation.op === 'insertText')
    return {
      op: 'proposeInsertion',
      span: { start: operation.at, end: operation.at },
      text: operation.text,
      where: 'Before',
      author,
    };
  if (operation.op === 'replaceSpan')
    return { op: 'proposeReplacement', span: operation.span, text: operation.text, author };
  if (operation.op !== 'deleteParagraph') return operation;
  const paragraph = resolveParagraphHandle(operation.paragraph, handles, packageReads);
  if (!paragraph.ok)
    return {
      ok: false,
      error: {
        code: paragraph.code,
        message: 'that handle does not name a paragraph',
        detail: paragraph.detail,
      },
    };
  const { story, paragraphId, index } = paragraph.value;
  const reads = packageReads.story(story);
  const nextId = reads?.paragraphIds[index + 1];
  if (
    !reads ||
    nextId === undefined ||
    nextSiblingParagraph(reads.part, paragraphId)?.id !== nextId
  )
    return {
      ok: false,
      error: {
        code: 'unsupported-capability',
        message: 'a tracked paragraph deletion needs a next paragraph in the same container',
        detail: 'paragraph',
      },
    };
  return {
    op: 'proposeDeletion',
    span: {
      start: { paragraph: operation.paragraph, offset: 0 },
      end: { paragraph: handles.paragraph(nextId, story), offset: 0 },
    },
    author,
  };
}

/** A deletion that starts right after the author's own pending mark deletion refuses. */
export function ownMarkDeletionRefusal(
  part: OoxmlPart,
  paragraphId: string,
  author: string
): PlannedOperation | null {
  if (!followsOwnMarkDeletion(part, paragraphId, author.trim())) return null;
  return {
    ok: false,
    error: {
      code: 'unsupported-revision',
      message: "a deletion beside the author's pending deletion would review as one decision",
      detail: 'span',
    },
  };
}

export function planProposal(
  operation: Extract<
    AutomationOperation,
    { op: 'proposeInsertion' | 'proposeDeletion' | 'proposeReplacement' }
  >,
  tracked: boolean,
  handles: AutomationHandleTable,
  packageReads: AutomationPackageReads,
  claim: (story: AutomationStoryReads, paragraphId: string) => PlannedOperation | null,
  trackedRangeReplacement = true,
  /** The write is followed by a paragraph split, so empty text still claims its paragraph. */
  splitFollows = false
): PlannedOperation {
  const refuse = (
    code: AutomationErrorCode,
    message: string,
    detail?: string
  ): PlannedOperation => ({
    ok: false,
    error: { code, message, ...(detail === undefined ? {} : { detail }) },
  });
  const spanOf = (range: ResolvedRange) => spanValue(range, handles);
  const query = (value: import('./protocol.ts').AutomationValue): PlannedOperation => ({
    ok: true,
    kind: 'query',
    value,
  });
  const inputError = proposalInputError(operation, tracked);
  if (inputError) return { ok: false, error: inputError };
  const insertion = operation.op === 'proposeInsertion';
  const deletion = operation.op === 'proposeDeletion';
  const resolved = resolveSpanRef(operation.span, handles, packageReads);
  if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
  const range = resolved.value;
  if (range && tracked && !insertion && range.start.paragraphId !== range.end.paragraphId) {
    // A deletion strikes text and paragraph marks in place, so concurrent typing in those
    // paragraphs follows the struck runs. A replacement also writes new text at the first
    // paragraph's end, which this owner cannot place against concurrent insertions.
    if (!trackedRangeReplacement && !deletion && operation.text !== '')
      return refuse(
        'unsupported-capability',
        'tracked paragraph-range replacement is unsupported in collaboration',
        'span'
      );
    const story = storyOfSpanRef(operation.span, handles, packageReads);
    if (!story.ok) return refuse(story.code, 'that story is not a place', story.detail);
    const reads = story.value;
    const firstIndex = reads.indexOf(range.start.paragraphId);
    const lastIndex = reads.indexOf(range.end.paragraphId);
    const ids = reads.paragraphIds.slice(firstIndex, lastIndex + 1);
    // Position markers, such as a bookmark end between two paragraphs, do not separate them.
    if (!areSiblingParagraphs(reads.part, ids))
      return refuse(
        'unsupported-content',
        'tracked ranges require adjacent sibling paragraphs',
        'span'
      );
    if (range.start.offset === 0) {
      const adjacent = ownMarkDeletionRefusal(reads.part, ids[0]!, operation.author);
      if (adjacent) return adjacent;
    }
    const revision = { author: operation.author.trim(), date: revisionDateNow() };
    const ops: TreeDocOp[] = [];
    // Text deletions first, then the marks: a mark op between two text deletions makes the
    // store walk the whole part again for the next revision id.
    const marks: TreeDocOp[] = [];
    for (let index = 0; index < ids.length; index++) {
      const paragraphId = ids[index]!;
      const start = index === 0 ? range.start.offset : 0;
      const end =
        index === ids.length - 1 ? range.end.offset : (reads.rawText(paragraphId) ?? '').length;
      const error =
        proposalRevisionError(
          reads,
          paragraphId,
          start,
          end,
          undefined,
          false,
          undefined,
          // Another author's text may hold the struck text. A range that only reaches the
          // next paragraph's start writes nothing there and keeps the strict boundary.
          end > start ? { author: revision.author, strikesMark: index < ids.length - 1 } : undefined
        ) ?? (index < ids.length - 1 ? markStrikeRefusal(reads.part, paragraphId) : null);
      if (error) return { ok: false, error };
      // A range that ends at a paragraph's start writes nothing there, so deleting adjacent
      // paragraphs in one batch does not claim the next one twice.
      const writes = end > start || index < ids.length - 1;
      const conflict = writes ? claim(reads, paragraphId) : null;
      if (conflict) return conflict;
      if (end > start) ops.push({ op: 'deleteText', paragraphId, start, end, revision });
      if (index < ids.length - 1)
        marks.push({ op: 'setParagraphMarkRevision', paragraphId, kind: 'del', revision });
    }
    ops.push(...marks);
    const aim = (reads.rawText(ids[0]!) ?? '').length;
    const text = deletion ? '' : operation.text;
    const lineBreak = lineBreakRefusal(reads.part, ids[0]!, range.start.offset, aim, text);
    if (lineBreak) return lineBreak;
    if (text) ops.push({ op: 'insertText', paragraphId: ids[0]!, offset: aim, text, revision });
    const landing = text
      ? trackedLandingOffset(reads, ids[0]!, { start: range.start.offset, end: aim }, aim, revision)
      : aim;
    const at = { ...range.start, offset: landing };
    return {
      ok: true,
      kind: 'command',
      ops,
      story: reads.story,
      answer: () => ({
        kind: 'span',
        span: spanOf({ start: at, end: { ...at, offset: at.offset + text.length } }),
      }),
    };
  }
  if (!range || range.start.paragraphId !== range.end.paragraphId) {
    return refuse('unsupported-content', 'proposals require a single paragraph range', 'span');
  }
  if (!tracked && !insertion && range.start.offset === range.end.offset) {
    return refuse('unsupported-content', 'deletion and replacement need a non-empty range', 'span');
  }
  const story = storyOfSpanRef(operation.span, handles, packageReads);
  if (!story.ok) return refuse(story.code, 'that story is not a place', story.detail);
  const paragraphId = range.start.paragraphId;
  const start = insertion && operation.where === 'After' ? range.end.offset : range.start.offset;
  const end = insertion ? start : range.end.offset;
  if (tracked && !insertion && end > start && start === 0) {
    const adjacent = ownMarkDeletionRefusal(story.value.part, paragraphId, operation.author);
    if (adjacent) return adjacent;
  }
  if (tracked && !deletion && start === end && operation.text === '' && !splitFollows)
    return query({ kind: 'span', span: spanOf({ start: range.start, end: range.start }) });
  const revisionError = proposalRevisionError(
    story.value,
    paragraphId,
    start,
    end,
    tracked && insertion ? operation.author.trim() : undefined,
    insertion && start === (story.value.rawText(paragraphId) ?? '').length,
    tracked && !insertion && end > start ? operation.author.trim() : undefined,
    tracked ? { author: operation.author.trim() } : undefined
  );
  if (revisionError) return { ok: false, error: revisionError };
  if (!deletion) {
    const lineBreak = lineBreakRefusal(story.value.part, paragraphId, start, end, operation.text);
    if (lineBreak) return lineBreak;
  }
  const revision = { author: operation.author.trim(), date: revisionDateNow() };
  // The store places tracked words outside struck text, so the answer names where they land.
  const aim = insertion ? start : end;
  const writes = tracked && !deletion && operation.text.length > 0;
  const landing = writes
    ? trackedLandingOffset(
        story.value,
        paragraphId,
        insertion ? null : { start, end },
        aim,
        revision
      )
    : aim;
  if (
    writes &&
    landsInForeignInsertionContainer(story.value, paragraphId, landing, revision.author)
  )
    return refuse(
      'unsupported-revision',
      "the new text would land inside a container within another author's pending insertion",
      'edit.tracked-foreign-revision-unsupported'
    );
  const conflict = claim(story.value, paragraphId);
  if (conflict) return conflict;
  const ops: TreeDocOp[] = [];
  if (!insertion && end > start) ops.push({ op: 'deleteText', paragraphId, start, end, revision });
  if (!deletion && operation.text.length > 0)
    ops.push({
      op: 'insertText',
      paragraphId,
      offset: insertion ? start : end,
      text: operation.text,
      revision,
    });
  return {
    ok: true,
    kind: 'command',
    ops,
    story: story.value.story,
    answer: () => {
      if (!tracked) return { kind: 'applied' };
      const at = { ...range.start, offset: landing };
      return {
        kind: 'span',
        span: spanOf({
          start: at,
          end: { ...at, offset: at.offset + (deletion ? 0 : operation.text.length) },
        }),
      };
    },
  };
}

/** Continuation can split an author's own text and paragraph proposals. */
export function trackedParagraphInsertError(
  story: AutomationStoryReads,
  paragraphId: string,
  author: string
) {
  return proposalRevisionError(
    story,
    paragraphId,
    0,
    (story.rawText(paragraphId) ?? '').length,
    author,
    true
  );
}
