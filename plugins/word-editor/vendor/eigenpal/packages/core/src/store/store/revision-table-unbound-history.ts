import { parentNodeOf } from '../package/ooxml-edit.ts';
import { ooxmlTreesEqual } from '../package/ooxml-serialize.ts';
import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlPart } from '../package/ooxml-tree.ts';
import type { RevisionSite } from './tree-op-revisions.ts';
function children(node: OoxmlElement, name: string): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  for (const n of node.children)
    if (n.kind !== 'textValue' && n.namespaceUri === WML_NAMESPACE_URI && n.localName === name)
      found.push(n);
  return found;
}
const attr = (node: OoxmlElement, name: string) =>
  node.attributes.find((a) => a.namespaceUri === WML_NAMESPACE_URI && a.localName === name)?.value;

function plainGrid(node: OoxmlElement, omit?: string): boolean {
  const columns = children(node, 'gridCol');
  return (
    !node.attributes.length &&
    columns.length > 0 &&
    node.children.every(
      (n) =>
        n.id === omit ||
        (n.kind === 'textValue'
          ? !n.value.trim()
          : n.namespaceUri === WML_NAMESPACE_URI &&
            n.localName === 'gridCol' &&
            !n.children.length &&
            n.attributes.length === 1 &&
            /^\d+$/.test(attr(n, 'w') ?? ''))
    )
  );
}

const TABLE_FORMATTING_RECORDS: ReadonlySet<string> = new Set([
  'tblPrChange',
  'tblGridChange',
  'tblPrExChange',
  'trPrChange',
  'tcPrChange',
]);

/** Standalone alignment/grid snapshots without row or cell history record nothing a decision applies.
 * Keep live properties and clean only the unambiguous metadata on unfiltered bulk actions. */
export function unboundTableHistories(
  part: OoxmlPart,
  sites: readonly RevisionSite[]
): ReadonlySet<string> {
  const histories = alignmentHistories(part, sites);
  const snapshots = new Set(histories.map(({ history }) => history));
  const result = new Set<string>();
  for (const { history, others } of histories)
    if (others.every((id) => snapshots.has(id))) result.add(history);
  return result;
}

/** Alignment-only table changes that row or cell history keeps a pending decision. */
export function boundTableAlignments(
  part: OoxmlPart,
  sites: readonly RevisionSite[]
): ReadonlySet<string> {
  const unbound = unboundTableHistories(part, sites);
  const result = new Set<string>();
  for (const { history, alignment } of alignmentHistories(part, sites))
    if (alignment && !unbound.has(history)) result.add(history);
  return result;
}

/**
 * An alignment snapshot in a table whose cells hold formatting history is one decision with
 * that history, so deciding either decides them all.
 */
export function bundledTableHistories(
  part: OoxmlPart,
  sites: readonly RevisionSite[]
): readonly (readonly string[])[] {
  // An inserted or deleted cell's own history goes with the cell, not with the table.
  const ownedByCell = (site: RevisionSite) =>
    !!site.parent &&
    site.parent.children.some(
      (n) => n.kind !== 'textValue' && (n.localName === 'cellIns' || n.localName === 'cellDel')
    );
  const cells = new Set(
    sites
      .filter((site) => site.node.localName === 'tcPrChange' && !ownedByCell(site))
      .map((site) => site.node.id)
  );
  if (!cells.size) return [];
  const alignments = new Set(
    sites.filter((site) => site.node.localName === 'tblPrChange').map((site) => site.node.id)
  );
  return alignmentHistories(part, sites).flatMap(({ history, others }) => {
    const bundled = others.filter((id) => cells.has(id));
    return alignments.has(history) && bundled.length ? [[history, ...bundled]] : [];
  });
}

/** Alignment and grid snapshots, each with the table's other formatting history sites. */
function alignmentHistories(
  part: OoxmlPart,
  sites: readonly RevisionSite[]
): readonly {
  readonly history: string;
  readonly alignment: boolean;
  readonly others: readonly string[];
}[] {
  const result: { history: string; alignment: boolean; others: string[] }[] = [];
  if (!sites.some((s) => ['tblPrChange', 'tblGridChange'].includes(s.node.localName)))
    return result;
  const identity = (site: RevisionSite) =>
    JSON.stringify(['id', 'author', 'date'].map((name) => attr(site.node, name)));
  const identities = new Map<string, number>();
  const tableRecords = new Map<string, string[]>();
  for (const site of sites) {
    const key = identity(site);
    identities.set(key, (identities.get(key) ?? 0) + 1);
    // Inserted or deleted rows and text are not formatting history of the table.
    if (!TABLE_FORMATTING_RECORDS.has(site.node.localName)) continue;
    let ancestor = site.parent;
    while (ancestor && ancestor.kind !== 'table') ancestor = parentNodeOf(part, ancestor.id);
    if (ancestor)
      tableRecords.set(ancestor.id, [...(tableRecords.get(ancestor.id) ?? []), site.node.id]);
  }
  for (const site of sites) {
    if (
      site.refused ||
      !['tblPrChange', 'tblGridChange'].includes(site.node.localName) ||
      !site.parent
    )
      continue;
    const current = site.parent;
    if (site.node.localName === 'tblGridChange') {
      const previous = children(site.node, 'tblGrid');
      if (previous.length !== 1 || !plainGrid(current, site.node.id) || !plainGrid(previous[0]!))
        continue;
      if (children(current, 'gridCol').length !== children(previous[0]!, 'gridCol').length)
        continue;
    } else {
      const previous = children(site.node, 'tblPr');
      const jc = children(current, 'jc');
      if (previous.length !== 1 || jc.length !== 1 || children(previous[0]!, 'jc').length) continue;
      if (
        jc[0]!.children.length ||
        jc[0]!.attributes.length !== 1 ||
        !['left', 'center', 'right', 'start', 'end'].includes(attr(jc[0]!, 'val') ?? '')
      )
        continue;
      if (
        !ooxmlTreesEqual(
          {
            ...current,
            children: current.children.filter((n) => n.id !== site.node.id && n.id !== jc[0]!.id),
          } as OoxmlElement,
          previous[0]!
        )
      )
        continue;
    }
    const table = parentNodeOf(part, current.id);
    if (table?.kind !== 'table' || !children(table, 'tr').length) continue;
    // Keep reused identities explicit.
    if (identities.get(identity(site)) !== 1) continue;
    const others = (tableRecords.get(table.id) ?? []).filter((id) => id !== site.node.id);
    result.push({
      history: site.node.id,
      alignment: site.node.localName === 'tblPrChange',
      others,
    });
  }
  return result;
}
