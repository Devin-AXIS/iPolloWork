// `navigateHighlight`: move the selection to the next or previous mark of one highlight set,
// so a keyboard user can walk proofing issues and open the context menu on each one.

import type { ExecResult } from '../contracts/editor.ts';
import type { HighlightRange, NavigateHighlightCommand } from '../contracts/editor-highlights.ts';
import type { EditorSelectionRange } from '../contracts/editor-selection-range.ts';
import { documentOrderIndex, everyStoryOrder } from '../layout/document-order.ts';
import type { SemanticLayout } from '../layout/semantic-records.ts';

/** Why the arguments cannot run, or null. */
export function navigateHighlightArgumentRefusal(command: NavigateHighlightCommand): string | null {
  if (typeof command.name !== 'string' || command.name.length === 0) {
    return 'navigateHighlight requires a highlight set name';
  }
  if (command.direction !== 'next' && command.direction !== 'previous') {
    return "navigateHighlight requires direction 'next' or 'previous'";
  }
  return null;
}

interface Mark {
  readonly blockId: string;
  readonly start: number;
  readonly end: number;
}

/**
 * The reading position of a paragraph in the published layout: the body first, then the
 * other stories. Both orders are memoized per layout, so a step reads no paragraph text.
 * A paragraph the layout does not place, such as one in a text box, has no position.
 */
export function layoutReadingOrder(
  layout: SemanticLayout | null
): (blockId: string) => number | undefined {
  if (!layout) return () => undefined;
  const body = documentOrderIndex(layout);
  let others: Map<string, number> | undefined;
  return (blockId) => {
    const inBody = body.get(blockId);
    if (inBody !== undefined) return inBody;
    if (!others) {
      others = new Map();
      for (const id of everyStoryOrder(layout)) {
        if (!body.has(id) && !others.has(id)) others.set(id, body.size + others.size);
      }
    }
    return others.get(blockId);
  };
}

/**
 * Select the mark after (or before) the selection, in reading order, and wrap at the end.
 * `marks` are the set's ranges that still cover their text, in set order; `readingOrder`
 * places a paragraph (see {@link layoutReadingOrder}). Marks in a paragraph it does not place
 * come last, in set order.
 */
export function navigateHighlight(
  command: NavigateHighlightCommand,
  marks: readonly Mark[] | null,
  readingOrder: (blockId: string) => number | undefined,
  selection: EditorSelectionRange | null,
  select: (range: HighlightRange) => ExecResult
): ExecResult {
  const refusal = navigateHighlightArgumentRefusal(command);
  if (refusal) return { ok: false, code: 'invalidArgs', reason: refusal };
  if (marks === null) {
    return { ok: false, code: 'notFound', reason: `no highlight set named ${command.name}` };
  }
  // Only the paragraphs that hold marks get a position.
  const index = new Map<string, number>();
  let unplaced = Number.MAX_SAFE_INTEGER / 2;
  for (const mark of marks) {
    if (index.has(mark.blockId)) continue;
    index.set(mark.blockId, readingOrder(mark.blockId) ?? unplaced++);
  }
  const sorted = marks
    .filter((mark) => mark.end > mark.start)
    .sort((a, b) => index.get(a.blockId)! - index.get(b.blockId)! || a.start - b.start);
  if (sorted.length === 0) {
    return { ok: false, code: 'notFound', reason: `highlight set ${command.name} has no marks` };
  }
  // Compare by the selection's first position. A collapsed caret at a mark's start is before
  // that mark, so Next selects the word the caret stands at.
  const key = (blockId: string, offset: number) =>
    [index.get(blockId) ?? readingOrder(blockId) ?? -1, offset] as const;
  const before = (a: readonly [number, number], b: readonly [number, number]) =>
    a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  let from: readonly [number, number] = [-1, -1];
  let collapsed = true;
  if (selection) {
    const anchor = key(selection.anchor.blockId, selection.anchor.offset);
    const head = key(selection.head.blockId, selection.head.offset);
    from = before(head, anchor) ? head : anchor;
    collapsed = anchor[0] === head[0] && anchor[1] === head[1];
  }
  const startOf = (mark: Mark) => key(mark.blockId, mark.start);
  const target =
    command.direction === 'next'
      ? (sorted.find((mark) =>
          collapsed ? !before(startOf(mark), from) : before(from, startOf(mark))
        ) ?? sorted[0]!)
      : ([...sorted].reverse().find((mark) => before(startOf(mark), from)) ?? sorted.at(-1)!);
  return select({
    blockId: target.blockId,
    start: target.start,
    length: target.end - target.start,
  });
}
