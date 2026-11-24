// Lossless property-container patching for table vocabulary (table-editing task 2).
//
// Table ops patch only named property leaves inside `w:tblPr`, `w:trPr`, `w:tcPr`, and
// `w:tblGrid`. Everything else in the container survives untouched, and replacements land
// in ECMA schema order so normalized serialization stays Word-readable.

import { type OoxmlElement, type OoxmlNode } from '../package/ooxml-tree.ts';
import {
  CT_TBLPR_SEQUENCE,
  CT_TCPR_SEQUENCE,
  CT_TRPR_SEQUENCE,
} from '../package/ooxml-property-order.ts';
import {
  WML_NAMESPACE_URI,
  expandedNameMatches,
  isWmlElement,
  isWmlGridCol,
} from './tree-op-table-shared.ts';

export { CT_TBLPR_SEQUENCE, CT_TCPR_SEQUENCE, CT_TRPR_SEQUENCE };

export type TablePropertyPatchRejection = 'wrong-expanded-name';

export type TablePropertyPatchResult =
  | { readonly ok: true; readonly container: OoxmlElement }
  | { readonly ok: false; readonly reason: TablePropertyPatchRejection };

export type TblGridColumnPatchRejection =
  'unknown-grid-column' | 'duplicate-grid-column' | 'wrong-expanded-name' | 'extension-collision';

export type TblGridColumnPatchResult =
  | { readonly ok: true; readonly grid: OoxmlElement }
  | { readonly ok: false; readonly reason: TblGridColumnPatchRejection };

function wmlRankOf(sequence: readonly string[], node: OoxmlNode): number {
  if (node.kind === 'textValue' || node.namespaceUri !== WML_NAMESPACE_URI) return sequence.length;
  const index = sequence.indexOf(node.localName);
  return index === -1 ? sequence.length : index;
}

function isWmlModelled(sequence: readonly string[], node: OoxmlNode): boolean {
  return wmlRankOf(sequence, node) !== sequence.length;
}

function inWmlSchemaOrder(
  children: readonly OoxmlNode[],
  sequence: readonly string[]
): OoxmlNode[] {
  const slots: number[] = [];
  const modelled: OoxmlNode[] = [];
  children.forEach((child, index) => {
    if (!isWmlModelled(sequence, child)) return;
    slots.push(index);
    modelled.push(child);
  });
  const result = [...children];
  if (modelled.length < 2) return result;
  const sorted = [...modelled].sort((a, b) => wmlRankOf(sequence, a) - wmlRankOf(sequence, b));
  slots.forEach((slot, index) => {
    result[slot] = sorted[index]!;
  });
  return result;
}

function childrenEqual(a: readonly OoxmlNode[], b: readonly OoxmlNode[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function patchReject(reason: TablePropertyPatchRejection): TablePropertyPatchResult {
  return { ok: false, reason };
}

function gridReject(reason: TblGridColumnPatchRejection): TblGridColumnPatchResult {
  return { ok: false, reason };
}

/**
 * Replace or remove one named WordprocessingML property leaf inside a container.
 *
 * Foreign-namespace children with the same local name are never matched, reordered, or
 * removed. Returns the original container when no semantic or ordering change is made.
 */
export function patchPropertyChild(
  container: OoxmlElement,
  property: OoxmlElement | null,
  order: readonly string[],
  propertyLocalName: string,
  namespaceUri: string = WML_NAMESPACE_URI
): TablePropertyPatchResult {
  if (property !== null && !expandedNameMatches(property, propertyLocalName, namespaceUri)) {
    return patchReject('wrong-expanded-name');
  }

  let replaced = false;
  const children: OoxmlNode[] = [];
  for (const child of container.children) {
    if (isWmlElement(child, propertyLocalName) && child.namespaceUri === namespaceUri) {
      if (property === null) {
        continue;
      }
      if (!replaced) {
        children.push(property);
        replaced = true;
      } else {
        children.push(child);
      }
      continue;
    }
    children.push(child);
  }

  if (property !== null && !replaced) {
    const rank = wmlRankOf(order, property);
    let insertAt = children.length;
    for (let index = 0; index < children.length; index += 1) {
      const childRank = wmlRankOf(order, children[index]!);
      if (childRank !== order.length && childRank > rank) {
        insertAt = index;
        break;
      }
    }
    children.splice(insertAt, 0, property);
  }

  const ordered = inWmlSchemaOrder(children, order);
  if (childrenEqual(container.children, ordered)) {
    return { ok: true, container };
  }

  return {
    ok: true,
    container: Object.freeze({ ...container, children: ordered }) as OoxmlElement,
  };
}

export function patchTblPrChild(
  container: OoxmlElement,
  property: OoxmlElement
): TablePropertyPatchResult {
  return patchPropertyChild(container, property, CT_TBLPR_SEQUENCE, property.localName);
}

export function removeTblPrChild(
  container: OoxmlElement,
  localName: string
): TablePropertyPatchResult {
  return patchPropertyChild(container, null, CT_TBLPR_SEQUENCE, localName);
}

export function patchTrPrChild(
  container: OoxmlElement,
  property: OoxmlElement
): TablePropertyPatchResult {
  return patchPropertyChild(container, property, CT_TRPR_SEQUENCE, property.localName);
}

export function removeTrPrChild(
  container: OoxmlElement,
  localName: string
): TablePropertyPatchResult {
  return patchPropertyChild(container, null, CT_TRPR_SEQUENCE, localName);
}

export function patchTcPrChild(
  container: OoxmlElement,
  property: OoxmlElement
): TablePropertyPatchResult {
  return patchPropertyChild(container, property, CT_TCPR_SEQUENCE, property.localName);
}

export function removeTcPrChild(
  container: OoxmlElement,
  localName: string
): TablePropertyPatchResult {
  return patchPropertyChild(container, null, CT_TCPR_SEQUENCE, localName);
}

function findWmlGridColMatches(grid: OoxmlElement, gridColumnId: string): OoxmlElement[] {
  const matches: OoxmlElement[] = [];
  for (const child of grid.children) {
    if (child.kind === 'textValue') continue;
    if (child.id !== gridColumnId) continue;
    if (isWmlGridCol(child)) matches.push(child);
  }
  return matches;
}

/** Replace or remove exactly one direct `w:gridCol` identified by node id. */
export function patchTblGridColumn(
  grid: OoxmlElement,
  gridColumnId: string,
  column: OoxmlElement | null
): TblGridColumnPatchResult {
  if (column !== null && !isWmlGridCol(column)) {
    return gridReject('wrong-expanded-name');
  }

  const wmlMatches = findWmlGridColMatches(grid, gridColumnId);
  const extensionCollision = grid.children.some(
    (child) => child.kind !== 'textValue' && child.id === gridColumnId && !isWmlGridCol(child)
  );

  if (extensionCollision) {
    return gridReject('extension-collision');
  }
  if (wmlMatches.length > 1) return gridReject('duplicate-grid-column');
  if (wmlMatches.length === 0) return gridReject('unknown-grid-column');

  const existing = wmlMatches[0]!;
  if (column === null) {
    const children = grid.children.filter((child) => child !== existing);
    if (children.length === grid.children.length) return { ok: true, grid };
    return {
      ok: true,
      grid: Object.freeze({ ...grid, children }) as OoxmlElement,
    };
  }

  if (column === existing) {
    const duplicateId = grid.children.some((child) => child !== existing && child.id === column.id);
    if (duplicateId) return gridReject('duplicate-grid-column');
    return { ok: true, grid };
  }

  const replacementIdTaken = grid.children.some(
    (child) => child !== existing && child.id === column.id
  );
  if (replacementIdTaken) return gridReject('duplicate-grid-column');

  const children = grid.children.map((child) => (child === existing ? column : child));
  return {
    ok: true,
    grid: Object.freeze({ ...grid, children }) as OoxmlElement,
  };
}

/** Append one validated `w:gridCol` to a grid container. */
export function insertTblGridColumn(
  grid: OoxmlElement,
  column: OoxmlElement
): TblGridColumnPatchResult {
  if (!isWmlGridCol(column)) return gridReject('wrong-expanded-name');
  const idTaken = grid.children.some((child) => child.id === column.id);
  if (idTaken) return gridReject('duplicate-grid-column');
  return {
    ok: true,
    grid: Object.freeze({ ...grid, children: [...grid.children, column] }) as OoxmlElement,
  };
}
