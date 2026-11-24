// The text highlights an open context menu is about: under the pointer for a right-click,
// and at the caret for a keyboard open.
//
// Both read painted geometry through `getHighlightsAt`, so a hit carries the same fields
// either way. A keyboard open probes the caret's line just before and just after the caret,
// then keeps the marks whose current range holds the caret offset. That covers a caret at
// either edge of a word, as well as inside it, in both writing directions.

import type { Editor, HighlightHit, HighlightRange } from '@docx-editor.dev/core/contracts/editor';

/** The menu anchor fields this read needs. */
interface MenuAnchor {
  readonly x: number;
  readonly y: number;
  readonly trigger: 'pointer' | 'keyboard';
}

const NO_HITS: readonly never[] = Object.freeze([]);

/** How far beside the caret line the keyboard probe reads, in CSS pixels. */
const CARET_PROBE = 1;

function ofSet<R extends HighlightRange>(
  hits: readonly HighlightHit<R>[],
  name: string | undefined
): readonly HighlightHit<R>[] {
  return name === undefined ? hits : hits.filter((hit) => hit.name === name);
}

/** The highlights whose current range holds the caret, topmost first. */
function highlightsAtCaret<R extends HighlightRange>(editor: Editor): readonly HighlightHit<R>[] {
  const caret = editor.getSelectionRange()?.head;
  const rect = editor.getCaretRect();
  if (!caret || !rect) return NO_HITS;
  const y = rect.top + rect.height / 2;
  const seen = new Set<string>();
  const hits: HighlightHit<R>[] = [];
  for (const x of [rect.left - CARET_PROBE, rect.left + CARET_PROBE]) {
    for (const hit of editor.getHighlightsAt<R>(x, y)) {
      const id = `${hit.name}\u0000${hit.index}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (hit.range.blockId !== caret.blockId) continue;
      if (caret.offset < hit.start || caret.offset > hit.start + hit.length) continue;
      hits.push(hit);
    }
  }
  return hits;
}

/**
 * The highlights the open menu is about, or an empty array while it is closed. A pointer
 * open reads under the pointer; a keyboard open reads at the caret.
 */
export function readContextMenuHighlights<R extends HighlightRange>(
  editor: Editor | null,
  anchor: MenuAnchor | null,
  name: string | undefined
): readonly HighlightHit<R>[] {
  if (!editor || !anchor) return NO_HITS;
  if (anchor.trigger === 'keyboard') return ofSet(highlightsAtCaret<R>(editor), name);
  return ofSet(editor.getHighlightsAt<R>(anchor.x, anchor.y), name);
}
