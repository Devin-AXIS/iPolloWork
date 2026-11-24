import {
  findNode,
  parentNodeOf,
  replaceChildren,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import type { RevisionSite } from './tree-op-revisions.ts';

const isW = (node: OoxmlNode, name?: string): node is OoxmlElement =>
  node.kind !== 'textValue' &&
  node.namespaceUri === WML_NAMESPACE_URI &&
  (name === undefined || node.localName === name);

/** Whether two elements state the same property: name, attributes, and content, not ids. */
function sameProperty(a: OoxmlNode, b: OoxmlNode): boolean {
  if (a.kind === 'textValue' || b.kind === 'textValue')
    return a.kind === 'textValue' && b.kind === 'textValue' && a.value === b.value;
  if (a.namespaceUri !== b.namespaceUri || a.localName !== b.localName) return false;
  const attributes = (node: OoxmlElement) =>
    node.attributes.map((x) => `${x.namespaceUri ?? ''} ${x.localName}=${x.value}`).sort();
  const left = attributes(a);
  const right = attributes(b);
  if (left.length !== right.length || left.some((value, i) => value !== right[i])) return false;
  const content = (node: OoxmlElement) =>
    node.children.filter((child) => child.kind !== 'textValue' || child.value.trim() !== '');
  const leftChildren = content(a);
  const rightChildren = content(b);
  return (
    leftChildren.length === rightChildren.length &&
    leftChildren.every((child, i) => sameProperty(child, rightChildren[i]!))
  );
}

/** The table row that holds a node. */
function rowOf(part: OoxmlPart, id: string): OoxmlElement | undefined {
  for (let node = parentNodeOf(part, id); node; node = parentNodeOf(part, node.id))
    if (node.kind === 'tableRow') return node;
  return undefined;
}

/** The table that holds a row, through any wrapper around the row. */
function tableOf(part: OoxmlPart, id: string): OoxmlElement | undefined {
  for (let node = parentNodeOf(part, id); node; node = parentNodeOf(part, node.id))
    if (node.kind === 'table') return node;
  return undefined;
}

/**
 * A decided row exception change keeps only what differs from the table's own properties.
 *
 * Accepting or rejecting a `w:tblPrExChange` leaves the row exception it settled. A property
 * that states the table's own value overrides nothing, so it goes, and an exception left with
 * nothing goes too. An exception that still holds a pending change is left as it is.
 */
export function trimDecidedExceptions(
  before: OoxmlPart,
  sites: readonly RevisionSite[],
  after: OoxmlPart,
  options?: EditOptions
): OoxmlPart | null {
  const rows = new Set<string>();
  for (const site of sites)
    if (site.node.localName === 'tblPrExChange') {
      const row = rowOf(before, site.node.id);
      if (row) rows.add(row.id);
    }
  let part = after;
  for (const id of rows) {
    const row = findNode(part, id);
    if (!row || row.kind === 'textValue') continue;
    const exception = row.children.find((child) => isW(child, 'tblPrEx'));
    const properties = tableOf(part, id)?.children.find((child) => isW(child, 'tblPr'));
    if (
      !exception ||
      exception.kind === 'textValue' ||
      !properties ||
      properties.kind === 'textValue'
    )
      continue;
    if (exception.children.some((child) => isW(child, 'tblPrExChange'))) continue;
    const kept = exception.children.filter(
      (child) =>
        !isW(child) ||
        !properties.children.some((own) => isW(own, child.localName) && sameProperty(own, child))
    );
    if (kept.length === exception.children.length) continue;
    const result = kept.some((child) => child.kind !== 'textValue')
      ? replaceChildren(part, exception.id, kept, options)
      : replaceChildren(
          part,
          row.id,
          row.children.filter((child) => child !== exception),
          options
        );
    if (!result.ok) return null;
    part = result.part;
  }
  return part;
}
