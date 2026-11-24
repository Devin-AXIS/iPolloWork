// Where an insertion lands right after a complex field that ends its paragraph.
//
// Split out of `tree-op-segments.ts`, which is at its line cap; it resolves every other
// insertion site and calls in here.

import { isFldChar } from '../package/field-nodes.ts';
import type { OoxmlElement, OoxmlNode, OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import { inlineContainersOf } from './tree-op-nodes.ts';
import {
  fieldInsertionEndAt,
  paragraphOffsetIndex,
  type InsertionSite,
  type Segment,
} from './tree-op-segments.ts';
import { noteReferenceEndingAt } from './note-typing-boundary.ts';

/** Keep typing outside a completed field or note reference, including shared runs. */
export function insertionSiteAfterAtom(
  paragraph: OoxmlParagraphNode,
  offset: number,
  owner: OoxmlNode | null,
  bias: 'left' | 'right'
): InsertionSite | null {
  const endId =
    fieldInsertionEndAt(paragraph, offset) ??
    (bias === 'left' ? noteReferenceEndingAt(paragraph, offset)?.node.id : undefined);
  const run = endId ? directParentOf(paragraph, endId) : null;
  const holds = (node: OoxmlNode): boolean =>
    node.id === run?.id || (node.kind !== 'textValue' && node.children.some(holds));
  if (run?.kind !== 'run' || (owner !== null && !holds(owner))) return null;
  const offsets = paragraphOffsetIndex(paragraph);
  if (owner !== null || offsets.spanOf(run)?.end !== offset) {
    return {
      kind: 'atRunIndex',
      run,
      index: run.children.findIndex((node) => node.id === endId) + 1,
    };
  }
  const exited =
    inlineContainersOf(paragraph, run.id)
      .filter((node) => offsets.spanOf(node)?.end === offset)
      .at(-1) ?? run;
  const holder = directParentOf(paragraph, exited.id) ?? paragraph;
  let index = holder.children.findIndex((node) => node.id === exited.id) + 1;
  while (holder.children[index]?.kind === 'bookmarkEnd') index += 1;
  return { kind: 'newRun', holder, index };
}

/** Direct element parent of one descendant within a paragraph. */
export function directParentOf(parent: OoxmlElement, id: string): OoxmlElement | null {
  for (const child of parent.children) {
    if (child.id === id) return parent;
    if (child.kind === 'textValue') continue;
    const found = directParentOf(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * A new run after the `end` marker of a complex field that closes the paragraph's content.
 *
 * The field is one atom whose segment names its `begin` run, so the generic trailing rules
 * joined the paragraph's last run, which is the one holding `end`. Text written there sits in
 * the field's own closing run, and a field or picture written next to it breaks the field
 * shape every reader expects. The new run escapes wrappers that end with the field, such as
 * the insertion that proposed it, and stays before closing bookmarks.
 */
export function afterTrailingFieldEnd(
  paragraph: OoxmlParagraphNode,
  trailing: Segment,
  offset: number
): InsertionSite | null {
  if (!trailing.removeNodeIds) return null;
  const offsets = paragraphOffsetIndex(paragraph);
  for (let index = trailing.removeNodeIds.length - 1; index >= 0; index -= 1) {
    const id = trailing.removeNodeIds[index]!;
    const run = directParentOf(paragraph, id);
    if (run?.kind !== 'run') continue;
    if (!run.children.some((child) => child.id === id && isFldChar(child, 'end'))) continue;
    const exited =
      inlineContainersOf(paragraph, run.id)
        .filter((node) => offsets.spanOf(node)?.end === offset)
        .at(-1) ?? run;
    const holder = directParentOf(paragraph, exited.id) ?? paragraph;
    let at = holder.children.findIndex((node) => node.id === exited.id) + 1;
    while (holder.children[at]?.kind === 'bookmarkEnd') at += 1;
    return { kind: 'newRun', holder, index: at };
  }
  return null;
}
