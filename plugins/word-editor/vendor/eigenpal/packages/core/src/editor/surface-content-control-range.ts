// Addressing a content control's content as a selection.
//
// A control is addressable two ways and the difference is structural, not cosmetic: one that
// wraps whole paragraphs is the span from the first to the last, and one that sits inside a
// paragraph is a UTF-16 range within it. Both answers are pure reads of the tree, which is
// what keeps them out of the composition root.

import {
  paragraphOffsetIndex,
  type OoxmlElement,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import type { SemanticSelection } from '@docx-editor.dev/core/layout';

/**
 * The control's addressable content, or null when it holds nothing addressable.
 *
 * `anchor` is always the START. Callers reveal that end rather than the head: the whole
 * content is selected for replacement, and the next keystroke lands at the beginning, so a
 * control taller than the viewport would otherwise be shown by its last line.
 */
export function contentControlSelectionRange(
  control: OoxmlElement,
  deps: {
    /** The control's own children, minus its properties — the host's `contentChildrenOf`. */
    contentChildrenOf(node: OoxmlElement): readonly OoxmlNode[];
    /** The roots to scan for the paragraph an INLINE control sits in. */
    searchRoots(): readonly OoxmlNode[];
  }
): SemanticSelection | null {
  const paragraphs: { id: string; length: number }[] = [];
  const collectParagraphs = (nodes: readonly OoxmlNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'paragraph') {
        paragraphs.push({ id: node.id, length: paragraphOffsetIndex(node).length });
        continue;
      }
      if (node.kind === 'textValue') continue;
      const kind = (node as { kind: string }).kind;
      if (kind === 'contentControl') {
        collectParagraphs(deps.contentChildrenOf(node as OoxmlElement));
        continue;
      }
      collectParagraphs(node.children);
    }
  };
  collectParagraphs(deps.contentChildrenOf(control));

  if (paragraphs.length > 0) {
    const first = paragraphs[0]!;
    const last = paragraphs[paragraphs.length - 1]!;
    return {
      anchor: { paragraphId: first.id, offset: 0 },
      head: { paragraphId: last.id, offset: last.length },
    };
  }

  // Inline control: locate the parent paragraph and its UTF-16 range.
  let found: SemanticSelection | null = null;
  const scanParagraphs = (nodes: readonly OoxmlNode[]): boolean => {
    for (const node of nodes) {
      if (node.kind === 'paragraph') {
        const span = paragraphOffsetIndex(node).spanOf(control);
        if (!span) continue;
        found = {
          anchor: { paragraphId: node.id, offset: span.start },
          head: { paragraphId: node.id, offset: span.end },
        };
        return true;
      }
      if (node.kind === 'textValue') continue;
      if (scanParagraphs(node.children)) return true;
    }
    return false;
  };
  scanParagraphs(deps.searchRoots());
  return found;
}

/** A control's content children: those of its `w:sdtContent`, never its properties. */
export function contentChildrenOf(control: OoxmlElement): readonly OoxmlNode[] {
  for (const child of control.children) {
    if (child.kind === 'textValue') continue;
    if (
      (child as { kind: string }).kind === 'contentControlContent' ||
      child.localName === 'sdtContent'
    ) {
      return child.children;
    }
  }
  return [];
}
