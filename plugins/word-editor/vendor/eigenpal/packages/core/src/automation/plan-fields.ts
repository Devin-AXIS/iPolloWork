import { planFieldInsert } from './plan-field-insert.ts';
import { planFieldResultWrite } from './plan-field-result.ts';
import { planOoxmlInsert } from './plan-ooxml-insert.ts';
import { insideOwnPendingInsertion } from '../store/store/tree-op-field-result-write.ts';
import { revisionDateNow } from './revision-date.ts';
import { TARGET_REMOVED } from './target-removed.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import { effectiveContentLockAt, isBoundAt } from '../store/store/tree-op-nodes.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import type { AutomationStoryId } from './stories.ts';
import { resolveSpanRef, spanOffsets, storyOfSpanRef } from './spans.ts';
import {
  fieldsInParagraph,
  supportedPageFieldCode,
  type AutomationFieldPageContext,
} from './fields.ts';

type FieldOperation = Extract<
  AutomationOperation,
  {
    op:
      | 'getFields'
      | 'getField'
      | 'setFieldCode'
      | 'deleteField'
      | 'updateFieldResult'
      | 'getFieldResult'
      | 'setFieldResult'
      | 'insertField';
  }
>;
const refuse = (
  message: string,
  code: 'unsupported-content' | 'invalid-handle' | 'unsupported-capability' = 'unsupported-content',
  detail?: string
): PlannedOperation => ({
  ok: false,
  error: { code, message, ...(detail === undefined ? {} : { detail }) },
});

type InlineAtomOperation = FieldOperation | Extract<AutomationOperation, { op: 'insertOoxml' }>;

const INLINE_ATOM_OPERATIONS: ReadonlySet<string> = new Set<InlineAtomOperation['op']>([
  'getFields',
  'getField',
  'setFieldCode',
  'deleteField',
  'updateFieldResult',
  'getFieldResult',
  'setFieldResult',
  'insertField',
  'insertOoxml',
]);

/** Field reads and writes, and the equation insertion: the operations planned here. */
export function isInlineAtomOperation(
  operation: AutomationOperation
): operation is InlineAtomOperation {
  return INLINE_ATOM_OPERATIONS.has(operation.op);
}

/** Plan one field operation, or the insertion of one equation from OOXML. */
export function planInlineAtoms(
  operation: InlineAtomOperation,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads,
  claim: (
    story: AutomationStoryReads,
    paragraphId: string,
    resultOnly?: boolean
  ) => PlannedOperation | null,
  fieldPageContext?: (
    story: AutomationStoryId,
    paragraphId: string,
    fieldNodeId: string
  ) => AutomationFieldPageContext | null,
  trackingAuthor?: string
): PlannedOperation {
  if (operation.op === 'insertOoxml')
    return planOoxmlInsert(
      operation,
      handles,
      reads,
      (story, paragraphId) => claim(story, paragraphId),
      trackingAuthor
    );
  return planFields(operation, handles, reads, claim, fieldPageContext, trackingAuthor);
}

function planFields(
  operation: FieldOperation,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads,
  claim: (
    story: AutomationStoryReads,
    paragraphId: string,
    resultOnly?: boolean
  ) => PlannedOperation | null,
  fieldPageContext?: (
    story: AutomationStoryId,
    paragraphId: string,
    fieldNodeId: string
  ) => AutomationFieldPageContext | null,
  trackingAuthor?: string
): PlannedOperation {
  if (operation.op === 'getFields' || operation.op === 'insertField') {
    const range = resolveSpanRef(operation.span, handles, reads);
    const storyResult = storyOfSpanRef(operation.span, handles, reads);
    if (!range.ok || !storyResult.ok)
      return refuse(
        'that field range no longer exists',
        'invalid-handle',
        !range.ok ? range.detail : !storyResult.ok ? storyResult.detail : undefined
      );
    const story = storyResult.value;
    if (operation.op === 'getFields') {
      const fields = spanOffsets(range.value, story).flatMap((span) =>
        fieldsInParagraph(story.part, span.paragraphId).filter(
          (field) => field.start >= span.start && field.end <= span.end
        )
      );
      return {
        ok: true,
        kind: 'query',
        value: {
          kind: 'handles',
          handles: fields.map((field) =>
            handles.field(field.paragraphId, field.fieldNodeId, story.story)
          ),
        },
      };
    }
    if (!range.value) return refuse('insert a paragraph before inserting a field');
    return planFieldInsert(
      operation,
      range.value,
      story,
      handles,
      (reads, paragraphId) => claim(reads, paragraphId),
      trackingAuthor
    );
  }
  const target = handles.resolve(operation.field, 'field');
  if (!target || target.kind !== 'field')
    return refuse('that is not a field handle', 'invalid-handle');
  const story = reads.story(target.story);
  const field =
    story &&
    fieldsInParagraph(story.part, target.paragraphId).find(
      (field) => field.fieldNodeId === target.fieldNodeId
    );
  if (!story || !story.has(target.paragraphId) || !field)
    return refuse('that field no longer exists', 'invalid-handle', TARGET_REMOVED);
  if (operation.op === 'getField')
    return { ok: true, kind: 'query', value: { kind: 'field', field: { code: field.code } } };
  // The result reads as a range over the field reads: the field's own span of the paragraph.
  if (operation.op === 'getFieldResult') {
    const text =
      story
        .projectedText(target.paragraphId, operation.projection ?? 'allMarkup')
        ?.sliceRaw(field.start, field.end) ?? '';
    return { ok: true, kind: 'query', value: { kind: 'text', text } };
  }
  if (
    field.locked ||
    effectiveContentLockAt(story.part, target.fieldNodeId).content ||
    isBoundAt(story.part, target.fieldNodeId)
  )
    return refuse('field is protected', 'unsupported-content', 'locked');
  if (operation.op === 'setFieldResult')
    // A result write changes no model offset (a field is one unit), so it claims no paragraph:
    // several results of one paragraph can change in one sync, as `updateFieldResult` can.
    return planFieldResultWrite(
      operation,
      story,
      target,
      (reads, paragraphId) => claim(reads, paragraphId, true),
      trackingAuthor
    );
  const conflict = claim(story, target.paragraphId, operation.op === 'updateFieldResult');
  if (conflict) return conflict;
  const ops: TreeDocOp[] = [];
  const author = trackingAuthor?.trim();
  if (operation.op === 'deleteField') {
    // Under TrackMineOnly, only the author's own pending field can go: the tracked deletion takes
    // that proposal back outright. Striking any other field has no supported form here.
    if (
      author !== undefined &&
      !insideOwnPendingInsertion(story.part, target.paragraphId, target.fieldNodeId, author)
    )
      return refuse(
        'TrackMineOnly deletes only a field that is your own pending insertion; no permanent edit was applied',
        'unsupported-capability',
        'change-tracking-operation-unsupported'
      );
    ops.push({
      op: 'deleteText',
      paragraphId: target.paragraphId,
      start: field.start,
      end: field.end,
      ...(author === undefined ? {} : { revision: { author, date: revisionDateNow() } }),
    });
  } else if (operation.op === 'setFieldCode') {
    if (!supportedPageFieldCode(field.code) || !supportedPageFieldCode(operation.code))
      return refuse('only PAGE and NUMPAGES code writes are supported');
    ops.push({
      op: 'setFieldCode',
      paragraphId: target.paragraphId,
      fieldNodeId: target.fieldNodeId,
      code: operation.code,
    });
  } else {
    const kind = supportedPageFieldCode(field.code);
    if (!kind || !field.rewritable)
      return refuse('this field result cannot be evaluated', 'unsupported-capability');
    const context = fieldPageContext?.(story.story, target.paragraphId, target.fieldNodeId);
    if (
      !context ||
      !Number.isInteger(context.pageNumber) ||
      context.pageNumber < 1 ||
      !Number.isInteger(context.pageCount) ||
      context.pageCount < 1
    )
      return refuse('field update requires actual semantic pagination', 'unsupported-capability');
    const text =
      kind === 'PAGE'
        ? (context.pageNumberText ?? String(context.pageNumber))
        : String(context.pageCount);
    ops.push({
      op: 'refreshFieldResults',
      updates: [{ paragraphId: target.paragraphId, fieldNodeId: target.fieldNodeId, text }],
    });
  }
  return {
    ok: true,
    kind: 'command',
    story: story.story,
    ops,
    answer: () => ({ kind: 'applied' }),
  };
}
