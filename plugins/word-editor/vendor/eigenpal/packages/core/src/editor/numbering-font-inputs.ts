import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import { createFontFamilyTreeCache, fontScanChildren } from '../layout/font-family-tree-cache.ts';

const ids = new WeakMap<OoxmlElement, string>();
let nextId = 0;
const scan = createFontFamilyTreeCache((node, context: { key: string }) => {
  if (node.kind === 'paragraphProperties') {
    let id = ids.get(node);
    if (!id) {
      id = String(++nextId);
      ids.set(node, id);
    }
    return { families: [id], children: [] };
  }
  return {
    families:
      node.kind === 'paragraph' &&
      !node.children.some((child) => child.kind === 'paragraphProperties')
        ? ['default-paragraph']
        : [],
    children: fontScanChildren(node, context),
  };
});

/** Marker faces depend on paragraph properties and global definitions, not text or counters. */
export function numberingFontInputs(roots: readonly OoxmlElement[]): readonly string[] {
  return scan(roots, { key: '' });
}
