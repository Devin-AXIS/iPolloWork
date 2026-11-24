import { parentNodeOf } from '../package/ooxml-edit.ts';
import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlPart } from '../package/ooxml-tree.ts';
import {
  registerRevisionSiteNodeIds,
  revisionSiteNodeIdsOf,
  type ReviewRevisionItem,
} from './review-items.ts';
import { tableChildren } from './revision-table-children.ts';
import type { RevisionSite } from './tree-op-revisions.ts';

const CELL_MARKERS: ReadonlySet<string> = new Set(['cellIns', 'cellDel']);

const attribute = (node: OoxmlElement | undefined, name: string) =>
  node?.attributes.find((a) => a.namespaceUri === WML_NAMESPACE_URI && a.localName === name)?.value;
function property(node: OoxmlElement | undefined, name: string): OoxmlElement | undefined {
  for (const child of node?.children ?? [])
    if (
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === name
    )
      return child;
  return undefined;
}

function ancestor(part: OoxmlPart, id: string, kind: string): OoxmlElement | undefined {
  for (let node = parentNodeOf(part, id); node; node = parentNodeOf(part, node.id))
    if (node.kind === kind) return node;
  return undefined;
}

/** Where a cell sits: its table, its row's place in the table, and its grid columns. */
interface CellPlace {
  readonly key: string;
  readonly row: number;
}

function cellPlace(part: OoxmlPart, site: RevisionSite): CellPlace | undefined {
  const cell = ancestor(part, site.node.id, 'tableCell');
  const row = cell && ancestor(part, cell.id, 'tableRow');
  const table = row && ancestor(part, row.id, 'table');
  if (!cell || !row || !table) return undefined;
  const span = (node: OoxmlElement) =>
    Number(attribute(property(property(node, 'tcPr'), 'gridSpan'), 'val') ?? 1) || 1;
  let column = Number(attribute(property(property(row, 'trPr'), 'gridBefore'), 'val') ?? 0) || 0;
  for (const other of tableChildren(row, 'tableCell')) {
    if (other.id === cell.id) break;
    column += span(other);
  }
  const author = attribute(site.node, 'author') ?? '';
  return {
    // NUL-separated: XML text cannot carry U+0000, so an author name cannot forge a boundary.
    key: [table.id, site.node.localName, column, span(cell), author].join('\u0000'),
    row: tableChildren(table, 'tableRow').findIndex((other) => other.id === row.id),
  };
}

/**
 * Inserted or deleted cells in one grid column of adjacent rows are one change, by one author
 * whatever their dates, as a column inserted or deleted in one edit is. Cells side by side in
 * one row stay separate changes.
 */
export function groupCellColumns(
  part: OoxmlPart,
  items: readonly ReviewRevisionItem[],
  sites: readonly RevisionSite[]
): ReviewRevisionItem[] {
  const markers = new Map<string, RevisionSite>();
  for (const site of sites)
    if (!site.refused && CELL_MARKERS.has(site.node.localName) && site.parent?.localName === 'tcPr')
      markers.set(site.node.id, site);
  if (markers.size < 2) return [...items];
  // A whole inserted or deleted row is its own change, cells and all.
  const rowMarkers = new Set(
    sites.filter((site) => site.parent?.localName === 'trPr').map((site) => site.node.id)
  );
  const places = new Map<ReviewRevisionItem, CellPlace>();
  for (const item of items) {
    const ids = revisionSiteNodeIdsOf(item);
    const own = ids.filter((id) => markers.has(id));
    if (own.length !== 1 || item.readOnly || ids.some((id) => rowMarkers.has(id))) continue;
    const place = cellPlace(part, markers.get(own[0]!)!);
    if (place) places.set(item, place);
  }
  const columns = new Map<string, ReviewRevisionItem[]>();
  for (const [item, place] of places) {
    const column = columns.get(place.key);
    if (column) column.push(item);
    else columns.set(place.key, [item]);
  }
  const replaced = new Map<ReviewRevisionItem, ReviewRevisionItem>();
  const consumed = new Set<ReviewRevisionItem>();
  for (const column of columns.values()) {
    if (column.length < 2) continue;
    column.sort((a, b) => places.get(a)!.row - places.get(b)!.row);
    let run: ReviewRevisionItem[] = [];
    const close = () => {
      if (run.length > 1) {
        const [primary, ...rest] = run;
        replaced.set(primary!, merged(primary!, rest));
        for (const item of rest) consumed.add(item);
      }
      run = [];
    };
    for (const item of column) {
      const last = run.at(-1);
      if (last && places.get(item)!.row !== places.get(last)!.row + 1) close();
      run.push(item);
    }
    close();
  }
  if (!replaced.size) return [...items];
  return items.filter((item) => !consumed.has(item)).map((item) => replaced.get(item) ?? item);
}

function merged(
  primary: ReviewRevisionItem,
  rest: readonly ReviewRevisionItem[]
): ReviewRevisionItem {
  const entries = [primary, ...rest];
  const addresses = [
    ...new Map(
      entries
        .flatMap((item) => item.addresses)
        .map((address) => [
          JSON.stringify([address.id, address.author, address.date ?? null]),
          address,
        ])
    ).values(),
  ];
  const ranges = [
    ...new Map(
      entries.flatMap((item) => item.ranges).map((range) => [JSON.stringify(range), range])
    ).values(),
  ];
  return registerRevisionSiteNodeIds(
    {
      ...primary,
      id: entries.map((item) => item.id).join('+'),
      addresses,
      ranges,
      text: entries
        .map((item) => item.text)
        .filter(Boolean)
        .join('\n'),
    },
    entries.flatMap(revisionSiteNodeIdsOf)
  );
}
