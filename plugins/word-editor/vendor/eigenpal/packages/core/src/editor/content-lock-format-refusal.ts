// Run formatting over a content lock, answered BEFORE the write, so `can`, the toolbar and
// `exec` all say the same thing. The store refuses the transaction either way; asking here
// first is what keeps a button from looking available and then doing nothing.

import type { EditorCommand, ExecResult } from '../contracts/editor.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import type { ContentLockPolicy } from '../store/package/ooxml-edit.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import {
  contentControlPropertiesOf,
  contentControlsIn,
  lockForbidsEdit,
  resolveContentControlLock,
} from '../store/package/content-control-nodes.ts';
import { effectiveContentLockAt } from '../store/store/tree-op-nodes.ts';
import { enclosingContentControls } from '../store/store/tree-op-content-controls.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { paragraphsInCells } from '../layout/semantic-cell-selection.ts';
import { partOfNodeId, storyScopeOfNodeId } from './surface-scope.ts';

export const LOCKED_FORMAT_REASON = 'this content is locked';

const RUN_FORMAT_COMMANDS: ReadonlySet<EditorCommand['type']> = new Set([
  'toggleMark',
  'setMarkAttr',
  'clearFormatting',
]);

/** One paragraph's selected span: `[start, end)` in its own offsets. */
interface SelectedSpan {
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
}

const WHOLE = Number.MAX_SAFE_INTEGER;

/** The paragraphs a format write reaches, with the same coverage rule the writer uses. */
function selectedSpans(surface: PaginatedSurface): SelectedSpan[] {
  const state = surface.state();
  const cells = state.cellSelection;
  if (cells) {
    return [...paragraphsInCells(surface.layout(), cells.cellIds)].map((paragraphId) => ({
      paragraphId,
      start: 0,
      end: WHOLE,
    }));
  }
  const { anchor, head } = state.selection;
  if (anchor.paragraphId === head.paragraphId) {
    // A collapsed caret arms a run format for the next characters typed, and the eraser
    // clears the paragraph's own properties: both are refused where typing would be.
    if (anchor.offset === head.offset) {
      return [{ paragraphId: head.paragraphId, start: head.offset, end: head.offset }];
    }
    return [
      {
        paragraphId: anchor.paragraphId,
        start: Math.min(anchor.offset, head.offset),
        end: Math.max(anchor.offset, head.offset),
      },
    ];
  }
  const scope = storyScopeOfNodeId(surface.session, anchor.paragraphId, { kind: 'body' });
  const order = surface.session.paragraphIdsIn(scope);
  const a = order.indexOf(anchor.paragraphId);
  const b = order.indexOf(head.paragraphId);
  if (a === -1 || b === -1) {
    return [
      { paragraphId: anchor.paragraphId, start: 0, end: WHOLE },
      { paragraphId: head.paragraphId, start: 0, end: WHOLE },
    ];
  }
  const [from, to] = a < b ? [anchor, head] : [head, anchor];
  const [first, last] = a < b ? [a, b] : [b, a];
  const spans = order.slice(first, last + 1).map((paragraphId, index, all) => ({
    paragraphId,
    start: index === 0 ? from.offset : 0,
    end: index === all.length - 1 ? to.offset : WHOLE,
  }));
  // A range that ENDS at the start of a paragraph writes nothing there (the writer's rule).
  const tail = spans[spans.length - 1];
  return tail && tail.end === 0 ? spans.slice(0, -1) : spans;
}

/** Whether any control in the story locks its content: most documents have none. */
function storyHasContentLock(part: OoxmlPart): boolean {
  return contentControlsIn(part.root).some((entry) =>
    lockForbidsEdit(contentControlPropertiesOf(entry.node).lock)
  );
}

/**
 * The refusal a formatting command meets because the selection reaches content a control
 * locks, or null.
 *
 * Run formatting passes a lock when the host's policy allows it. The eraser also clears
 * PARAGRAPH properties, which no policy lets through a block content lock.
 */
export function contentLockFormatRefusal(
  command: EditorCommand,
  surface: PaginatedSurface,
  policy: ContentLockPolicy | undefined
): Exclude<ExecResult, { ok: true }> | null {
  if (!RUN_FORMAT_COMMANDS.has(command.type)) return null;
  const clearing = command.type === 'clearFormatting';
  // The policy lets an UNTRACKED restyle through; a proposed one is still an edit to locked
  // content, so suggesting mode keeps the lock unless the document asks for formatting
  // changes to go untracked.
  const tracked =
    surface.editingMode() === 'suggest' &&
    Boolean(surface.author()?.trim()) &&
    !surface.session.trackingSettings().doNotTrackFormatting;
  const runsPass = policy?.allowFormattingInLockedContent === true && !tracked;
  // A caret only arms a format for text typed next, and no policy lets typing into a lock.
  const { selection, cellSelection } = surface.state();
  const atCaret =
    !cellSelection &&
    selection.anchor.paragraphId === selection.head.paragraphId &&
    selection.anchor.offset === selection.head.offset;
  if (runsPass && !clearing && !atCaret) return null;
  const refusal = { ok: false as const, code: 'locked' as const, reason: LOCKED_FORMAT_REASON };
  for (const span of selectedSpans(surface)) {
    // A pure ancestry read of the story that holds the paragraph.
    const part = partOfNodeId(surface.session, span.paragraphId) ?? surface.session.part();
    if (!storyHasContentLock(part)) continue;
    const paragraph = findNode(part, span.paragraphId);
    if (!paragraph || paragraph.kind !== 'paragraph') continue;
    if (effectiveContentLockAt(part, span.paragraphId).content) return refusal;
    if (runsPass && !atCaret) continue;
    const inside = contentControlsIn(paragraph);
    if (inside.length === 0) continue;
    const offsets = paragraphOffsetIndex(paragraph);
    const caret = span.start === span.end;
    for (const entry of inside) {
      const at = offsets.spanOf(entry.node);
      if (!at) continue;
      // A caret strictly INSIDE a locked control arms a format for text that cannot be typed
      // there; at its edge the text lands outside, so the caret is free.
      const reached = caret
        ? at.start < span.start && span.start < at.end
        : at.end > span.start && at.start < span.end;
      if (!reached) continue;
      const locks = enclosingContentControls(part, entry.node.id).map(
        (control) => contentControlPropertiesOf(control).lock
      );
      if (lockForbidsEdit(resolveContentControlLock(locks))) return refusal;
    }
  }
  return null;
}
