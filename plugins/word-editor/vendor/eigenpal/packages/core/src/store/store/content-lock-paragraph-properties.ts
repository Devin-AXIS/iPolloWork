import { findNode, parentNodeOf } from '../package/ooxml-edit.ts';
import { WML_NAMESPACE_URI, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import { propertyContainer } from './direct-properties.ts';
import { equivalentNodes } from './ooxml-node-equality.ts';
import { mergedPropertyChildren, PARAGRAPH_VOCABULARY } from './tree-op-properties.ts';
import { recordedProperties } from './tree-op-tracked-properties.ts';
import type { TreeDocOp } from './tree-op-types.ts';

/**
 * Direct paragraph properties that a content lock (`contentLocked`, `sdtContentLocked`) lets
 * change. They place the paragraph around the locked text without changing the text, its
 * style, its list, or its character formatting: alignment, indents, spacing and line spacing,
 * the keep and page-break settings, widow control, outline level, and hyphenation.
 *
 * Paragraph style, numbering, the paragraph mark's run properties, direction, tab stops,
 * contextual spacing, borders, shading, and every other property stay locked.
 */
export const LOCK_FREE_PARAGRAPH_PROPERTIES: ReadonlySet<string> = new Set([
  'jc',
  'ind',
  'spacing',
  'keepNext',
  'keepLines',
  'pageBreakBefore',
  'widowControl',
  'outlineLvl',
  'suppressAutoHyphens',
]);

const named = (node: OoxmlNode, localName: string): boolean =>
  node.kind !== 'textValue' &&
  node.namespaceUri === WML_NAMESPACE_URI &&
  node.localName === localName;

const lockFree = (node: OoxmlNode): boolean =>
  node.kind !== 'textValue' &&
  node.namespaceUri === WML_NAMESPACE_URI &&
  LOCK_FREE_PARAGRAPH_PROPERTIES.has(node.localName);

/**
 * Whether a paragraph property write changes only properties a content lock lets change.
 * Uses the write's own merge: unchanged properties, including extensions, must survive verbatim.
 */
export function changesOnlyLockFreeParagraphProperties(part: OoxmlPart, op: TreeDocOp): boolean {
  if (op.op !== 'setParagraphProperties') return false;
  const paragraph = findNode(part, op.paragraphId);
  if (paragraph?.kind !== 'paragraph') return false;
  const container = propertyContainer(paragraph, 'paragraphProperties', 'pPr');
  const prior = container && container.kind !== 'textValue' ? container.children : [];
  // A tracked write merges into the pending paragraph change. When that change already records
  // a locked property, the merged revision could never be rejected inside the lock.
  if (op.revision) {
    const pending = prior.find((node) => named(node, 'pPrChange'));
    if (pending && !restoresOnlyLockFreeParagraphProperties(part, pending)) return false;
  }
  const next = mergedPropertyChildren(prior, op.properties, PARAGRAPH_VOCABULARY, () => '');
  const keep = (nodes: readonly OoxmlNode[]) => nodes.filter((node) => !lockFree(node));
  const before = keep(prior);
  const after = keep(next);
  // The canonical merge can put existing properties in schema order without changing them.
  const remaining = new Set(before);
  return (
    remaining.size === before.length &&
    before.length === after.length &&
    after.every((node) => remaining.delete(node))
  );
}

/**
 * Whether rejecting a recorded paragraph property change restores only properties a content
 * lock lets change, so the lock can let the rejection through.
 */
export function restoresOnlyLockFreeParagraphProperties(
  part: OoxmlPart,
  change: OoxmlNode
): boolean {
  if (!named(change, 'pPrChange')) return false;
  const container = parentNodeOf(part, change.id);
  if (!container || !named(container, 'pPr')) return false;
  const recorded = recordedProperties(change);
  if (!recorded) return false;
  const current = container.children.filter(
    (node) =>
      !named(node, 'pPrChange') && !named(node, 'rPr') && !named(node, 'sectPr') && !lockFree(node)
  );
  return equivalentNodes(
    current,
    recorded.filter((node) => !lockFree(node))
  );
}
