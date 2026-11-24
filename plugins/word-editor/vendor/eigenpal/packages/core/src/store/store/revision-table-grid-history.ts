import { parentNodeOf } from '../package/ooxml-edit.ts';
import type { OoxmlPart } from '../package/ooxml-tree.ts';
import type { RevisionSite } from './tree-op-revisions.ts';

/** A shared grid snapshot survives until the last direct row-formatting decision. */
export function deferredTableGridSites(
  part: OoxmlPart,
  sites: readonly RevisionSite[],
  selected: ReadonlySet<string>
): ReadonlySet<string> {
  const grids = sites.filter(
    (site) => site.node.localName === 'tblGridChange' && selected.has(site.node.id)
  );
  if (!grids.length) return new Set();
  const rowsByTable = new Map<string, string[]>();
  for (const site of sites) {
    if (!['trPrChange', 'tcPrChange', 'tblPrExChange'].includes(site.node.localName)) continue;
    let ancestor = site.parent;
    while (ancestor && ancestor.kind !== 'table') ancestor = parentNodeOf(part, ancestor.id);
    if (!ancestor) continue;
    const ids = rowsByTable.get(ancestor.id) ?? [];
    ids.push(site.node.id);
    rowsByTable.set(ancestor.id, ids);
  }
  const deferred = new Set<string>();
  for (const grid of grids) {
    const table = grid.parent && parentNodeOf(part, grid.parent.id);
    const rows = table && rowsByTable.get(table.id);
    // Explicitly resolving a standalone grid remains supported. Defer only when
    // the grid was selected with one of its row decisions, while another survives.
    if (rows?.some((id) => selected.has(id)) && rows.some((id) => !selected.has(id)))
      deferred.add(grid.node.id);
  }
  return deferred;
}
