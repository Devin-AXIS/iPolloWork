// Striking text in SUGGESTING mode: `applyDeleteTracked` and the run surgery it needs.
//
// Split out of `tree-op-tracked.ts`, which keeps the insertion appliers and the node builders,
// wrapper-merging and adjacency rules both lanes share. The dependency runs one way: this
// module imports the builders; nothing here is imported back.

import {
  isInlineRunContainer,
  MAX_INLINE_CONTAINER_DEPTH,
  nextInlineContainerDepth,
} from '../package/ooxml-shared.ts';
import { isInlineContainerProperty } from '../package/inline-container-properties.ts';
import type { OoxmlNode, OoxmlParagraphNode, OoxmlPart } from '../package/ooxml-tree.ts';
import {
  createNodeIdAllocator,
  findNode,
  replaceChildren,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import { isFldSimple } from '../package/field-nodes.ts';
import { complexFieldNodes } from './field-simple-to-complex.ts';
import { isOmmlEquationAtom } from '../package/omml-display.ts';
import {
  contentControlPropertiesOf,
  resolveContentControlLock,
} from '../package/content-control-nodes.ts';
import { strikesWholeControl } from './tree-op-control-strike.ts';
import { nextRevisionId } from './tree-op-revision-ids.ts';
import { TEXT_DEPS, fromEdit } from './tree-op-nodes.ts';
import { paragraphOffsetIndex, type ParagraphOffsetIndex } from './tree-op-segments.ts';
import { insertionAuthor, insideDeletion } from './tree-op-retraction.ts';
import type { RevisionAttributionInput, TreeOpEffect, TreeOpResult } from './tree-op-validate.ts';
import { adjacentDeletion, revisionKey } from './tree-op-tracked-adjacency.ts';
import {
  build,
  childrenOf,
  contentOf,
  copy,
  type Cursor,
  isRunProperties,
  isWmlNamed,
  mergedRevisions,
  revisionAttributes,
  textNode,
} from './tree-op-tracked.ts';

/**
 * Delete `[start, end)` as a tracked deletion: the words stay, re-labelled.
 *
 * Content already inside a `w:del` is left alone, and content inside the caller's OWN `w:ins`
 * is removed outright — it was never proposed to anybody else, so there is nothing to strike.
 */
export function applyDeleteTracked(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  start: number,
  end: number,
  revision: RevisionAttributionInput,
  options?: EditOptions
): TreeOpResult {
  const mint = createNodeIdAllocator(part);
  // The transaction's bookkeeping when it lends any: the insertion half of a replacement
  // draws its own id from the same walk, and asks whether this strike is the one it replaces.
  const revisionIds = options?.trackedRevisionIds;
  // The fallback walk is built on FIRST USE, not in the ternary: a range covering only this
  // author's own pending insertion writes no `w:del`, and outside a transaction it would
  // otherwise have paid a whole-part walk to mint an id nothing uses.
  let ownMint: (() => string) | null = null;
  const mintRevision = (): string =>
    revisionIds ? revisionIds.mint() : (ownMint ??= nextRevisionId(part))();
  // Join the deletion the caret is already working on, rather than minting a fresh id per
  // keystroke. Holding Backspace through a word is ONE decision — Word records it as one
  // `w:del` and offers one Accept — and a new id per character turned a deleted word into a
  // column of one-letter cards, the same way untracked insertions did before they coalesced.
  //
  // The whole `CT_TrackChange` triple is joined, not just the id: a reader identifies a
  // revision by (id, author, date), so a fresh timestamp per keystroke split the run back
  // into one card per character even with the id shared.
  const offsets = paragraphOffsetIndex(paragraph);
  const adjacent = adjacentDeletion(paragraph, offsets, start, end, revision.author, revision.date);
  // Taken LAZILY, on the first wrapper actually written: a range covering only this author's
  // own pending insertion retracts it and strikes nothing, and minting there left a hole in
  // the dense sequence Word writes — and, under a collaboration actor, burnt a slot in that
  // actor's stripe.
  let minted: string | null = null;
  const revisionId = (): string => adjacent?.id ?? (minted ??= mintRevision());
  const attribution: RevisionAttributionInput = adjacent
    ? { author: revision.author, ...(adjacent.date === undefined ? {} : { date: adjacent.date }) }
    : revision;
  const effect: TreeOpEffect = {
    dirty: [paragraph.id],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'text-local',
  };
  const cursor: Cursor = { offset: 0 };
  // The nodes of every atom whose single model unit falls INSIDE the struck range. An atom is
  // one addressable unit, so it goes whole: striking a field's `begin` and leaving its
  // instruction, separator, result and `end` standing wrote a field no reader can resolve, and
  // accepting that deletion removed the `begin` and orphaned the rest of it in the file.
  const struck = new Set<string>();
  for (const segment of offsets.segments) {
    if (!segment.removeNodeIds || segment.removeNodeIds.length === 0) continue;
    if (segment.start < start || segment.end > end) continue;
    for (const id of segment.removeNodeIds) {
      const node = findNode(part, id);
      // Simple fields are struck in their complex form, around their direct result runs
      // (and `w:fldData`, which moves to the begin marker). Nested fields and
      // wrappers need their own deletion semantics; leaving them intact would turn a
      // replacement into an insertion. Refuse before rebuilding any selected content.
      if (
        node &&
        isFldSimple(node) &&
        node.kind !== 'textValue' &&
        node.children.some((child) => child.kind !== 'run' && !isWmlNamed(child, 'fldData'))
      ) {
        return { ok: false, reason: 'unsupported', detail: 'tracked-simple-field-result' };
      }
      struck.add(id);
    }
  }
  /** A run carrying part of a struck atom, whether or not it carries the offset itself. */
  const carriesStruckAtom = (node: OoxmlNode): boolean =>
    node.kind !== 'textValue' && contentOf(node).some((child) => struck.has(child.id));

  let exceedsDepth = false;
  // A wholly struck control that holds a revision (a `w:del` cannot hold a `w:ins`) or an
  // equation (its runs have no deleted form).
  let strikesRevisedControl = false;
  const strike = (nodes: readonly OoxmlNode[], depth: number): OoxmlNode => {
    // A JOINED deletion is this transaction's strike too, though it minted nothing — a
    // replacement over words abutting a strike from a moment ago belongs after all of them.
    // Recorded HERE rather than beside the join, because a range covering only this author's
    // own pending insertion writes no `w:del` at all: it retracts. Claiming a strike then let
    // the replacement for those retracted words jump to the far side of a struck word beside
    // them.
    const id = revisionId();
    revisionIds?.wrote(revisionKey(id, revision.author, attribution.date));
    const wrapper = build(
      mint(),
      'revisionDelete',
      'del',
      revisionAttributes(id, attribution),
      nodes
    );
    if (nextInlineContainerDepth(wrapper, depth) >= MAX_INLINE_CONTAINER_DEPTH) exceedsDepth = true;
    return wrapper;
  };

  const rebuild = (
    nodes: readonly OoxmlNode[],
    stack: readonly OoxmlNode[],
    containerDepth = 0
  ): OoxmlNode[] => {
    if (containerDepth >= MAX_INLINE_CONTAINER_DEPTH) return nodes.slice();
    const out: OoxmlNode[] = [];
    for (const node of nodes) {
      const length = offsets.lengthOf(node);
      const from = cursor.offset;
      const to = from + length;

      // A `w:fldSimple` cannot go inside a `w:del`: `CT_RunTrackChange` takes
      // `EG_ContentRunContent`, which has no `fldSimple` in it. So the field is rewritten in
      // its complex form and that whole form is struck: begin, instruction, separate, result
      // and end in one `w:del`. Striking only the result runs from inside the field did
      // nothing for a field with no saved result, and accepting it left the field standing.
      if (struck.has(node.id) && node.kind !== 'textValue' && isWmlNamed(node, 'fldSimple')) {
        cursor.offset = to;
        if (insideDeletion(stack)) {
          out.push(node);
          continue;
        }
        // Inside the author's own pending insertion it goes outright, like their own words do.
        if (insertionAuthor(stack) === revision.author) continue;
        const complex = complexFieldNodes(node, mint).map((run) => toDeleted(mint, run));
        out.push(strike(complex, containerDepth));
        continue;
      }

      if ((to <= start || from >= end || length === 0) && !carriesStruckAtom(node)) {
        cursor.offset = to;
        out.push(node);
        continue;
      }

      // A `contentLocked` control the range wholly covers is proposed for removal as a WHOLE:
      // the `w:sdt` goes inside one `w:del`, so accepting removes the control and rejecting
      // restores it. Striking its text from inside would edit content the lock protects.
      if (node.kind === 'contentControl' && !insideDeletion(stack)) {
        const locks = [...stack, node]
          .filter((owner) => owner.kind === 'contentControl')
          .map((owner) => contentControlPropertiesOf(owner).lock);
        const span = { start: from, end: to };
        if (strikesWholeControl(span, { start, end }, resolveContentControlLock(locks), node)) {
          cursor.offset = to;
          // The author's own proposal is taken back, not struck.
          if (insertionAuthor(stack) === revision.author) continue;
          if (holdsRevision(node) || holdsMath(node)) {
            strikesRevisedControl = true;
            continue;
          }
          out.push(strike([deletedWhole(mint, node)], containerDepth));
          continue;
        }
      }

      if (
        node.kind !== 'textValue' &&
        (isInlineRunContainer(node) ||
          // A content control is a run container too (`w:sdtContent` takes `EG_PContent`,
          // `w:del` included). Passing it through whole made a suggested deletion over its
          // text a silent NO-OP: the transaction committed, nothing was struck, and the
          // reviewer's replacement landed beside words that were never proposed away.
          node.kind === 'contentControl' ||
          node.kind === 'contentControlContent')
      ) {
        // Runs struck one by one inside the container are one deletion there too, as at the top.
        const rebuilt = mergedRevisions(
          mint,
          rebuild(node.children, [...stack, node], nextInlineContainerDepth(node, containerDepth))
        );
        // A wrapper emptied by the removal of our own insertion goes with it; one that
        // still holds content stays, because it is still saying something about that
        // content. A CONTROL is not a wrapper: it is document structure the user placed,
        // so it keeps its (possibly emptied) `w:sdtContent` — dropping it left a `w:sdt`
        // husk with properties and no content element, a shape Word never writes.
        const structural =
          node.kind === 'contentControl' ||
          node.kind === 'contentControlContent' ||
          (node.kind === 'generic' &&
            isInlineRunContainer(node) &&
            insertionAuthor(stack) !== revision.author);
        if (structural || rebuilt.some((child) => !isInlineContainerProperty(node, child))) {
          out.push({ ...node, children: rebuilt } as OoxmlNode);
        }
        continue;
      }

      // An equation is struck WHOLE: `m:oMath` and `m:oMathPara` go inside the `w:del`, which
      // `EG_RunLevelElements` allows, so accepting removes the equation and rejecting restores
      // it. Passing it through left it standing while the words around it were struck.
      // Inside the author's own pending insertion it goes outright, like their own words do.
      if (struck.has(node.id) && isOmmlEquationAtom(node) && !insideDeletion(stack)) {
        cursor.offset = to;
        if (insertionAuthor(stack) !== revision.author) out.push(strike([node], containerDepth));
        continue;
      }

      if (node.kind !== 'run') {
        cursor.offset = to;
        out.push(node);
        continue;
      }

      cursor.offset = to;
      if (insideDeletion(stack)) {
        // Already struck. Deleting it again would nest a second `w:del`, which says the same
        // thing twice and makes accepting it a two-step affair.
        out.push(node);
        continue;
      }
      const own = insertionAuthor(stack) === revision.author;
      const covered = { from: Math.max(start, from) - from, to: Math.min(end, to) - from };
      const pieces = splitRunThree(mint, offsets, node, covered.from, covered.to, struck);
      if (pieces.before) out.push(pieces.before);
      if (pieces.covered) {
        // Our own pending insertion: remove rather than strike. The words were never anyone
        // else's to see, so there is no proposal to make about taking them away.
        if (!own) out.push(strike([toDeleted(mint, pieces.covered)], containerDepth));
      }
      if (pieces.after) out.push(pieces.after);
    }
    return out;
  };

  const children = mergedRevisions(mint, rebuild(paragraph.children, []));
  if (exceedsDepth) return { ok: false, reason: 'invalid-range' };
  if (strikesRevisedControl) {
    return { ok: false, reason: 'unsupported', detail: 'tracked-control-with-revisions' };
  }
  return fromEdit(replaceChildren(part, paragraph.id, children, options), effect);
}

/** Split a run into the part before the range, the covered part, and the part after. */
function splitRunThree(
  mint: () => string,
  offsets: ParagraphOffsetIndex,
  run: OoxmlNode,
  from: number,
  to: number,
  /** Nodes an atom being struck swallows; covered by identity, since they measure nothing. */
  struckAtomNodes: ReadonlySet<string> = new Set()
): { before: OoxmlNode | null; covered: OoxmlNode | null; after: OoxmlNode | null } {
  const properties = childrenOf(run).filter(isRunProperties);
  const withProperties = (content: readonly OoxmlNode[]): OoxmlNode | null =>
    content.length === 0
      ? null
      : build(
          mint(),
          'run',
          'r',
          [],
          [...properties.map((child) => copy(mint, child)), ...content]
        );

  const before: OoxmlNode[] = [];
  const covered: OoxmlNode[] = [];
  const after: OoxmlNode[] = [];
  let seen = 0;
  for (const child of childrenOf(run)) {
    if (isRunProperties(child)) continue;
    const length = offsets.lengthOf(child);
    const childFrom = seen;
    const childTo = seen + length;
    seen = childTo;
    // An atom's chrome measures nothing, so no offset comparison can place it. It goes with
    // the unit it belongs to, which is being struck.
    if (struckAtomNodes.has(child.id)) {
      covered.push(child);
      continue;
    }
    if (childTo <= from) {
      before.push(child);
      continue;
    }
    if (childFrom >= to) {
      after.push(child);
      continue;
    }
    if (child.kind !== 'text' && child.kind !== 'deletedText') {
      // A tab or a break is atomic: it is covered or it is not.
      covered.push(child);
      continue;
    }
    const value = childrenOf(child).find((grand) => grand.kind === 'textValue');
    const raw = value && value.kind === 'textValue' ? value.value : '';
    const deleted = child.kind === 'deletedText';
    const head = raw.slice(0, Math.max(0, from - childFrom));
    const middle = raw.slice(Math.max(0, from - childFrom), Math.min(raw.length, to - childFrom));
    const tail = raw.slice(Math.min(raw.length, to - childFrom));
    if (head) before.push(textNode(mint, head, deleted));
    if (middle) covered.push(textNode(mint, middle, deleted));
    if (tail) after.push(textNode(mint, tail, deleted));
  }
  return {
    before: withProperties(before),
    covered: withProperties(covered),
    after: withProperties(after),
  };
}

/** Whether a revision wrapper sits anywhere inside the node. */
function holdsRevision(node: OoxmlNode): boolean {
  return (
    node.kind !== 'textValue' &&
    node.children.some(
      (child) =>
        child.kind !== 'textValue' && (child.kind.startsWith('revision') || holdsRevision(child))
    )
  );
}

/** Whether an equation sits anywhere inside the node; its runs have no deleted form here. */
function holdsMath(node: OoxmlNode): boolean {
  return (
    node.kind !== 'textValue' &&
    node.children.some(
      (child) => child.kind !== 'textValue' && (isOmmlEquationAtom(child) || holdsMath(child))
    )
  );
}

/** A whole subtree in its deleted form: every run inside it re-labelled by `toDeleted`. */
function deletedWhole(mint: () => string, node: OoxmlNode): OoxmlNode {
  if (node.kind === 'textValue') return node;
  if (node.kind === 'run') return toDeleted(mint, node);
  return {
    ...node,
    children: node.children.map((child) => deletedWhole(mint, child)),
  } as OoxmlNode;
}

/** Re-label a run's text as deleted: `w:t` becomes `w:delText`, everything else stays. */
function toDeleted(mint: () => string, run: OoxmlNode): OoxmlNode {
  const children = childrenOf(run).map((child) => {
    // `w:instrText` becomes `w:delInstrText` inside a deletion, exactly as `w:t` becomes
    // `w:delText`. The REJECT path already renames it back, so without this the write path
    // could never produce what the reject path exists to undo.
    if (child.kind !== 'textValue' && isWmlNamed(child, 'instrText')) {
      const value = childrenOf(child).find((grand) => grand.kind === 'textValue');
      const raw = value && value.kind === 'textValue' ? value.value : '';
      const valueId = mint();
      return build(mint(), 'generic', 'delInstrText', child.attributes, [
        { id: valueId, kind: 'textValue', value: raw } as OoxmlNode,
      ]);
    }
    if (child.kind !== 'text') return child;
    const value = childrenOf(child).find((grand) => grand.kind === 'textValue');
    const raw = value && value.kind === 'textValue' ? value.value : '';
    return textNode(mint, raw, true);
  });
  return { ...run, id: mint(), children } as OoxmlNode;
}
