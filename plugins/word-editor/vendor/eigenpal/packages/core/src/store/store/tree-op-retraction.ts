// Whose words are these — the two questions a tracked deletion asks (tracked-edits seam).
//
// `applyDeleteTracked` does one of two different things to the characters it covers, and the
// answer turns on the run's ancestry alone: a run already inside a `w:del` is left as it is,
// a run inside the author's OWN `w:ins` is RETRACTED (it leaves the paragraph, because those
// words were never anyone else's to see), and everything else is STRUCK in place.
//
// The predicates live here rather than in the writer because a CALLER has to be able to ask
// the same question before it builds a plan. Striking keeps offsets; retracting moves every
// offset past it to the left. A replacement aimed past a selection that turns out to be
// retracted is aimed past the end of the paragraph, which the store refuses — and a refusal
// takes the whole transaction, so the keystroke does nothing at all.

import type { OoxmlNode, OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-tree.ts';
import { paragraphOffsetIndex } from './tree-op-segments.ts';

/** The author of the enclosing `w:ins`, when there is one. */
export function insertionAuthor(stack: readonly OoxmlNode[]): string | null {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const node = stack[index]!;
    if (node.kind === 'textValue') continue;
    if (node.kind !== 'revisionInsert') continue;
    const found = node.attributes.find(
      (attribute) =>
        attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'author'
    );
    return found?.value ?? '';
  }
  return null;
}

/** Whether the run is already struck, in which case a deletion has nothing left to say. */
export function insideDeletion(stack: readonly OoxmlNode[]): boolean {
  return stack.some((node) => node.kind !== 'textValue' && node.kind === 'revisionDelete');
}

/**
 * How much of `[start, end)` a tracked deletion RETRACTS instead of striking.
 *
 * Struck text stays in the paragraph and keeps its offsets, so everything after it still
 * means what it meant. Retracted text leaves, so every offset past it moves left by its
 * length. A caller that replaces a range needs the difference to aim the replacement.
 *
 * Answers from the same walk the writer uses, so the two cannot drift apart: a run outside a
 * `w:del` whose nearest `w:ins` is this author's, measured in the paragraph's own offset
 * space rather than in characters.
 */
export function retractedLengthOf(
  paragraph: OoxmlParagraphNode,
  start: number,
  end: number,
  author: string
): number {
  let retracted = 0;
  for (const range of retractedRangesOf(paragraph, start, end, author)) {
    retracted += range.end - range.start;
  }
  return retracted;
}

/**
 * The sub-ranges of `[start, end)` a tracked deletion RETRACTS, in the paragraph's own
 * offset space, in document order.
 *
 * The walk {@link retractedLengthOf} sums over, exposed whole: a caller judging what a
 * strike leaves STANDING — the landing pick for a replacement wants a paragraph whose
 * surviving text is worded — needs the positions, because no arithmetic over the length
 * can tell a surviving word from retracted whitespace.
 */
export function retractedRangesOf(
  paragraph: OoxmlParagraphNode,
  start: number,
  end: number,
  author: string
): readonly { readonly start: number; readonly end: number }[] {
  if (end <= start) return [];
  const offsets = paragraphOffsetIndex(paragraph);
  const ranges: { start: number; end: number }[] = [];
  const walk = (nodes: readonly OoxmlNode[], stack: readonly OoxmlNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'textValue') continue;
      const span = offsets.spanOf(node);
      // No span means the offset walk never reached it: it holds no addressable characters,
      // and a deletion leaves it standing — the same reading the writer gives a node of
      // length zero.
      if (!span || span.end <= start || span.start >= end) continue;
      if (node.kind === 'run') {
        if (insideDeletion(stack) || insertionAuthor(stack) !== author) continue;
        ranges.push({ start: Math.max(start, span.start), end: Math.min(end, span.end) });
        continue;
      }
      walk(node.children, [...stack, node]);
    }
  };
  walk(paragraph.children, []);
  return ranges;
}
