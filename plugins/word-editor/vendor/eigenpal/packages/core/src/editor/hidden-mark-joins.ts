// Joining two paragraphs the reader sees as neighbours when the tree holds, between them,
// paragraphs a hidden mark removed from the flow (see `layout/hidden-paragraph-mark.ts`).
//
// Those paragraphs show nothing, so Backspace or Delete at the visible break means "join the
// two paragraphs on either side". A `joinParagraphs` of just those two is refused
// (`not-adjacent-siblings`), because joins need true child-index adjacency. The join instead
// absorbs each removed paragraph into the first paragraph on the way. The first paragraph
// keeps its properties, and whatever a removed paragraph holds (hidden runs, tracked content
// this view does not show) moves with it unchanged, so nothing the reader can see changes
// except the break they deleted.
//
// Which paragraphs count as removed is LAYOUT'S answer for the view being edited, not a
// separate rule: a paragraph whose only content is a tracked deletion is removed in the
// proposed view and shown in all-markup, and editing has to agree with the page either way.
//
// The caret can still come to rest in such a paragraph: Enter at the end of a paragraph whose
// mark is hidden makes an empty one, and deleting the last character of one empties it. A
// break the reader cannot see is not a place they can see either, so a caret there SHOWS at
// the start of the paragraph that takes the join, and the arrow keys move from there. Typing
// still lands in the paragraph itself, which then shows again, and so do the other lanes that
// insert at the caret. Paragraph and character formatting, and the toolbar state that reports
// it, read the paragraph where the caret shows. Backspace and Delete act on
// that paragraph first: both join it into the paragraph before it, which is the exact reverse
// of the Enter that made it, and only then act from the shown position.

import {
  parentNodeOf,
  type OoxmlNode,
  type OoxmlPart,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import type {
  SemanticLayout,
  SemanticPosition,
  SemanticSelection,
} from '@docx-editor.dev/core/layout';
import { numberingFlowBlocks } from '../layout/hidden-paragraph-mark.ts';
import { paragraphTextOf } from '../store/store/tree-ops.ts';
import { paragraphLinesFor } from '../layout/paragraph-lines.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from '../layout/revision-projection.ts';
import { mergedFlowBlocks } from '../layout/story-roots.ts';

/** The revision view the page is laid out in. */
export interface RevisionView {
  readonly displayMode: RevisionDisplayMode;
  readonly authorFilter: RevisionAuthorFilter | undefined;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * Ids of the paragraphs among `children` that layout removes under a hidden mark in `view`.
 *
 * Asks the same collector layout uses for that container, so the two cannot disagree.
 */
export function hiddenMarkRemovedIds(
  children: readonly OoxmlNode[],
  view: RevisionView
): ReadonlySet<string> {
  const flow = mergedFlowBlocks(children, view.displayMode, view.authorFilter);
  const all = numberingFlowBlocks(flow);
  if (all === flow) return NONE;
  const laidOut = new Set(flow.map((block) => block.id));
  return new Set(all.flatMap((block) => (laidOut.has(block.id) ? [] : [block.id])));
}

/**
 * The laid-out paragraph that takes the join of a removed paragraph, read from layout's own
 * block list for the container: the next block after it that layout keeps. Markers between
 * blocks (a body-level `w:bookmarkEnd`) are not blocks at all, and a paragraph a revision view
 * removes is not kept, so neither can stand in for it. Null when the paragraph is not removed.
 */
function joinTargetOf(
  children: readonly OoxmlNode[],
  paragraphId: string,
  view: RevisionView
): string | null {
  const flow = mergedFlowBlocks(children, view.displayMode, view.authorFilter);
  const all = numberingFlowBlocks(flow);
  if (all === flow) return null;
  const laidOut = new Set(flow.map((block) => block.id));
  if (laidOut.has(paragraphId)) return null;
  const index = all.findIndex((block) => block.id === paragraphId);
  if (index === -1) return null;
  const next = all.slice(index + 1).find((block) => laidOut.has(block.id));
  return next?.kind === 'paragraph' ? next.id : null;
}

/**
 * Ids of the siblings strictly between two paragraphs, in order: `[]` when the two are
 * adjacent, `null` when they are not in that order. `removed` is asked only when there is
 * something between; the answer is `null` unless every sibling between is removed.
 */
export function hiddenParagraphsBetween(
  siblings: readonly OoxmlNode[],
  firstId: string,
  secondId: string,
  removed: () => ReadonlySet<string>
): string[] | null {
  const indexOf = (id: string): number =>
    siblings.findIndex((child) => child.kind !== 'textValue' && child.id === id);
  const first = indexOf(firstId);
  const second = indexOf(secondId);
  if (first === -1 || second <= first) return null;
  const between: string[] = [];
  for (let index = first + 1; index < second; index += 1) {
    const child = siblings[index]!;
    if (child.kind === 'textValue') return null;
    between.push(child.id);
  }
  if (between.length === 0) return between;
  const ids = removed();
  return between.every((id) => ids.has(id)) ? between : null;
}

/**
 * The ops that join `secondId` onto `firstId`, absorbing any removed paragraphs between them
 * first, or `null` when the two are not siblings that such a join can reach.
 */
export function joinAcrossHiddenMarks(
  part: OoxmlPart,
  firstId: string,
  secondId: string,
  view: RevisionView
): TreeDocOp[] | null {
  const parent = parentNodeOf(part, firstId);
  if (parent === null || parentNodeOf(part, secondId)?.id !== parent.id) return null;
  const between = hiddenParagraphsBetween(parent.children, firstId, secondId, () =>
    hiddenMarkRemovedIds(parent.children, view)
  );
  if (between === null) return null;
  return [...between, secondId].map((id) => ({ op: 'joinParagraphs', firstId, secondId: id }));
}

/**
 * Where a position shows on the page.
 *
 * A position in a paragraph that layout removed shows at the start of the laid-out paragraph
 * that takes its join. Any other position, and one whose container holds nothing laid out
 * after it, shows where it is.
 */
export function shownPosition(
  layout: SemanticLayout,
  part: OoxmlPart,
  position: SemanticPosition,
  view: RevisionView
): SemanticPosition {
  if (paragraphLinesFor(layout, position.paragraphId).length > 0) return position;
  const parent = parentNodeOf(part, position.paragraphId);
  if (parent === null) return position;
  const target = joinTargetOf(parent.children, position.paragraphId, view);
  return target === null ? position : { paragraphId: target, offset: 0 };
}

/**
 * Backspace or Delete from a caret in a paragraph layout removed: join that paragraph into the
 * sibling paragraph before it. Backspace leaves the caret at the end of that sibling; Delete
 * leaves it where it showed, so nothing visible moves.
 *
 * Null when the caret's paragraph is laid out, or when no paragraph directly precedes it in
 * its container; the keys then act from the shown position. A body-level marker such as
 * `w:bookmarkStart` directly before it counts as no paragraph: a join needs adjacent siblings,
 * and the store refuses one across a marker.
 */
export function removedCaretParagraphEdit(
  layout: SemanticLayout,
  part: OoxmlPart,
  position: SemanticPosition,
  view: RevisionView,
  direction: 'backward' | 'forward'
): { readonly ops: TreeDocOp[]; readonly caret: SemanticPosition } | null {
  if (paragraphLinesFor(layout, position.paragraphId).length > 0) return null;
  const parent = parentNodeOf(part, position.paragraphId);
  if (parent === null) return null;
  if (!hiddenMarkRemovedIds(parent.children, view).has(position.paragraphId)) return null;
  const siblings = parent.children;
  const index = siblings.findIndex(
    (child) => child.kind !== 'textValue' && child.id === position.paragraphId
  );
  let previous: OoxmlNode | undefined;
  for (let at = index - 1; at >= 0 && previous === undefined; at -= 1) {
    if (siblings[at]!.kind !== 'textValue') previous = siblings[at];
  }
  if (previous === undefined || previous.kind !== 'paragraph') return null;
  const caret =
    direction === 'backward'
      ? { paragraphId: previous.id, offset: (paragraphTextOf(part, previous.id) ?? '').length }
      : shownPosition(layout, part, position, view);
  return {
    ops: [{ op: 'joinParagraphs', firstId: previous.id, secondId: position.paragraphId }],
    caret,
  };
}

/**
 * Delete at the end of a paragraph, when the join to the next laid-out paragraph cannot reach
 * it: absorb the run of removed paragraphs directly after it, and nothing else.
 *
 * Something that is not a removed paragraph (a body-level `w:bookmarkEnd`, a paragraph this
 * view merges away) sits between, and a join across it would be refused. The removed run
 * before it is still adjacent and shows nothing, so absorbing it is the edit Delete made when
 * those paragraphs were laid out as blank lines, with no visible change. Null when no removed
 * paragraph directly follows.
 */
export function absorbRemovedAfter(
  part: OoxmlPart,
  firstId: string,
  view: RevisionView
): TreeDocOp[] | null {
  const parent = parentNodeOf(part, firstId);
  if (parent === null) return null;
  const siblings = parent.children;
  const start = siblings.findIndex((child) => child.kind !== 'textValue' && child.id === firstId);
  if (start === -1) return null;
  let removed: ReadonlySet<string> | null = null;
  const ops: TreeDocOp[] = [];
  for (let index = start + 1; index < siblings.length; index += 1) {
    const child = siblings[index]!;
    if (child.kind === 'textValue') continue;
    removed ??= hiddenMarkRemovedIds(siblings, view);
    if (!removed.has(child.id)) break;
    ops.push({ op: 'joinParagraphs', firstId, secondId: child.id });
  }
  return ops.length > 0 ? ops : null;
}

/** The editing surface's view of the rules above, over its live layout, story, and view. */
export function createHiddenMarkEditing(deps: {
  readonly layout: () => SemanticLayout;
  readonly part: () => OoxmlPart;
  readonly view: () => RevisionView;
}): {
  /** Ops joining two neighbours in paragraph order; see {@link joinAcrossHiddenMarks}. */
  joinOps(firstId: string, secondId: string): TreeDocOp[] | null;
  /** Delete's join: {@link joinOps}, else {@link absorbRemovedAfter}. */
  forwardJoinOps(firstId: string, nextId: string): TreeDocOp[] | null;
  /** See {@link shownPosition}. */
  shown(position: SemanticPosition): SemanticPosition;
  /** A collapsed selection moved to where it shows; a range is left alone. */
  shownSelection(selection: SemanticSelection): SemanticSelection;
  /** The same for an ordered range: moved only when it is collapsed. */
  shownRange(range: { from: SemanticPosition; to: SemanticPosition }): {
    from: SemanticPosition;
    to: SemanticPosition;
  };
  /** See {@link removedCaretParagraphEdit}. */
  removedCaretEdit(
    position: SemanticPosition,
    direction: 'backward' | 'forward'
  ): { readonly ops: TreeDocOp[]; readonly caret: SemanticPosition } | null;
} {
  const shown = (position: SemanticPosition): SemanticPosition =>
    shownPosition(deps.layout(), deps.part(), position, deps.view());
  return {
    joinOps: (firstId, secondId) =>
      joinAcrossHiddenMarks(deps.part(), firstId, secondId, deps.view()),
    forwardJoinOps: (firstId, nextId) =>
      joinAcrossHiddenMarks(deps.part(), firstId, nextId, deps.view()) ??
      absorbRemovedAfter(deps.part(), firstId, deps.view()),
    shown,
    removedCaretEdit: (position, direction) =>
      removedCaretParagraphEdit(deps.layout(), deps.part(), position, deps.view(), direction),
    shownRange: (range) => {
      const { from, to } = range;
      if (from.paragraphId !== to.paragraphId || from.offset !== to.offset) return range;
      const position = shown(from);
      return position === from ? range : { from: position, to: position };
    },
    shownSelection: (selection) => {
      const { anchor, head } = selection;
      if (anchor.paragraphId !== head.paragraphId || anchor.offset !== head.offset) {
        return selection;
      }
      const position = shown(head);
      return position === head ? selection : { ...selection, anchor: position, head: position };
    },
  };
}
