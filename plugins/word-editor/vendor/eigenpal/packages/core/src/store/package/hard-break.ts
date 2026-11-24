// OOXML `w:br` break-kind helpers.
//
// `w:br` without `w:type`, or with `w:type="textWrapping"`, is a line break inside the
// paragraph. `w:type="page"` is a page break: following content continues on the next page
// while the paragraph identity is preserved. Other `w:type` values are carried on the node
// as authored attributes and treated as line breaks for layout until modeled.

import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlHardBreakNode, OoxmlNode } from './ooxml-tree.ts';

/** UTF-16 placeholder for a page break in paragraph text projections. */
export const PAGE_BREAK_CHAR = '\f';

/** What a `w:br` breaks. `other` covers values this engine does not model, kept losslessly. */
export type HardBreakKind = 'line' | 'page' | 'column' | 'other';

/** Read the semantic break kind from a typed `w:br` node. */
export function hardBreakKind(node: OoxmlHardBreakNode): HardBreakKind {
  if (node.localName === 'cr') return 'line';
  for (const attribute of node.attributes) {
    if (attribute.namespaceUri !== WML_NAMESPACE_URI || attribute.localName !== 'type') continue;
    switch (attribute.value) {
      case 'page':
        return 'page';
      case 'column':
        return 'column';
      case 'textWrapping':
        return 'line';
      default:
        return 'other';
    }
  }
  return 'line';
}

/** Whether a node is a `w:br` with `w:type="page"`. */
export function isPageBreakNode(node: OoxmlNode): node is OoxmlHardBreakNode {
  return node.kind === 'hardBreak' && hardBreakKind(node) === 'page';
}

/** Text projection for a `w:br` node — one UTF-16 code unit per break. */
export function hardBreakText(node: OoxmlHardBreakNode): string {
  return hardBreakKind(node) === 'page' ? PAGE_BREAK_CHAR : '\n';
}

/** Attributes for a newly authored `w:br`. */
export function hardBreakAttributes(kind: 'line' | 'page'): OoxmlHardBreakNode['attributes'] {
  if (kind === 'line') return [];
  return [
    {
      kind: 'genericExtension',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'type',
      prefix: 'w',
      value: 'page',
    },
  ];
}
