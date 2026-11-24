// Fragment content signatures for incremental layout convergence.
//
// Extracted from semantic-layout so the flow module stays under the line budget while every
// published field still participates in equality.

import type {
  BlockFragmentRecord,
  ParagraphFragmentRecord,
  TableFragmentRecord,
} from './semantic-records.ts';
import { isOutOfFlowTableFragment } from './table-float-position.ts';

/**
 * What one field of a fragment record does in the signature.
 *
 * - `hashed` — the field is serialized. Every PUBLISHED field belongs here. A published
 *   field left out converges a freshly built fragment against a stale one and discards the
 *   new value, so the consumer keeps reading the pre-edit state.
 * - `covered` — another hashed field ALREADY moves whenever this one moves, so hashing it
 *   again buys nothing. Only a field with that proof gets this role.
 *
 * The maps below are `satisfies Record<keyof …>`, so a new field on a record is a TYPE ERROR
 * here until somebody classifies it. That guard is the point: `props`, `indent`, `borders`
 * and `lines.drawings` were each added to a record, missed here, and shipped as a stale-read
 * bug that only a hand-written test could catch.
 */
type SignatureRole = 'hashed' | 'covered';

/**
 * Every field of a paragraph fragment, classified.
 *
 * Order is the record's own declaration order, and it is also the order the values are
 * serialized in, so a diff of this map is a diff of the signature.
 */
const PARAGRAPH_FIELDS = {
  // The branch this record takes below already separates it from a table fragment.
  kind: 'covered',
  id: 'hashed',
  // `id` is `${paragraphId}#f${fragmentIndex}`, so both are already in it.
  paragraphId: 'covered',
  fragmentIndex: 'covered',
  clipToBox: 'hashed',
  outOfFlow: 'hashed',
  positionedFrame: 'hashed',
  range: 'hashed',
  // A paragraph-property change that layout does not read moves no geometry. Without this
  // the freshly built fragment converged against the old one and was discarded, leaving a
  // painter or style consumer reading the pre-edit value.
  props: 'hashed',
  styleId: 'hashed',
  outlineLevel: 'hashed',
  alignment: 'hashed',
  spacing: 'hashed',
  // The EFFECTIVE indent, for the same reason `props` is here. A list paragraph's indent
  // comes from `numbering.xml`, so a renumber that moves the text but no other hashed field
  // would converge against the stale fragment and leave the ruler reading the pre-edit value.
  indent: 'hashed',
  bottomBorder: 'hashed',
  // Every `w:pBdr` stroke, not just the bottom one. A left rule's colour or width moves
  // nothing else that is hashed here — `props` carries `pBdr` without its children — so
  // leaving it out kept the old frame drawn.
  borders: 'hashed',
  shading: 'hashed',
  shadingBox: 'hashed',
  // The revisions on the paragraph MARK. Accepting or rejecting a tracked pilcrow rewrites
  // `w:pPr/w:rPr/w:ins|w:del` and moves no geometry at all, so nothing else here moves with
  // them: paint kept drawing the attribution of a decision the document no longer records.
  paragraphEnd: 'hashed',
  emptyParagraphStyle: 'hashed',
  paragraphMarkSizePt: 'hashed',
  markRevisions: 'hashed',
  // Derived from `markRevisions` at publish time by one shared function, so it cannot move
  // without the list moving first.
  markRevision: 'covered',
  // Its own field, not covered by the list: a mark can carry a format change and no decision.
  markFormatRevision: 'hashed',
  markChangeSites: 'hashed',
  marker: 'hashed',
  // The resolved stops move where text lands on the line, so a fragment whose stops changed
  // is not the fragment it was even when every line box happens to match.
  tabStops: 'hashed',
  // WHOLESALE, not a projection of the fields a line happens to publish today. A line owns
  // `contentX` (the only alignment carrier on a span-less line), `leading`, `trailingSpacing`,
  // `deletedRanges` and `drawings`, and each of those was reachable only by adding it here by
  // hand. Serializing the record itself is what makes the next line field participate on the
  // day it is published rather than on the day someone notices.
  //
  // The price is that a line's own KEY ORDER reaches the string, and the two sites that build
  // one order their optional keys differently (semantic-layout.ts and semantic-table-layout.ts
  // disagree about where `drawings` sits). That costs nothing: comparison is positional, and a
  // body line is only ever compared against the body line at the same index, a cell line
  // against a cell line inside `rows`. A line cannot change its construction site without
  // changing the node id in `fragment.id`. Order can only cost a reuse, never restore a stale
  // value, which is the direction this whole comparison is allowed to fail in.
  lines: 'hashed',
  box: 'hashed',
} as const satisfies Record<keyof ParagraphFragmentRecord, SignatureRole>;

/**
 * Every field of a table fragment, classified.
 *
 * `rows` carries the cells, and a cell carries the paragraph fragments inside it, all
 * wholesale. That is why a table cell never had the omissions the paragraph branch did.
 */
const TABLE_FIELDS = {
  kind: 'covered',
  floatingWrap: 'hashed',
  id: 'hashed',
  tableId: 'hashed',
  fragmentIndex: 'hashed',
  nestingDepth: 'hashed',
  columnEdges: 'hashed',
  rows: 'hashed',
  box: 'hashed',
} as const satisfies Record<keyof TableFragmentRecord, SignatureRole>;

function hashedKeys<Fragment extends object>(
  fields: Record<keyof Fragment, SignatureRole>
): readonly (keyof Fragment)[] {
  return (Object.keys(fields) as (keyof Fragment)[]).filter((key) => fields[key] === 'hashed');
}

const PARAGRAPH_KEYS = hashedKeys<ParagraphFragmentRecord>(PARAGRAPH_FIELDS);
const TABLE_KEYS = hashedKeys<TableFragmentRecord>(TABLE_FIELDS);

/** Cached per record, so a fragment is serialized once however often convergence is tested. */
const signatures = new WeakMap<object, string>();

export function fragmentSignature(fragment: BlockFragmentRecord): string {
  const cached = signatures.get(fragment);
  if (cached !== undefined) return cached;
  // An absent optional field serializes as `null` in place rather than vanishing, so the
  // values stay positionally aligned with the key list that produced them.
  const signature =
    fragment.kind === 'table'
      ? JSON.stringify([
          isOutOfFlowTableFragment(fragment),
          ...TABLE_KEYS.map((key) => fragment[key]),
        ])
      : JSON.stringify(PARAGRAPH_KEYS.map((key) => fragment[key]));
  signatures.set(fragment, signature);
  return signature;
}

/**
 * Are two pending-fragment lists the same CONTENT?
 *
 * Identity is not enough: a resume rebuilds the open page's fragments, so the arrays differ
 * even when every record matches. Comparing signatures is what lets convergence fire.
 */
export function sameFragments(
  left: readonly BlockFragmentRecord[],
  right: readonly BlockFragmentRecord[]
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    if (a === b || sameHashedFields(a, b)) continue;
    if (fragmentSignature(a) !== fragmentSignature(b)) return false;
  }
  return true;
}

/**
 * True only when both records would serialize to the same signature, decided without
 * serializing: the same hashed fields, each holding the same keys in the same order and the
 * same primitive values. Shared sub-records (styles, spans a paragraph cache handed out again)
 * answer by identity at once. False means "not proved" and the signatures decide, so this can
 * never call two different records equal. Rebuilding the JSON of every line and span of a
 * freshly placed fragment was most of the cost of a convergence test on a long document.
 */
function sameHashedFields(a: BlockFragmentRecord, b: BlockFragmentRecord): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'table') {
    if (isOutOfFlowTableFragment(a) !== isOutOfFlowTableFragment(b)) return false;
    return TABLE_KEYS.every((key) => sameJson(a[key], (b as TableFragmentRecord)[key]));
  }
  return PARAGRAPH_KEYS.every((key) => sameJson(a[key], (b as ParagraphFragmentRecord)[key]));
}

/** `JSON.stringify(a) === JSON.stringify(b)` for plain data, proved without building either. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (!sameJson(a[index], b[index])) return false;
    }
    return true;
  }
  if (Array.isArray(b) || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  const otherKeys = Object.keys(right);
  if (keys.length !== otherKeys.length) return false;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (key !== otherKeys[index] || !sameJson(left[key], right[key])) return false;
  }
  return true;
}

/**
 * Pending anchored drawings on the open page — reference identity for incremental reuse.
 *
 * Identity is the STRICT side of the trade the fragments make: a rebuilt record compares
 * unequal even when its content matches, so this can cost a convergence but can never
 * restore a stale one.
 */
export function sameAnchoredDrawings(
  left: readonly import('./drawing-layout.ts').AnchoredDrawingRecord[],
  right: readonly import('./drawing-layout.ts').AnchoredDrawingRecord[]
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) continue;
    return false;
  }
  return true;
}

/**
 * Shared empties, so a checkpoint per block costs one reference in a document with none.
 *
 * Module-internal on purpose. A `Map` cannot be frozen the way the array is, so the only thing
 * keeping this one empty is that nothing outside this file can reach it to write to it.
 */
export const NO_DEFERRED_DRAWINGS: readonly import('./drawing-layout.ts').AnchoredDrawingRecord[] =
  Object.freeze([]);
export const NO_DEFER_COUNTS: ReadonlyMap<string, number> = new Map();

/** Are two anchor-deferral tallies the same? Order is irrelevant; the counts are not. */
export function sameDeferCounts(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>
): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [nodeId, count] of left) {
    if (right.get(nodeId) !== count) return false;
  }
  return true;
}
