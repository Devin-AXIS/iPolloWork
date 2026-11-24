// Selection geometry and edit-op planning (paginated-surface seam).
//
// This module owns the pure reading of a semantic selection against the published layout —
// document order, clamping, the covered text — and the tree ops a destructive gesture
// produces. No DOM and no session here: the surface closure passes in its current layout,
// selection and part, so every function is a plain input-to-output computation.

import { selectionMarkRects } from '../layout/selection-rects.ts';
import type { TextMeasurer } from '../layout/semantic-records.ts';
import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import { hiddenMarkRemovedIds, type RevisionView } from './hidden-mark-joins.ts';
import { coveredLockedControlOps } from './surface-locked-control-delete.ts';
import { mergedPredecessorsOf } from '../layout/line-segments.ts';
import { fieldResultSpeller } from '../layout/field-copy-text.ts';
import { cellSelectionText, type CellSelection } from '../layout/semantic-cell-selection.ts';
import {
  parentNodeOf,
  type FragmentCoverage,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  documentOrder,
  paragraphTextFromLayout,
  wordBoundary,
  type SemanticLayout,
  type SemanticPosition,
  type SemanticSelection,
} from '@docx-editor.dev/core/layout';

/** What counts as part of a word for a double-click and for the format painter. */
const WORD_CHARACTER = /[\p{L}\p{N}_'’]/u;

const isWordCharacter = (character: string | undefined): boolean =>
  character !== undefined && WORD_CHARACTER.test(character);

/**
 * The WORD one position sits in, as a range.
 *
 * A caret sits BETWEEN characters, so a position at a word's edge is ambiguous. Word resolves
 * it by preferring the character to the right and falling back to the one on the left, which
 * is what stops a double-click at the end of a word from selecting the space after it instead
 * of the word itself.
 *
 * Shared rather than owned by the pointer, because two gestures ask it: a double-click, and
 * the format painter applied at a caret — Word paints the word under a single click there.
 * Two answers to "which word is this" is two gestures that select differently.
 */
export function wordRangeAt(
  layout: SemanticLayout,
  position: SemanticPosition,
  /** Where a struck half meets a live one, so a word stops at the seam. See the caller. */
  stops: ReadonlySet<number>,
  /** The side of `position` the pointer was on, when the caller knows it. */
  side: 'before' | 'after' = 'after',
  /** The text to walk, when the caller bridges what the layout leaves out. */
  text: string = paragraphTextFromLayout(layout, position.paragraphId)
): { readonly from: SemanticPosition; readonly to: SemanticPosition } {
  const id = position.paragraphId;
  const offset = Math.max(0, Math.min(position.offset, text.length));
  let anchor = -1;
  if (side === 'before' && offset > 0 && isWordCharacter(text[offset - 1])) anchor = offset - 1;
  else if (isWordCharacter(text[offset])) anchor = offset;
  else if (offset > 0 && isWordCharacter(text[offset - 1])) anchor = offset - 1;

  if (anchor === -1) {
    // Neither side is a word: take the run of whitespace the pointer is in, or the single
    // character it is on, rather than reaching into a word that was not clicked.
    let from = offset;
    let to = offset;
    while (from > 0 && /\s/.test(text[from - 1] ?? '')) from -= 1;
    while (to < text.length && /\s/.test(text[to] ?? '')) to += 1;
    if (from === to && to < text.length) to += 1;
    return { from: { paragraphId: id, offset: from }, to: { paragraphId: id, offset: to } };
  }
  return {
    from: { paragraphId: id, offset: wordBoundary(text, anchor + 1, -1, stops) },
    to: { paragraphId: id, offset: wordBoundary(text, anchor, 1, stops) },
  };
}

export function collapsedAt(position: SemanticPosition): SemanticSelection {
  return { anchor: position, head: position };
}

/**
 * A selection as a history mark, or null when it spans paragraphs.
 *
 * A mark addresses ONE paragraph, and a cross-paragraph selection has no honest single-id
 * form; recording the head's paragraph would put the caret somewhere the user never had it.
 */
export function selectionMarkOf(
  selection: SemanticSelection
): { paragraphId: string; start: number; end: number } | null {
  if (selection.anchor.paragraphId !== selection.head.paragraphId) return null;
  const start = Math.min(selection.anchor.offset, selection.head.offset);
  const end = Math.max(selection.anchor.offset, selection.head.offset);
  return { paragraphId: selection.head.paragraphId, start, end };
}

/**
 * The selection in DOCUMENT order, whichever way the user dragged it.
 *
 * `order` defaults to the body's document order; a header/footer scope passes its own
 * (scoped) paragraph order so a selection dragged inside furniture orders correctly instead
 * of falling back to indices from a document order it does not belong to.
 */
export function orderedRangeOf(
  layout: SemanticLayout,
  selection: SemanticSelection,
  order?: readonly string[]
): { from: SemanticPosition; to: SemanticPosition } {
  const { anchor, head } = selection;
  if (anchor.paragraphId === head.paragraphId) {
    return anchor.offset <= head.offset ? { from: anchor, to: head } : { from: head, to: anchor };
  }
  const effectiveOrder = order ?? documentOrder(layout);
  return effectiveOrder.indexOf(anchor.paragraphId) <= effectiveOrder.indexOf(head.paragraphId)
    ? { from: anchor, to: head }
    : { from: head, to: anchor };
}

/** A selection guaranteed to address content that exists at the current revision. */
export function clampedToDocument(
  layout: SemanticLayout,
  ids: readonly string[],
  next: SemanticSelection
): SemanticSelection {
  const fallback = ids[0];
  const clampPosition = (position: SemanticPosition): SemanticPosition => {
    const known = ids.includes(position.paragraphId);
    const paragraphId = known ? position.paragraphId : (fallback ?? position.paragraphId);
    // A SUBSTITUTED paragraph does not keep the old one's OFFSET. The offset was counted in a
    // paragraph this one has nothing to do with — a header's, on an undo taken from the body —
    // so carrying it over put the caret some arbitrary way into the first paragraph of the
    // document, for no reason the reader can see. Its start is the honest answer, and it is
    // where a fallback means to put them.
    const offset = known ? position.offset : 0;
    const length = paragraphTextFromLayout(layout, paragraphId).length;
    return { paragraphId, offset: Math.max(0, Math.min(offset, length)) };
  };
  return { anchor: clampPosition(next.anchor), head: clampPosition(next.head) };
}

/** The model text a document-ordered range covers, newline-separated per paragraph. */
export function selectedTextIn(
  layout: SemanticLayout,
  from: SemanticPosition,
  to: SemanticPosition,
  order?: readonly string[],
  atomText?: (paragraphId: string, offset: number) => string | null,
  paragraphText: (layout: SemanticLayout, paragraphId: string) => string = paragraphTextFromLayout,
  /** Whether a paragraph's mark is left out, joining it to the next one (a deleted mark). */
  markLeftOut?: (paragraphId: string) => boolean
): string {
  // An atom paints as U+FFFC in the model text; a caller can spell it for plain text.
  const spell = (paragraphId: string, text: string, start: number): string =>
    atomText === undefined || !text.includes('\uFFFC')
      ? text
      : text.replace(
          /\uFFFC/g,
          (atom, index: number) => atomText(paragraphId, start + index) ?? atom
        );
  if (from.paragraphId === to.paragraphId) {
    return spell(
      from.paragraphId,
      paragraphText(layout, from.paragraphId).slice(from.offset, to.offset),
      from.offset
    );
  }
  const effectiveOrder = order ?? documentOrder(layout);
  const firstIndex = effectiveOrder.indexOf(from.paragraphId);
  const lastIndex = effectiveOrder.indexOf(to.paragraphId);
  if (firstIndex === -1 || lastIndex === -1) return '';
  const ids = effectiveOrder.slice(firstIndex, lastIndex + 1);
  let text = spell(
    from.paragraphId,
    paragraphText(layout, from.paragraphId).slice(from.offset),
    from.offset
  );
  for (let index = 1; index < ids.length; index += 1) {
    const paragraphId = ids[index]!;
    const whole = paragraphText(layout, paragraphId);
    // A break the reader cannot SEE is not one to copy. A resolved display mode draws a run
    // of paragraphs as one, so a newline here pasted two paragraphs out of a line that was
    // drawn as one — and the file the reader is looking at says the break is gone.
    const separator =
      mergedPredecessorsOf(layout, paragraphId).includes(ids[index - 1]!) ||
      markLeftOut?.(ids[index - 1]!)
        ? ''
        : '\n';
    text +=
      separator +
      spell(paragraphId, index === ids.length - 1 ? whole.slice(0, to.offset) : whole, 0);
  }
  return text;
}

/** The plain text of a range. Each computed field reads as its painted result. */
export function rangePlainText(
  layout: SemanticLayout,
  from: SemanticPosition,
  to: SemanticPosition,
  order: readonly string[]
): string {
  const fields = fieldResultSpeller(layout, paragraphTextFromLayout);
  return selectedTextIn(layout, from, to, order, fields.resultAt, fields.markedText);
}

/** The plain text of a cell rectangle, as a grid, with each field as its painted result. */
export function cellsPlainText(layout: SemanticLayout, cells: CellSelection): string {
  return cellSelectionText(
    layout,
    cells,
    fieldResultSpeller(layout, paragraphTextFromLayout).spelledText
  );
}

/**
 * What removing a document-ordered range takes, and where the caret ends up.
 *
 * `collapseTo` is not always the range's start. A table the plan removes takes its cell
 * paragraphs with it, and if the range began in one of those the start no longer exists —
 * so the survivor is promoted and the caller must address THAT position. An op naming a
 * paragraph the same transaction deleted is refused, and one refused op vetoes the whole
 * atomic transaction: a paste over such a selection would silently do nothing at all.
 */
export interface RangeDeletionPlan {
  readonly ops: Parameters<TreeDocxSessionView['applyTreeOps']>[0];
  readonly collapseTo: SemanticPosition;
  /**
   * Where content REPLACING the range belongs, when it differs from `collapseTo`.
   *
   * In suggesting mode a deletion keeps the characters it strikes, so a replacement goes
   * AFTER them — in the last surviving paragraph of the range, past its struck head. Set by
   * the surface's plan wrapper, which owns the editing mode; `planRangeDeletion` itself
   * never sets it. Replacing lanes read `replaceAt ?? collapseTo`.
   */
  readonly replaceAt?: SemanticPosition;
}

type TreeOp = Parameters<TreeDocxSessionView['applyTreeOps']>[0][number];
/** Store unwrap op — typed in the content-control lane; planned here, validated there. */
type RemoveContentControlOp = { readonly op: 'removeContentControl'; readonly controlId: string };
type PlannedOp = TreeOp | RemoveContentControlOp;

/** Every paragraph id inside a subtree, in document order. */
function paragraphIdsUnder(node: OoxmlNode): string[] {
  const ids: string[] = [];
  const walk = (current: OoxmlNode): void => {
    if (current.kind === 'textValue') return;
    if (current.kind === 'paragraph') ids.push(current.id);
    for (const child of current.children) walk(child);
  };
  walk(node);
  return ids;
}

/** Kind string — narrow unions grow; planning must accept typed SDTs as they land. */
function kindOf(node: OoxmlNode): string {
  return node.kind;
}

function isContentControl(node: OoxmlNode): boolean {
  return node.kind !== 'textValue' && kindOf(node) === 'contentControl';
}

function isContentControlContent(node: OoxmlNode): boolean {
  return node.kind !== 'textValue' && kindOf(node) === 'contentControlContent';
}

/**
 * The OUTERMOST tables whose every paragraph is inside `covered`, mapped to the paragraphs
 * they take with them.
 *
 * Outermost because removing a table removes what is nested in it; naming the inner one too
 * would be a second removal of a node that is already gone. A table with no paragraph at all
 * is left alone — there is nothing the range could have covered to justify removing it.
 */
function removableTablesIn(
  part: OoxmlPart,
  covered: ReadonlySet<string>
): Map<string, readonly string[]> {
  const removable = new Map<string, readonly string[]>();
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'table') {
      const paragraphs = paragraphIdsUnder(node);
      if (paragraphs.length > 0 && paragraphs.every((id) => covered.has(id))) {
        removable.set(node.id, paragraphs);
        return;
      }
    }
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return removable;
}

/**
 * Fully covered block content controls that this plan can unwrap.
 *
 * `removeContentControl` keeps the content and drops the wrapper, so a select-all delete does
 * not leave empty SDT shells that then act as join boundaries. Controls nested inside a
 * removable table are skipped — `deleteBlock` on the table already takes them. Nested
 * controls inside a removable control ARE collected: unwrap keeps nested wrappers, so each
 * fully covered shell must be named or it survives as an empty container.
 *
 * Lock state is NOT read here. The store refuses `removeContentControl` on a locked control
 * atomically; duplicating that authority in the planner would drift the moment either side
 * moved. A control the range does not fully cover is simply never planned for removal and
 * remains a join boundary.
 */
function removableContentControlsIn(
  part: OoxmlPart,
  covered: ReadonlySet<string>,
  removableTables: ReadonlyMap<string, readonly string[]>
): Set<string> {
  const removable = new Set<string>();
  const walk = (node: OoxmlNode, underRemovableTable: boolean): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'table' && removableTables.has(node.id)) {
      for (const child of node.children) walk(child, true);
      return;
    }
    if (isContentControl(node)) {
      const paragraphs = paragraphIdsUnder(node);
      if (
        !underRemovableTable &&
        paragraphs.length > 0 &&
        paragraphs.every((id) => covered.has(id))
      ) {
        removable.add(node.id);
      }
      for (const child of node.children) walk(child, underRemovableTable);
      return;
    }
    for (const child of node.children) walk(child, underRemovableTable);
  };
  walk(part.root, false);
  return removable;
}

/**
 * The mark-to-mark coverage decision, shared by the deletion planner and the clipboard
 * fragment extractor so "fully covered" means exactly one thing (rich-clipboard-fidelity
 * task 1.1). Edge paragraphs qualify only when the range reaches their far edge.
 */
function coveredParagraphIdsIn(
  textOf: (paragraphId: string) => string,
  order: readonly string[],
  firstIndex: number,
  lastIndex: number,
  from: SemanticPosition,
  to: SemanticPosition
): Set<string> {
  const covered = new Set<string>();
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const id = order[index]!;
    const wholeParagraph =
      index === firstIndex
        ? from.offset === 0 && (index !== lastIndex || to.offset === textOf(id).length)
        : index === lastIndex
          ? to.offset === textOf(id).length
          : true;
    if (wholeParagraph) covered.add(id);
  }
  return covered;
}

/**
 * Outermost tables and block SDTs whose every LAYOUT-KNOWN paragraph the range covers
 * mark-to-mark.
 *
 * Judged against the layout's paragraph universe (`knownIds`), not the raw part tree: the
 * layout legitimately omits paragraphs the reader cannot select — a TOC's hidden field
 * machinery, the empty paragraph inside a `w:vMerge` continuation cell. Requiring THOSE
 * in `covered` made a select-all read the TOC SDT and every vertically merged table as
 * "partially covered", so the SDT unwrapped and the table flattened to paragraphs. A
 * layout-invisible paragraph rides along with its block's subtree instead.
 */
function fullyCoveredBlocksIn(
  part: OoxmlPart,
  covered: ReadonlySet<string>,
  knownIds: ReadonlySet<string>
): string[] {
  const out: string[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'table' || isContentControl(node)) {
      const paragraphs = paragraphIdsUnder(node);
      const known = paragraphs.filter((id) => knownIds.has(id));
      // At least one selectable paragraph, and all of them covered. A block whose every
      // paragraph is layout-invisible has nothing the gesture could have covered.
      if (known.length > 0 && known.every((id) => covered.has(id))) {
        out.push(node.id);
        return;
      }
    }
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return out;
}

/**
 * The coverage description a clipboard copy hands the store-lane extractor.
 *
 * ONLY DATA crosses the lane boundary: paragraph ids in document order, the edge offsets,
 * the covered set, and the fully-covered block set — the store never imports the layout
 * this reads. Returns null for a collapsed or unresolvable range.
 */
export function fragmentCoverageOf(
  layout: SemanticLayout,
  part: OoxmlPart,
  from: SemanticPosition,
  to: SemanticPosition,
  order?: readonly string[]
): FragmentCoverage | null {
  const textOf = (paragraphId: string): string => paragraphTextFromLayout(layout, paragraphId);
  if (from.paragraphId === to.paragraphId && from.offset === to.offset) return null;
  const effectiveOrder = order ?? documentOrder(layout);
  const firstIndex = effectiveOrder.indexOf(from.paragraphId);
  const lastIndex = effectiveOrder.indexOf(to.paragraphId);
  if (firstIndex === -1 || lastIndex === -1 || firstIndex > lastIndex) return null;

  const paragraphIds = effectiveOrder.slice(firstIndex, lastIndex + 1);
  const covered = coveredParagraphIdsIn(textOf, effectiveOrder, firstIndex, lastIndex, from, to);
  const lastId = effectiveOrder[lastIndex]!;
  return {
    partName: part.name,
    paragraphIds,
    startOffset: from.offset,
    endOffset: to.offset,
    coveredParagraphIds: [...covered],
    fullyCoveredBlockIds: fullyCoveredBlocksIn(part, covered, new Set(effectiveOrder)),
    lastMarkCovered: to.offset === textOf(lastId).length,
  };
}

/**
 * The plan that removes a document-ordered range, or an empty one when it is collapsed.
 *
 * A selection spanning paragraphs is trimmed at both ends and then JOINED back into one,
 * which is what makes selecting three paragraphs and typing behave like every other editor.
 * The order matters: trim first, remove blocks / unwrap controls, join last, so each join
 * sees the text that is meant to survive and the sibling sequence the removals leave behind.
 */
export function planRangeDeletion(
  layout: SemanticLayout,
  part: OoxmlPart,
  from: SemanticPosition,
  to: SemanticPosition,
  order?: readonly string[],
  view: RevisionView = { displayMode: layout.displayMode ?? 'all-markup', authorFilter: undefined },
  /** A tracked deletion: the store strikes a covered content-locked control whole. */
  tracked = false
): RangeDeletionPlan {
  const textOf = (paragraphId: string): string => paragraphTextFromLayout(layout, paragraphId);
  // A whole content-locked control in the range goes as a node, and only the text around it
  // as text: deleting its characters as text edits locked content, which the store refuses.
  const trimmed = (paragraphId: string, start: number, end: number): PlannedOp[] =>
    (tracked
      ? null
      : coveredLockedControlOps(
          layout,
          { paragraphId, offset: start },
          { paragraphId, offset: end }
        )) ?? [{ op: 'deleteText', paragraphId, start, end }];
  if (from.paragraphId === to.paragraphId) {
    if (from.offset === to.offset) return { ops: [], collapseTo: from };
    return { ops: trimmed(from.paragraphId, from.offset, to.offset), collapseTo: from };
  }

  const effectiveOrder = order ?? documentOrder(layout);
  const firstIndex = effectiveOrder.indexOf(from.paragraphId);
  const lastIndex = effectiveOrder.indexOf(to.paragraphId);
  if (firstIndex === -1 || lastIndex === -1) return { ops: [], collapseTo: from };

  // FULLY covered: the range holds the whole paragraph, mark to mark. The endpoints qualify
  // only when the range reaches their far edge — a table is removed for containing text the
  // gesture actually covered, never for being adjacent to it.
  const covered = coveredParagraphIdsIn(textOf, effectiveOrder, firstIndex, lastIndex, from, to);

  // `deleteBlock` has no tracked form, so a tracked range strikes the cell text instead.
  const removableTables = tracked
    ? new Map<string, readonly string[]>()
    : removableTablesIn(part, covered);
  const tableOfParagraph = new Map<string, string>();
  for (const [tableId, paragraphs] of removableTables) {
    for (const id of paragraphs) tableOfParagraph.set(id, tableId);
  }
  const removableControls = removableContentControlsIn(part, covered, removableTables);

  // The SURVIVOR hosts the caret and everything joined into it, so it cannot be a paragraph
  // this plan removes. When the range starts inside a removable table, the first covered
  // paragraph outside every removable table is promoted in its place.
  let survivorIndex = firstIndex;
  if (tableOfParagraph.has(from.paragraphId)) {
    survivorIndex = -1;
    for (let index = firstIndex + 1; index <= lastIndex; index += 1) {
      if (!tableOfParagraph.has(effectiveOrder[index]!)) {
        survivorIndex = index;
        break;
      }
    }
    if (survivorIndex === -1) {
      // Every covered paragraph sits inside one table — a document that IS a table. Nothing
      // outside it could host the caret, so that table stays and is emptied instead. Tables
      // nested inside it go with it, so they stay too rather than being removed piecemeal.
      const kept = tableOfParagraph.get(from.paragraphId)!;
      for (const id of removableTables.get(kept) ?? []) tableOfParagraph.delete(id);
      removableTables.delete(kept);
      // Controls that lived only under the kept table were skipped for removal already; any
      // that were collected independently stay planned — they are not under a removable table.
      survivorIndex = firstIndex;
    }
  }
  const survivorId = effectiveOrder[survivorIndex]!;
  const collapseTo: SemanticPosition =
    survivorIndex === firstIndex ? from : { paragraphId: survivorId, offset: 0 };

  const ops: PlannedOp[] = [];
  // Text first, and only for paragraphs that will still be there — a paragraph inside a
  // removed table needs no trimming, and trimming it would be work the removal undoes.
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const id = effectiveOrder[index]!;
    if (tableOfParagraph.has(id)) continue;
    const length = textOf(id).length;
    const start = index === firstIndex ? from.offset : 0;
    const end = index === lastIndex ? to.offset : length;
    if (start < end) ops.push(...trimmed(id, start, end));
  }
  // Then the blocks the range fully contains. Nothing in the paragraph vocabulary can do
  // this: a body paragraph and a cell paragraph have different parents, so collapsing
  // across a table is not a paragraph edit and the store refuses it. Without a structural
  // removal the text cleared everywhere while every row, cell and border stayed — pages of
  // blank table skeletons, and a paste over the selection that looked like a no-op.
  for (const tableId of removableTables.keys()) ops.push({ op: 'deleteBlock', blockId: tableId });
  // Fully covered content controls unwrap (content kept) so emptied shells do not survive as
  // join boundaries. Lock refusal is the store's job on the atomic transaction.
  for (const controlId of removableControls) {
    ops.push({ op: 'removeContentControl', controlId });
  }

  // Then collapse the emptied paragraphs, WITHIN runs of consecutive sibling `w:p` elements
  // — reading a removed table OR a planned-unwrapped control as transparent, because by the
  // time a join applies those nodes are gone and the paragraphs either side really are
  // adjacent. A control this plan does not unwrap stays a boundary. A join the store still
  // refuses (across a table this plan did not remove, or out of a cell) is not planned at
  // all: it would veto the whole atomic transaction, and the honest reading of that gesture
  // is one empty paragraph left beside each block boundary the range did not fully cover.

  /** Host a paragraph lands under after planned unwraps (removable control shells dissolve). */
  const eventualHost = (paragraphId: string): OoxmlElement | null => {
    let host = parentNodeOf(part, paragraphId);
    while (host && isContentControlContent(host)) {
      const control = parentNodeOf(part, host.id);
      if (!control || !removableControls.has(control.id)) break;
      host = parentNodeOf(part, control.id);
    }
    return host;
  };

  /**
   * Paragraph ids that become direct children of `host` after planned table deletes and
   * control unwraps — the sequence joins actually see.
   *
   * Inert body-level siblings (a misplaced `w:pBdr`, a leftover bookmark marker, …) are
   * recorded as barriers, not skipped. Skipping them made two paragraphs look adjacent here
   * while `joinParagraphs` still requires true child-index adjacency, which vetoed the whole
   * atomic delete (`not-adjacent-siblings`) and left every table standing.
   */
  // Paragraphs a hidden mark removed from the flow in this view, per host: invisible, so a
  // join may absorb them. Layout's own answer, asked only where something lies between.
  const removedUnder = new Map<string, ReadonlySet<string>>();
  const hiddenUnder = (host: OoxmlElement): ReadonlySet<string> => {
    let ids = removedUnder.get(host.id);
    if (!ids) removedUnder.set(host.id, (ids = hiddenMarkRemovedIds(host.children, view)));
    return ids;
  };
  const eventualParagraphsUnder = (host: OoxmlElement): string[] => {
    const ids: string[] = [];
    const visit = (nodes: readonly OoxmlNode[]): void => {
      for (const child of nodes) {
        if (child.kind === 'textValue') continue;
        if (removableTables.has(child.id)) continue;
        if (removableControls.has(child.id)) {
          const content = child.children.find(isContentControlContent);
          if (content && content.kind !== 'textValue') visit(content.children);
          continue;
        }
        if (child.kind === 'paragraph') {
          ids.push(child.id);
          continue;
        }
        // Opaque sibling or wrapper: do not bridge joins across it, and do not lift its
        // nested paragraphs into `host`'s sibling sequence.
        ids.push(`\0barrier:${child.id}`);
      }
    };
    visit(host.children);
    return ids;
  };

  // The paragraphs a join from `before` to `after` must absorb on the way — none when they
  // are consecutive — or null when something that is not a removed paragraph lies between.
  const bridgeBetween = (before: string, after: string): string[] | null => {
    const host = eventualHost(before);
    if (!host || eventualHost(after) !== host) return null;
    const sequence = eventualParagraphsUnder(host);
    const start = sequence.indexOf(before);
    const end = sequence.indexOf(after);
    if (start === -1 || end <= start) return null;
    const between = sequence.slice(start + 1, end);
    if (between.length === 0) return between;
    const removed = hiddenUnder(host);
    return between.every((id) => removed.has(id)) ? between : null;
  };

  let groupHead = survivorId;
  let previous = survivorId;
  for (let index = survivorIndex + 1; index <= lastIndex; index += 1) {
    const id = effectiveOrder[index]!;
    if (tableOfParagraph.has(id)) continue; // going with its table; nothing to join
    const bridge = bridgeBetween(previous, id);
    if (bridge) {
      for (const joined of [...bridge, id]) {
        ops.push({ op: 'joinParagraphs', firstId: groupHead, secondId: joined });
      }
    } else {
      // Something this plan does not remove sits between: start a new join group on ITS far
      // side rather than joining across it.
      groupHead = id;
    }
    previous = id;
  }
  return { ops: ops as RangeDeletionPlan['ops'], collapseTo };
}

/** A collapsed caret has no selected marks and needs no document-order index. */
export function surfaceSelectionMarkRects(
  layout: SemanticLayout,
  selection: SemanticSelection,
  paragraphOrder: () => readonly string[],
  measurer?: TextMeasurer
) {
  if (
    selection.anchor.paragraphId === selection.head.paragraphId &&
    selection.anchor.offset === selection.head.offset
  )
    return [];
  return selectionMarkRects(layout, selection, paragraphOrder(), measurer);
}
