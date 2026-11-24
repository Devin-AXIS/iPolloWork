import {
  deepParagraphOrderOfPart,
  findNode,
  paragraphTextOf,
  textFormFieldsOf,
  validateTreeOp,
  type OoxmlPart,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import type { SemanticSelection } from '@docx-editor.dev/core/layout';
import { formatTextFormValue } from '../store/store/text-form-field-options.ts';

/** Validate all pending values before a save changes any field or history entry. */
export function planTextFormSave(
  parts: readonly OoxmlPart[],
  pending: ReadonlyMap<string, { text: string; locale: string }>,
  selection: SemanticSelection
): { ops: readonly TreeDocOp[]; selection: SemanticSelection } | { reason: string } {
  const ops: TreeDocOp[] = [];
  const changes: { paragraphId: string; start: number; end: number; length: number }[] = [];
  for (const part of parts) {
    for (const paragraphId of deepParagraphOrderOfPart(part).keys()) {
      const paragraph = findNode(part, paragraphId);
      if (paragraph?.kind !== 'paragraph') continue;
      for (const field of textFormFieldsOf(paragraph)) {
        const input = pending.get(field.fieldNodeId);
        if (!input) continue;
        const current = (paragraphTextOf(part, paragraphId) ?? '').slice(field.start, field.end);
        const formatted = formatTextFormValue(current, field, 'fill', input.locale);
        if (formatted === null) return { reason: 'invalidArgs' };
        if (formatted === current) continue;
        const op: TreeDocOp = {
          op: 'commitTextFormField',
          paragraphId,
          fieldNodeId: field.fieldNodeId,
          locale: input.locale,
        };
        const refusal = validateTreeOp(part, op);
        if (refusal) return { reason: refusal };
        ops.push(op);
        changes.push({ paragraphId, start: field.start, end: field.end, length: formatted.length });
      }
    }
  }
  const move = (point: SemanticSelection['head']): SemanticSelection['head'] => {
    let offset = point.offset;
    for (const change of changes) {
      if (change.paragraphId !== point.paragraphId || point.offset <= change.start) continue;
      offset +=
        point.offset >= change.end
          ? change.length - (change.end - change.start)
          : Math.min(point.offset - change.start, change.length) - (point.offset - change.start);
    }
    return offset === point.offset ? point : { ...point, offset };
  };
  return { ops, selection: { anchor: move(selection.anchor), head: move(selection.head) } };
}
