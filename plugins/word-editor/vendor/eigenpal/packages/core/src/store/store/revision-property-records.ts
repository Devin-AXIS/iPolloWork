import type { OoxmlNode } from '../package/ooxml-tree.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-tree.ts';

/** Property snapshots are historical copies, never live revision subtrees. */
export const REVISION_PROPERTY_CONTAINERS: ReadonlyMap<string, string> = new Map([
  ['rPrChange', 'rPr'],
  ['pPrChange', 'pPr'],
  ['trPrChange', 'trPr'],
  ['tcPrChange', 'tcPr'],
  ['tblPrChange', 'tblPr'],
  ['tblPrExChange', 'tblPrEx'],
  ['tblGridChange', 'tblGrid'],
  ['sectPrChange', 'sectPr'],
]);

export function preservedRevisionProperty(wrapperName: string, child: OoxmlNode): boolean {
  if (child.kind === 'textValue' || child.namespaceUri !== WML_NAMESPACE_URI) return false;
  const name = child.localName;
  switch (wrapperName) {
    case 'pPrChange':
      return name === 'rPr' || name === 'sectPr';
    case 'rPrChange':
      return ['ins', 'del', 'moveFrom', 'moveTo'].includes(name);
    case 'trPrChange':
      return name === 'ins' || name === 'del';
    case 'tcPrChange':
      return name === 'cellIns' || name === 'cellDel' || name === 'cellMerge';
    case 'sectPrChange':
      return name === 'headerReference' || name === 'footerReference';
    default:
      return false;
  }
}

/** Reject ambiguous duplicate live records before choosing a historical state. */
export function validRevisionPropertyRecord(node: OoxmlNode, parent: OoxmlNode | null): boolean {
  if (node.kind === 'textValue' || !parent || parent.kind === 'textValue') return false;
  const container = REVISION_PROPERTY_CONTAINERS.get(node.localName);
  if (parent.namespaceUri !== WML_NAMESPACE_URI || parent.localName !== container) return false;
  const records = parent.children.filter(
    (child) =>
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === node.localName
  );
  if (records.length !== 1) return false;
  return (
    node.children.filter(
      (child) =>
        child.kind !== 'textValue' &&
        child.namespaceUri === WML_NAMESPACE_URI &&
        child.localName === container
    ).length <= 1
  );
}

/** Word restores the recorded section fields, retaining fields absent from the record. */
export function restoredSectionProperties(
  current: readonly OoxmlNode[],
  recorded: readonly OoxmlNode[]
): OoxmlNode[] {
  const key = (n: OoxmlNode) =>
    n.kind === 'textValue' ? n.id : `${n.namespaceUri}:${n.localName}`;
  const oldByKey = new Map(recorded.map((n) => [key(n), n]));
  const seen = new Set<string>();
  const restored = current.map((node) => {
    const name = key(node);
    seen.add(name);
    const old = oldByKey.get(name);
    if (!old) return node;
    if (node.kind === 'textValue' || old.kind === 'textValue') return old;
    const attrs = new Map(node.attributes.map((a) => [`${a.namespaceUri}:${a.localName}`, a]));
    for (const a of old.attributes) attrs.set(`${a.namespaceUri}:${a.localName}`, a);
    return { ...old, attributes: [...attrs.values()] } as typeof old;
  });
  return [...restored, ...recorded.filter((n) => !seen.has(key(n)))];
}

/** Numbering-reference history is metadata; Word retains numPr in either direction. */
export function validNumberingRevision(node: OoxmlNode, parent: OoxmlNode | null): boolean {
  const named = (n: OoxmlNode, name: string) =>
    n.kind !== 'textValue' && n.namespaceUri === WML_NAMESPACE_URI && n.localName === name;
  if (
    !parent ||
    parent.kind === 'textValue' ||
    !named(parent, 'numPr') ||
    node.kind === 'textValue' ||
    !named(node, 'ins') ||
    node.children.length !== 0
  )
    return false;
  if (parent.children.filter((n) => named(n, 'ins')).length !== 1) return false;
  const ids = parent.children.filter((n) => named(n, 'numId'));
  if (ids.length !== 1 || ids[0]!.kind === 'textValue') return false;
  const value = ids[0]!.attributes.find(
    (a) => a.namespaceUri === WML_NAMESPACE_URI && a.localName === 'val'
  )?.value;
  return /^\d+$/.test(value ?? '');
}
