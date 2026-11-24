// Read a TOC's actual inline result without including neighbouring text or field codes.
import { tocFieldRange, type DetectedToc } from './toc-detect.ts';
import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';
import { MAX_INLINE_CONTAINER_DEPTH, nextInlineContainerDepth } from './ooxml-shared.ts';

/** Preserve wrappers/properties while selecting one side of the field boundaries. */
export function sliceTocParagraph(
  paragraph: OoxmlElement,
  toc: DetectedToc,
  side: 'before' | 'result' | 'after'
): OoxmlElement {
  const range = tocFieldRange(toc);
  if (!range) return paragraph;
  let active =
    side === 'before' || (side === 'result' && paragraph.id !== range.separateParagraphId);
  const walk = (node: OoxmlNode, depth: number): OoxmlNode | null => {
    if (node.id === range.separateNodeId) {
      active = side === 'result';
      return side === 'before' ? node : null;
    }
    if (node.id === range.endNodeId) {
      active = side === 'after';
      return side === 'after' ? node : null;
    }
    if (node.kind === 'textValue') return active ? node : null;
    if (node.localName.endsWith('Pr')) return node;
    if (depth >= MAX_INLINE_CONTAINER_DEPTH) return active ? node : null;
    if (node.children.length === 0) return active ? node : null;
    const childDepth = nextInlineContainerDepth(node, depth);
    const children = node.children.flatMap((child) => {
      const kept = walk(child, childDepth);
      return kept ? [kept] : [];
    });
    if (
      children.length === 0 ||
      children.every((child) => child.kind !== 'textValue' && child.localName.endsWith('Pr'))
    )
      return null;
    return children.length === node.children.length &&
      children.every((child, i) => child === node.children[i])
      ? node
      : ({ ...node, children } as OoxmlNode);
  };
  const children = paragraph.children.flatMap((child) => {
    const kept = walk(child, 0);
    return kept ? [kept] : [];
  });
  return { ...paragraph, children } as OoxmlElement;
}
