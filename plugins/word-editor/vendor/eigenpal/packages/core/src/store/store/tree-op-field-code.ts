// Rewrite allowlisted field instructions without replacing field identity or cached result runs.
import {
  collectFieldRunChildren,
  fieldOnOffAttribute,
  isFldChar,
  isFldSimpleNode,
  isInstrTextNode,
  type FieldRunChildRef,
} from '../package/field-nodes.ts';
import { findNode, replaceNode, type EditOptions } from '../package/ooxml-edit.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { locateFieldResults, fieldResultUpdateRefusal } from './tree-op-field-results.ts';
import { ok, TEXT_DEPS } from './tree-op-nodes.ts';
import type { TreeOpRejection, TreeOpResult } from './tree-op-types.ts';

export interface SetFieldCodeOp {
  readonly op: 'setFieldCode';
  readonly paragraphId: string;
  readonly fieldNodeId: string;
  readonly code: string;
}
/** No switches or arguments execute through the field authoring lane. */
export function supportedPageFieldCode(code: string): 'PAGE' | 'NUMPAGES' | null {
  if (typeof code !== 'string') return null;
  const normalized = code.trim().toUpperCase();
  return normalized === 'PAGE' || normalized === 'NUMPAGES' ? normalized : null;
}
function instructionNodes(
  part: OoxmlPart,
  paragraphId: string,
  fieldNodeId: string
): readonly OoxmlNode[] | null {
  const field = findNode(part, fieldNodeId);
  const paragraph = findNode(part, paragraphId);
  if (!field || !paragraph || paragraph.kind !== 'paragraph') return null;
  if (isFldSimpleNode(field)) return [field];
  const refs: FieldRunChildRef[] = [];
  if (!collectFieldRunChildren(paragraph, refs, { left: 100000 })) return null;
  const start = refs.findIndex((ref) => ref.node.id === fieldNodeId);
  if (start < 0) return null;
  const nodes: OoxmlNode[] = [];
  for (let i = start + 1; i < refs.length; i++) {
    const node = refs[i]!.node;
    if (isFldChar(node, 'separate')) return nodes.length ? nodes : null;
    if (isFldChar(node, 'begin') || isFldChar(node, 'end')) return null;
    if (isInstrTextNode(node)) nodes.push(node);
  }
  return null;
}
export function validateSetFieldCode(part: OoxmlPart, op: SetFieldCodeOp): TreeOpRejection | null {
  if (!supportedPageFieldCode(op.code)) return 'invalidArgs';
  const paragraph = findNode(part, op.paragraphId);
  const anchor = findNode(part, op.fieldNodeId);
  if (!paragraph || paragraph.kind !== 'paragraph' || !anchor) return 'unknown-paragraph';
  if (fieldOnOffAttribute(anchor, 'fldLock') === true) return 'invalidArgs';
  const located = locateFieldResults(paragraph).find(
    (field) => field.fieldNodeId === op.fieldNodeId
  );
  if (
    !located ||
    !located.rewritable ||
    !supportedPageFieldCode(located.instruction) ||
    !instructionNodes(part, op.paragraphId, op.fieldNodeId)
  )
    return 'invalidArgs';
  return fieldResultUpdateRefusal(part, op.paragraphId);
}
export function applySetFieldCode(
  part: OoxmlPart,
  op: SetFieldCodeOp,
  options?: EditOptions
): TreeOpResult {
  const refusal = validateSetFieldCode(part, op);
  if (refusal) return { ok: false, reason: refusal };
  const nodes = instructionNodes(part, op.paragraphId, op.fieldNodeId)!;
  let current = part;
  const code = supportedPageFieldCode(op.code)!;
  let wrote = false;
  for (const node of nodes) {
    if (node.kind === 'textValue') continue;
    let updated: OoxmlNode;
    if (isFldSimpleNode(node)) {
      updated = {
        ...node,
        attributes: node.attributes.map((attribute) =>
          attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'instr'
            ? { ...attribute, value: code }
            : attribute
        ),
      };
    } else {
      updated = {
        ...node,
        children: node.children.map((child) => {
          if (child.kind !== 'textValue') return child;
          const value = wrote ? '' : ` ${code} `;
          wrote = true;
          return { ...child, value };
        }),
      } as OoxmlNode;
    }
    const replaced = replaceNode(current, node.id, updated, options);
    if (!replaced.ok) return { ok: false, reason: 'tree-invariant' };
    current = replaced.part;
  }
  return ok(current, {
    dirty: [op.paragraphId],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'text-local',
  });
}
