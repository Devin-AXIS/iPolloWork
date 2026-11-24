// Tracked PARAGRAPH MARKS — the pilcrow's own revisions.
//
// Split from `tree-op-tracked.ts`, which owns run-level content wrappers and their
// placement; this module owns the one tracked edit with no run in it: `w:pPr/w:rPr/w:ins`
// and `w:del` (§17.13.5, `EG_ParaRPrTrackChanges`), the marks a split or a merge writes.
// The node builders and the coalescing window are shared — one spelling of a wrapper's
// attributes, one definition of "the same editing moment".

import {
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import {
  createMarkContainerIdAllocator,
  createNodeIdAllocator,
  parentNodeOf as parentOf,
  replaceChildren,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import { nextRevisionId } from './tree-op-revision-ids.ts';
import { TEXT_DEPS, fromEdit } from './tree-op-nodes.ts';
import { build, childrenOf, isWmlNamed, revisionAttributes } from './tree-op-tracked.ts';
import { sameEditingMoment } from './tree-op-tracked-adjacency.ts';
import { isInertMarker } from './revision-marker-content.ts';
import type { RevisionAttributionInput, TreeOpEffect, TreeOpResult } from './tree-op-validate.ts';

/**
 * Stamp a paragraph's own MARK as inserted or deleted.
 *
 * `w:pPr/w:rPr/w:ins|w:del` (§17.13.5, `EG_ParaRPrTrackChanges`) is how Word records a split
 * or a merge: the mark is the pilcrow, and the pilcrow is what the edit added or removed.
 * There is no text to strike, which is why this is the only tracked edit with no run in it.
 *
 * SPLIT stamps `w:ins` on the FIRST paragraph — its mark is the one that did not exist
 * before. MERGE stamps `w:del` on the first as well: the mark being proposed for removal is
 * the one between the two paragraphs, which belongs to the first. Rejecting the insert and
 * accepting the delete both run the paragraph into the one after it, which is why
 * `resolveRevisions` treats them the same way.
 *
 * An existing mark of the SAME kind and author is joined rather than replaced, so a run of
 * Enters is one decision and one Accept.
 */
export function applyParagraphMarkRevision(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  kind: 'ins' | 'del',
  revision: RevisionAttributionInput,
  options?: EditOptions
): TreeOpResult {
  const mint = createNodeIdAllocator(part);
  const effect: TreeOpEffect = {
    dirty: [paragraph.id],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
  };

  const existing = paragraphMarkRevisionOf(paragraph, kind);
  if (existing && existing.author === revision.author) {
    // Already proposed by this author. A second Enter at the same mark is not a second
    // decision, and stamping again would mint an id nothing else refers to.
    return fromEdit({ ok: true, part }, effect);
  }

  const adjacent = adjacentParagraphMark(part, paragraph, kind, revision);
  // The transaction's counter when it lends one: a walk of the whole part per mark made a
  // deletion over many paragraphs quadratic.
  const id = adjacent?.id ?? options?.trackedRevisionIds?.mint() ?? nextRevisionId(part)();
  const attribution = adjacent
    ? {
        author: revision.author,
        ...(adjacent.date === undefined ? {} : { date: adjacent.date }),
      }
    : revision;
  const mark = build(mint(), 'generic', kind, revisionAttributes(id, attribution), []);

  const properties = childrenOf(paragraph).find((child) => child.kind === 'paragraphProperties');
  const rest = childrenOf(paragraph).filter((child) => child.kind !== 'paragraphProperties');

  // `w:rPr` sits near the END of `CT_PPr` — after the base properties (`w:jc`, `w:spacing`,
  // `w:numPr`, …) and before `w:sectPr`/`w:pPrChange`, which are the only two that may
  // follow it. Placing it first looked tidier and produced a `w:pPr` the tree invariants
  // reject, which is the invariant reading the schema correctly.
  const previousRPr = properties
    ? childrenOf(properties).find((child) => isWmlNamed(child, 'rPr'))
    : undefined;
  // Only the SAME-KIND mark is replaced. `EG_ParaRPrTrackChanges` is `ins? del? moveFrom?
  // moveTo?` — both an insert and a delete may sit here, and that pair is exactly what Word
  // writes when B proposes removing a mark A proposed adding. Stripping every revision took
  // A's out of the file, so rejecting B's deletion made A's break permanent and A's card
  // vanished from every reviewer's pane.
  const rPrRest = previousRPr
    ? childrenOf(previousRPr).filter((child) => !isMarkRevisionOfKind(child, kind))
    : [];
  const siblingMark = rPrRest.filter(isMarkRevision);
  const otherProperties = rPrRest.filter((child) => !isMarkRevision(child));
  // `ins` before `del`, per the group's own order.
  const marks = kind === 'ins' ? [mark, ...siblingMark] : [...siblingMark, mark];
  // The existing containers keep their ids. A fresh `w:pPr` reads, to a collaborating
  // replica, as removing the old one, and a peer's concurrent property edit inside the old one
  // then lands in a container that no longer exists.
  // Containers this stamp creates take the `mark` id family, so resolving the mark removes
  // them again and only them: a source `<w:pPr/>` or empty `w:rPr` stays as it was.
  const markMint = createMarkContainerIdAllocator(part);
  const rPr = build(
    previousRPr?.id ?? markMint(),
    'runProperties',
    'rPr',
    previousRPr && previousRPr.kind !== 'textValue' ? previousRPr.attributes : [],
    [...marks, ...otherProperties]
  );
  const pPrRest = properties
    ? childrenOf(properties).filter((child) => !isWmlNamed(child, 'rPr'))
    : [];
  // `CT_PPr` puts `w:rPr` AFTER the base properties — only `w:sectPr` and `w:pPrChange` may
  // follow it — so an existing `w:jc` stays in front. Placing `w:rPr` first looked tidier and
  // produced a `w:pPr` the tree invariants reject, which is the invariant reading the schema
  // correctly.
  const trailing = pPrRest.filter(isTrailingParagraphProperty);
  const leading = pPrRest.filter((child) => !isTrailingParagraphProperty(child));
  const pPr = build(
    properties?.id ?? markMint(),
    'paragraphProperties',
    'pPr',
    properties ? properties.attributes : [],
    [...leading, rPr, ...trailing]
  );

  return fromEdit(replaceChildren(part, paragraph.id, [pPr, ...rest], options), effect);
}

/**
 * Propose merging `paragraph` into the paragraph before it.
 *
 * The mark that would go is its PREDECESSOR's, and only the tree knows which paragraph that
 * is: addressing the merge by the first paragraph made a multi-paragraph delete stamp one
 * paragraph N times and leave the rest untouched, so accepting produced an empty paragraph
 * for every one selected.
 */
export function applyProposeParagraphMerge(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  revision: RevisionAttributionInput,
  options?: { readonly deferValidation?: boolean }
): TreeOpResult {
  const parent = parentOf(part, paragraph.id);
  if (!parent) return { ok: false, reason: 'tree-invariant' };
  const siblings = parent.children;
  const at = siblings.findIndex((child) => child.id === paragraph.id);
  const previous = at > 0 ? siblings[at - 1] : undefined;
  // A paragraph with nothing before it IN THE SAME CONTAINER has no mark to propose away.
  // Marking across a container boundary wrote a `w:del` on the last paragraph of a `w:tc` —
  // markup Word repairs, and which Accept then silently dropped, because there is no
  // following paragraph to merge into.
  if (!previous || previous.kind !== 'paragraph') {
    return { ok: false, reason: 'not-adjacent-siblings' };
  }
  return applyParagraphMarkRevision(part, previous, 'del', revision, options);
}

/**
 * Whether this paragraph's mark is an insertion THIS author proposed.
 *
 * Proposing to delete a mark you proposed adding is just taking the proposal back, so the
 * caller performs a real join instead of writing a `w:del`. Re-labelling it left a paragraph
 * break that Reject then made permanent — the opposite of what the user asked for. The
 * module states this rule for text; the mark path did not have it.
 */
export function retractsOwnParagraphMark(paragraph: OoxmlParagraphNode, author: string): boolean {
  const own = paragraphMarkRevisionOf(paragraph, 'ins');
  return own !== undefined && own.author === author;
}

/** The revision of one KIND on a paragraph's own mark, or undefined. */
export function paragraphMarkRevisionOf(
  paragraph: OoxmlParagraphNode,
  kind: 'ins' | 'del'
): { readonly localName: string; readonly author: string } | undefined {
  const properties = childrenOf(paragraph).find((child) => child.kind === 'paragraphProperties');
  const rPr = properties
    ? childrenOf(properties).find((child) => isWmlNamed(child, 'rPr'))
    : undefined;
  const mark = rPr ? childrenOf(rPr).find((child) => isMarkRevisionOfKind(child, kind)) : undefined;
  if (!mark || mark.kind === 'textValue') return undefined;
  const author = mark.attributes.find(
    (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'author'
  );
  return { localName: mark.localName, author: author?.value ?? '' };
}

/** The only two `CT_PPr` children that may follow `w:rPr`. */
function isTrailingParagraphProperty(node: OoxmlNode): boolean {
  return isWmlNamed(node, 'sectPr') || isWmlNamed(node, 'pPrChange');
}

function isMarkRevisionOfKind(node: OoxmlNode, kind: 'ins' | 'del'): boolean {
  return node.kind !== 'textValue' && isWmlNamed(node, kind);
}

function isMarkRevision(node: OoxmlNode): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    (node.localName === 'ins' || node.localName === 'del')
  );
}

/**
 * The identity of a same-kind, same-author, same-moment mark on a NEIGHBOURING paragraph.
 *
 * A run of Enters, or a run of Backspaces at a paragraph start, is one editing gesture — Word
 * groups it under one revision and offers one Accept. Both id and date must match because the
 * review queue addresses a decision by their pair. Reusing only the id still made one card per
 * second, which is why the same number of Enter presses produced an inconsistent card count.
 */
function adjacentParagraphMark(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  kind: 'ins' | 'del',
  revision: RevisionAttributionInput
): { readonly id: string; readonly date?: string } | null {
  const parent = parentOf(part, paragraph.id);
  if (!parent) return null;
  const siblings = parent.children;
  const at = siblings.findIndex((child) => child.id === paragraph.id);
  // Position markers between two paragraphs, such as a bookmark end, do not separate them:
  // one deletion over both stays one decision.
  const neighbourAt = (step: number): OoxmlNode | undefined => {
    let index = at + step;
    while (index >= 0 && index < siblings.length && isInertMarker(siblings[index]!)) index += step;
    return siblings[index];
  };
  for (const neighbour of [neighbourAt(-1), neighbourAt(1)]) {
    if (!neighbour || neighbour.kind !== 'paragraph') continue;
    const properties = childrenOf(neighbour).find((child) => child.kind === 'paragraphProperties');
    const rPr = properties
      ? childrenOf(properties).find((child) => isWmlNamed(child, 'rPr'))
      : undefined;
    const mark = rPr
      ? childrenOf(rPr).find((child) => isMarkRevisionOfKind(child, kind))
      : undefined;
    if (!mark || mark.kind === 'textValue') continue;
    const read = (localName: string): string | undefined =>
      mark.attributes.find(
        (attribute) =>
          attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === localName
      )?.value;
    if (read('author') !== revision.author) continue;
    if (!sameEditingMoment(read('date'), revision.date)) continue;
    const id = read('id');
    const date = read('date');
    if (id !== undefined) return date === undefined ? { id } : { id, date };
  }
  return null;
}
