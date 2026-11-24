// Legacy FORMDROPDOWN choices update both ffData and the cached result in one tree operation.
import type { OoxmlNode, OoxmlPart, OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import { legacyFormFieldDataOf, parsedFieldSpansOf } from '../package/field-nodes.ts';
import {
  createNodeIdAllocator,
  findNode,
  replaceChildren,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import { paragraphOffsetIndex } from './tree-op-segments.ts';
import {
  applyFieldResults,
  locateFieldResults,
  fieldResultUpdateRefusal,
  validateRefreshFieldResults,
} from './tree-op-field-results.ts';
import { ok } from './tree-op-nodes.ts';
import type { TreeOpRejection, TreeOpResult } from './tree-op-types.ts';

/** Select one declared entry of a legacy Word dropdown form field. */
export interface SetLegacyDropdownOp {
  readonly op: 'setLegacyDropdown';
  readonly paragraphId: string;
  readonly fieldNodeId: string;
  readonly selectedIndex: number;
}

export interface LegacyDropdownFieldRange {
  readonly fieldNodeId: string;
  readonly start: number;
  readonly end: number;
  readonly entries: readonly string[];
  readonly selectedIndex: number;
  readonly enabled: boolean;
}

function child(node: OoxmlNode | null | undefined, name: string): OoxmlNode | undefined {
  return node && node.kind !== 'textValue'
    ? node.children.find(
        (n) =>
          n.kind !== 'textValue' && n.namespaceUri === WML_NAMESPACE_URI && n.localName === name
      )
    : undefined;
}

export function legacyDropdownFieldsOf(
  paragraph: OoxmlParagraphNode
): readonly LegacyDropdownFieldRange[] {
  const offsets = paragraphOffsetIndex(paragraph);
  const ranges: LegacyDropdownFieldRange[] = [];
  const dropdownIds = new Set(
    locateFieldResults(paragraph, true)
      .filter((field) => field.instruction.trim().toUpperCase() === 'FORMDROPDOWN')
      .map((field) => field.fieldNodeId)
  );
  for (const field of parsedFieldSpansOf(paragraph)) {
    if (field.addressing !== 'atomic' || !dropdownIds.has(field.node.id)) continue;
    const data = legacyFormFieldDataOf(field.node);
    if (data?.kind !== 'dropdown') continue;
    const begin = offsets.spanOf(field.node);
    const endId = field.removeNodeIds.at(-1);
    const end = endId ? offsets.spanOf(endId) : null;
    if (!begin || !end) continue;
    const enabled = child(child(field.node, 'ffData'), 'enabled');
    const value =
      enabled && enabled.kind !== 'textValue'
        ? enabled.attributes.find(
            (a) =>
              a.localName === 'val' &&
              (a.namespaceUri === WML_NAMESPACE_URI || a.namespaceUri === '')
          )?.value
        : undefined;
    ranges.push({
      fieldNodeId: field.node.id,
      start: begin.start,
      end: end.end,
      entries: data.entries,
      selectedIndex: data.selectedIndex,
      enabled: !['0', 'false', 'off'].includes(value ?? ''),
    });
  }
  return ranges;
}

export function validateSetLegacyDropdown(
  part: OoxmlPart,
  op: SetLegacyDropdownOp
): TreeOpRejection | null {
  if (!Number.isInteger(op.selectedIndex) || op.selectedIndex < 0) return 'invalidArgs';
  const paragraph = findNode(part, op.paragraphId);
  if (paragraph?.kind !== 'paragraph') return 'unknown-paragraph';
  const field = legacyDropdownFieldsOf(paragraph).find((f) => f.fieldNodeId === op.fieldNodeId);
  if (!field || op.selectedIndex >= field.entries.length) return 'invalidArgs';
  // The bounded render reader can truncate long or malformed entries. Never persist its
  // preview as the field's real value or select an index shifted by a missing w:val.
  const list = child(child(findNode(part, op.fieldNodeId), 'ffData'), 'ddList');
  const entries =
    list && list.kind !== 'textValue'
      ? list.children
          .slice(0, 256)
          .filter(
            (n) =>
              n.kind !== 'textValue' &&
              n.namespaceUri === WML_NAMESPACE_URI &&
              n.localName === 'listEntry'
          )
      : [];
  const entry = entries[op.selectedIndex];
  const raw =
    entry && entry.kind !== 'textValue'
      ? entry.attributes.find(
          (a) =>
            a.localName === 'val' && (a.namespaceUri === WML_NAMESPACE_URI || a.namespaceUri === '')
        )?.value
      : undefined;
  if (raw !== field.entries[op.selectedIndex]) return 'unsupported';
  // A dropdown result is one line of text: a line break would leave a result the next
  // selection cannot rewrite.
  if (/[\r\n]/.test(raw)) return 'invalidArgs';
  if (!field.enabled) return 'locked';
  const refusal = fieldResultUpdateRefusal(part, op.paragraphId);
  if (refusal) return refusal;
  // Refuse non-text result structure; never update the index while leaving stale cached text.
  if (
    !locateFieldResults(paragraph, true).find((f) => f.fieldNodeId === op.fieldNodeId)?.rewritable
  )
    return 'unsupported';
  return validateRefreshFieldResults(part, {
    op: 'refreshFieldResults',
    updates: [
      {
        paragraphId: op.paragraphId,
        fieldNodeId: op.fieldNodeId,
        text: field.entries[op.selectedIndex]!,
      },
    ],
  });
}

export function applySetLegacyDropdown(
  part: OoxmlPart,
  op: SetLegacyDropdownOp,
  options?: EditOptions
): TreeOpResult {
  const refusal = validateSetLegacyDropdown(part, op);
  if (refusal) return { ok: false, reason: refusal };
  const paragraph = findNode(part, op.paragraphId) as OoxmlParagraphNode;
  const field = legacyDropdownFieldsOf(paragraph).find((f) => f.fieldNodeId === op.fieldNodeId)!;
  const result = applyFieldResults(
    part,
    {
      op: 'refreshFieldResults',
      updates: [
        {
          paragraphId: op.paragraphId,
          fieldNodeId: op.fieldNodeId,
          text: field.entries[op.selectedIndex]!,
        },
      ],
    },
    options,
    true
  );
  if (!result.ok) return result;
  const list = child(child(findNode(result.part, op.fieldNodeId), 'ffData'), 'ddList');
  if (!list || list.kind === 'textValue') return { ok: false, reason: 'invalidArgs' };
  const mint = createNodeIdAllocator(result.part);
  const state: OoxmlNode = {
    id: mint(),
    kind: 'generic',
    namespaceUri: WML_NAMESPACE_URI,
    prefix: 'w',
    localName: 'result',
    namespaceBindings: [],
    attributes: [
      {
        kind: 'genericExtension',
        namespaceUri: WML_NAMESPACE_URI,
        prefix: 'w',
        localName: 'val',
        value: String(op.selectedIndex),
      },
    ],
    children: [],
  } as OoxmlNode;
  const children = list.children.filter(
    (n) =>
      n.kind === 'textValue' || n.namespaceUri !== WML_NAMESPACE_URI || n.localName !== 'result'
  );
  // Schema order is result, default, then listEntry.
  const edited = replaceChildren(result.part, list.id, [state, ...children], options);
  if (!edited.ok) return { ok: false, reason: 'tree-invariant' };
  return ok(edited.part, {
    dirty: [op.paragraphId],
    created: [],
    deleted: [],
    dependencyKeys: [op.paragraphId],
    impact: 'text-local',
  });
}
