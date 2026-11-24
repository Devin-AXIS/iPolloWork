// Write a field's cached result on behalf of the editing API (`Field.result.insertText`).
//
// The op names one field by its anchor (the begin `w:fldChar`, or the `w:fldSimple`) and the
// new result text. The instruction is never modified, and the result is never computed: the
// text is caller data, written as `w:t` and `w:tab` children of the field's plain result runs.
// The anchor gains `w:dirty="true"`, so a reader that evaluates fields recomputes the result.
//
// Two placements, and nothing else:
//   - without a revision, a field that no revision holds: an ordinary edit;
//   - with a revision, a field that sits wholly inside a pending insertion by that author: the
//     new result runs stay inside that `w:ins`, so one Reject takes the whole field back.
// A field inside another author's insertion, or any deletion, refuses. So does a result that
// holds anything other than plain runs, a locked field, and a locked or bound control.

import { createNodeIdAllocator, findNode, replaceChildren } from '../package/ooxml-edit.ts';
import type { EditOptions } from '../package/ooxml-edit.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { isValidXmlText } from '../package/sinks.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import {
  fieldResultUpdateRefusal,
  locateFieldForResultWrite,
  MAX_FIELD_RESULT_TEXT_CHARS,
  rewriteFieldResult,
} from './tree-op-field-results.ts';
import { dirtyAttribute } from './tree-op-fields.ts';
import { inlineContainersOf, ok, parentOf } from './tree-op-nodes.ts';
import { invalidRevisionAttribution } from './tree-op-revision-attribution.ts';
import type { RevisionAttributionInput } from './tree-op-revision-attribution.ts';
import type { TreeOpRejection, TreeOpResult } from './tree-op-types.ts';

/** Set one field's cached result text. See the module comment for the placements. */
export interface SetFieldResultOp {
  readonly op: 'setFieldResult';
  readonly paragraphId: string;
  /** The begin `w:fldChar`, or the `w:fldSimple` element. */
  readonly fieldNodeId: string;
  /** Plain text. A tab becomes `w:tab`; other control characters refuse. */
  readonly text: string;
  /**
   * The author whose pending insertion holds the field. The result joins that insertion. The
   * op mints no revision of its own.
   */
  readonly revision?: RevisionAttributionInput;
}

/** C0 and C1 controls other than the tab, and the line and paragraph separators. */
const RESULT_CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u2028\u2029]/u;

/** Whether `text` is one this op writes. */
export function writableFieldResultText(text: unknown): text is string {
  return (
    typeof text === 'string' &&
    text.length <= MAX_FIELD_RESULT_TEXT_CHARS &&
    isValidXmlText(text) &&
    !RESULT_CONTROL.test(text)
  );
}

/** Why the field cannot take the write, read against the current paragraph. */
export function fieldResultWriteRefusal(
  part: OoxmlPart,
  paragraphId: string,
  fieldNodeId: string,
  author: string | undefined
): TreeOpRejection | null {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return 'unknown-paragraph';
  const refusal = fieldResultUpdateRefusal(part, paragraphId);
  if (refusal) return refusal;
  const field = locateFieldForResultWrite(paragraph, fieldNodeId);
  if (!field || !(field.resultWritable ?? field.rewritable)) return 'field-result-unsupported';
  const revisions = revisionsAround(paragraph, fieldNodeId);
  if (author === undefined) return revisions.length === 0 ? null : 'unsupported-revision';
  return ownInsertion(revisions, author) ? null : 'unsupported-revision';
}

function revisionsAround(paragraph: OoxmlNode, nodeId: string): readonly OoxmlNode[] {
  if (paragraph.kind === 'textValue') return [];
  return inlineContainersOf(paragraph, nodeId).filter(
    (node) =>
      node.kind === 'revisionInsert' ||
      node.kind === 'revisionDelete' ||
      node.kind === 'revisionMoveFrom' ||
      node.kind === 'revisionMoveTo'
  );
}

const ownInsertion = (revisions: readonly OoxmlNode[], author: string): boolean =>
  revisions.length > 0 &&
  revisions.every((node) => node.kind === 'revisionInsert' && insertionAuthorOf(node) === author);

/**
 * Whether the node sits only inside pending insertions by `author`: the author's own proposal,
 * which a tracked deletion takes back outright rather than striking.
 */
export function insideOwnPendingInsertion(
  part: OoxmlPart,
  paragraphId: string,
  nodeId: string,
  author: string
): boolean {
  const paragraph = findNode(part, paragraphId);
  return !!paragraph && ownInsertion(revisionsAround(paragraph, nodeId), author);
}

function insertionAuthorOf(node: OoxmlNode): string | undefined {
  if (node.kind === 'textValue') return undefined;
  return node.attributes.find(
    (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'author'
  )?.value;
}

export function validateSetFieldResult(
  part: OoxmlPart,
  op: SetFieldResultOp
): TreeOpRejection | null {
  if (
    typeof op.paragraphId !== 'string' ||
    typeof op.fieldNodeId !== 'string' ||
    op.fieldNodeId.length === 0 ||
    !writableFieldResultText(op.text)
  )
    return 'invalidArgs';
  if (op.revision !== undefined && invalidRevisionAttribution(op.revision)) {
    return 'invalid-property-value';
  }
  return fieldResultWriteRefusal(part, op.paragraphId, op.fieldNodeId, op.revision?.author.trim());
}

/** The anchor with `w:dirty="true"` in place of any `w:dirty` it carried. */
function markedDirty(node: OoxmlNode, anchorId: string): OoxmlNode {
  if (node.kind === 'textValue') return node;
  if (node.id === anchorId) {
    return {
      ...node,
      attributes: [
        ...node.attributes.filter((attribute) => attribute.localName !== 'dirty'),
        dirtyAttribute(),
      ],
    } as OoxmlNode;
  }
  let changed = false;
  const children = node.children.map((child) => {
    const next = markedDirty(child, anchorId);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? ({ ...node, children } as OoxmlNode) : node;
}

export function applySetFieldResult(
  part: OoxmlPart,
  op: SetFieldResultOp,
  options?: EditOptions
): TreeOpResult {
  const paragraph = findNode(part, op.paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph')
    return { ok: false, reason: 'unknown-paragraph' };
  const field = locateFieldForResultWrite(paragraph, op.fieldNodeId);
  if (!field) return { ok: false, reason: 'field-result-unsupported' };
  const mint = createNodeIdAllocator(part);
  // An empty write over an empty result mints no run: the field already says nothing.
  const rewritten =
    op.text === '' && field.resultRunIds.length === 0
      ? paragraph
      : rewriteFieldResult(paragraph, field, op.text, mint);
  const marked = markedDirty(rewritten, op.fieldNodeId);
  const parent = parentOf(part, paragraph.id);
  if (!parent) return { ok: false, reason: 'unknown-paragraph' };
  const siblings = parent.children.map((child) => (child.id === paragraph.id ? marked : child));
  const replaced = replaceChildren(part, parent.id, siblings, options);
  if (!replaced.ok) return { ok: false, reason: 'tree-invariant' };
  return ok(replaced.part, {
    dirty: [op.paragraphId],
    created: [],
    deleted: [],
    dependencyKeys: [op.paragraphId],
    impact: 'text-local',
  });
}
