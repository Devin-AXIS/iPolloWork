// Repeated picks and concurrent actors must not duplicate nested controls' serialized ids.
import {
  MAX_DECIMAL_ID,
  resolveAllocationActor,
  stripedDecimalIdSequence,
} from '../package/actor-scoped-ids.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { mintParaId, mintedParagraphIdentityAttributes, usedParaIds } from '../package/para-id.ts';
import { W14_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';

export function mintBuildingBlockIdentities(
  part: OoxmlPart
): (node: OoxmlNode) => OoxmlNode | null {
  const used = new Set<string>();
  const paragraphs = new Set(usedParaIds(part.root));
  const scan = (node: OoxmlNode, parent = ''): void => {
    if (node.kind === 'textValue') return;
    if (parent === 'sdtPr' && node.localName === 'id' && node.namespaceUri === WML_NAMESPACE_URI) {
      const raw = node.attributes.find((a) => a.localName === 'val')?.value;
      if (raw !== undefined) {
        used.add(raw);
        if (/^-?\d{1,10}$/.test(raw)) used.add(String(Number(raw)));
      }
    }
    for (const child of node.children) scan(child, node.localName);
  };
  scan(part.root);
  const actor = resolveAllocationActor();
  const striped = actor ? stripedDecimalIdSequence(used, actor, MAX_DECIMAL_ID) : null;
  const paragraphSequence = actor
    ? stripedDecimalIdSequence(
        new Set(['0', ...[...paragraphs].map((id) => String(parseInt(id, 16)))]),
        actor,
        MAX_DECIMAL_ID
      )
    : null;
  let next = 1;
  let exhausted = false;
  const mint = (): string => {
    if (striped) {
      const id = striped();
      if (id === null) exhausted = true;
      return id ?? '0';
    }
    while (used.has(String(next))) next++;
    const id = String(next++);
    used.add(id);
    return id;
  };
  const rewrite = (node: OoxmlNode, parent = ''): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    let attributes =
      parent === 'sdtPr' && node.localName === 'id' && node.namespaceUri === WML_NAMESPACE_URI
        ? node.attributes.map((a) =>
            a.localName === 'val' && a.namespaceUri === WML_NAMESPACE_URI
              ? { ...a, value: mint() }
              : a
          )
        : node.attributes;
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'p') {
      const decimal = paragraphSequence?.();
      if (decimal === null) exhausted = true;
      const paraId = decimal
        ? Number(decimal).toString(16).toUpperCase().padStart(8, '0')
        : mintParaId(node.id, paragraphs);
      paragraphs.add(paraId);
      attributes = [
        ...attributes.filter(
          (a) =>
            !(
              a.namespaceUri === W14_NAMESPACE_URI &&
              (a.localName === 'paraId' || a.localName === 'textId')
            )
        ),
        ...mintedParagraphIdentityAttributes('w14', paraId),
      ];
    }
    return {
      ...node,
      attributes,
      children: node.children.map((child) => rewrite(child, node.localName)),
    } as OoxmlNode;
  };
  return (node) => {
    const rewritten = rewrite(node);
    return exhausted ? null : rewritten;
  };
}
