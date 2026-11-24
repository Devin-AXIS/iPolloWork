// Field insertion: an inert field at a range edge, untracked or as one tracked insertion.
//
// The instruction is caller data. It is checked against the bounded allowlist in
// `inert-field-instruction.ts`, written as text, and never evaluated, so the cached result is
// empty. Untracked PAGE, NUMPAGES, and TOC keep their simple-field form. Every other field,
// and every tracked field, is one complex field whose runs take the formatting of the text
// beside the insertion point. Tracked insertion puts its runs in ONE `w:ins` by the runtime
// author, so Accept keeps the field and Reject removes all of it. A simple field is never
// written inside a revision.

import { inertFieldInstruction } from '../store/store/inert-field-instruction.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import { tocFieldCode } from './toc-field-code.ts';
import { fieldsInParagraph, fieldInsertionParagraph } from './fields.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan.ts';
import type { AutomationErrorCode } from './protocol.ts';
import type { AutomationStoryReads } from './reads.ts';
import type { ResolvedRange } from './spans.ts';
import { planInlineInsertPlacement } from './plan-inline-insert.ts';

type InsertFieldOperation = Extract<AutomationOperation, { op: 'insertField' }>;

/** Office field types and the instruction word each writes. */
const FIELD_TYPE_WORDS: Readonly<Record<string, string>> = {
  Page: 'PAGE',
  NumPages: 'NUMPAGES',
  Ref: 'REF',
  PageRef: 'PAGEREF',
  NoteRef: 'NOTEREF',
  Seq: 'SEQ',
  StyleRef: 'STYLEREF',
  Date: 'DATE',
  Time: 'TIME',
};

const refuse = (code: AutomationErrorCode, message: string, detail?: string): PlannedOperation => ({
  ok: false,
  error: { code, message, ...(detail === undefined ? {} : { detail }) },
});

/** Field types and instructions this lane writes. Every other one refuses with this. */
const fieldUnsupported = (message: string) =>
  refuse('unsupported-content', message, 'field-unsupported');

/**
 * The instruction a call writes, or the refusal. A typed call writes the type's word followed
 * by `text`; `Empty` writes `text` as the whole instruction. TOC keeps its own switch subset.
 */
function instructionOf(operation: InsertFieldOperation): string | PlannedOperation {
  const type = operation.fieldType ?? 'Empty';
  const text = operation.text ?? '';
  if (type === 'TOC')
    return tocFieldCode(text) ?? fieldUnsupported('the TOC switches are not supported');
  const word = type === 'Empty' ? '' : FIELD_TYPE_WORDS[type];
  if (word === undefined) return fieldUnsupported(`the ${type} field type is not supported`);
  const instruction = inertFieldInstruction(word ? `${word} ${text}` : text);
  return (
    instruction ??
    fieldUnsupported('the field instruction is not one this API writes, or its arguments refuse')
  );
}

export function planFieldInsert(
  operation: InsertFieldOperation,
  range: ResolvedRange,
  story: AutomationStoryReads,
  handles: AutomationHandleTable,
  claim: (story: AutomationStoryReads, paragraphId: string) => PlannedOperation | null,
  trackingAuthor?: string
): PlannedOperation {
  if (operation.removeFormatting !== undefined && operation.removeFormatting !== false)
    return refuse('unsupported-content', 'removeFormatting is not supported', 'unsupported');
  if (operation.text !== undefined && typeof operation.text !== 'string')
    return refuse('unsupported-content', 'field text must be a string', 'invalidArgs');
  if (operation.fieldType !== undefined && typeof operation.fieldType !== 'string')
    return refuse('unsupported-content', 'field type must be a string', 'invalidArgs');
  const tracked = trackingAuthor !== undefined;
  // TOC fields hold their entries as a result this lane cannot propose: refuse as before.
  if (tracked && operation.fieldType === 'TOC')
    return refuse(
      'unsupported-capability',
      'insertField does not support TrackMineOnly for TOC fields; no permanent edit was applied',
      'change-tracking-operation-unsupported'
    );
  const instruction = instructionOf(operation);
  if (typeof instruction !== 'string') return instruction;
  const placement = planInlineInsertPlacement(
    'field',
    operation.location,
    range,
    story,
    claim,
    trackingAuthor
  );
  if ('ok' in placement) return placement;
  const { paragraphId, at, revision } = placement;
  const before = new Set(fieldsInParagraph(story.part, paragraphId).map((f) => f.fieldNodeId));
  // Untracked PAGE, NUMPAGES, and TOC keep the simple-field form they always had; every other
  // field, and every tracked field, is one complex field.
  const simple = !revision && ['PAGE', 'NUMPAGES', 'TOC'].includes(instruction.split(' ')[0]!);
  const insert: TreeDocOp = simple
    ? {
        op: 'insertFragment',
        paragraphId,
        offset: at,
        blocks: [fieldInsertionParagraph(instruction)],
        lastMarkCovered: false,
      }
    : {
        op: 'insertComplexField',
        paragraphId,
        offset: at,
        instruction,
        ...(revision ? { revision } : {}),
      };
  const ops: TreeDocOp[] = [...placement.ops, insert];
  return {
    ok: true,
    kind: 'command',
    story: story.story,
    ops,
    answer: (post) => {
      const part = post.story(story.story)?.part;
      const inserted = part
        ? fieldsInParagraph(part, paragraphId).filter((field) => !before.has(field.fieldNodeId))
        : [];
      if (inserted.length !== 1) throw new Error('inserted field was not committed');
      return {
        kind: 'handle',
        handle: handles.field(paragraphId, inserted[0]!.fieldNodeId, story.story),
      };
    },
  };
}
