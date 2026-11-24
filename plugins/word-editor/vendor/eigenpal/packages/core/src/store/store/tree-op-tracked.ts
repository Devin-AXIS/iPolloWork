// Typing AS A TRACKED CHANGE — what suggesting mode writes — and the node builders, wrapper
// merging and adjacency rules that striking text (`tree-op-tracked-delete.ts`) shares.
//
// Two shapes, and they are not symmetrical. An insertion is new content, so it goes into a
// `w:ins` wrapper the file did not have; a deletion keeps the words exactly where they are
// and re-labels them, `w:t` becoming `w:delText` inside a `w:del`. That asymmetry is the
// whole point of tracking: the reader has to be able to see what would go.
//
// WHY THE PARAGRAPH IS REBUILT rather than surgically patched. `w:ins` and `w:del` are
// paragraph-level (`EG_PContent`), not run-level, so tracking a change in the middle of a run
// means splitting that run and placing a sibling between the halves — and the run may sit
// inside a hyperlink, inside another revision, or both. A single ordered rebuild handles
// every nesting the same way; a set of splice-in-place edits needs a separate case for each
// and gets the offsets wrong the first time two of them overlap.
//
// Word's merge rules are followed where they are observable in the file:
//   - typing inside your own `w:ins` EXTENDS it rather than nesting a second one;
//   - deleting your own pending insertion REMOVES it, because there is nothing to propose to
//     anyone else — the text never existed for them;
//   - deleting inside an existing `w:del` does nothing, since it is already gone.

import { textWithHyphens } from './tree-op-inline-elements.ts';
import { noteReferenceEndingAt, noteTypingProperties } from './note-typing-boundary.ts';
import { trackedTypingProperties } from './fit-text-typing-boundary.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import {
  isContentRevisionKind,
  isInlineRunContainer,
  MAX_INLINE_CONTAINER_DEPTH,
  nextInlineContainerDepth,
} from '../package/ooxml-shared.ts';
import { isInlineContainerProperty } from '../package/inline-container-properties.ts';
import {
  createNodeIdAllocator,
  findNode,
  replaceChildren,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import { equivalentNodes } from './ooxml-node-equality.ts';
import { sameRevision } from './same-revision.ts';
import { nextRevisionId } from './tree-op-revision-ids.ts';
import { TEXT_DEPS, fromEdit } from './tree-op-nodes.ts';
import {
  insertionDestination,
  fieldInsertionEndAt,
  paragraphOffsetIndex,
  trailingInsertionDestination,
  type ParagraphOffsetIndex,
} from './tree-op-segments.ts';
import { insertionAuthor } from './tree-op-retraction.ts';
import {
  adjacentDeletion,
  deletionId,
  replacedEnd,
  revisionKey,
  sameEditingMoment,
} from './tree-op-tracked-adjacency.ts';
import type { RevisionAttributionInput, TreeOpEffect, TreeOpResult } from './tree-op-validate.ts';
import { build, revisionAttributes } from './tree-op-tracked-builders.ts';
import { emptyParagraphRunProperties } from './mark-character-style-run.ts';
import { formattingRunBesideRestrictedControl } from './tree-op-restricted-edge.ts';
import { liftedOutOfForeignInsertions } from './tree-op-tracked-foreign-split.ts';

export { sameEditingMoment } from './tree-op-tracked-adjacency.ts';
export { build, revisionAttributes } from './tree-op-tracked-builders.ts';

/** A `w:t`, or the `w:delText` the same characters become once struck. */
export function textNode(mint: () => string, value: string, deleted: boolean): OoxmlNode {
  const valueId = mint();
  return build(
    mint(),
    deleted ? 'deletedText' : 'text',
    deleted ? 'delText' : 't',
    [],
    [{ id: valueId, kind: 'textValue', value } as OoxmlNode]
  );
}

/** A `w:r` over its children — the ONE spelling of the run shape this module writes. */
function runOf(mint: () => string, children: readonly OoxmlNode[]): OoxmlNode {
  return build(mint(), 'run', 'r', [], children);
}

export function isRunProperties(node: OoxmlNode): boolean {
  return node.kind !== 'textValue' && node.kind === 'runProperties';
}

/**
 * The face a NEW run takes from the run it is being inserted into — never that run's pending
 * FORMAT RECORD.
 *
 * A split copies the record into both halves, correctly: the same characters are still under
 * the same proposal. A run being inserted is different. Its characters were never in the state
 * the record describes, so inheriting it put them under somebody's pending decision — reject
 * the format card and the words just typed came back in a colour nobody had ever given them,
 * while their own insertion card was still unanswered. The mirror of `insideOwnInsertion`,
 * which refuses to WRITE a record in the same position.
 */
export function insertedRunProperties(mint: () => string, run: OoxmlNode): OoxmlNode[] {
  const out: OoxmlNode[] = [];
  for (const child of childrenOf(run)) {
    if (!isRunProperties(child)) continue;
    const kept = childrenOf(child).filter((entry) => !isWmlNamed(entry, 'rPrChange'));
    // A container holding nothing but the record is not a face to inherit.
    if (kept.length === 0) continue;
    out.push(copy(mint, { ...child, children: kept } as OoxmlNode));
  }
  return out;
}

/** Deep copy with fresh ids, so a split run's halves are two nodes and not one twice. */
export function copy(mint: () => string, node: OoxmlNode): OoxmlNode {
  if (node.kind === 'textValue') return { id: mint(), kind: 'textValue', value: node.value };
  return {
    ...node,
    id: mint(),
    children: node.children.map((child) => copy(mint, child)),
  } as OoxmlNode;
}

/** How many deletion wrappers with this `@w:id` live under the node, itself included. */
function deletionWrappersWithId(node: OoxmlNode, id: string): number {
  if (node.kind === 'textValue') return 0;
  let count = deletionId(node) === id ? 1 : 0;
  for (const child of node.children) count += deletionWrappersWithId(child, id);
  return count;
}

/** A wrapper's `@w:date`, or undefined. */
function revisionDateOf(node: OoxmlNode): string | undefined {
  if (node.kind === 'textValue') return undefined;
  return node.attributes.find(
    (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'date'
  )?.value;
}

export interface Cursor {
  offset: number;
}

/**
 * The nodes an ATOM occupies, split into the one that carries its offset and the rest.
 *
 * A complex field is one addressable unit spread over five or six runs — `w:fldChar begin`,
 * `w:instrText`, `w:fldChar separate`, the cached result, `w:fldChar end`. `segmentsOf` gives
 * the whole thing ONE model position, at the begin node, and lists every other node it
 * swallows. A tracked edit has to respect that grouping or it writes markup no reader can
 * resolve: a `begin` inside a `w:del` with its `end` outside is a field whose deletion cannot
 * be accepted without orphaning the rest of it, and text typed at the field's model end lands
 * between the chrome runs, inside the instruction, where it is invisible and stays invisible.
 */
interface AtomNodes {
  /** The node the atom's single offset belongs to — its `begin`, or the `w:fldSimple`. */
  readonly begin: ReadonlySet<string>;
  /** Everything else the atom swallows: instruction, separator, cached result, end. */
  readonly tail: ReadonlySet<string>;
}

function atomNodesOf(offsets: ParagraphOffsetIndex): AtomNodes {
  const begin = new Set<string>();
  const tail = new Set<string>();
  for (const segment of offsets.segments) {
    if (!segment.removeNodeIds || segment.removeNodeIds.length === 0) continue;
    begin.add(segment.node.id);
    for (const id of segment.removeNodeIds) {
      if (id !== segment.node.id) tail.add(id);
    }
  }
  return { begin, tail };
}

/** A run's content — everything but its `w:rPr`. */
export function contentOf(node: OoxmlNode): readonly OoxmlNode[] {
  return childrenOf(node).filter((child) => !isRunProperties(child));
}

/** A run holding nothing but an atom's TAIL: chrome, and never a position of its own. */
function isAtomTailRun(node: OoxmlNode, atoms: AtomNodes): boolean {
  if (node.kind !== 'run') return false;
  const content = contentOf(node);
  return content.length > 0 && content.every((child) => atoms.tail.has(child.id));
}

/** A run holding an atom's addressable node — the one position the whole atom has. */
function holdsAtomBegin(node: OoxmlNode, atoms: AtomNodes): boolean {
  if (node.kind !== 'run') return false;
  return contentOf(node).some((child) => atoms.begin.has(child.id));
}

/**
 * What a tracked insertion places: run text, run-level elements, or one complete run.
 *
 * `length` is the payload's size in MODEL units, on `segmentsOf`'s terms — `text.length`
 * for characters, one for a tab or a break — so the extend-own-insertion path can step the
 * cursor past what it just placed without re-measuring the rebuilt run.
 */
interface TrackedInsertionPayload {
  readonly length: number;
  /**
   * Run CHILDREN — text, a tab, a field's nodes — that inherit the host run's `w:rPr`:
   * placed in one run under the wrapper, or spliced into the author's own run when
   * extending. Null for a payload that is a complete run of its own.
   */
  readonly nodes: ((mint: () => string) => readonly OoxmlNode[]) | null;
  /**
   * Complete runs carrying their OWN `w:rPr` — a note citation, whose reference style must
   * not be replaced by the formatting at the caret, or a complex field's marker runs. Placed
   * as sibling runs: alone under the wrapper, or beside the split halves when extending the
   * author's own `w:ins`.
   */
  readonly runs?: (mint: () => string) => readonly OoxmlNode[];
}

/**
 * Insert `text` at `offset` as a tracked insertion.
 *
 * Returns the paragraph's new children, or null when the offset was never reached — which
 * means the caller's offset is past the end of the paragraph and the op should be refused
 * rather than quietly appended somewhere else.
 */
export function applyInsertTracked(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  text: string,
  revision: RevisionAttributionInput,
  options?: EditOptions,
  bias: 'left' | 'right' = 'left'
): TreeOpResult {
  return applyTrackedInsertion(
    part,
    paragraph,
    offset,
    {
      length: text.length,
      nodes: (mint) => textWithHyphens(mint, text),
    },
    revision,
    options,
    bias
  );
}

/**
 * Insert ONE run-level element — a tab or a break — at `offset` as a tracked insertion.
 *
 * The caller supplies the element builder. This module supplies tracked placement.
 */
export function applyInsertTrackedElement(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  element: (mint: () => string) => OoxmlNode,
  revision: RevisionAttributionInput,
  options?: EditOptions,
  bias?: 'left' | 'right'
): TreeOpResult {
  return applyTrackedInsertion(
    part,
    paragraph,
    offset,
    { length: 1, nodes: (mint) => [element(mint)] },
    revision,
    options,
    bias
  );
}

/**
 * Insert a MULTI-NODE run payload — a complete complex field — as ONE tracked insertion.
 *
 * The nodes share one run inside one `w:ins`, exactly the grouping the untracked
 * `insertPageField` writes, so the whole atom is one proposal: rejecting it takes the
 * `begin`, instruction, separator and `end` back together, never leaving a field no reader
 * can resolve. `length` is the payload's size in MODEL units on `segmentsOf`'s terms — one
 * per field atom plus any literal text between them.
 */
export function applyInsertTrackedElements(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  elements: (mint: () => string) => readonly OoxmlNode[],
  length: number,
  revision: RevisionAttributionInput,
  options?: EditOptions
): TreeOpResult {
  return applyTrackedInsertion(
    part,
    paragraph,
    offset,
    { length, nodes: elements },
    revision,
    options
  );
}

/**
 * Insert COMPLETE runs — a note citation, or a complex field's begin, instruction, separate,
 * and end runs (one model unit) — at `offset` as ONE tracked insertion.
 *
 * The run arrives with its own `w:rPr` (the reference style) and keeps it: it is placed as
 * a sibling run under the wrapper, never spliced into a run whose formatting would restyle
 * it. Everything else — adjacent-deletion adoption, extending the author's own `w:ins`,
 * relocation past struck words — is the same placement typed text follows, which is what
 * lets a citation inserted over a selection resolve as ONE reviewable replacement.
 */
export function applyInsertTrackedRun(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  run: (mint: () => string) => OoxmlNode | readonly OoxmlNode[],
  revision: RevisionAttributionInput,
  options?: EditOptions,
  length = 1,
  bias?: 'left' | 'right'
): TreeOpResult {
  const runs = (mint: () => string) => [run(mint)].flat();
  return applyTrackedInsertion(
    part,
    paragraph,
    offset,
    { length, nodes: null, runs },
    revision,
    options,
    bias
  );
}

function applyTrackedInsertion(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  aim: number,
  payload: TrackedInsertionPayload,
  revision: RevisionAttributionInput,
  options?: EditOptions,
  bias: 'left' | 'right' = 'left'
): TreeOpResult {
  const mint = createNodeIdAllocator(part);
  const offsets = paragraphOffsetIndex(paragraph);
  const effect: TreeOpEffect = {
    dirty: [paragraph.id],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'text-local',
  };
  const cursor: Cursor = { offset: 0 };
  const atoms = atomNodesOf(offsets);
  let placed = false;

  // Typing over a selection arrives as a deletion and an insertion in ONE transaction, the
  // deletion first — so by the time this runs, the struck words are already in the tree at
  // the caret. The insertion adopts their DATE, so the pair reads as one moment, and lands
  // right after them, so the pair reads as one replacement. It does NOT adopt their `@w:id`:
  // Word numbers every revision element uniquely and writes a replacement as `w:del` then
  // `w:ins` under two ids, and a reader that keys on the id — the reporter's tooling did —
  // saw one collided revision where Word writes two. Nothing here needs the shared id: the
  // review lane pairs the halves on adjacency (the only thing that works for a file this
  // engine did not write) and resolves both addresses in one transaction, and undo is the
  // transaction's, not the id's.
  // Only a deletion from THIS edit joins: `adjacentDeletion` matches on author alone, and a
  // deletion the same author made last month is also adjacent. Adopting its date would
  // backdate today's edit into last month's revision and make rejecting one reject both.
  const replaced = adjacentDeletion(paragraph, offsets, aim, aim, revision.author, revision.date);
  const attribution: RevisionAttributionInput = replaced
    ? { author: revision.author, ...(replaced.date === undefined ? {} : { date: replaced.date }) }
    : revision;
  // THE REPLACEMENT FOLLOWS THE WORDS IT REPLACES. The struck text keeps its offsets, so a
  // caller that aims at the front edge of THIS TRANSACTION's own strike — where the range
  // began — is placing the same edit the keyboard places when it aims past the strike.
  // Normalized HERE, once, so every rule below sees one aim: struck text first, then what
  // takes its place, which is Word's arrangement, the order that reads as a sentence, and the
  // adjacency the review lane pairs into one card. Aimed at the front, the run before the
  // strike used to take the words at its end boundary, and every mid-paragraph replacement
  // came out `w:ins` then `w:del`.
  // Only a strike THIS transaction wrote qualifies (`TransactionRevisionIds.wroteUnder`). The
  // deletion a keystroke ago is adjacent too, and typing after Backspace or Delete belongs in
  // FRONT of the struck character — Word's order for that gesture — not after it.
  // ONE predicate for the whole placement, because the question is asked three times: here,
  // at the boundary rule that puts the words after a `w:del` they start on, and at the rule
  // that follows them into the link or control holding the struck words. Two answers to it
  // put the same gesture on either side of the strike depending on what preceded it.
  //
  // WITHOUT a transaction's bookkeeping there is no opinion to consult, and the reading is
  // that an adjacent strike by this author IS the one being replaced — which is what every
  // caller driving the appliers directly means by a `deleteText` and an `insertText` at one
  // offset, and what the note lifecycle means when it writes its reference over a selection.
  // Only a transaction can tell that gesture apart from Backspace-then-type, and only a
  // transaction has to: the keyboard's two gestures are two transactions.
  const replacesThisEdit =
    replaced !== null &&
    (options?.trackedRevisionIds?.wroteUnder(
      revisionKey(replaced.id, revision.author, replaced.date)
    ) ??
      true);
  const offset = replacesThisEdit
    ? Math.max(aim, replacedEnd(paragraph, offsets, replaced!, revision.author, aim))
    : aim;
  const trailingDestination = trailingInsertionDestination(paragraph, offset);
  const afterNote = bias === 'left' && noteReferenceEndingAt(paragraph, offset);
  const fieldDestination =
    fieldInsertionEndAt(paragraph, offset) || afterNote
      ? insertionDestination(paragraph, offset, null)
      : null;
  const fieldSite = fieldDestination?.site;
  const fieldLeftRunId = fieldDestination
    ? [...offsets.segments].reverse().find((segment) => segment.end === offset)?.runId
    : undefined;
  const fieldLeftRun = fieldLeftRunId ? findNode(part, fieldLeftRunId) : null;
  const fieldProperties = () =>
    afterNote
      ? noteTypingProperties(paragraph, offset, mint)
      : fieldLeftRun
        ? insertedRunProperties(mint, fieldLeftRun)
        : [];
  // Beside a control that typing cannot enter, the words take the text's formatting outside it.
  const besideProperties = (): readonly OoxmlNode[] | null => {
    if (replacesThisEdit || afterNote) return null;
    const run = formattingRunBesideRestrictedControl(paragraph, offset, offsets);
    return run === undefined ? null : run ? insertedRunProperties(mint, run) : [];
  };
  const rightBiasedDestination =
    bias === 'right' ? insertionDestination(paragraph, offset, null, bias) : null;
  // Minted LAZILY, on the first wrapper actually built: `nextRevisionId` walks the whole
  // part, and typing on inside your own `w:ins` — every keystroke after the first — extends
  // the existing wrapper and builds none, so it must not pay that walk. A transaction lends
  // its own bookkeeping so a replacement's two halves share one walk.
  let insertionId: string | null = null;
  const mintedInsertionId = (): string =>
    (insertionId ??= options?.trackedRevisionIds?.mint() ?? nextRevisionId(part)());

  // Counted lazily and ONCE: the paragraph-wide count only matters when a container holds
  // part of the adopted deletion, and it cannot change during the rebuild.
  let replacedWrapperTotal: number | null = null;
  const wrappersWithReplacedId = (): number => {
    if (replaced === null) return 0;
    replacedWrapperTotal ??= paragraph.children.reduce(
      (count, child) => count + deletionWrappersWithId(child, replaced.id),
      0
    );
    return replacedWrapperTotal;
  };

  // A replacement inherits the first replaced run, even when the whole run was struck.
  // A deletion wrapper is not an ordinary insertion host: at its boundary the generic
  // placement path has no run properties to borrow, and used to silently drop bold/links'
  // character styles when the replacement was accepted.
  const firstRun = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'run') return node;
    if (node.kind === 'textValue') return null;
    for (const child of node.children) {
      const found = firstRun(child);
      if (found) return found;
    }
    return null;
  };
  const replacedRunIn = (nodes: readonly OoxmlNode[], start = 0): OoxmlNode | null => {
    for (const node of nodes) {
      if (node.kind === 'textValue') continue;
      const end = start + offsets.lengthOf(node);
      if (
        start <= aim &&
        aim <= end &&
        node.kind === 'revisionDelete' &&
        deletionId(node) === replaced?.id &&
        node.attributes.some(
          (attribute) =>
            attribute.namespaceUri === WML_NAMESPACE_URI &&
            attribute.localName === 'author' &&
            attribute.value === revision.author
        ) &&
        revisionDateOf(node) === replaced?.date
      ) {
        const run = firstRun(node);
        if (run) return run;
      }
      const nested = replacedRunIn(node.children, start);
      if (nested) return nested;
      start = end;
    }
    return null;
  };
  const replacementRun = replacesThisEdit ? replacedRunIn(paragraph.children) : null;
  // A paragraph with no content gives its first run the mark's character style, whatever an
  // empty run beside the insertion carries (`mark-character-style-run.ts`).
  // `offsets.segments` first: every keystroke in a paragraph with content skips the mark read.
  const markStyled = (): readonly OoxmlNode[] | null => {
    if (offsets.segments.length > 0) return null;
    const styled = emptyParagraphRunProperties(paragraph, mint);
    return styled.length > 0 ? styled : null;
  };
  let exceedsDepth = false;
  const wrappers = new Set<string>();
  const wrap = (properties: readonly OoxmlNode[], depth: number): OoxmlNode => {
    const wrapper = build(
      mint(),
      'revisionInsert',
      'ins',
      revisionAttributes(mintedInsertionId(), attribution),
      payload.nodes
        ? [
            runOf(mint, [
              ...(replacementRun
                ? insertedRunProperties(mint, replacementRun)
                : (markStyled() ?? besideProperties() ?? properties)),
              ...payload.nodes(mint),
            ]),
          ]
        : payload.runs!(mint)
    );
    if (nextInlineContainerDepth(wrapper, depth) >= MAX_INLINE_CONTAINER_DEPTH) exceedsDepth = true;
    wrappers.add(wrapper.id);
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
      if (placed) {
        out.push(node);
        continue;
      }
      // `w:pPr` IS a child of the paragraph, it measures nothing, and §17.3.1.26 requires it
      // FIRST — so it is never a place to put words. Without this it took every insertion
      // aimed at offset 0 (the boundary rule below fires for anything that is not a run) and
      // wrote `<w:p><w:ins/><w:pPr/></w:p>`, which the paragraph invariant refuses. Every
      // keystroke in an empty paragraph that carries properties — the one Enter has just
      // made, a list item, a styled blank line — was rejected, so suggesting mode looked
      // dead from the moment the caret landed in a new paragraph.
      if (node.kind !== 'textValue' && node.kind === 'paragraphProperties') {
        out.push(node);
        continue;
      }
      // A content control's property containers are the same shape: `CT_SdtRun` requires
      // `w:sdtPr`/`w:sdtEndPr` ahead of `w:sdtContent`, they measure nothing, and the
      // boundary rule below would otherwise put an insertion aimed at the control's first
      // character in FRONT of them.
      const parent = stack.at(-1);
      if (
        node.kind === 'contentControlProperties' ||
        node.kind === 'contentControlEndProperties' ||
        (parent !== undefined && isInlineContainerProperty(parent, node))
      ) {
        out.push(node);
        continue;
      }

      const length = offsets.lengthOf(node);
      const start = cursor.offset;
      const end = start + length;

      if (fieldDestination) {
        // An offset cannot distinguish the result from its closing chrome. Use the
        // same structural insertion site as plain typing, including shared runs.
        if (
          fieldSite?.kind === 'newRun' &&
          fieldSite.holder.id === (parent?.id ?? paragraph.id) &&
          node.id ===
            fieldSite.holder.children[fieldSite.index ?? fieldSite.holder.children.length]?.id
        ) {
          const inserted =
            insertionAuthor(stack) === revision.author
              ? payload.nodes
                ? [runOf(mint, [...fieldProperties(), ...payload.nodes(mint)])]
                : payload.runs!(mint)
              : [wrap(fieldProperties(), containerDepth)];
          out.push(...inserted, node);
          placed = true;
          cursor.offset = end;
          continue;
        }
        if (fieldSite?.kind === 'atRunIndex' && node.id === fieldSite.run.id) {
          const children = childrenOf(node);
          const properties = () =>
            afterNote ? fieldProperties() : insertedRunProperties(mint, node);
          const head = runOf(mint, children.slice(0, fieldSite.index));
          const tail = runOf(mint, [
            ...children.filter(isRunProperties).map((child) => copy(mint, child)),
            ...children.slice(fieldSite.index),
          ]);
          const own = insertionAuthor([...stack, node]) === revision.author;
          const inserted = own
            ? payload.nodes
              ? [runOf(mint, [...properties(), ...payload.nodes(mint)])]
              : payload.runs!(mint)
            : [wrap(properties(), containerDepth)];
          out.push(
            ...(contentOf(head).length ? [head] : []),
            ...inserted,
            ...(contentOf(tail).length ? [tail] : [])
          );
          placed = true;
          cursor.offset = end;
          continue;
        }
        if (!fieldDestination.path.has(node.id)) {
          out.push(node);
          cursor.offset = end;
          continue;
        }
      }

      // Atom chrome measures zero at one offset. Let all of it pass before inserting, or the
      // new text lands inside the field and remains invisible.
      if (isAtomTailRun(node, atoms)) {
        out.push(node);
        continue;
      }

      // Descend inside a container. At a boundary, only an existing or shared container keeps it.
      // Never descend into a deletion: it requires `w:delText`, and accepting it would also
      // take the new insertion.
      const container =
        node.kind !== 'textValue' &&
        ((isInlineRunContainer(node) &&
          node.kind !== 'revisionDelete' &&
          node.kind !== 'revisionMoveFrom') ||
          node.kind === 'contentControl' ||
          node.kind === 'contentControlContent');
      // Same MOMENT as well as the same author — the deletion path already gates on this.
      // Typing at the end of your own month-old insertion backdated today's edit into that
      // revision, and rejecting one then rejected both.
      const ownInsertion =
        container &&
        insertionAuthor([node]) === revision.author &&
        sameEditingMoment(revisionDateOf(node), revision.date);
      const sharedTrailingOwner = trailingDestination?.path.has(node.id) === true;
      const rightBiasedOwner = rightBiasedDestination?.path.has(node.id) === true;
      // THE REPLACEMENT FOLLOWS THE DELETION IT REPLACES — into a link or a control, and
      // only when the WHOLE deletion lives there. Replacing a link's display text strikes
      // runs INSIDE the `w:hyperlink`, and the insertion adopting that deletion aims at
      // the link's boundary: placed beside the link, accepting the pair emptied the link,
      // the sweep removed it, and the accepted text came out silently unlinked. Two rules
      // narrow it:
      //   - a revision wrapper is NOT followed into: the same deletion can sit inside
      //     another author's `w:ins`, and appending there would put this author's words
      //     inside their proposal, where rejecting theirs deletes these;
      //   - a deletion that also has pieces OUTSIDE the container is not followed either —
      //     a replacement for "plain words plus the link's text" stands in for the whole
      //     range, most of which was never linked.
      // Checked lazily — the subtree scans run only for an in-bounds container while an
      // adopted deletion exists at all.
      const followable =
        container &&
        ((isInlineRunContainer(node) && !isContentRevisionKind(node.kind)) ||
          node.kind === 'contentControl' ||
          node.kind === 'contentControlContent');
      // `replacesThisEdit`, not merely "a deletion is adjacent": this is the THIRD place the
      // same question is asked, and an ungated answer followed the words into a link whose
      // text a previous gesture had struck — where the relocation above had already declined
      // to send them.
      const wrappersInside =
        followable && replacesThisEdit && offset >= start && offset <= end
          ? deletionWrappersWithId(node, replaced!.id)
          : 0;
      const holdsReplaced = wrappersInside > 0 && wrappersInside === wrappersWithReplacedId();
      if (
        container &&
        ((offset > start && offset < end) ||
          ((ownInsertion ||
            holdsReplaced ||
            sharedTrailingOwner ||
            rightBiasedOwner ||
            fieldDestination?.path.has(node.id)) &&
            offset >= start &&
            offset <= end))
      ) {
        const rebuilt = rebuild(
          node.children,
          [...stack, node],
          nextInlineContainerDepth(node, containerDepth)
        );
        // The adopted deletion ends exactly where the container does, so the inner walk
        // comes back unplaced. The replacement still belongs beside the struck words,
        // INSIDE the container that holds them.
        if (
          !placed &&
          (holdsReplaced || (sharedTrailingOwner && node.id === trailingDestination?.holderId)) &&
          offset === cursor.offset
        ) {
          rebuilt.push(
            wrap(
              fieldDestination ? fieldProperties() : [],
              nextInlineContainerDepth(node, containerDepth)
            )
          );
          placed = true;
        }
        out.push({ ...node, children: rebuilt } as OoxmlNode);
        continue;
      }

      // INSIDE struck text. The caret can rest there — all-markup shows the words, so the
      // reader can put it between two of them — and the module's rule is that an insertion
      // goes BESIDE a deletion, never into it. Only the start boundary implemented that, so
      // every interior offset was refused `offset-out-of-range`: a caret the surface had
      // placed, at a position the offset model calls valid, that would take no typing.
      // A deletion stays contiguous, so the words go after it, which is also the order a
      // replacement reads in.
      if (
        !placed &&
        offset > start &&
        offset < end &&
        node.kind !== 'textValue' &&
        (node.kind === 'revisionDelete' || node.kind === 'revisionMoveFrom')
      ) {
        cursor.offset = end;
        out.push(node, wrap([], containerDepth));
        placed = true;
        continue;
      }

      // A BOUNDARY against something that is not a run — a revision wrapper, a hyperlink,
      // a bookmark. Nothing here can be split, so the insertion goes beside it, and which
      // side is the whole question.
      if (!placed && offset === start && node.kind !== 'run') {
        // Typing over a selection: the words being replaced start exactly here, and Word
        // puts the replacement AFTER them — struck text first, then what takes its place.
        // Before them would read as "omega alpha" with alpha struck, which inverts the
        // sentence. It also puts the two halves side by side, which is what lets a reader
        // see them as one replacement.
        // The SAME gate as the relocation above: a strike from an earlier transaction is
        // adjacent too, and typing after Backspace belongs in front of the struck character.
        if (
          replacesThisEdit &&
          node.kind === 'revisionDelete' &&
          deletionId(node) === replaced!.id
        ) {
          cursor.offset = end;
          out.push(node, wrap([], containerDepth));
          placed = true;
          continue;
        }
        out.push(wrap([], containerDepth));
        placed = true;
        cursor.offset = end;
        out.push(node);
        continue;
      }

      // The END boundary of an atom's begin run is the END of the WHOLE atom, and the atom's
      // remaining runs are still to come. Placing here would put the words between the
      // field's `begin` and its instruction; deferring lets the tail runs pass and the
      // insertion land after the field, which is where the model offset points.
      if (holdsAtomBegin(node, atoms) && offset === end && offset !== start) {
        cursor.offset = end;
        out.push(node);
        continue;
      }

      // A right bias names the container the caller wants the words in, and a run ENDING at
      // this offset is not it: taking the insertion here would leave the text outside the
      // requested wrapper, which validation had already resolved as the destination. Walk on
      // and let that container claim it.
      if (
        node.kind === 'run' &&
        offset === end &&
        offset !== start &&
        rightBiasedDestination !== null &&
        !rightBiasedDestination.path.has(node.id)
      ) {
        cursor.offset = end;
        out.push(node);
        continue;
      }

      if (node.kind === 'run' && offset >= start && offset <= end) {
        const own = insertionAuthor([...stack, node]);
        // Inside our OWN pending insertion: extend it. A second `w:ins` nested in the first
        // says two people proposed the same words, which is not what happened.
        if (own === revision.author) {
          out.push(...splitRunAndInsert(mint, offsets, node, offset - start, payload));
          placed = true;
          cursor.offset = end + payload.length;
          continue;
        }
        const properties = trackedTypingProperties(
          insertedRunProperties(mint, node),
          part,
          offsets,
          node,
          offset
        );
        if (offset === start) {
          out.push(wrap(properties, containerDepth), node);
        } else if (offset === end) {
          out.push(node, wrap(properties, containerDepth));
        } else {
          const [head, tail] = splitRun(mint, offsets, node, offset - start);
          out.push(head, wrap(properties, containerDepth), tail);
        }
        placed = true;
        cursor.offset = end;
        continue;
      }

      cursor.offset = end;
      out.push(node);
    }
    return out;
  };

  const rebuilt = rebuild(paragraph.children, []);
  const lifted = wrappers.size
    ? liftedOutOfForeignInsertions(rebuilt, wrappers, revision.author, mint)
    : rebuilt;
  if (!lifted) return { ok: false, reason: 'unsupported-revision:foreign-insertion' };
  let children = mergedRevisions(mint, lifted);
  if (!placed) {
    // An empty paragraph, or an offset at the very end with no run to hang it on.
    if (offset !== cursor.offset) {
      return { ok: false, reason: 'offset-out-of-range', detail: 'offset past the paragraph' };
    }
    children = [...children, wrap(fieldDestination ? fieldProperties() : [], 0)];
  }
  if (exceedsDepth) return { ok: false, reason: 'invalid-range' };
  return fromEdit(replaceChildren(part, paragraph.id, children, options), effect);
}

/** Split a run at a local offset, keeping its `w:rPr` on both halves. */
export function splitRun(
  mint: () => string,
  offsets: ParagraphOffsetIndex,
  run: OoxmlNode,
  local: number
): [OoxmlNode, OoxmlNode] {
  const properties = childrenOf(run).filter(isRunProperties);
  const head: OoxmlNode[] = [];
  const tail: OoxmlNode[] = [];
  let seen = 0;
  for (const child of childrenOf(run)) {
    if (isRunProperties(child)) continue;
    const length = offsets.lengthOf(child);
    if (seen + length <= local) head.push(child);
    else if (seen >= local) tail.push(child);
    else if (child.kind === 'text' || child.kind === 'deletedText') {
      const value = childrenOf(child).find((grand) => grand.kind === 'textValue');
      const raw = value && value.kind === 'textValue' ? value.value : '';
      const at = local - seen;
      head.push(textNode(mint, raw.slice(0, at), child.kind === 'deletedText'));
      tail.push(textNode(mint, raw.slice(at), child.kind === 'deletedText'));
    } else tail.push(child);
    seen += length;
  }
  return [
    runOf(mint, [...properties.map((child) => copy(mint, child)), ...head]),
    runOf(mint, [...properties.map((child) => copy(mint, child)), ...tail]),
  ];
}

/** Put new content into an existing run at a local offset — the extend-my-own-insertion path. */
function splitRunAndInsert(
  mint: () => string,
  offsets: ParagraphOffsetIndex,
  run: OoxmlNode,
  local: number,
  payload: TrackedInsertionPayload
): OoxmlNode[] {
  const [head, tail] = splitRun(mint, offsets, run, local);
  if (payload.nodes) {
    const content = [
      ...childrenOf(head).filter((child) => !isRunProperties(child)),
      ...payload.nodes(mint),
      ...childrenOf(tail).filter((child) => !isRunProperties(child)),
    ];
    const properties = childrenOf(run)
      .filter(isRunProperties)
      .map((child) => copy(mint, child));
    return [runOf(mint, [...properties, ...coalesced(mint, content)])];
  }
  // A whole-run payload keeps its OWN `w:rPr`, so it goes between the halves as a sibling
  // run inside the same wrapper — spliced into the host run, the citation would take on
  // whatever formatting the caret sits in and lose its reference style.
  return [
    ...(contentOf(head).length > 0 ? [head] : []),
    ...payload.runs!(mint),
    ...(contentOf(tail).length > 0 ? [tail] : []),
  ];
}

/**
 * Merge adjacent text nodes of the same kind.
 *
 * Splitting a run and putting the new characters back leaves `<w:t>ab</w:t><w:t>c</w:t>` —
 * valid, and read identically by anything that concatenates, but it accumulates one element
 * per keystroke and is not what Word writes.
 */
export function coalesced(mint: () => string, nodes: readonly OoxmlNode[]): OoxmlNode[] {
  const out: OoxmlNode[] = [];
  for (const node of nodes) {
    const previous = out[out.length - 1];
    const mergeable =
      previous !== undefined &&
      previous.kind === node.kind &&
      (node.kind === 'text' || node.kind === 'deletedText');
    if (!mergeable) {
      out.push(node);
      continue;
    }
    const left = childrenOf(previous).find((child) => child.kind === 'textValue');
    const right = childrenOf(node).find((child) => child.kind === 'textValue');
    const value =
      (left && left.kind === 'textValue' ? left.value : '') +
      (right && right.kind === 'textValue' ? right.value : '');
    out[out.length - 1] = textNode(mint, value, node.kind === 'deletedText');
  }
  return out;
}

/** A node's children, or none for a text value — the union's only childless member. */
export function childrenOf(node: OoxmlNode): readonly OoxmlNode[] {
  return node.kind === 'textValue' ? [] : node.children;
}

/**
 * Fold adjacent revision wrappers that are the same revision into one.
 *
 * Striking a character at a time leaves `<w:del id=0/><w:del id=0/><w:del id=0/>` — one
 * decision by every reader that groups on the id, but three elements where Word writes one,
 * and three more on the next keystroke. Same id, same author, same date, side by side: one
 * wrapper holding all their runs.
 */
export function mergedRevisions(mint: () => string, nodes: readonly OoxmlNode[]): OoxmlNode[] {
  const out: OoxmlNode[] = [];
  for (const node of nodes) {
    const previous = out[out.length - 1];
    if (
      previous !== undefined &&
      previous.kind !== 'textValue' &&
      node.kind !== 'textValue' &&
      previous.kind === node.kind &&
      (node.kind === 'revisionInsert' || node.kind === 'revisionDelete') &&
      sameRevision(previous, node)
    ) {
      out[out.length - 1] = {
        ...previous,
        children: mergedRevisionRuns(mint, previous.children, node.children),
      } as OoxmlNode;
      continue;
    }
    out.push(node);
  }
  return out;
}

/** Merge the boundary runs when repeated deletion split one formatted run per keypress. */
function mergedRevisionRuns(
  mint: () => string,
  left: readonly OoxmlNode[],
  right: readonly OoxmlNode[]
): OoxmlNode[] {
  const previous = left[left.length - 1];
  const next = right[0];
  if (
    previous?.kind !== 'run' ||
    next?.kind !== 'run' ||
    !mergeableTextRun(previous) ||
    !mergeableTextRun(next)
  ) {
    return [...left, ...right];
  }
  const previousProperties = previous.children.filter(isRunProperties);
  const nextProperties = next.children.filter(isRunProperties);
  if (!equivalentNodes(previousProperties, nextProperties)) return [...left, ...right];
  const content = coalesced(mint, [
    ...previous.children.filter((child) => !isRunProperties(child)),
    ...next.children.filter((child) => !isRunProperties(child)),
  ]);
  const merged = { ...previous, children: [...previousProperties, ...content] } as OoxmlNode;
  return [...left.slice(0, -1), merged, ...right.slice(1)];
}

/** Only plain text runs are safe to collapse; drawings, breaks and generic atoms stay separate. */
function mergeableTextRun(run: OoxmlElement): boolean {
  const content = run.children.filter((child) => !isRunProperties(child));
  return (
    content.length > 0 &&
    content.every((child) => child.kind === 'text' || child.kind === 'deletedText')
  );
}

/** Shared with `tree-op-tracked-marks.ts`, which writes the paragraph-mark wrappers. */
export function isWmlNamed(node: OoxmlNode, localName: string): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === localName
  );
}
