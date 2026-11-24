import { supportsTextFormField } from './text-form-field-options.ts';
import type { TextFormFieldOptions } from './text-form-field-options.ts';
import { findNode } from '../package/ooxml-edit.ts';
import type { OoxmlPart } from '../package/ooxml-tree.ts';
import type { TreeDocOp } from './tree-op-types.ts';
import {
  parsedFieldSpansOf,
  isFieldChrome,
  collectFieldRunChildren,
  type FieldRunChildRef,
} from '../package/field-nodes.ts';
import type { OoxmlNode, OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import { paragraphOffsetIndex } from './tree-op-segments.ts';

/** A legacy text input in the shared paragraph offset space. */
export interface TextFormFieldRange {
  readonly fieldNodeId: string;
  readonly start: number;
  readonly end: number;
  readonly enabled: boolean;
  readonly defaultText: string;
  readonly type: string;
  readonly maxLength: number;
  readonly format: string;
  readonly chromeIds: readonly string[];
}

function child(node: OoxmlNode, name: string): OoxmlNode | undefined {
  return node.kind === 'textValue'
    ? undefined
    : node.children.find(
        (n) =>
          n.kind !== 'textValue' && n.namespaceUri === node.namespaceUri && n.localName === name
      );
}
function value(node: OoxmlNode | undefined, name = 'val'): string | undefined {
  return !node || node.kind === 'textValue'
    ? undefined
    : node.attributes.find((a) => a.localName === name && a.namespaceUri === node.namespaceUri)
        ?.value;
}

/** Uses the field parser and offset index; never introduces another inline walk. */
export function textFormFieldsOf(paragraph: OoxmlParagraphNode): readonly TextFormFieldRange[] {
  const fields = parsedFieldSpansOf(paragraph).filter((f) => f.addressing === 'editable-result');
  if (!fields.length) return [];
  const offsets = paragraphOffsetIndex(paragraph);
  const entries: FieldRunChildRef[] = [];
  collectFieldRunChildren(paragraph, entries);
  const nodes = new Map(entries.map((entry) => [entry.node.id, entry.node]));
  const bookmarks: OoxmlNode[] = [];
  const pending: OoxmlNode[] = [...paragraph.children];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.kind === 'textValue' || !offsets.spanOf(node)) continue;
    if (node.kind === 'bookmarkStart' || node.kind === 'bookmarkEnd') bookmarks.push(node);
    else for (const nested of node.children) pending.push(nested);
  }
  return fields.flatMap((field) => {
    const begin = offsets.spanOf(field.node);
    const endId = field.removeNodeIds[field.removeNodeIds.length - 1];
    const end = endId ? offsets.spanOf(endId) : null;
    const data = child(field.node, 'ffData');
    if (!begin || !end || !data || !child(data, 'textInput')) return [];
    const enabled = child(data, 'enabled');
    const input = child(data, 'textInput')!;
    const rawMax = Number(value(child(input, 'maxLength')) ?? 0);
    const name = value(child(data, 'name'));
    const bookmarkStart = name
      ? bookmarks.find(
          (n) =>
            n.kind === 'bookmarkStart' &&
            value(n, 'name') === name &&
            offsets.spanOf(n)?.start === begin.start
        )
      : undefined;
    const bookmarkId = value(bookmarkStart, 'id');
    const bookmarkEnd = bookmarkId
      ? bookmarks.find(
          (n) =>
            n.kind === 'bookmarkEnd' &&
            value(n, 'id') === bookmarkId &&
            offsets.spanOf(n)?.end === end.end
        )
      : undefined;
    const bookmarkIds = bookmarkStart && bookmarkEnd ? [bookmarkStart.id, bookmarkEnd.id] : [];
    return [
      {
        fieldNodeId: field.node.id,
        start: begin.start,
        end: end.end,
        enabled: !enabled || !['0', 'false', 'off'].includes(value(enabled) ?? '1'),
        type: value(child(input, 'type')) ?? 'regular',
        maxLength: Number.isInteger(rawMax) && rawMax > 0 && rawMax <= 32767 ? rawMax : 0,
        format: value(child(input, 'format')) ?? '',
        defaultText:
          value(child(data, 'textInput') && child(child(data, 'textInput')!, 'default')) ?? '',
        chromeIds: [
          ...bookmarkIds,
          ...field.removeNodeIds.filter((id) => {
            const n = nodes.get(id);
            return n && isFieldChrome(n);
          }),
        ],
      },
    ];
  });
}

/** Locate a text-only filling edit. Other operations retain the normal protection policy. */
export function textFormFieldForEdit(
  part: OoxmlPart,
  op: TreeDocOp,
  preferredId?: string
): TextFormFieldRange | null {
  if ((op.op !== 'insertText' && op.op !== 'deleteText') || op.revision) return null;
  const paragraph = findNode(part, op.paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return null;
  const start = op.op === 'insertText' ? op.offset : op.start;
  const end = op.op === 'insertText' ? op.offset : op.end;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) return null;
  const candidates = textFormFieldsOf(paragraph).filter(
    (f) => f.enabled && supportsTextFormField(f) && start >= f.start && end <= f.end
  );
  if (op.textFormFieldId !== undefined)
    return candidates.find((f) => f.fieldNodeId === op.textFormFieldId) ?? null;
  return (
    candidates.find((f) => f.fieldNodeId === preferredId) ??
    candidates.find((f) => f.start === start && f.end === end) ??
    candidates[0] ??
    null
  );
}

/** Options edit for an existing legacy text form. */
export interface SetTextFormFieldDefaultOp {
  readonly op: 'setTextFormFieldDefault';
  /** Regional conventions for new date input; defaults to en-US. */
  readonly locale?: string;
  readonly paragraphId: string;
  readonly fieldNodeId: string;
  readonly text: string;
  readonly options?: TextFormFieldOptions;
}

/** Validate and format the existing result when a user finishes filling a field. */
export interface CommitTextFormFieldOp {
  readonly op: 'commitTextFormField';
  /** Regional conventions for new date input; defaults to en-US. */
  readonly locale?: string;
  readonly paragraphId: string;
  readonly fieldNodeId: string;
}
