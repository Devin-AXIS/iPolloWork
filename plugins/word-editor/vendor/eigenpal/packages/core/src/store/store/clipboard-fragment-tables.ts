import {
  WML_NAMESPACE_URI,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlNode,
} from '../package/ooxml-tree.ts';
import { attributeValueOf } from './tree-op-nodes.ts';

export interface FragmentTableCoverage {
  readonly inRange: ReadonlySet<string>;
  readonly covered: ReadonlySet<string>;
}

function withChildren(node: OoxmlElement, children: readonly OoxmlNode[]): OoxmlElement {
  return { ...node, children } as OoxmlElement;
}

function isWmlElement(node: OoxmlNode, localName: string): boolean {
  return (
    node.kind !== 'textValue' &&
    node.localName === localName &&
    node.namespaceUri === WML_NAMESPACE_URI
  );
}

function paragraphIdsUnder(node: OoxmlNode, out: string[] = []): string[] {
  if (node.kind === 'textValue') return out;
  if (node.kind === 'paragraph') out.push(node.id);
  for (const child of node.children) paragraphIdsUnder(child, out);
  return out;
}

function findParagraph(node: OoxmlNode, id: string): OoxmlElement | null {
  if (node.kind === 'textValue') return null;
  if (node.kind === 'paragraph' && node.id === id) return node;
  for (const child of node.children) {
    const found = findParagraph(child, id);
    if (found) return found;
  }
  return null;
}

/** Restart continuations in the first extracted row, including wrapped cells. */
function withVMergeRestarts(row: OoxmlElement): OoxmlElement {
  const restarted = (node: OoxmlNode, insideCell: boolean): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    if (insideCell && isWmlElement(node, 'vMerge')) {
      if (attributeValueOf(node, 'val') === 'restart') return node;
      const attributes: OoxmlAttribute[] = [
        ...node.attributes.filter(
          (attribute) =>
            !(attribute.localName === 'val' && attribute.namespaceUri === WML_NAMESPACE_URI)
        ),
        {
          kind: 'wmlVal',
          namespaceUri: WML_NAMESPACE_URI,
          localName: 'val',
          prefix: 'w',
          value: 'restart',
        },
      ];
      return { ...node, attributes } as OoxmlNode;
    }
    // A generic customXml or SDT can wrap a cell. Nested tables have separate merges.
    if (node.kind === 'paragraph' || node.kind === 'table') return node;
    const nextInsideCell = insideCell || isWmlElement(node, 'tc');
    return withChildren(
      node,
      node.children.map((child) => restarted(child, nextInsideCell))
    );
  };
  return withChildren(
    row,
    row.children.map((child) => restarted(child, false))
  );
}

function tableRowsUnder(node: OoxmlNode, out: OoxmlElement[]): void {
  if (node.kind === 'textValue' || node.kind === 'table') return;
  if (isWmlElement(node, 'tr')) {
    out.push(node as OoxmlElement);
    return;
  }
  for (const child of node.children) tableRowsUnder(child, out);
}

function withCoveredTableRows(
  node: OoxmlNode,
  coveredRows: ReadonlySet<OoxmlElement>,
  first: { value: boolean }
): { readonly node: OoxmlNode | null; readonly hadRows: boolean; readonly keptRows: boolean } {
  if (node.kind === 'textValue' || node.kind === 'table') {
    return { node, hadRows: false, keptRows: false };
  }
  if (isWmlElement(node, 'tr')) {
    if (!coveredRows.has(node as OoxmlElement)) {
      return { node: null, hadRows: true, keptRows: false };
    }
    const kept = first.value ? withVMergeRestarts(node as OoxmlElement) : node;
    first.value = false;
    return { node: kept, hadRows: true, keptRows: true };
  }
  let hadRows = false;
  let keptRows = false;
  const children: OoxmlNode[] = [];
  for (const child of node.children) {
    const filtered = withCoveredTableRows(child, coveredRows, first);
    hadRows ||= filtered.hadRows;
    keptRows ||= filtered.keptRows;
    if (filtered.node !== null) children.push(filtered.node);
  }
  if (!hadRows) return { node, hadRows: false, keptRows: false };
  return {
    node: keptRows ? withChildren(node, children) : null,
    hadRows: true,
    keptRows,
  };
}

export function partialTableBlocks(
  table: OoxmlElement,
  coverage: FragmentTableCoverage,
  out: OoxmlNode[]
): void {
  const rows: OoxmlElement[] = [];
  for (const child of table.children) tableRowsUnder(child, rows);
  const touched = new Set(paragraphIdsUnder(table).filter((id) => coverage.inRange.has(id)));
  if (touched.size === 0) return;
  const coveredRows = rows.filter((row) => {
    const ids = paragraphIdsUnder(row);
    return ids.length > 0 && ids.every((id) => coverage.covered.has(id));
  });
  const coveredRowParagraphs = new Set(coveredRows.flatMap((row) => paragraphIdsUnder(row)));
  const rowAligned =
    coveredRows.length > 0 &&
    touched.size === coveredRowParagraphs.size &&
    [...touched].every((id) => coveredRowParagraphs.has(id));
  if (rowAligned) {
    const first = { value: true };
    const selectedRows = new Set(coveredRows);
    const kept: OoxmlNode[] = [];
    for (const child of table.children) {
      const filtered = withCoveredTableRows(child, selectedRows, first);
      if (filtered.node !== null) kept.push(filtered.node);
    }
    out.push(withChildren(table, kept));
    return;
  }
  // A partial row remains plain paragraphs because a fragment cannot ship half a cell.
  for (const id of paragraphIdsUnder(table)) {
    if (!coverage.inRange.has(id)) continue;
    const paragraph = findParagraph(table, id);
    if (paragraph) out.push(paragraph);
  }
}
