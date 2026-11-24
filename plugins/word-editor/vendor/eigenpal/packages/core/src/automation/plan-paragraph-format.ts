// The store ops one `setParagraphFormat` writes.
//
// Split out of `plan.ts`, which is at its line cap. Pure: the planner keeps the batch rules
// (the story pin, the formatting claim) and asks this module only what the ops are.
//
// Paragraph properties and borders are two ops on the same `w:pPr`, because `w:pBdr` carries its
// meaning in children that a flat property write cannot author. They stay ONE automation
// operation, so a caller's assignments in one sync are one write and one formatting claim, and a
// tracked write records one paragraph property revision: the border op finds the record the
// property op left and keeps its original.

import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import { paragraphFormatProperties, type AutomationParagraphFormatWrite } from './formatting.ts';
import type { AutomationStyleIndex } from './styles.ts';

export type ParagraphFormatOps =
  | { readonly ok: true; readonly ops: readonly TreeDocOp[] }
  | { readonly ok: false; readonly detail: string };

/** The ops that author `request` on one paragraph. An empty list means nothing changes. */
export function paragraphFormatOps(
  part: OoxmlPart,
  paragraphId: string,
  request: AutomationParagraphFormatWrite,
  styles: AutomationStyleIndex
): ParagraphFormatOps {
  const planned = paragraphFormatProperties(part, paragraphId, request, styles);
  if (!planned.ok) return planned;
  const ops: TreeDocOp[] = [];
  if (!planned.unchanged)
    ops.push({ op: 'setParagraphProperties', paragraphId, properties: planned.value });
  if (planned.borders) ops.push({ op: 'setParagraphBorders', paragraphId, edges: planned.borders });
  return { ok: true, ops };
}
