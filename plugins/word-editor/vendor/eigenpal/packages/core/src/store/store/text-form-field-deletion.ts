import { removeNode, type EditOptions } from '../package/ooxml-edit.ts';
import type { OoxmlPart, OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import { textFormFieldsOf } from './text-form-fields.ts';
import { effectiveContentLockAt, isBoundAt, ok } from './tree-op-nodes.ts';
import type { TreeOpRejection, TreeOpResult } from './tree-op-types.ts';

/** Validate every definition node that a whole-result deletion will remove. */
export function coveredTextFormDefinitionRefusal(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  start: number,
  end: number
): TreeOpRejection | null {
  if (start >= end) return null;
  for (const field of textFormFieldsOf(paragraph)) {
    if (field.start < start || field.end > end || field.start === field.end) continue;
    for (const id of field.chromeIds) {
      if (isBoundAt(part, id)) return 'bound';
      if (effectiveContentLockAt(part, id).content) return 'locked';
    }
  }
  return null;
}

/** Whole-result replacement removes the definition; partial edits preserve it. */
export function removeCoveredTextFormDefinitions(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  start: number,
  end: number,
  options?: EditOptions
): TreeOpResult {
  const refusal = coveredTextFormDefinitionRefusal(part, paragraph, start, end);
  if (refusal) return { ok: false, reason: refusal };
  let current = part;
  if (start < end)
    for (const field of textFormFieldsOf(paragraph)) {
      if (field.start < start || field.end > end || field.start === field.end) continue;
      for (const id of field.chromeIds) {
        const removed = removeNode(current, id, options);
        if (!removed.ok) return { ok: false, reason: 'tree-invariant' };
        current = removed.part;
      }
    }
  return ok(current, {
    dirty: [paragraph.id],
    created: [],
    deleted: [],
    dependencyKeys: [],
    impact: 'text-local',
  });
}
