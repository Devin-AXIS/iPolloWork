import { replaceNode } from './ooxml-edit.ts';
import { withPart, type OoxmlPackage } from './ooxml-package.ts';
import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';
import {
  isCanonicalPrimitiveCaptureActive,
  recordSetAttribute,
  recordSpliceChildren,
  runWithoutJournalCapture,
} from './canonical-primitive-capture.ts';

export interface CommentPartChanges {
  readonly removed: Set<string>;
  readonly replaced: Map<string, OoxmlElement>;
}

/** Rebuild each affected part once; journal only removed children and changed attributes. */
export function rewriteCommentBatch(
  pkg: OoxmlPackage,
  changes: ReadonlyMap<string, CommentPartChanges>
): OoxmlPackage | null {
  let next = pkg;
  const capture = isCanonicalPrimitiveCaptureActive();
  const effects: (() => void)[] = [];
  for (const [partName, change] of changes) {
    const part = next.parts.get(partName);
    if (!part) continue;
    const rewrite = (node: OoxmlNode): OoxmlNode | null => {
      if (change.removed.has(node.id)) return null;
      if (node.kind === 'textValue') return node;
      const replacement = change.replaced.get(node.id) ?? node;
      let children: OoxmlNode[] | undefined;
      for (let index = 0; index < node.children.length; index += 1) {
        const child = node.children[index]!;
        const result = rewrite(child);
        if (result !== child && children === undefined) children = node.children.slice(0, index);
        if (children !== undefined && result !== null) children.push(result);
      }
      if (capture) {
        // Descending positions remain valid as earlier removals shrink the same child list.
        // A whole-list diff can reinsert retained siblings; concurrent edits must keep them.
        for (let index = node.children.length - 1; index >= 0; index -= 1) {
          if (change.removed.has(node.children[index]!.id)) {
            effects.push(() => recordSpliceChildren(node.id, index, 1, []));
          }
        }
        for (let index = 0; index < replacement.attributes.length; index += 1) {
          const attribute = replacement.attributes[index]!;
          if (attribute === node.attributes[index]) continue;
          effects.push(() =>
            recordSetAttribute(
              node.id,
              {
                namespaceUri: attribute.namespaceUri,
                localName: attribute.localName,
                ...(attribute.prefix === undefined ? {} : { prefix: attribute.prefix }),
              },
              attribute.value
            )
          );
        }
      }
      return children !== undefined || replacement !== node
        ? (Object.freeze({
            ...replacement,
            children: children === undefined ? node.children : Object.freeze(children),
          }) as OoxmlElement)
        : node;
    };
    const root = rewrite(part.root);
    if (root === part.root) continue;
    if (root === null) return null;
    const result = runWithoutJournalCapture(() =>
      replaceNode(part, part.root.id, root, { deferValidation: true })
    );
    if (!result.ok) return null;
    next = withPart(next, result.part);
  }
  for (const effect of effects) effect();
  return next;
}
