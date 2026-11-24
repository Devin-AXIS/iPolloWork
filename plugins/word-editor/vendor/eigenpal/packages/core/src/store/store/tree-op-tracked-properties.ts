import { REVISION_PROPERTY_CONTAINERS } from './revision-property-records.ts';
// Tracked FORMAT changes — `w:rPrChange` and `w:pPrChange` (tracked-edits seam).
//
// The third kind of tracked edit, beside content wrappers (`tree-op-tracked.ts`) and
// paragraph marks (`tree-op-tracked-marks.ts`). Content revisions keep the CHARACTERS and say
// who added or struck them; this one keeps the characters exactly as they were and says what
// their PROPERTIES used to be.
//
// The shape is the same for all three containers: the container keeps its new children, and
// gains one change wrapper holding a copy of the container as it was.
//
//   w:rPr        → w:rPrChange/w:rPr   (CT_RPrChange over CT_RPrOriginal,      §17.13.5.30)
//   w:pPr/w:rPr  → w:rPrChange/w:rPr   (CT_ParaRPrChange over CT_ParaRPrOriginal, §17.13.5.31)
//   w:pPr        → w:pPrChange/w:pPr   (CT_PPrChange over CT_PPrBase,           §17.13.5.29)
//
// TWO RULES DO ALL THE WORK.
//
// THE RECORD IS THE ORIGINAL, NOT THE PREVIOUS STATE. Only one change wrapper may sit in a
// container, so a second format press over an already-pending change cannot record a second
// step. It keeps the record that is already there — the state Reject has to restore — and
// only re-attributes it. Recording the intermediate state instead would make Reject restore
// a document nobody ever saw.
//
// A WRITE THAT ARRIVES BACK AT THE ORIGINAL LEAVES NO RECORD. Setting a colour and then
// setting it back is not two proposals, and a card offering to revert a change that no longer
// exists is worse than no card: accepting and rejecting it both produce the same document, so
// the reviewer cannot tell what they decided. Same rule `retractsOwnParagraphMark` applies to
// a break the author took back.
//
// "The original" means the PROPERTY SET, compared as elements, and that is the whole of what
// this module can know. A TOGGLE pressed twice does not reach it: toggling off writes an
// explicit `<w:b w:val="0"/>` rather than dropping `w:b`, because the property may come from a
// style and dropping the override would let it back (see `toggleRunProperty`). Whether that
// explicit off is a real change is a question about the CASCADE, and the store lane has none
// by design — reading one here would be the same mistake as merging a write against a cascaded
// bag. So Bold on then Bold off records a change, exactly as it writes one.
//
// `resolveRevisions` already resolves both wrappers — accept drops the record, reject
// restores what it holds. This module is the missing WRITE half.

import { WML_NAMESPACE_URI, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import { parentNodeOf } from '../package/ooxml-edit.ts';
import { equivalentNodes } from './ooxml-node-equality.ts';
import { attributeValueOf, cloneWithNewIds, isParagraphMarkRevision } from './tree-op-nodes.ts';
import { build, isWmlNamed, revisionAttributes } from './tree-op-tracked.ts';
import type { RevisionAttributionInput } from './tree-op-validate.ts';

/**
 * Which container is being recorded.
 *
 * `runProperties` covers a run's own `w:rPr` and the paragraph MARK's alike: both write a
 * `w:rPrChange`, and the only difference — `CT_ParaRPrOriginal` also admits the mark's own
 * `w:ins`/`w:del` — is a widening, so one code path covers both.
 */
export type PropertyChangeContainer = 'runProperties' | 'paragraphProperties';

/**
 * The change wrapper each property op writes, and — by omission — which ops write none.
 *
 * ONE table, because two rules read it and they must stay in step: the surface decides which
 * ops `w:doNotTrackFormatting` silences, and a transaction shares one `@w:id` per wrapper name
 * so one press is one card. Spelled twice, the two lists drifted apart the moment a fourth
 * property op appeared.
 */
export const PROPERTY_CHANGE_WRAPPER_OF_OP: ReadonlyMap<string, 'rPrChange' | 'pPrChange'> =
  // A MAP, not an object literal: the key is an op name off a `TreeDocOp`, which reaches this
  // from untyped JS and before validation. An object literal answers `__proto__`,
  // `constructor` and `toString` through its prototype, so a crafted op name would read as a
  // property op (D14).
  new Map([
    ['setRunProperties', 'rPrChange'],
    ['setParagraphMarkProperties', 'rPrChange'],
    ['setParagraphProperties', 'pPrChange'],
    ['setListLevel', 'pPrChange'],
    ['setListNumbering', 'pPrChange'],
  ]);

/** `w:rPr` records through `w:rPrChange`; `w:pPr` through `w:pPrChange`. */
function changeNameOf(container: PropertyChangeContainer): 'rPrChange' | 'pPrChange' {
  return container === 'runProperties' ? 'rPrChange' : 'pPrChange';
}

/** The element the wrapper holds its copy in. */
function recordNameOf(container: PropertyChangeContainer): 'rPr' | 'pPr' {
  return container === 'runProperties' ? 'rPr' : 'pPr';
}

/**
 * What a container's children reduce to for the RECORD.
 *
 * Three families come out, and each for its own reason.
 *
 * The change wrapper never records itself.
 *
 * `CT_PPrChange` records a `CT_PPrBase`, which by construction cannot hold `w:rPr` or
 * `w:sectPr` — `CT_PPr` is `CT_PPrBase`, then `w:rPr`, then `w:sectPr`, then the change
 * wrapper. So the paragraph mark and the section break are not part of what a paragraph
 * property change records, and putting them in produces a `w:pPr` Word calls unreadable.
 *
 * The MARK REVISIONS come out even though `CT_ParaRPrOriginal` admits them, because a reject
 * restores the container from the record and they are somebody's PENDING DECISION about the
 * paragraph break — a decision that may have been taken after this format change was
 * proposed. Recording them made rejecting a formatting suggestion silently delete an
 * unrelated `w:pPr/w:rPr/w:ins`, taking a break the reviewer had not answered. They are
 * preserved on the container instead, exactly as `w:rPr` and `w:sectPr` are for `w:pPrChange`.
 */
function recordable(
  children: readonly OoxmlNode[],
  container: PropertyChangeContainer
): readonly OoxmlNode[] {
  const changeName = changeNameOf(container);
  return children.filter((child) => {
    if (child.kind === 'textValue') return true;
    if (isWmlNamed(child, changeName)) return false;
    if (container === 'paragraphProperties') {
      return !isWmlNamed(child, 'rPr') && !isWmlNamed(child, 'sectPr');
    }
    return !isParagraphMarkRevision(child);
  });
}

/**
 * Whether two property sets say the same thing, ignoring the order the schema imposes.
 *
 * `mergedPropertyChildren` re-sorts what it rewrites into `xsd:sequence` order, so a
 * container the file authored out of order comes back reordered even when no value moved.
 * Comparing positionally would call that a change and raise a card for a press that did
 * nothing. A reorder alone is not a formatting change.
 */
function sameProperties(left: readonly OoxmlNode[], right: readonly OoxmlNode[]): boolean {
  const byName = (nodes: readonly OoxmlNode[]): readonly OoxmlNode[] =>
    [...nodes].sort((a, b) => {
      const first = a.kind === 'textValue' ? '' : a.localName;
      const second = b.kind === 'textValue' ? '' : b.localName;
      return first < second ? -1 : first > second ? 1 : 0;
    });
  return equivalentNodes(byName(left), byName(right));
}

/**
 * The copy a change wrapper holds, or null when it holds none.
 *
 * `w:rPrChange` holds a `w:rPr`, `w:pPrChange` a `w:pPr`; the wrapper's own name says which,
 * so this answers for either. Both the write side (what the ORIGINAL was) and the resolve side
 * (what a reject restores) read it — two copies of this lookup drifted on how the caller
 * narrows the result, which is the whole reason the record is fiddly.
 */
export function recordedProperties(wrapper: OoxmlNode): readonly OoxmlNode[] | null {
  if (wrapper.kind === 'textValue') return null;
  const inner = REVISION_PROPERTY_CONTAINERS.get(wrapper.localName);
  if (!inner) return null;
  const snapshots = wrapper.children.filter((child) => isWmlNamed(child, inner));
  if (snapshots.length === 1 && snapshots[0]!.kind !== 'textValue') {
    return snapshots[0]!.children;
  }
  return wrapper.localName === 'sectPrChange' && wrapper.children.length === 0 ? [] : null;
}

/**
 * A container's rewritten children with the tracked format record folded in.
 *
 * `prior` is what the container held before the write and `next` is the merge's result — the
 * caller's own `mergedPropertyChildren` output, change wrapper and all, because the merge
 * keeps every child its vocabulary cannot name.
 *
 * When the write lands back on the recorded original there is nothing left to revert, so no
 * wrapper is added — and one this author put there is DROPPED. Another author's is not:
 * dropping it would resolve their pending decision from a formatting press, silently, with
 * nothing recorded and nothing for the review pane to show. A silently-dropped decision is
 * worse than a standing one, because only the standing one can be reconciled.
 */
export function withPropertyChangeRecord(options: {
  readonly container: PropertyChangeContainer;
  readonly prior: readonly OoxmlNode[];
  readonly next: readonly OoxmlNode[];
  readonly revision: RevisionAttributionInput;
  readonly mint: () => string;
  readonly nextRevisionId: () => string;
}): readonly OoxmlNode[] {
  const { container, prior, next, revision, mint, nextRevisionId } = options;
  const changeName = changeNameOf(container);
  const existing = prior.find((child) => isWmlNamed(child, changeName));
  // The ORIGINAL: whatever a pending record already holds, else the state this write is
  // replacing. Never the intermediate state — see the module header.
  //
  // Narrowed the SAME way either source is, because the comparison below has the narrowed
  // container on its other side. `CT_ParaRPrOriginal` admits `EG_ParaRPrTrackChanges`, so a
  // record another producer wrote legitimately carries a `w:ins` — and taking that one raw
  // made the two sides unequal for good: a write landing exactly on the recorded original
  // re-attributed somebody else's proposal instead of dropping it, and copied their `w:ins`
  // in beside the live one, two revisions sharing an `@w:id`.
  const recorded = recordable((existing ? recordedProperties(existing) : null) ?? prior, container);
  const body = next.filter((child) => !isWmlNamed(child, changeName));
  if (sameProperties(recordable(body, container), recorded)) {
    // Back at the original. This author's own record goes; anyone else's stays exactly as
    // they wrote it — see the doc comment.
    return existing !== undefined && !ownedBy(existing, revision.author)
      ? [...body, existing]
      : body;
  }

  const copy = recorded.map((child) => cloneWithNewIds(child, mint));
  // The record's inner container carries the TYPED kind, because that is what re-reading the
  // emitted XML produces (`w:rPr` is `runProperties` wherever it sits) and a save/reopen
  // digest compares the two trees.
  const record = build(mint(), container, recordNameOf(container), [], copy);
  const wrapper = build(
    mint(),
    'generic',
    changeName,
    // The TRANSACTION's id, so one press is one card however many runs it covers — and a
    // fresh one relative to any record already standing, because that proposal is being
    // replaced by this one and sharing its id would join two authors' cards.
    revisionAttributes(nextRevisionId(), revision),
    [record]
  );
  // BOTH change wrappers are the last member of their container's sequence — `CT_RPr` ends
  // with `w:rPrChange`, `CT_PPr` with `w:pPrChange` — so the tail is the only legal slot.
  return [...body, wrapper];
}

/** Whether a `CT_TrackChange` element names this author. An absent `@w:author` is nobody's. */
function ownedBy(node: OoxmlNode, author: string): boolean {
  return attributeValueOf(node, 'author', WML_NAMESPACE_URI) === author;
}

/**
 * Whether this node sits inside a tracked INSERTION this author owns.
 *
 * A run inside the author's own `w:ins` needs no format record: the whole run is already a
 * proposal of theirs, so rejecting the insertion takes the words and the formatting together
 * and there is nothing a separate card could offer. A run inside SOMEBODY ELSE's `w:ins` is
 * the opposite case and is exactly why this lane exists — before it, a suggester's Bold press
 * silently rewrote another author's pending insertion with nothing to accept or reject.
 *
 * A `w:moveTo` is NOT the same case even for the same author: the words were not added, they
 * were moved, and rejecting the move restores the `w:moveFrom` half as it was. A format
 * applied to the moved-in text is a separate decision and gets its own record.
 *
 * The NEAREST enclosing insertion wins: a foreign `w:ins` inside this author's own is text
 * they did not write, and the record belongs on it.
 */
export function insideOwnInsertion(part: OoxmlPart, nodeId: string, author: string): boolean {
  let ancestor = parentNodeOf(part, nodeId);
  while (ancestor !== null) {
    if (ancestor.kind === 'revisionInsert') return ownedBy(ancestor, author);
    const table = insertedTablePart(ancestor, author);
    if (table !== null) return table;
    ancestor = parentNodeOf(part, ancestor.id);
  }
  return false;
}

/**
 * For a row or cell proposed as an insertion (`w:trPr/w:ins`, `w:tcPr/w:cellIns`), whether
 * this author proposed it; null for anything else. Rejecting the author's own removes
 * everything inside, formatting included, so nothing inside needs a format record, the same as
 * a run in their `w:ins`. Someone else's is the nearest owner, and the record belongs on it.
 */
function insertedTablePart(node: OoxmlNode, author: string): boolean | null {
  if (node.kind === 'textValue') return null;
  const container = node.kind === 'tableRow' ? 'trPr' : node.kind === 'tableCell' ? 'tcPr' : null;
  if (!container) return null;
  const properties = node.children.find((child) => isWmlNamed(child, container));
  if (!properties || properties.kind === 'textValue') return null;
  const marker = properties.children.find((child) =>
    isWmlNamed(child, container === 'trPr' ? 'ins' : 'cellIns')
  );
  return marker ? ownedBy(marker, author) : null;
}

/**
 * {@link ownProposedMark} for a paragraph, also true inside a row or cell this author
 * proposed inserting: such a paragraph never existed for anyone else either.
 */
export function ownProposedParagraph(
  part: OoxmlPart,
  paragraphId: string,
  markProperties: readonly OoxmlNode[],
  author: string
): boolean {
  // The nearest proposal decides: the mark's own `w:ins`, then the innermost proposed row.
  if (markProperties.some((child) => isWmlNamed(child, 'ins')))
    return ownProposedMark(markProperties, author);
  return insideOwnInsertion(part, paragraphId, author);
}

/**
 * Whether the paragraph MARK carries a `w:ins` this author proposed.
 *
 * `EG_ParaRPrTrackChanges` sits in `w:pPr/w:rPr`, so the answer is in the mark's own property
 * container. The paragraph-level twin of {@link insideOwnInsertion}, and it decides the same
 * thing for the two writes that address a paragraph rather than a run: rejecting that `w:ins`
 * runs the paragraph into the next one and takes its properties with it, so a record of what
 * they used to be decides nothing. The mark never existed for anyone else.
 */
export function ownProposedMark(markProperties: readonly OoxmlNode[], author: string): boolean {
  for (const child of markProperties) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri !== WML_NAMESPACE_URI || child.localName !== 'ins') continue;
    return ownedBy(child, author);
  }
  return false;
}
