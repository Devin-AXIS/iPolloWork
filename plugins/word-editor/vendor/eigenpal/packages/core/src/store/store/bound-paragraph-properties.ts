// What a data binding lets change in the paragraphs a bound control holds.
//
// A bound control mirrors a custom XML node as TEXT. A paragraph's own properties (style,
// alignment, indents, spacing, keeps, numbering, tab stops, borders, shading, direction) are not part of
// that text, so a write that changes only them cannot put the control out of step with the part
// it mirrors. Neither can accepting or rejecting a recorded paragraph property change. The
// binding refuses neither; a content lock on the same control still applies its own rule.

import { WML_NAMESPACE_URI, type OoxmlNode } from '../package/ooxml-tree.ts';
import type { TreeDocOp } from './tree-op-types.ts';

/** The ops that write a paragraph's own properties and nothing else. */
const PARAGRAPH_PROPERTY_OPS: ReadonlySet<TreeDocOp['op']> = new Set<TreeDocOp['op']>([
  'setParagraphProperties',
  'setParagraphTabStops',
  'setParagraphBorders',
  'setListNumbering',
  'setListLevel',
]);

/** Whether an op writes only a paragraph's own properties, which a data binding lets change. */
export function writesOnlyParagraphProperties(op: TreeDocOp): boolean {
  return PARAGRAPH_PROPERTY_OPS.has(op.op);
}

/**
 * Whether a revision decision on this node changes only paragraph properties: a recorded
 * paragraph property change (`w:pPrChange`), which a data binding lets through either way.
 */
export function isParagraphPropertyChange(node: OoxmlNode): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === 'pPrChange'
  );
}
