// Struck text in a paragraph: a pending tracked deletion (`w:del`, `w:delText`) or text moved
// away (`w:moveFrom`). It stays in the model text until the change is accepted, so search finds
// it and offsets address it.
//
// `replaceMatch` refuses a range that overlaps it, and `replaceAllMatches` skips one.

import { WML_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import type { OoxmlNode, OoxmlParagraphNode } from '../store/package/ooxml-tree.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';

const REMOVED_CONTAINERS = new Set(['del', 'moveFrom']);

/** The `[start, end)` spans of struck text in a paragraph: `w:del` and `w:moveFrom` content. */
export function removedTextSpans(
  paragraph: OoxmlParagraphNode
): readonly { readonly start: number; readonly end: number }[] {
  const index = paragraphOffsetIndex(paragraph);
  const spans: { start: number; end: number }[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'deletedText') {
      const span = index.spanOf(node);
      if (span) spans.push(span);
      return;
    }
    if (node.namespaceUri === WML_NAMESPACE_URI && REMOVED_CONTAINERS.has(node.localName)) {
      const span = index.spanOf(node);
      if (span) spans.push(span);
      return;
    }
    for (const child of node.children) visit(child);
  };
  for (const child of paragraph.children) visit(child);
  return spans;
}

/** Whether `[start, end)` shares a character with struck text. */
export function rangeOverlapsRemovedText(
  paragraph: OoxmlParagraphNode,
  start: number,
  end: number
): boolean {
  return removedTextSpans(paragraph).some((span) => span.start < end && span.end > start);
}
