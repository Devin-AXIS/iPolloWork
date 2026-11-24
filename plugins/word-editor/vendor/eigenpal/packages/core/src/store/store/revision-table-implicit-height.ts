import { implicitTableRowAlignments } from './revision-table-implicit-alignment.ts';
import { ooxmlTreesEqual } from '../package/ooxml-serialize.ts';
import { parentNodeOf } from '../package/ooxml-edit.ts';
import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlPart } from '../package/ooxml-tree.ts';
import type { RevisionSite } from './tree-op-revisions.ts';
function children(node: OoxmlElement, name: string): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  for (const child of node.children)
    if (
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === name
    )
      found.push(child);
  return found;
}
const attr = (node: OoxmlElement, name: string) =>
  node.attributes.find((a) => a.namespaceUri === WML_NAMESPACE_URI && a.localName === name)?.value;

/** Word omits an old row-property snapshot when a newly added height replaces no properties.
 * Recognize only its complete, otherwise unchanged table/grid/cell snapshot bundle. */
export function implicitTableRowProperties(
  part: OoxmlPart,
  matched: readonly RevisionSite[]
): ReadonlyMap<string, string> {
  const selected = new Map(matched.filter((s) => !s.refused).map((s) => [s.node.id, s]));
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
    const previous = children(record, container.localName);
    if (previous.length !== 1) return false;
    const current = {
      ...container,
      children: container.children.filter((n) => n.id !== record.id),
    } as OoxmlElement;
    return ooxmlTreesEqual(current, previous[0]!);
  };
  const result = new Map(implicitTableRowAlignments(part, matched).rows);
  for (const site of matched) {
    if (
      site.node.localName !== 'tblPrChange' ||
      !site.parent ||
      !unchanged(site.parent, 'tblPrChange')
    )
      continue;
    const table = parentNodeOf(part, site.parent.id);
    if (table?.kind !== 'table' || children(table, 'tblPr').length !== 1) continue;
    const grid = children(table, 'tblGrid');
    if (grid.length !== 1 || !unchanged(grid[0]!, 'tblGridChange')) continue;
    for (const row of children(table, 'tr')) {
      const props = children(row, 'trPr');
      if (props.length !== 1) continue;
      const height = children(props[0]!, 'trHeight');
      // Other row properties or live row revisions are independent; never infer their old state.
      if (height.length !== 1 || props[0]!.children.length !== 1 || height[0]!.children.length)
        continue;
      if (
        !/^\d+$/.test(attr(height[0]!, 'val') ?? '') ||
        height[0]!.attributes.some(
          (a) => a.namespaceUri !== WML_NAMESPACE_URI || !['val', 'hRule'].includes(a.localName)
        )
      )
        continue;
      const cells = children(row, 'tc');
      if (
        !cells.length ||
        row.children.some(
          (n) =>
            n.kind !== 'textValue' &&
            (n.namespaceUri !== WML_NAMESPACE_URI || !['trPr', 'tc'].includes(n.localName))
        )
      )
        continue;
      if (
        !cells.every((cell) => {
          const properties = children(cell, 'tcPr');
          return properties.length === 1 && unchanged(properties[0]!, 'tcPrChange', site.node);
        })
      )
        continue;
      result.set(height[0]!.id, row.id);
    }
  }
  return result;
}
