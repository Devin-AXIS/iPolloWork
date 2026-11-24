import { findNode, type ContentLockPolicy } from '../package/ooxml-edit.ts';
import { restylePassesContentLock } from './content-lock-policy.ts';
import type { OoxmlPart } from '../package/ooxml-tree.ts';
import { paragraphTextOf } from './tree-op-apply.ts';
import { deepParagraphOrderOfPart } from './review-paragraph-order.ts';
import { enforcesFormsProtection } from './forms-protection.ts';
import {
  contentControlBindingRefusal,
  contentControlLockRefusal,
  formsProtectionRefusal,
} from './tree-op-content-controls.ts';
import { textFormFieldForEdit } from './text-form-fields.ts';
import { protectedTextFormEditRefusal } from './tree-op-field-results.ts';
import type { TreeDocOp, TreeOpRejection } from './tree-op-types.ts';

interface Position {
  readonly paragraphId: string;
  readonly offset: number;
}
export interface FormsProtectionCommand {
  readonly selection: { readonly anchor: Position; readonly head: Position };
  readonly intent: 'text' | 'runFormat' | 'paragraph' | 'structure' | 'document';
  /** Absent means deletion. An empty string is also the clipboard toolbar's probe. */
  readonly text?: string;
  readonly fieldId?: string;
  /** The control that owns text inserted at a caret, as the keyboard names it. */
  readonly inside?: string;
  /** The host's lock policy, so restyling a content-locked control is answered as the commit. */
  readonly contentLockPolicy?: ContentLockPolicy | undefined;
  readonly paste?: boolean;
}

/** Ask the same per-op policy as commit, without publishing or changing field input state. */
export function formsProtectionCommandRefusal(
  part: OoxmlPart,
  settings: OoxmlPart | null | undefined,
  command: FormsProtectionCommand
): TreeOpRejection | null {
  if (!enforcesFormsProtection(settings)) return null;
  const refusal = (op: TreeDocOp, current = part) =>
    formsProtectionRefusal(current, settings, op, command.fieldId) ??
    (restylePassesContentLock(op, command.contentLockPolicy)
      ? null
      : contentControlLockRefusal(current, op)) ??
    contentControlBindingRefusal(current, op);
  if (command.intent === 'document') return 'locked';
  let { anchor: from, head: to } = command.selection;
  const order = deepParagraphOrderOfPart(part);
  const a = order.get(from.paragraphId),
    b = order.get(to.paragraphId);
  if (a === undefined || b === undefined) return 'locked';
  if (a > b || (a === b && from.offset > to.offset)) [from, to] = [to, from];
  const ids = [...order.keys()].slice(Math.min(a, b), Math.max(a, b) + 1);
  let fieldId = command.fieldId;
  for (const [index, paragraphId] of ids.entries()) {
    const start = index === 0 ? from.offset : 0;
    const end =
      index === ids.length - 1 ? to.offset : (paragraphTextOf(part, paragraphId) ?? '').length;
    if (command.intent === 'text') {
      if (start !== end) {
        const op: TreeDocOp = { op: 'deleteText', paragraphId, start, end };
        const blocked = refusal(op);
        if (blocked) return blocked;
        const field = textFormFieldForEdit(part, op, fieldId);
        if (field && ids.length === 1) fieldId = field.fieldNodeId;
      }
      if (index > 0) {
        const blocked = refusal({
          op: 'joinParagraphs',
          firstId: ids[index - 1]!,
          secondId: paragraphId,
        });
        if (blocked) return blocked;
      }
    } else {
      const op: TreeDocOp =
        command.intent === 'runFormat'
          ? { op: 'setRunProperties', paragraphId, start, end, properties: [] }
          : command.intent === 'paragraph'
            ? { op: 'setParagraphProperties', paragraphId, properties: [] }
            : { op: 'splitParagraph', paragraphId, offset: start };
      const blocked = refusal(op);
      if (blocked) return blocked;
      if (
        command.intent === 'runFormat' &&
        start === 0 &&
        end >= (paragraphTextOf(part, paragraphId) ?? '').length
      ) {
        const mark = refusal({ op: 'setParagraphMarkProperties', paragraphId, properties: [] });
        if (mark) return mark;
      }
    }
  }
  if (command.intent !== 'text') return null;
  // A collapsed delete still needs an editable location for toolbar state.
  if (
    command.text === undefined &&
    (from.paragraphId !== to.paragraphId || from.offset !== to.offset)
  )
    return null;
  let text = command.text || 'x';
  const op = {
    op: 'insertText' as const,
    paragraphId: from.paragraphId,
    offset: from.offset,
    text,
    ...(fieldId === undefined ? {} : { textFormFieldId: fieldId }),
    ...(command.inside === undefined ? {} : { inside: command.inside }),
  };
  const field = textFormFieldForEdit(part, op, fieldId);
  if (command.paste && field) {
    // The paste path clips to the field's capacity. Ask whether at least its first character
    // can land; the actual clipboard normalizer still owns the full value and truncation.
    text = [...text.replace(/[\r\n\t]/g, ' ')][0] ?? 'x';
    op.text = text;
  }
  if (!findNode(part, from.paragraphId)) return 'locked';
  // Admission must stay read-only, including while collaboration captures primitives.
  // Share the store's capacity check rather than speculatively applying a deletion.
  if (field)
    return protectedTextFormEditRefusal(
      part,
      op,
      field,
      from.paragraphId === to.paragraphId ? to.offset : undefined
    );
  return refusal(op);
}
