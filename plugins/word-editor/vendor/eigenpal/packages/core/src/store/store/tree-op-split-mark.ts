// What the new marks of a split take from the original paragraph mark.
//
// A split inserts new marks before the existing one, so the original mark stays after all of
// the paragraph's content, on the LAST piece. Two things in `w:pPr` belong to that mark and
// not to the paragraph's formatting: the section break (`w:sectPr`), and the revisions that
// record the mark itself in `w:pPr/w:rPr` (`w:ins`, `w:del`, `w:moveFrom`, `w:moveTo`).
// Copying a mark revision onto a new mark made the new mark part of someone else's proposal:
// accepting that author's deletion of the original mark also joined the paragraphs the split
// had just made, and the copies shared the original's `w:id`.

import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlNode } from '../package/ooxml-tree.ts';

const MARK_REVISIONS: ReadonlySet<string> = new Set(['ins', 'del', 'moveFrom', 'moveTo']);

const isWml = (node: OoxmlNode, localName: string): boolean =>
  node.kind !== 'textValue' &&
  node.namespaceUri === WML_NAMESPACE_URI &&
  node.localName === localName;

/**
 * A `w:pPr` for a mark the split adds: without `w:sectPr` and without the original mark's
 * revisions. Keeps identity when there is nothing to drop; `undefined` when nothing is left,
 * because an empty `w:pPr` serializes markup a paragraph that never had one does not.
 */
export function withoutOriginalMark(pPr: OoxmlNode): OoxmlNode | undefined {
  if (pPr.kind === 'textValue') return undefined;
  let changed = false;
  const children: OoxmlNode[] = [];
  for (const child of pPr.children) {
    if (isWml(child, 'sectPr')) {
      changed = true;
      continue;
    }
    if (isWml(child, 'rPr') && child.kind !== 'textValue') {
      const kept = child.children.filter(
        (entry) =>
          !(
            entry.kind !== 'textValue' &&
            entry.namespaceUri === WML_NAMESPACE_URI &&
            MARK_REVISIONS.has(entry.localName)
          )
      );
      if (kept.length !== child.children.length) {
        changed = true;
        if (kept.length > 0) children.push({ ...child, children: kept } as OoxmlNode);
        continue;
      }
    }
    children.push(child);
  }
  if (!changed) return pPr;
  if (children.length === 0) return undefined;
  return { ...pPr, children } as OoxmlNode;
}
