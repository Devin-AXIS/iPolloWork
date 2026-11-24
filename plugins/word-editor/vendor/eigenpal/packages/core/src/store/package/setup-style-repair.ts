// Duplicate setup styles that concurrent participants each added.
//
// Two participants who both make the first link while apart each append the built-in style
// to the styles part. Both inserts survive the merge, so the part holds the style twice. Every
// participant removes the same copies: each style that is an exact copy (same content, any
// node ids) of an earlier style with the same id, in document order. That order is the same
// on every replica, so the removals agree and the first copy is never removed by anyone.
// Removing an exact copy changes nothing a reader resolves, so a copy the file already held
// may go too.

import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';
import { withPart, type OoxmlPackage } from './ooxml-package.ts';
import { stylesPartOf } from './ooxml-indexes.ts';
import { removeNode } from './ooxml-edit.ts';
import { attributeOf, markDocumentSetupEdit, styleElementsOf } from './style-definition-edit.ts';

/** A node's content without its node ids, for comparing two copies. */
function contentOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return JSON.stringify(node.value);
  const attributes = node.attributes
    .map((a) => `${a.namespaceUri ?? ''}|${a.localName}=${a.value}`)
    .sort()
    .join(',');
  return `<${node.namespaceUri ?? ''}|${node.localName} ${attributes}>${node.children
    .map(contentOf)
    .join('')}</>`;
}

/** Node ids of styles that exactly copy an earlier style with the same id. */
export function duplicateSetupStyleIds(pkg: OoxmlPackage): string[] {
  const root = stylesPartOf(pkg)?.root;
  if (!root) return [];
  const firstById = new Map<string, OoxmlElement>();
  const duplicates: string[] = [];
  for (const style of styleElementsOf(root)) {
    const styleId = attributeOf(style, 'styleId');
    if (!styleId) continue;
    const first = firstById.get(styleId);
    if (!first) firstById.set(styleId, style);
    else if (contentOf(first) === contentOf(style)) duplicates.push(style.id);
  }
  return duplicates;
}

/** A setup edit that removes duplicate setup styles, or null when there are none. */
export function duplicateSetupStylesEdit(
  pkg: OoxmlPackage
): ((pkg: OoxmlPackage) => OoxmlPackage) | null {
  if (duplicateSetupStyleIds(pkg).length === 0) return null;
  return markDocumentSetupEdit((current) => {
    let part = stylesPartOf(current);
    if (!part) return current;
    for (const nodeId of duplicateSetupStyleIds(current)) {
      const removed = removeNode(part, nodeId);
      if (!removed.ok) return current;
      part = removed.part;
    }
    return withPart(current, part);
  });
}
