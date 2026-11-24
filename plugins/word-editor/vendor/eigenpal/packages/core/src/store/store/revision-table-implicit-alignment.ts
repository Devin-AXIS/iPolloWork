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

/** Word records a newly introduced row alignment in the table snapshot bundle,
 * without trPrChange. Require the complete bundle before inferring an absent old jc. */
export function implicitTableRowAlignments(
  part: OoxmlPart,
  matched: readonly RevisionSite[]
): {
  rows: ReadonlyMap<string, string>;
  tableHistories: ReadonlySet<string>;
} {
  const selected = new Set(matched.filter((s) => !s.refused).map((s) => s.node.id));
  const rows = new Map<string, string>();
  const tableHistories = new Set<string>();
  const unchanged = (container: OoxmlElement, name: string, actor?: OoxmlElement) => {
    const records = children(container, name);
    const record = records[0];
    if (records.length !== 1 || !record || !selected.has(record.id)) return false;
    if (
      actor &&
      (attr(record, 'author') !== attr(actor, 'author') ||
        attr(record, 'date') !== attr(actor, 'date'))
    )
      return false;
    const old = children(record, container.localName);
    return (
      old.length === 1 &&
      ooxmlTreesEqual(
        {
          ...container,
          children: container.children.filter((n) => n.id !== record.id),
        } as OoxmlElement,
        old[0]!
      )
    );
  };
  for (const site of matched) {
    if (site.node.localName !== 'tblPrChange' || !selected.has(site.node.id) || !site.parent)
      continue;
    const current = site.parent;
    const previous = children(site.node, 'tblPr');
    const alignment = children(current, 'jc');
    if (previous.length !== 1 || alignment.length !== 1 || children(previous[0]!, 'jc').length)
      continue;
    const jc = alignment[0]!;
    if (
      jc.children.length ||
      jc.attributes.length !== 1 ||
      !['left', 'center', 'right', 'start', 'end'].includes(attr(jc, 'val') ?? '')
    )
      continue;
    if (
      !ooxmlTreesEqual(
        {
          ...current,
          children: current.children.filter((n) => n.id !== jc.id && n.id !== site.node.id),
        } as OoxmlElement,
        previous[0]!
      )
    )
      continue;
    const table = parentNodeOf(part, current.id);
    if (table?.kind !== 'table' || children(table, 'tblPr').length !== 1) continue;
    const grid = children(table, 'tblGrid');
    if (grid.length !== 1 || !unchanged(grid[0]!, 'tblGridChange')) continue;
    const found = new Map<string, string>();
    for (const row of children(table, 'tr')) {
      const props = children(row, 'trPr');
      if (props.length !== 1 || props[0]!.children.length !== 1) continue;
      const own = children(props[0]!, 'jc');
      if (own.length !== 1 || !ooxmlTreesEqual(own[0]!, jc)) continue;
      const exceptions = children(row, 'tblPrEx');
      if (
        exceptions.length > 1 ||
        (exceptions.length === 1 && !unchanged(exceptions[0]!, 'tblPrExChange', site.node))
      )
        continue;
      if (
        row.children.some(
          (n) =>
            n.kind !== 'textValue' &&
            (n.namespaceUri !== WML_NAMESPACE_URI ||
              !['trPr', 'tblPrEx', 'tc'].includes(n.localName))
        )
      )
        continue;
      const cells = children(row, 'tc');
      if (
        !cells.length ||
        !cells.every((cell) => {
          const p = children(cell, 'tcPr');
          return p.length === 1 && unchanged(p[0]!, 'tcPrChange', site.node);
        })
      )
        continue;
      found.set(own[0]!.id, row.id);
    }
    if (found.size) {
      tableHistories.add(site.node.id);
      for (const [id, row] of found) rows.set(id, row);
    }
  }
  return { rows, tableHistories };
}
