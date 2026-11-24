// Delete and Backspace treat a `w:showingPlcHdr` prompt as one unit.
//
// A prompt is what an empty control shows, not text to edit one character at a time: the first
// typed character replaces it whole, and the control shows it again whenever it is empty. So a
// press never takes some prompt characters and leaves the rest. Deleting them one at a time left
// "ck here to enter text." on the page, still flagged as the prompt.
//
// - A press from a caret that reaches only prompt characters selects the whole prompt. The next
//   press, with the prompt selected, removes the control: an inline control goes with its prompt,
//   and a block control leaves its paragraph behind, empty.
// - In suggesting mode the first press proposes the inline control's deletion, as one revision.
//   A block control has no such revision, so there the press only selects its prompt.
// - A range that takes part of a prompt takes only the text around it, and the prompt stays.
// - A range that covers a whole inline control and more removes the control with the rest, as
//   far as its lock allows: the store refuses to remove an `sdtLocked` one.
// - A press never removes a locked control (any `w:lock`) from its prompt, and a range that
//   takes part of a locked prompt does nothing.
// - Copy and cut take the whole prompt when the selection holds part of it, so the clipboard
//   holds what a cut removes.

import {
  findNode,
  parentNodeOf,
  type OoxmlPart,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import type { SemanticPosition, SemanticSelection } from '@docx-editor.dev/core/layout';
import {
  contentControlPropertiesOf,
  contentControlsIn,
} from '../store/package/content-control-nodes.ts';
import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import { enclosingContentControls } from '../store/store/tree-op-content-controls.ts';
import { paragraphLength, paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';

/** A deletion a press plans: its ops, and where the caret goes after them. */
export interface PlannedDeletion {
  readonly ops: readonly TreeDocOp[];
  readonly collapseTo: SemanticPosition;
}

/** A prompt a paragraph shows: `[start, end)` of its text, and its control. */
export interface Prompt {
  readonly control: OoxmlNode;
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
  /** A block control: the prompt is the whole paragraph. */
  readonly block: boolean;
  /** Any `w:lock`. A press never removes or splits a locked control's prompt. */
  readonly locked: boolean;
  /** Already inside a proposed deletion. */
  readonly struck: boolean;
}

/** What a press does with the prompts it reaches. */
export type PromptPress =
  | { readonly kind: 'plan'; readonly plan: PlannedDeletion }
  /** The press reached only prompt characters; `prompt` is the one it reached. */
  | { readonly kind: 'reached'; readonly prompt: Prompt }
  /** The press would take part of a locked prompt, so it does nothing. */
  | { readonly kind: 'refused' };

function struckAt(part: OoxmlPart, nodeId: string): boolean {
  for (let node = parentNodeOf(part, nodeId); node; node = parentNodeOf(part, node.id)) {
    if (node.kind === 'revisionDelete') return true;
    if (node.kind === 'paragraph') return false;
  }
  return false;
}

/** Every prompt a paragraph shows, in document order. A block prompt holds the whole paragraph. */
export function promptsIn(
  part: OoxmlPart,
  paragraphId: string,
  removed: ReadonlySet<string> = new Set()
): Prompt[] {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return [];
  const showing = (control: OoxmlNode) =>
    !removed.has(control.id) && contentControlPropertiesOf(control).showingPlaceholder;
  const prompt = (control: OoxmlNode, start: number, end: number, block: boolean): Prompt => ({
    control,
    paragraphId,
    start,
    end,
    block,
    locked: contentControlPropertiesOf(control).lock !== 'unlocked',
    struck: struckAt(part, block ? paragraph.id : control.id),
  });
  const enclosing = enclosingContentControls(part, paragraphId).find(showing);
  if (enclosing) return [prompt(enclosing, 0, paragraphLength(paragraph), true)];
  const offsets = paragraphOffsetIndex(paragraph);
  return contentControlsIn(paragraph).flatMap((entry) => {
    const span = showing(entry.node) ? offsets.spanOf(entry.node) : null;
    return span && span.start < span.end ? [prompt(entry.node, span.start, span.end, false)] : [];
  });
}

/** The prompt a selection holds exactly, whichever way it points, or null. */
export function promptSelected(part: OoxmlPart, selection: SemanticSelection): Prompt | null {
  const { anchor, head } = selection;
  if (anchor.paragraphId !== head.paragraphId) return null;
  const start = Math.min(anchor.offset, head.offset);
  const end = Math.max(anchor.offset, head.offset);
  if (start === end) return null;
  return (
    promptsIn(part, head.paragraphId).find(
      (prompt) => prompt.start === start && prompt.end === end
    ) ?? null
  );
}

/** Whether a block control holds more than one paragraph; bounded, like every tree walk. */
function holdsSeveralParagraphs(control: OoxmlNode): boolean {
  const stack: OoxmlNode[] = [control];
  let paragraphs = 0;
  for (let visited = 0; stack.length > 0 && visited < 10_000; visited++) {
    const node = stack.pop()!;
    if (node.kind === 'paragraph' && ++paragraphs > 1) return true;
    if ('children' in node && node.kind !== 'paragraph') stack.push(...node.children);
  }
  return false;
}

/**
 * The ops that remove a prompt's control, or null when a press must leave it: it is locked,
 * already proposed for deletion, or a block control of several paragraphs. A tracked removal is
 * a deletion of the control's text, which the store proposes as one revision holding the
 * control. A block control has no such revision, so suggesting mode only selects its prompt.
 */
export function promptRemoval(
  prompt: Prompt,
  tracked: boolean,
  direction: 'backward' | 'forward'
): PlannedDeletion | null {
  if (prompt.locked || prompt.struck) return null;
  if (prompt.block && (tracked || holdsSeveralParagraphs(prompt.control))) return null;
  const { paragraphId, start, end } = prompt;
  const text: TreeDocOp = { op: 'deleteText', paragraphId, start, end };
  if (tracked) {
    const offset = direction === 'backward' ? start : end;
    return { ops: [text], collapseTo: { paragraphId, offset } };
  }
  const collapseTo = { paragraphId, offset: start };
  return prompt.block
    ? { ops: [{ op: 'removeContentControl', controlId: prompt.control.id }, text], collapseTo }
    : {
        ops: [{ op: 'removeContentControl', controlId: prompt.control.id, keepContent: false }],
        collapseTo,
      };
}

interface Piece {
  readonly start: number;
  readonly end: number;
}

/** The parts of `[start, end)` outside every span, in document order. */
function outside(start: number, end: number, spans: readonly Piece[]): Piece[] {
  const pieces: Piece[] = [];
  let at = start;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    if (span.end <= at || span.start >= end) continue;
    if (span.start > at) pieces.push({ start: at, end: span.start });
    at = Math.max(at, span.end);
  }
  if (at < end) pieces.push({ start: at, end });
  return pieces;
}

/** A `[start, end)` deletion covers the whole inline prompt, and more on at least one side. */
function covers(op: Piece, prompt: Prompt): boolean {
  return (
    !prompt.block &&
    op.start <= prompt.start &&
    op.end >= prompt.end &&
    (op.start < prompt.start || op.end > prompt.end)
  );
}

/**
 * The deletion with the prompt rule applied (see the header), or null when no prompt is
 * involved and the plan stands as it is.
 */
export function keepPromptsWhole(
  part: OoxmlPart,
  plan: PlannedDeletion,
  tracked: boolean
): PromptPress | null {
  const removed = new Set(
    plan.ops.flatMap((op) => (op.op === 'removeContentControl' ? [op.controlId] : []))
  );
  const taken = new Set<string>();
  let changed = false;
  let refused = false;
  let reached: Prompt | null = null;
  const ops = plan.ops.flatMap((op): TreeDocOp[] => {
    if (op.op !== 'deleteText') return [op];
    const prompts = promptsIn(part, op.paragraphId, removed).filter(
      (prompt) => prompt.start < op.end && prompt.end > op.start
    );
    if (prompts.length === 0) return [op];
    changed = true;
    const partial = prompts.filter((prompt) => !covers(op, prompt));
    for (const prompt of prompts) if (covers(op, prompt)) taken.add(prompt.control.id);
    if (partial.some((prompt) => prompt.locked)) refused = true;
    reached ??= partial[0] ?? null;
    // A tracked deletion over a whole control proposes the control with the text around it, so
    // only the prompts it takes part of are cut out. An untracked one removes the control as a
    // node, because deleting its text left an empty control behind.
    const items = outside(op.start, op.end, tracked ? partial : prompts).map((piece) => ({
      start: piece.start,
      op: { ...op, ...piece } as TreeDocOp,
    }));
    if (!tracked) {
      for (const prompt of prompts) {
        if (!covers(op, prompt)) continue;
        const controlId = prompt.control.id;
        items.push({
          start: prompt.start,
          op: { op: 'removeContentControl', controlId, keepContent: false },
        });
      }
    }
    // From the end back, so no op moves the offsets of the ops after it.
    return items.sort((a, b) => b.start - a.start).map((item) => item.op);
  });
  if (!changed) return null;
  if (ops.length === 0 && reached) return { kind: 'reached', prompt: reached };
  if (refused) return { kind: 'refused' };
  // A caret that would land inside a kept prompt goes to its end, where the deleted text began.
  const { paragraphId, offset } = plan.collapseTo;
  const around = promptsIn(part, paragraphId, removed).find(
    (prompt) => !taken.has(prompt.control.id) && offset >= prompt.start && offset < prompt.end
  );
  return {
    kind: 'plan',
    plan: { ops, collapseTo: around ? { paragraphId, offset: around.end } : plan.collapseTo },
  };
}

/**
 * The selection grown to hold every prompt it holds part of, or null when it needs no change.
 * Copy and cut read it, so the clipboard and the deletion agree on what the range takes.
 */
export function selectionOverPrompts(
  part: OoxmlPart,
  selection: SemanticSelection,
  ordered: { readonly from: SemanticPosition; readonly to: SemanticPosition }
): SemanticSelection | null {
  const grow = (position: SemanticPosition, side: 'start' | 'end'): SemanticPosition => {
    const inside = promptsIn(part, position.paragraphId).find(
      (prompt) => position.offset > prompt.start && position.offset < prompt.end
    );
    return inside ? { paragraphId: position.paragraphId, offset: inside[side] } : position;
  };
  const from = grow(ordered.from, 'start');
  const to = grow(ordered.to, 'end');
  if (from === ordered.from && to === ordered.to) return null;
  const forward =
    selection.anchor.paragraphId === ordered.from.paragraphId &&
    selection.anchor.offset === ordered.from.offset;
  return forward ? { anchor: from, head: to } : { anchor: to, head: from };
}
