// Backspace and Delete beside, or over, an inline control the caret treats as one unit.
//
// A control whose content is locked (`contentLocked`, `sdtContentLocked`) is never removed by
// the press that reaches it. The first press beside it SELECTS the whole control, so the reader
// sees what the next press will take; a second press, with the control selected, removes it.
// The store decides whether that removal is allowed: `contentLocked` lets the control go,
// `sdtContentLocked` refuses it. A checkbox or a picture still goes in one press, because its
// glyph is the whole control and there is nothing to show before it goes.
//
// A selection that covers a whole content-locked control removes it, together with the text
// around it in the same paragraph. Deleting the range as text alone touched the locked
// characters, so the store refused the whole edit.
//
// The rule is the same with either `lockedControlNavigation` value.

import type {
  ContentControlBoundaryRecord,
  SemanticLayout,
  SemanticPosition,
  SemanticSelection,
} from '@docx-editor.dev/core/layout';
import type { TreeDocOp } from '@docx-editor.dev/core/store';

/** An inline control beside the caret, as the store reports it. */
export interface InlineControlBesideCaret {
  readonly controlId: string;
  readonly start: number;
  readonly end: number;
  /** The control's content is locked: the first press selects it instead of removing it. */
  readonly contentLocked: boolean;
  /** The control is already proposed for deletion: the key steps over it. */
  readonly struck?: boolean;
}

/** What a Backspace or Delete does with an atomic inline control, when one is involved. */
export type AtomicControlDeletion =
  | { readonly kind: 'select'; readonly selection: SemanticSelection }
  | {
      readonly kind: 'remove';
      readonly ops: readonly TreeDocOp[];
      readonly collapseTo: SemanticPosition;
    };

export interface AtomicControlDeletionInput {
  readonly layout: SemanticLayout;
  readonly selection: SemanticSelection;
  readonly direction: 'backward' | 'forward';
  /** A collapsed caret as the reader sees it (hidden paragraph marks resolved). */
  readonly shown: (position: SemanticPosition) => SemanticPosition;
  /** The atomic inline control whose content ends (`before`) or starts (`after`) here. */
  readonly controlBeside: (
    position: SemanticPosition,
    side: 'before' | 'after'
  ) => InlineControlBesideCaret | null;
  /**
   * The deletion is tracked. A removal is then a tracked deletion of the control's characters,
   * which the store writes as one proposal holding the whole control.
   */
  readonly tracked?: boolean;
}

function contentLockedInline(control: ContentControlBoundaryRecord): boolean {
  return (
    control.level === 'inline' &&
    control.range !== undefined &&
    control.range.start < control.range.end &&
    (control.effectiveLock === 'contentLocked' || control.effectiveLock === 'sdtContentLocked')
  );
}

/**
 * The ops that remove `[from, to)` in one paragraph when it covers at least one whole
 * content-locked control: each outermost covered control goes as a node, and the text between
 * them goes as text. Ops run from the end of the range back, so no op shifts the offsets of
 * the ops after it. Null when the range covers no such control.
 */
export function coveredLockedControlOps(
  layout: SemanticLayout,
  from: SemanticPosition,
  to: SemanticPosition
): TreeDocOp[] | null {
  const covered = (layout.contentControls ?? []).filter(
    (control) =>
      contentLockedInline(control) &&
      control.range!.paragraphId === from.paragraphId &&
      control.range!.start >= from.offset &&
      control.range!.end <= to.offset
  );
  const outermost = covered
    .filter(
      (control) =>
        !covered.some(
          (other) =>
            other !== control &&
            other.range!.start <= control.range!.start &&
            other.range!.end >= control.range!.end &&
            other.nestingDepth < control.nestingDepth
        )
    )
    .sort((a, b) => b.range!.start - a.range!.start);
  if (outermost.length === 0) return null;
  const paragraphId = from.paragraphId;
  const ops: TreeDocOp[] = [];
  let end = to.offset;
  for (const control of outermost) {
    if (control.range!.end < end) {
      ops.push({ op: 'deleteText', paragraphId, start: control.range!.end, end });
    }
    ops.push({ op: 'removeContentControl', controlId: control.id, keepContent: false });
    end = control.range!.start;
  }
  if (from.offset < end) ops.push({ op: 'deleteText', paragraphId, start: from.offset, end });
  return ops;
}

/**
 * What Backspace (`backward`) or Delete (`forward`) does with an atomic inline control, or
 * null when the key has no atomic control to act on and its ordinary rules apply.
 */
export function atomicControlDeletion(
  input: AtomicControlDeletionInput
): AtomicControlDeletion | null {
  const { anchor, head } = input.selection;
  if (anchor.paragraphId !== head.paragraphId) return null;
  if (anchor.offset !== head.offset) {
    // A tracked range deletion is planned as text: the store strikes a covered control whole.
    if (input.tracked) return null;
    const [from, to] = anchor.offset < head.offset ? [anchor, head] : [head, anchor];
    const ops = coveredLockedControlOps(input.layout, from, to);
    return ops ? { kind: 'remove', ops, collapseTo: from } : null;
  }
  const position = input.shown(head);
  const backward = input.direction === 'backward';
  const control = input.controlBeside(position, backward ? 'before' : 'after');
  if (!control) return null;
  const start = { paragraphId: position.paragraphId, offset: control.start };
  const end = { paragraphId: position.paragraphId, offset: control.end };
  if (control.struck) {
    const past = backward ? start : end;
    return { kind: 'select', selection: { anchor: past, head: past } };
  }
  if (control.contentLocked) {
    return {
      kind: 'select',
      selection: backward ? { anchor: end, head: start } : { anchor: start, head: end },
    };
  }
  return {
    kind: 'remove',
    ops: input.tracked
      ? [
          {
            op: 'deleteText',
            paragraphId: position.paragraphId,
            start: control.start,
            end: control.end,
          },
        ]
      : [{ op: 'removeContentControl', controlId: control.controlId, keepContent: false }],
    // A tracked removal leaves the control in place, struck: a forward press moves past it,
    // or the next press would find the same control and strike nothing new.
    collapseTo: backward ? start : input.tracked ? end : position,
  };
}
