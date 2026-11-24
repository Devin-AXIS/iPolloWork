import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import { isLegacyVmlAtom } from '../store/package/legacy-vml-projection.ts';
import { isRunLevelMcAlternateContent } from '../store/package/drawing-projection.ts';
import { isInlineRunContainer, MAX_INLINE_CONTAINER_DEPTH } from '../store/package/ooxml-shared.ts';
import {
  contentControlContentChildren,
  isContentControl,
} from '../store/package/content-control-walk.ts';

/** Visit run content below the bounded inline-container surface of one paragraph. */
export function walkDrawingRunContent(
  paragraph: Exclude<OoxmlNode, { kind: 'textValue' }>,
  visitRunContent: (node: OoxmlNode) => void
): void {
  const visitInline = (child: OoxmlNode, depth: number): void => {
    if (depth >= MAX_INLINE_CONTAINER_DEPTH) return;
    if (child.kind === 'run') {
      for (const inner of child.children) visitRunContent(inner);
      return;
    }
    if (isInlineRunContainer(child)) {
      for (const inner of child.children) visitInline(inner, depth + 1);
      return;
    }
    if (isContentControl(child)) {
      for (const inner of contentControlContentChildren(child)) visitInline(inner, depth + 1);
    }
  };
  for (const child of paragraph.children) visitInline(child, 0);
}

const paragraphsWithoutDrawingAtoms = new WeakSet<OoxmlNode>();

/** Visit addressable drawing atoms with their transparent-container ancestry. */
export function walkDrawingAtoms(
  paragraph: Exclude<OoxmlNode, { kind: 'textValue' }>,
  visit: (node: OoxmlNode, containers: readonly OoxmlNode[], run: OoxmlNode) => void
): void {
  if (paragraphsWithoutDrawingAtoms.has(paragraph)) return;
  let found = false;
  const containers: OoxmlNode[] = [];
  const walk = (child: OoxmlNode, depth: number): void => {
    if (depth >= MAX_INLINE_CONTAINER_DEPTH) return;
    if (child.kind === 'run') {
      for (const inner of child.children) {
        if (
          inner.kind === 'drawing' ||
          isRunLevelMcAlternateContent(inner) ||
          isLegacyVmlAtom(inner)
        ) {
          found = true;
          visit(inner, containers, child);
        }
      }
      return;
    }
    if (isInlineRunContainer(child)) {
      containers.push(child);
      for (const inner of child.children) walk(inner, depth + 1);
      containers.pop();
      return;
    }
    if (!isContentControl(child)) return;
    containers.push(child);
    for (const inner of contentControlContentChildren(child)) walk(inner, depth + 1);
    containers.pop();
  };
  for (const child of paragraph.children) walk(child, 0);
  if (!found) paragraphsWithoutDrawingAtoms.add(paragraph);
}
