// The engine half of `Editor.getSelectionRange()` and `Editor.getCaretRect()`.
//
// The range is the surface's own (paragraph id, offset) selection, so it round-trips through
// `setSelection` unchanged. It is cached by value: the snapshot carries it and compares its
// fields with `===`, so a fresh object per tick would wake every subscriber on every tick.

import type { ViewScope } from '../contracts/editor-scope.ts';
import type { EditorSelectionRange } from '../contracts/editor-selection-range.ts';
import type { HighlightRect } from '../contracts/editor-highlights.ts';
import type { SemanticSelection } from '../layout/semantic-interaction.ts';
import { resolveSelectedDrawingRecord } from './docx-editor-images.ts';
import { deepFreezeValue } from './docx-editor-support.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

const BODY: ViewScope = Object.freeze({ kind: 'body' as const });

/**
 * Whether two scopes name the same story. Scope objects are not reference-stable, and a frame
 * scope nests its owner, so this compares plain values field by field.
 */
function sameScope(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => sameScope(left[key], right[key]))
  );
}

function sameSelection(range: EditorSelectionRange, selection: SemanticSelection): boolean {
  return (
    range.anchor.blockId === selection.anchor.paragraphId &&
    range.anchor.offset === selection.anchor.offset &&
    range.head.blockId === selection.head.paragraphId &&
    range.head.offset === selection.head.offset
  );
}

/**
 * Whether the selection is a CARET rather than a range: `snapshot().selectionCollapsed`.
 *
 * Cheap on purpose. The only way to ask this used to be `query({ type: 'selectedText' })
 * === ''`, which materializes the whole selected string to answer a boolean, and hosts ask
 * it from selector functions that re-run on every tick, so a select-all on a long document
 * allocated megabytes per tick to learn one bit. `snapshot().selection` cannot carry it:
 * `DocRange` addresses paragraphs by paraId and has no offsets, so a caret and a range
 * inside one paragraph look identical there.
 */
export function selectionCollapsedOf(
  state: { readonly selection: SemanticSelection } | null
): boolean {
  if (state === null) return true;
  const { anchor, head } = state.selection;
  return anchor.paragraphId === head.paragraphId && anchor.offset === head.offset;
}

/** Selection and caret reads over the live surface. */
export function createSelectionRangeRead(surface: () => PaginatedSurface | null) {
  let cached: EditorSelectionRange | null = null;

  /** The snapshot's read: the selection as the surface holds it, without forcing a pass. */
  function selectionRange(): EditorSelectionRange | null {
    const mounted = surface();
    // No text selection: nothing open, a cell block, or a selected drawing. A drawing is
    // selected only by a press on it or a host write; a caret beside one is a text caret.
    if (
      !mounted ||
      mounted.state().cellSelection !== null ||
      resolveSelectedDrawingRecord(mounted) !== null
    ) {
      cached = null;
      return null;
    }
    const { selection } = mounted.state();
    const scope = mounted.activeScope() ?? BODY;
    if (cached && sameSelection(cached, selection) && sameScope(cached.scope, scope)) return cached;
    // Copied and frozen: the surface's own objects must not reach a host that could mutate them.
    cached = deepFreezeValue({
      anchor: { blockId: selection.anchor.paragraphId, offset: selection.anchor.offset },
      head: { blockId: selection.head.paragraphId, offset: selection.head.offset },
      scope: structuredClone(scope),
    });
    return cached;
  }

  /**
   * The host's direct read. A remote commit carries the caret when its layout publishes,
   * which can wait for the scheduler's task; the text has moved by then, so a read in
   * between would pair new text with an old offset. Only that case runs the pass early. A
   * local edit has already moved the selection, so a read during typing forces neither a
   * deferred layout nor a flush of buffered keystrokes; buffered characters are not in the
   * document text yet, and the offsets describe that text. Other snapshot reads can land the
   * buffered keystrokes; the snapshot then derives again from the state they moved to.
   */
  function currentSelectionRange(): EditorSelectionRange | null {
    const mounted = surface();
    if (mounted?.remoteSelectionPending()) mounted.layout();
    return selectionRange();
  }

  function caretRect(): HighlightRect | null {
    return surface()?.caretClientRect() ?? null;
  }

  return {
    selectionRange,
    members: { getSelectionRange: currentSelectionRange, getCaretRect: caretRect },
  };
}
