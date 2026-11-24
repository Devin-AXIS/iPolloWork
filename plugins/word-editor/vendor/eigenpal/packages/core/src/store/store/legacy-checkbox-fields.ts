// Legacy FORMCHECKBOX form fields (§17.16.5.22) as togglable ranges, and the one op that
// flips them.
//
// A checkbox is an ATOMIC field: one reserved model unit whose painted glyph comes from the
// `w:checked` / `w:default` state under `w:fldChar/w:ffData/w:checkBox`, never from a cached
// result. Toggling therefore rewrites only that state element — the instruction, the
// bookmark, the result phase and every macro reference stay exactly as the file had them.

import type { OoxmlNode, OoxmlPart, OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import { legacyFormFieldDataOf, parsedFieldSpansOf } from '../package/field-nodes.ts';
import { createNodeIdAllocator, findNode, replaceChildren } from '../package/ooxml-edit.ts';
import type { EditOptions } from '../package/ooxml-edit.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import { paragraphOffsetIndex } from './tree-op-segments.ts';
import { effectiveContentLockAt, isBoundAt, ok } from './tree-op-nodes.ts';
import type { TreeOpRejection, TreeOpResult } from './tree-op-types.ts';

/** One FORMCHECKBOX in the shared paragraph offset space. */
export interface LegacyCheckboxFieldRange {
  /** The begin `w:fldChar` node: what the op addresses. */
  readonly fieldNodeId: string;
  readonly start: number;
  readonly end: number;
  readonly checked: boolean;
  /** `w:enabled` under `w:ffData`; a disabled field renders but refuses the toggle. */
  readonly enabled: boolean;
}

/** Flip a FORMCHECKBOX's state; the only write into `w:ffData` a checkbox permits. */
export interface SetLegacyCheckboxOp {
  readonly op: 'setLegacyCheckbox';
  readonly paragraphId: string;
  readonly fieldNodeId: string;
  readonly checked: boolean;
}

function wmlChild(node: OoxmlNode, localName: string): OoxmlNode | undefined {
  return node.kind === 'textValue'
    ? undefined
    : node.children.find(
        (child) =>
          child.kind !== 'textValue' &&
          child.namespaceUri === WML_NAMESPACE_URI &&
          child.localName === localName
      );
}

function onOff(node: OoxmlNode | undefined, absent: boolean): boolean {
  if (!node || node.kind === 'textValue') return absent;
  const raw = node.attributes.find(
    (attribute) =>
      attribute.localName === 'val' &&
      (attribute.namespaceUri === WML_NAMESPACE_URI || attribute.namespaceUri === '')
  )?.value;
  if (raw === undefined) return true;
  return !(raw === '0' || raw === 'false' || raw === 'off');
}

/** Every FORMCHECKBOX in a paragraph, in document order; uses the shared field parser. */
export function legacyCheckboxFieldsOf(
  paragraph: OoxmlParagraphNode
): readonly LegacyCheckboxFieldRange[] {
  const fields = parsedFieldSpansOf(paragraph).filter((field) => field.addressing === 'atomic');
  if (fields.length === 0) return [];
  const offsets = paragraphOffsetIndex(paragraph);
  const ranges: LegacyCheckboxFieldRange[] = [];
  for (const field of fields) {
    const data = legacyFormFieldDataOf(field.node);
    if (data?.kind !== 'checkbox') continue;
    const begin = offsets.spanOf(field.node);
    const endId = field.removeNodeIds[field.removeNodeIds.length - 1];
    const end = endId ? offsets.spanOf(endId) : null;
    if (!begin || !end) continue;
    const ffData = wmlChild(field.node, 'ffData');
    ranges.push({
      fieldNodeId: field.node.id,
      start: begin.start,
      end: end.end,
      checked: data.checked,
      enabled: onOff(ffData ? wmlChild(ffData, 'enabled') : undefined, true),
    });
  }
  return ranges;
}

function locate(
  part: OoxmlPart,
  op: SetLegacyCheckboxOp
): { readonly field: LegacyCheckboxFieldRange } | TreeOpRejection {
  if (typeof op.checked !== 'boolean') return 'invalidArgs';
  const paragraph = findNode(part, op.paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return 'unknown-paragraph';
  const field = legacyCheckboxFieldsOf(paragraph).find((f) => f.fieldNodeId === op.fieldNodeId);
  if (!field) return 'invalidArgs';
  // A disabled field is Word's "this box is not yours to tick"; the lock and binding checks
  // are the same ones every field-result write answers to.
  if (!field.enabled) return 'locked';
  if (isBoundAt(part, op.paragraphId)) return 'bound';
  if (effectiveContentLockAt(part, op.paragraphId).content) return 'locked';
  return { field };
}

export function validateSetLegacyCheckbox(
  part: OoxmlPart,
  op: SetLegacyCheckboxOp
): TreeOpRejection | null {
  const located = locate(part, op);
  return typeof located === 'string' ? located : null;
}

/**
 * Rewrite `w:checked` under the field's `w:checkBox`.
 *
 * The reader takes the FIRST `w:checked` it meets, so every existing one goes and a single
 * fresh element lands last, after `w:size` / `w:sizeAuto` / `w:default`, which is where the
 * schema orders it. Everything else under `w:checkBox` — and under `w:ffData` — is untouched.
 */
export function applySetLegacyCheckbox(
  part: OoxmlPart,
  op: SetLegacyCheckboxOp,
  options?: EditOptions
): TreeOpResult {
  const located = locate(part, op);
  if (typeof located === 'string') return { ok: false, reason: located };
  const begin = findNode(part, op.fieldNodeId);
  const ffData = begin ? wmlChild(begin, 'ffData') : undefined;
  const checkBox = ffData ? wmlChild(ffData, 'checkBox') : undefined;
  if (!checkBox || checkBox.kind === 'textValue') return { ok: false, reason: 'invalidArgs' };
  const mint = createNodeIdAllocator(part);
  const checked: OoxmlNode = {
    id: mint(),
    kind: 'generic',
    namespaceUri: WML_NAMESPACE_URI,
    prefix: 'w',
    localName: 'checked',
    namespaceBindings: [],
    attributes: [
      {
        kind: 'genericExtension',
        namespaceUri: WML_NAMESPACE_URI,
        prefix: 'w',
        localName: 'val',
        value: op.checked ? '1' : '0',
      },
    ],
    children: [],
  } as OoxmlNode;
  const children = [
    ...checkBox.children.filter(
      (child) =>
        child.kind === 'textValue' ||
        child.namespaceUri !== WML_NAMESPACE_URI ||
        child.localName !== 'checked'
    ),
    checked,
  ];
  const edited = replaceChildren(part, checkBox.id, children, options);
  if (!edited.ok) return { ok: false, reason: 'tree-invariant' };
  return ok(edited.part, {
    dirty: [op.paragraphId],
    created: [],
    deleted: [],
    dependencyKeys: [op.paragraphId],
    impact: 'text-local',
  });
}
