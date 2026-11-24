// WHICH DELETION AN EDIT JOINS, and where that deletion ends.
//
// One question, asked by both tracked text lanes and by the surface: striking text joins the
// strike the caret is already working on rather than minting a card per keystroke, and a
// replacement lands after the words it replaces. Split from `tree-op-tracked.ts`, which owns
// the appliers; the dependency runs one way, and nothing here writes.

import {
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlParagraphNode,
} from '../package/ooxml-tree.ts';
import { paragraphOffsetIndex, type ParagraphOffsetIndex } from './tree-op-segments.ts';

/**
 * Whether an existing revision's timestamp belongs to the edit being made now.
 *
 * Coalescing is for a continuous editing run, so the window is small: two keystrokes a
 * minute apart are still one thought, two edits a month apart are not one revision. Two
 * dateless wrappers join — a file written with date stamping off has nothing else to go on.
 */
export function sameEditingMoment(
  existing: string | undefined,
  current: string | undefined
): boolean {
  if (existing === undefined || current === undefined) return existing === current;
  const from = Date.parse(existing);
  const to = Date.parse(current);
  if (Number.isNaN(from) || Number.isNaN(to)) return existing === current;
  return Math.abs(to - from) <= COALESCE_WINDOW_MS;
}

const COALESCE_WINDOW_MS = 60_000;

/** A deletion wrapper's `@w:id`, or null for anything else. */
export function deletionId(node: OoxmlNode): string | null {
  if (node.kind !== 'revisionDelete') return null;
  return (
    node.attributes.find(
      (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'id'
    )?.value ?? null
  );
}

/** A deletion an edit joins or follows, by its `CT_TrackChange` identity. */
export interface AdjacentDeletion {
  readonly id: string;
  readonly date: string | undefined;
}

/**
 * A revision's identity as one string: `@w:id`, `@w:author`, `@w:date`.
 *
 * The id alone is not an identity. It comes out of the file, `ST_DecimalNumber` constrains
 * nothing, and Word reuses one across an editing burst — so two unrelated wrappers can carry
 * the same number. Everything that remembers a revision across ops keys on this.
 */
export function revisionKey(id: string, author: string, date: string | undefined): string {
  return `${id}\u0000${author}\u0000${date ?? ''}`;
}

/**
 * Where a tracked insertion aimed at `aim` actually lands, in the paragraph's offset space.
 *
 * THE ONE ANSWER, for the applier that places the words and for the surface that has to say
 * where they went before the transaction runs. The two computed it separately once, and
 * disagreed exactly when the strike joined a deletion already standing beside it: the store
 * put the words after the joined chain and the object model answered a span over the struck
 * ones, so a script that formatted what it had just written formatted the strike instead.
 */
export function trackedInsertionLanding(
  paragraph: OoxmlParagraphNode,
  struck: { readonly start: number; readonly end: number },
  aim: number,
  author: string,
  date: string | undefined
): { readonly past: number; readonly landing: number } {
  const offsets = paragraphOffsetIndex(paragraph);
  // PAST A DELETION THE AIM SITS INSIDE, first, and from the paragraph's own tree rather than
  // from painted pages. The store relocates such an aim whatever the reader is looking at, so
  // a story with no layout — an unattached header variant, a note nobody references — was
  // told the words landed where they were aimed while the store put them past the strike.
  // Strictly interior, matching `positionPastDeletion`: an aim ON either edge is a boundary
  // the placement rules below own.
  const past = pastContainingDeletion(paragraph, offsets, aim);
  // THE RANGE THE STRIKE WILL ASK ABOUT, not the point the words land at. `applyDeleteTracked`
  // asks with both edges and joins the FIRST deletion in document order, so a strike touching
  // the range's start wins there. Asking here with the end alone picked the deletion touching
  // the other edge whenever both edges had one, and the words were then written past a strike
  // this edit never joined — folding an unrelated deletion into the replacement's card, and
  // its Accept with it.
  const replaced = adjacentDeletion(paragraph, offsets, struck.start, struck.end, author, date);
  const landing =
    replaced === null
      ? past
      : Math.max(past, replacedEnd(paragraph, offsets, replaced, author, past));
  return { past, landing };
}

/** `offset` mapped past a `w:del`/`w:moveFrom` that strictly contains it, or unchanged. */
function pastContainingDeletion(
  paragraph: OoxmlParagraphNode,
  offsets: ParagraphOffsetIndex,
  offset: number
): number {
  let mapped = offset;
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'revisionDelete' || node.kind === 'revisionMoveFrom') {
      const span = offsets.spanOf(node);
      if (span && mapped > span.start && mapped < span.end) mapped = span.end;
      return;
    }
    for (const child of node.children) visit(child);
  };
  for (const child of paragraph.children) visit(child);
  return mapped;
}

/**
 * Where this deletion's LAST piece ends, in the paragraph's offset space.
 *
 * One deletion is several `w:del` elements whenever the struck stretch crosses something a
 * wrapper cannot contain — a field, a note reference, a bookmark edge, another author's
 * strike — and a replacement aimed at the front of the first belongs after the last. Only the
 * CONTIGUOUS chain reaching the aim counts: a Word redline reuses one `@w:id` across a whole
 * editing burst, so two pieces under one identity can have live words standing between them.
 *
 * Walked only when the relocation is actually going to happen, which is a replacement and not
 * an ordinary keystroke. Membership is the FULL `CT_TrackChange` identity, never `@w:id`
 * alone: the id comes out of the file, nothing makes it unique, and a distant strike by
 * somebody else carrying the same number would drop the typed words past text this edit never
 * touched.
 */
export function replacedEnd(
  paragraph: OoxmlParagraphNode,
  offsets: ParagraphOffsetIndex,
  replaced: AdjacentDeletion,
  author: string,
  aim: number
): number {
  const pieces: { start: number; end: number }[] = [];
  const struck: { start: number; end: number }[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'revisionDelete' || node.kind === 'revisionMoveFrom') {
      const span = offsets.spanOf(node);
      if (span) {
        struck.push(span);
        const read = (localName: string): string | undefined =>
          node.attributes.find(
            (attribute) =>
              attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === localName
          )?.value;
        if (
          node.kind === 'revisionDelete' &&
          deletionId(node) === replaced.id &&
          read('author') === author &&
          sameEditingMoment(read('date'), replaced.date)
        ) {
          pieces.push(span);
        }
      }
      return;
    }
    for (const child of node.children) visit(child);
  };
  for (const child of paragraph.children) visit(child);
  pieces.sort((a, b) => a.start - b.start);
  struck.sort((a, b) => a.start - b.start);

  /** Whether `[from, to)` holds no LIVE text: every offset in it is inside some strike. */
  const allStruck = (from: number, to: number): boolean => {
    let covered = from;
    for (const span of struck) {
      if (span.start > covered) break;
      if (span.end > covered) covered = span.end;
      if (covered >= to) return true;
    }
    return covered >= to;
  };

  let end = -1;
  for (const piece of pieces) {
    if (end < 0) {
      // The chain starts at the piece the aim touches, not at the first piece in the
      // paragraph: an earlier burst under the same id is a different decision.
      if (piece.start <= aim && aim <= piece.end) end = piece.end;
      continue;
    }
    if (piece.start < end) continue;
    // A later piece joins the chain only when nothing LIVE stands between: markup a `w:del`
    // cannot contain measures nothing, and another author's strike is struck text too. Live
    // words between two pieces mean two decisions that happen to share a number, which is
    // ordinary in a Word redline — it reuses one `@w:id` across an editing burst — and
    // carrying the replacement past them dropped it on the wrong side of untouched words.
    if (!allStruck(end, piece.start)) break;
    end = piece.end;
  }
  return end;
}

/**
 * The deletion by this author touching `[start, end)`, or null.
 *
 * Touching, not overlapping: the run being struck now sits beside the one struck a keystroke
 * ago, never inside it. Both edges are checked, because Backspace grows a deletion leftwards
 * and Delete grows it rightwards.
 */
export function adjacentDeletion(
  paragraph: OoxmlParagraphNode,
  offsets: ParagraphOffsetIndex,
  start: number,
  end: number,
  author: string,
  /** Only a wrapper from the same moment joins; see the call sites. */
  within: string | undefined
): AdjacentDeletion | null {
  let found: AdjacentDeletion | null = null;
  const visit = (node: OoxmlNode): void => {
    if (found !== null || node.kind === 'textValue') return;
    if (node.kind === 'revisionDelete') {
      const attributes = node.attributes;
      const whose = attributes.find(
        (attribute) =>
          attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'author'
      );
      const id = attributes.find(
        (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'id'
      );
      // A wrapper the offset walk never reached has no span, so it cannot be adjacent to
      // anything: joining it would put this edit under an id at an unknown position.
      const span = offsets.spanOf(node);
      if (whose?.value === author && id && span) {
        if (span.end === start || span.start === end) {
          const when = attributes.find(
            (attribute) =>
              attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'date'
          );
          if (!sameEditingMoment(when?.value, within)) return;
          found = { id: id.value, date: when?.value };
          return;
        }
      }
    }
    for (const child of node.children) visit(child);
  };
  for (const child of paragraph.children) visit(child);
  return found;
}
