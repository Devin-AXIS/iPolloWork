// Placing comment markup in a story.
//
// `w:commentRangeStart` and `w:commentRangeEnd` are `EG_RangeMarkupElements`, which sit in
// `EG_PContent` — BETWEEN runs, not inside them. So anchoring a comment mid-run means splitting
// the run first and putting the marker on the boundary that opens up. `w:commentReference` is
// the opposite: a run child, carried by a run of its own.
//
// The markers occupy no characters, so they never move an offset. That is what lets a comment be
// anchored without shifting the text every other anchor in the document is addressed by.

import { insertChildren, findNode, type EditOptions } from '../package/ooxml-edit.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { isInlineRunContainer, MAX_INLINE_CONTAINER_DEPTH } from '../package/ooxml-shared.ts';
// The SAME predicate and accessor the offset authority walks with. A second pair that
// disagreed — `content-control-nodes.ts` matches only a TYPED control, while the authority
// also measures a demoted generic `w:sdt` — would refuse offsets the authority hands out.
import { contentControlContentOf, isContentControlNode } from './tree-op-nodes.ts';
import { paragraphOffsetIndex } from './tree-op-segments.ts';
import { DEPENDENCY_KEY_IDS } from '../registry/frozen-ids.ts';
import { splitRunsAt } from './tree-op-apply.ts';
import type { TreeOpResult } from './tree-op-validate.ts';
import type { TreeOpRejection } from './tree-op-types.ts';

/** Which piece of comment markup an `insertCommentMarker` op places. */
export type CommentMarkerKind = 'start' | 'end' | 'reference';

/**
 * Where in a container's child list an offset falls, descending into the containers a
 * comment may legitimately be anchored inside.
 *
 * MEASURED BY THE PARAGRAPH OFFSET AUTHORITY, never by a second walk of its own. This
 * function used to count characters itself, and every element the authority counts and it
 * did not put the paragraph out of step by one: a drawing, a field, an inline content
 * control. The visible half was a refusal (`offset-out-of-range`) for offsets past the
 * element, and the invisible half was worse — an offset that still resolved landed the
 * marker on the wrong character, so a comment silently covered text nobody selected.
 */
function locateOffset(
  paragraph: OoxmlParagraphNode,
  container: OoxmlElement,
  offset: number,
  depth: number
): { readonly containerId: string; readonly index: number } | null {
  if (depth >= MAX_INLINE_CONTAINER_DEPTH) return null;
  const index = paragraphOffsetIndex(paragraph);
  const span =
    container.id === paragraph.id ? { start: 0, end: index.length } : index.spanOf(container);
  if (!span) return null;
  // Nodes an atom swallowed: a complex field is one offset unit spread over its begin, its
  // instruction, its separator, its cached result and its end. Each of those after the first
  // measures zero, so a boundary would otherwise match INSIDE the group — between the field's
  // begin and its instruction — where Word drops the marker the next time it rebuilds the
  // field. The boundary belongs after the whole group.
  // `removeNodeIds` names the field's INNER nodes (`w:fldChar`, `w:instrText`), so the set is
  // mapped up to the container's own children — the runs holding them — before it is useful
  // here. Built only when a multi-node atom is present, which is the only case it changes.
  const swallowed = new Set<string>();
  const atomInnerIds = new Set<string>();
  for (const segment of index.segments) {
    if ((segment.removeNodeIds?.length ?? 0) < 2) continue;
    for (const id of segment.removeNodeIds ?? []) atomInnerIds.add(id);
  }
  if (atomInnerIds.size > 0) {
    const holdsAtomInner = (node: OoxmlNode, depth: number): boolean => {
      if (atomInnerIds.has(node.id)) return true;
      if (node.kind === 'textValue' || depth > 8) return false;
      return node.children.some((inner) => holdsAtomInner(inner, depth + 1));
    };
    // The FIRST child of the group still owns the atom's own offset, so it stays matchable;
    // only the zero-length remainder is skipped past.
    let seenGroupStart = false;
    for (const child of container.children) {
      if (child.kind === 'textValue' || !holdsAtomInner(child, 0)) {
        seenGroupStart = false;
        continue;
      }
      if (seenGroupStart) swallowed.add(child.id);
      seenGroupStart = true;
    }
  }
  let cursor = span.start;
  for (let position = 0; position < container.children.length; position += 1) {
    const child = container.children[position]!;
    // `w:pPr` and `w:rPr` must stay first among their siblings, so a marker at offset 0 goes
    // AFTER the properties rather than before them. Inserting ahead of `w:pPr` produces a
    // paragraph the tree invariants reject, which is the invariant doing its job.
    const isProperties = child.kind === 'paragraphProperties' || child.kind === 'runProperties';
    if (cursor === offset && !isProperties && !swallowed.has(child.id)) {
      return { containerId: container.id, index: position };
    }
    if (child.kind === 'textValue') continue;
    const length = index.lengthOf(child);
    // A container the offset falls STRICTLY inside is descended into, so the marker lands
    // where the text is rather than beside the wrapper. A hyperlink, a revision wrapper and
    // an inline content control are all run containers, and any can hold another — a link
    // inside a tracked insertion is ordinary. A comment anchored inside tracked text belongs
    // inside the wrapper that tracks it, or the markup claims the comment covers text the
    // revision does not.
    if (offset > cursor && offset < cursor + length) {
      const inner = descendableContainer(child);
      if (inner) {
        const found = locateOffset(paragraph, inner, offset, depth + 1);
        if (found) return found;
      }
    }
    cursor += length;
  }
  return cursor === offset ? { containerId: container.id, index: container.children.length } : null;
}

/**
 * The element to descend into for an offset inside `child`, or null when the offset is
 * inside something indivisible.
 *
 * A run is deliberately absent: `insertCommentMarker` splits the run straddling the offset
 * before this runs, so an offset inside a run is already a boundary between runs by the time
 * it is located. An atom — a drawing, a field, a note mark — has no inside to reach.
 */
function descendableContainer(child: OoxmlNode): OoxmlElement | null {
  if (child.kind === 'textValue') return null;
  if (isInlineRunContainer(child)) {
    return child as OoxmlElement;
  }
  // An inline content control holds its content in `w:sdtContent`; the wrapper's other
  // children (`w:sdtPr`, `w:sdtEndPr`) are properties a marker must never land among.
  if (isContentControlNode(child)) return contentControlContentOf(child) ?? null;
  return null;
}

/**
 * A marker built with its TYPED kind, not as a generic element.
 *
 * The readers match on kind — `commentAnchorsOfStory` looks for `commentRangeStart` — so a
 * marker written as generic would round-trip correctly and be invisible to everything in the
 * same session that asked where the comment is anchored.
 */
function markerElement(
  id: string,
  kind: 'commentRangeStart' | 'commentRangeEnd' | 'commentReference',
  localName: string,
  commentId: string
): OoxmlElement {
  return {
    id,
    kind,
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes: [
      {
        kind: 'genericExtension' as const,
        namespaceUri: WML_NAMESPACE_URI,
        localName: 'id',
        prefix: 'w',
        value: commentId,
      },
    ],
    children: [],
  } as OoxmlElement;
}

/** `<w:r><w:commentReference w:id="N"/></w:r>` — the reference is a RUN child. */
function referenceRun(id: string, commentId: string): OoxmlElement {
  return {
    id,
    kind: 'run',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'r',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [markerElement(`${id}.0`, 'commentReference', 'commentReference', commentId)],
  } as OoxmlElement;
}

/** A run that carries a `w:commentReference` and nothing measured (no text, drawing, …). */
function isCommentReferenceRun(node: OoxmlNode): boolean {
  if (node.kind !== 'run') return false;
  let sawReference = false;
  for (const child of node.children) {
    if (child.kind === 'commentReference') {
      sawReference = true;
      continue;
    }
    if (child.kind === 'runProperties') continue;
    return false;
  }
  return sawReference;
}

/** Zero-width comment markup already parked at an equal offset. */
function isCoincidentCommentMarkup(node: OoxmlNode): boolean {
  return (
    node.kind === 'commentRangeStart' ||
    node.kind === 'commentRangeEnd' ||
    isCommentReferenceRun(node)
  );
}

/**
 * Where a new marker sits among zero-width comment markup already at this offset.
 *
 * Word's accepted coincident-range shape is
 * `start_outer…start_inner…end_inner…end_outer…ref_outer…ref_inner`. Equal-offset
 * insertion otherwise always lands *before* the marker already there and produces
 * interleaved end→ref pairs that make Word drop `@w15:paraIdParent`.
 */
function coincidentInsertIndex(
  container: OoxmlElement,
  index: number,
  marker: CommentMarkerKind
): number {
  let insertIndex = index;
  if (marker === 'start' || marker === 'end') {
    // Starts nest inside existing starts; ends stay after those starts (empty ranges)
    // but before any end/ref already at the offset.
    while (
      insertIndex < container.children.length &&
      container.children[insertIndex]!.kind === 'commentRangeStart'
    ) {
      insertIndex += 1;
    }
    return insertIndex;
  }
  // References trail the whole end/ref cluster so parent refs precede reply refs.
  while (
    insertIndex < container.children.length &&
    isCoincidentCommentMarkup(container.children[insertIndex]!)
  ) {
    insertIndex += 1;
  }
  return insertIndex;
}

/**
 * Where a zero-width range marker goes at a model offset: the run straddling the offset is
 * split first, then the offset is located the way the paragraph offset authority measures it.
 * Shared by comment and bookmark markers, which are the same class of `EG_RangeMarkupElements`.
 */
export function markerSiteAt(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  options?: EditOptions
):
  | {
      readonly ok: true;
      readonly part: OoxmlPart;
      readonly containerId: string;
      readonly index: number;
    }
  | { readonly ok: false; readonly reason: TreeOpRejection } {
  const split = splitRunsAt(part, paragraph, offset, options);
  if (!split.ok) return { ok: false, reason: split.reason };
  const reloaded = findNode(split.part, paragraph.id);
  if (!reloaded || reloaded.kind !== 'paragraph') return { ok: false, reason: 'tree-invariant' };
  const at = locateOffset(reloaded, reloaded, offset, 0);
  if (!at) return { ok: false, reason: 'offset-out-of-range' };
  return { ok: true, part: split.part, containerId: at.containerId, index: at.index };
}

export interface InsertCommentMarkerOp {
  readonly op: 'insertCommentMarker';
  readonly paragraphId: string;
  readonly offset: number;
  readonly commentId: string;
  readonly marker: CommentMarkerKind;
}

/**
 * Place one piece of comment markup at a model offset.
 *
 * The run straddling the offset is split first, because a range marker is a sibling of runs and
 * cannot be placed inside one. Splitting changes no characters, so every other offset in the
 * paragraph — and every anchor addressed by one — is unmoved.
 *
 * Coincident markers (a reply on its parent's range, or a second remark on the same span) are
 * ordered for Word: starts outer→inner, ends inner→outer, references outer→inner.
 */
export function applyInsertCommentMarker(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  op: InsertCommentMarkerOp,
  options?: EditOptions
): TreeOpResult {
  const at = markerSiteAt(part, paragraph, op.offset, options);
  if (!at.ok) return at;
  const split = at;

  let insertIndex = at.index;
  const container = findNode(split.part, at.containerId);
  if (container && container.kind !== 'textValue') {
    insertIndex = coincidentInsertIndex(container, at.index, op.marker);
  }

  const nodeId = `${part.name}#comment-${op.marker}-${op.commentId}-${op.offset}`;
  const node =
    op.marker === 'reference'
      ? referenceRun(nodeId, op.commentId)
      : markerElement(
          nodeId,
          op.marker === 'start' ? 'commentRangeStart' : 'commentRangeEnd',
          op.marker === 'start' ? 'commentRangeStart' : 'commentRangeEnd',
          op.commentId
        );

  const inserted = insertChildren(split.part, at.containerId, insertIndex, [node], options);
  if (!inserted.ok) {
    return { ok: false, reason: 'tree-invariant', detail: JSON.stringify(inserted.issues) };
  }
  return {
    ok: true,
    part: inserted.part,
    effect: {
      dirty: [paragraph.id],
      created: [],
      deleted: [],
      dependencyKeys: [DEPENDENCY_KEY_IDS.story],
      // The markers add no characters and no height; only the paragraph's own content changed.
      impact: 'text-local',
    },
  };
}
