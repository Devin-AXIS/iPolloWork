import { readOnOffChild } from '../store/package/ooxml-shared.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-tree.ts';
import type { HeadlessDocumentView, OoxmlNode, OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createDocumentStyleDependencies,
  type DocumentStyleDependencies,
} from '../layout/document-style-deps.ts';
import { storyBlocks } from '../layout/story-roots.ts';
import { styleSeparatorMembersOf } from '../layout/style-separator-group.ts';
import { hiddenStyleSeparatorMark } from '../layout/style-separator-flow.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import { MAX_PART_SCAN_ELEMENTS } from '../store/package/drawing-projection.ts';
import { MAX_XML_DEPTH } from '../store/package/ooxml-drawing-rules.ts';
const dependencies = new WeakMap<HeadlessDocumentView, DocumentStyleDependencies>();
/** Report preserved hidden paragraph breaks outside the supported display subset. */
export function unsupportedStyleSeparator(view: HeadlessDocumentView, part: OoxmlPart): boolean {
  let deps = dependencies.get(view);
  if (!deps) {
    deps = createDocumentStyleDependencies(view);
    dependencies.set(view, deps);
  }
  const styles = deps.styleCascade();
  const supported = new Set<string>();
  if (part === view.part())
    for (const block of storyBlocks(part, undefined, undefined, styles, deps.numberingIndex()))
      for (const member of styleSeparatorMembersOf(block)?.slice(0, -1) ?? [])
        supported.add(member.paragraph.id);
  const directHiddenMark = (node: OoxmlNode): boolean => {
    if (node.kind === 'textValue') return false;
    const properties = node.children.find(
      (child) =>
        child.kind !== 'textValue' &&
        child.namespaceUri === WML_NAMESPACE_URI &&
        child.localName === 'pPr'
    );
    const mark =
      properties?.kind !== 'textValue'
        ? properties?.children.find(
            (child) =>
              child.kind !== 'textValue' &&
              child.namespaceUri === WML_NAMESPACE_URI &&
              child.localName === 'rPr'
          )
        : undefined;
    return mark !== undefined && readOnOffChild(mark, 'vanish');
  };
  let visited = 0;
  const walk = (node: OoxmlNode, depth: number): boolean => {
    if (++visited > MAX_PART_SCAN_ELEMENTS || depth > MAX_XML_DEPTH) return false;
    if (node.kind === 'textValue') return false;
    if (
      node.kind === 'paragraph' &&
      !supported.has(node.id) &&
      (hiddenStyleSeparatorMark(node, styles, false) || directHiddenMark(node)) &&
      paragraphOffsetIndex(node).length > 0
    )
      return true;
    for (const child of node.children) {
      if (visited >= MAX_PART_SCAN_ELEMENTS) break;
      if (walk(child, depth + 1)) return true;
    }
    return false;
  };
  return walk(part.root, 0);
}
