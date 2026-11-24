// Insert one inline equation, with the plain runs around it, at a UTF-16 offset.
//
// The nodes come from `readEquationSnippet` (`equation-snippet.ts`), which read caller OOXML
// through the bounded reader and an allowlist. The op checks their shape again, because an op
// is a trust boundary of its own. Both arms place the nodes where typed text would land,
// inside a link, a content control, or a pending insertion. Without a revision they go beside
// the runs there (`tree-op-run-placement.ts`). With one, they go into ONE `w:ins` by the
// author through the placement typed text follows: `w:ins > m:oMath` is the shape
// `EG_RunLevelElements` allows and the mirror of how a tracked deletion strikes an equation,
// so Accept keeps the equation and Reject removes it whole.

import { findNode, type EditOptions } from '../package/ooxml-edit.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlNode, OoxmlParagraphNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { isEquationSnippetShape } from './equation-snippet.ts';
import { withRequiredNamespaceBindings } from './tree-op-fragment.ts';
import { applyPlaceRunNodes } from './tree-op-run-placement.ts';
import { invalidRevisionAttribution } from './tree-op-revision-attribution.ts';
import type { RevisionAttributionInput } from './tree-op-revision-attribution.ts';
import { paragraphLength, splitsSurrogate } from './tree-op-segments.ts';
import { applyInsertTrackedRun, copy } from './tree-op-tracked.ts';
import type { TreeOpRejection, TreeOpResult } from './tree-op-types.ts';
import { rejectContentEdit } from './tree-op-validate-controls.ts';

/** Insert one inline `m:oMath` and the plain runs beside it. */
export interface InsertEquationOp {
  readonly op: 'insertEquation';
  readonly paragraphId: string;
  readonly offset: number;
  /** Plain runs and exactly one inline `m:oMath`, in order. Receive fresh ids at apply. */
  readonly nodes: readonly OoxmlNode[];
  /** Model length of `nodes`: their text, plus one for the equation. */
  readonly length: number;
  /** Write the nodes as ONE tracked insertion, on the same terms as `insertText`. */
  readonly revision?: RevisionAttributionInput;
}

export function validateInsertEquation(
  part: OoxmlPart,
  op: InsertEquationOp
): TreeOpRejection | null {
  const paragraph = findNode(part, op.paragraphId);
  if (!paragraph) return 'unknown-paragraph';
  if (paragraph.kind !== 'paragraph') return 'not-a-paragraph';
  const length = paragraphLength(paragraph);
  if (!Number.isInteger(op.offset) || op.offset < 0 || op.offset > length) {
    return 'offset-out-of-range';
  }
  if (splitsSurrogate(paragraph, op.offset)) return 'splits-surrogate-pair';
  // An offset inside a link, a control, or a revision wrapper is a place, as it is for a
  // field: the fragment path splits the wrapper around the equation, and the tracked path
  // places it inside the wrapper the way typed text goes.
  if (!isEquationSnippetShape(op.nodes)) return 'fragment-invalid-block';
  const measured = paragraphLength(snippetParagraph(op.nodes));
  if (!Number.isInteger(op.length) || op.length !== measured) return 'invalidArgs';
  // `CT_TrackChange` makes `@w:author` required.
  if (op.revision !== undefined && invalidRevisionAttribution(op.revision)) {
    return 'invalid-property-value';
  }
  return rejectContentEdit(part, paragraph, op.offset, op.offset);
}

/** The nodes as a detached paragraph, for the length read. */
function snippetParagraph(nodes: readonly OoxmlNode[]): OoxmlParagraphNode {
  return {
    id: 'equation-snippet',
    kind: 'paragraph',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'p',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: nodes,
  } as unknown as OoxmlParagraphNode;
}

export function applyInsertEquation(
  part: OoxmlPart,
  op: InsertEquationOp,
  options?: EditOptions
): TreeOpResult {
  // The `m:` prefix must be bound at the root before the commit validator sees it.
  const bound = withRequiredNamespaceBindings(part, op.nodes);
  const paragraph = findNode(bound, op.paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph')
    return { ok: false, reason: 'unknown-paragraph' };
  if (!op.revision) return applyPlaceRunNodes(bound, paragraph, op.offset, op.nodes, options);
  return applyInsertTrackedRun(
    bound,
    paragraph,
    op.offset,
    (mint) => op.nodes.map((node) => copy(mint, node)),
    op.revision,
    options,
    op.length
  );
}
