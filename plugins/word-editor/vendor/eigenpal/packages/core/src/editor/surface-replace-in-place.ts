// Replacing a range the reader did not select.
//
// A host replacing a found match addresses it directly, so the reader's selection and the
// viewport stay where they are. Suggesting records the strike and the insertion under the
// configured author, through the same plan and store rules as a replacement typed over a
// selection; editing replaces outright.

import type { SemanticPosition, SemanticSelection } from '@docx-editor.dev/core/layout';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import { mapSelectionAcrossText } from './surface-remote-caret.ts';
import { replacementOps } from './replacement-ops.ts';

type HistoryMark = { paragraphId: string; start: number; end: number };

export interface InPlaceReplacementDeps {
  /** Land queued typing and any deferred layout pass. */
  settle(): void;
  /** Report a refusal through `lastRejection`. */
  refuse(reason: string): false;
  /** Paragraph ids of the story the reader is in. */
  storyParagraphs(): readonly string[];
  textOf(paragraphId: string): string;
  /** The deletion plan and landing for a range, with the selection left alone. */
  rangePlan(range: SemanticSelection): {
    readonly ops: readonly TreeDocOp[];
    readonly replaceAt: SemanticPosition;
  };
  /** Where an insertion at a collapsed position lands, past any deletion it rests in. */
  insertionPoint(position: SemanticPosition): SemanticPosition;
  selection(): SemanticSelection;
  selectionMark(): HistoryMark | null;
  /**
   * Commit `ops` in the active story with no caret follow, now or owed to a later paint.
   * `after` names the selection to install, or null to keep it. True when committed.
   */
  commitWithoutFollow(
    ops: readonly TreeDocOp[],
    mark: HistoryMark | undefined,
    after: () => SemanticSelection | null
  ): boolean;
  flushLayout(): void;
  /** The model selection is newer than the DOM one until the next mirror. */
  noteModelMoved(): void;
  selectionsEqual(a: SemanticSelection, b: SemanticSelection): boolean;
}

/** Replace `[start, end)` of one paragraph in the active story with `text`, in place. */
export function createInPlaceReplacement(deps: InPlaceReplacementDeps) {
  return (paragraphId: string, start: number, end: number, text: string): boolean => {
    deps.settle();
    if (/[\r\n\v\f\u2028\u2029]/.test(text))
      return deps.refuse('replacement requires text without a paragraph mark');
    if (!deps.storyParagraphs().includes(paragraphId))
      return deps.refuse('that text is not in the story being edited');
    const beforeText = deps.textOf(paragraphId);
    if (start < 0 || end < start || end > beforeText.length)
      return deps.refuse('that range is outside the paragraph');
    const anchor = { paragraphId, offset: start };
    const plan =
      end > start
        ? deps.rangePlan({ anchor, head: { paragraphId, offset: end } })
        : { ops: [], replaceAt: deps.insertionPoint(anchor) };
    const { paragraphId: landingId, offset: landing } = plan.replaceAt;
    const [only] = plan.ops;
    // A plain deletion of exactly the range: the text joins the first replaced character's run.
    const plain =
      plan.ops.length === 1 &&
      only?.op === 'deleteText' &&
      only.revision === undefined &&
      only.paragraphId === paragraphId &&
      only.start === start &&
      only.end === end &&
      landingId === paragraphId &&
      landing === start;
    const ops: TreeDocOp[] = plain
      ? replacementOps(paragraphId, start, end, text, null)
      : [...plan.ops];
    if (!plain && text.length > 0)
      ops.push({ op: 'insertText', paragraphId: landingId, offset: landing, text });
    if (ops.length === 0) return true;
    const kept = deps.selection();
    return deps.commitWithoutFollow(ops, deps.selectionMark() ?? undefined, () => {
      // Only a selection in the edited paragraph shifts. Returning the same one would still
      // count as a move and retire an open card or a selected picture.
      deps.flushLayout();
      const after = deps.textOf(paragraphId);
      const mapped = mapSelectionAcrossText(kept, paragraphId, beforeText, after);
      if (deps.selectionsEqual(mapped, kept)) return null;
      deps.noteModelMoved();
      return mapped;
    });
  };
}
