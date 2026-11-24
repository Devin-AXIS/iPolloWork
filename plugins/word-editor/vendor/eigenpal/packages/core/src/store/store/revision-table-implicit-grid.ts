import { readTwipsMeasure } from '../units.ts';
import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from '../package/ooxml-tree.ts';
import { tableChildren, replaceTableChildren } from './revision-table-children.ts';
import { recordedProperties } from './tree-op-tracked-properties.ts';
function elements(node: OoxmlElement): OoxmlElement[] {
  const result: OoxmlElement[] = [];
  for (const child of node.children) if (child.kind !== 'textValue') result.push(child);
  return result;
}
const child = (node: OoxmlElement | undefined, name: string): OoxmlElement | undefined =>
  node && elements(node).find((n) => n.namespaceUri === WML_NAMESPACE_URI && n.localName === name);
const attr = (node: OoxmlElement | undefined, name: string) =>
  node?.attributes.find((a) => a.namespaceUri === WML_NAMESPACE_URI && a.localName === name)?.value;

/** Word reconstructs empty row snapshots with a 360-twip minimum cell width.
 * When unchanged rows establish a wider grid, the restored rows end before that grid does. */
export function implicitGridRows(table: OoxmlElement, restored: ReadonlySet<string>): Set<string> {
  const result = new Set<string>();
  const grid = child(table, 'tblGrid');
  if (!grid || child(grid, 'tblGridChange')) return result;
  const rows = tableChildren(table, 'tableRow');
  // A row exception records no row geometry, so rejecting one restores the row as an empty
  // row snapshot does.
  const exception = (row: OoxmlElement) => {
    const record = child(child(row, 'tblPrEx'), 'tblPrExChange');
    return record && restored.has(record.id) ? record : undefined;
  };
  if (!rows.some((row) => !child(child(row, 'trPr'), 'trPrChange') && !exception(row)))
    return result;
  for (const row of rows) {
    const record = child(child(row, 'trPr'), 'trPrChange');
    const cells = tableChildren(row, 'tableCell');
    const emptySnapshot =
      record && restored.has(record.id) && recordedProperties(record)?.length === 0;
    if (!(emptySnapshot || (!record && exception(row))) || !cells.length) continue;
    if (
      cells.some((cell) => {
        const pr = child(cell, 'tcPr');
        return [
          'tcPrChange',
          'gridSpan',
          'hMerge',
          'vMerge',
          'cellIns',
          'cellDel',
          'cellMerge',
        ].some((name) => child(pr, name));
      })
    )
      continue;
    result.add(row.id);
  }
  return result;
}
export function restoreImplicitRowGrid(
  original: OoxmlElement,
  rebuilt: OoxmlElement,
  restored: ReadonlySet<string>,
  mint: () => string
): OoxmlElement {
  const inferred = implicitGridRows(original, restored);
  if (!inferred.size) return rebuilt;
  const grid = child(rebuilt, 'tblGrid');
  if (!grid) return rebuilt;
  const cols = elements(grid).filter(
    (n) => n.namespaceUri === WML_NAMESPACE_URI && n.localName === 'gridCol'
  );
  if (
    !cols.length ||
    cols.some(
      (c) =>
        c.children.length > 0 ||
        c.attributes.some((a) => a.namespaceUri !== WML_NAMESPACE_URI || a.localName !== 'w')
    )
  )
    return rebuilt;
  if (grid.children.some((n) => n.kind !== 'textValue' && !cols.includes(n))) return rebuilt;
  const widths = cols.map((c) => readTwipsMeasure(attr(c, 'w')) ?? Number.NaN);
  if (widths.some((w) => !Number.isFinite(w) || w <= 0)) return rebuilt;
  const positions = [0];
  for (const width of widths) positions.push(positions.at(-1)! + width);
  const total = positions.at(-1)!;
  const rows = tableChildren(rebuilt, 'tableRow');
  if (rows.length !== tableChildren(original, 'tableRow').length) return rebuilt;
  const ranges = new Map<string, [number, number]>();
  const ends = new Map<string, number>();
  const boundaries = new Set([0, total]);
  for (const row of rows) {
    const cells = tableChildren(row, 'tableCell');
    const before = Number(attr(child(child(row, 'trPr'), 'gridBefore'), 'val') ?? 0);
    let column = before;
    let at = inferred.has(row.id) ? 0 : positions[column];
    if (at === undefined || !cells.length) return rebuilt;
    for (const cell of cells) {
      const span = Number(attr(child(child(cell, 'tcPr'), 'gridSpan'), 'val') ?? 1);
      column += span;
      const end = inferred.has(row.id) ? at + 360 : positions[column];
      if (end === undefined || end > total || end <= at) return rebuilt;
      ranges.set(cell.id, [at, end]);
      boundaries.add(at);
      boundaries.add(end);
      at = end;
    }
    ends.set(row.id, at);
  }
  const sorted = [...boundaries].sort((a, b) => a - b);
  const indices = new Map(sorted.map((p, i) => [p, i]));
  const make = (source: OoxmlElement, name: string, attrs: Record<string, string>): OoxmlElement =>
    ({
      ...source,
      id: mint(),
      kind: 'generic',
      localName: name,
      children: [],
      attributes: Object.entries(attrs).map(([localName, value]) => ({
        kind: localName === 'val' ? 'wmlVal' : 'genericExtension',
        namespaceUri: WML_NAMESPACE_URI,
        prefix: source.prefix,
        localName,
        value,
      })),
    }) as OoxmlElement;
  const patch = (
    node: OoxmlElement,
    name: string,
    values: Record<string, Record<string, string> | null>
  ) => {
    const pr = child(node, name) ?? make(node, name, {});
    const children = pr.children.filter(
      (n) =>
        n.kind === 'textValue' || n.namespaceUri !== WML_NAMESPACE_URI || !(n.localName in values)
    );
    const order =
      name === 'tcPr'
        ? [
            'cnfStyle',
            'tcW',
            'gridSpan',
            'hMerge',
            'vMerge',
            'tcBorders',
            'shd',
            'noWrap',
            'tcMar',
            'textDirection',
            'tcFitText',
            'vAlign',
            'hideMark',
            'headers',
            'cellIns',
            'cellDel',
            'cellMerge',
            'tcPrChange',
          ]
        : [
            'cnfStyle',
            'divId',
            'gridBefore',
            'gridAfter',
            'wBefore',
            'wAfter',
            'cantSplit',
            'trHeight',
            'tblHeader',
            'tblCellSpacing',
            'jc',
            'hidden',
            'ins',
            'del',
            'trPrChange',
          ];
    for (const [key, value] of Object.entries(values)) {
      if (!value) continue;
      const existing = child(pr, key);
      const fresh = make(pr, key, value);
      const replacement = existing
        ? ({
            ...existing,
            attributes: [
              ...existing.attributes.filter(
                (a) => a.namespaceUri !== WML_NAMESPACE_URI || !(a.localName in value)
              ),
              ...fresh.attributes,
            ],
          } as OoxmlElement)
        : fresh;
      const index = children.findIndex(
        (n) =>
          n.kind !== 'textValue' &&
          n.namespaceUri === WML_NAMESPACE_URI &&
          order.indexOf(n.localName) > order.indexOf(key)
      );
      children.splice(index < 0 ? children.length : index, 0, replacement);
    }
    const patched = { ...pr, children } as OoxmlNode;
    // An existing container keeps its place; a new `w:trPr` follows the row's `w:tblPrEx`.
    if (node.children.some((n) => n.id === pr.id))
      return {
        ...node,
        children: node.children.map((n) => (n.id === pr.id ? patched : n)),
      } as OoxmlElement;
    const at =
      name === 'trPr'
        ? node.children.findIndex(
            (n) =>
              n.kind !== 'textValue' &&
              n.namespaceUri === WML_NAMESPACE_URI &&
              n.localName === 'tblPrEx'
          ) + 1
        : 0;
    return {
      ...node,
      children: [...node.children.slice(0, at), patched, ...node.children.slice(at)],
    } as OoxmlElement;
  };
  const fixed = attr(child(child(original, 'tblPr'), 'tblLayout'), 'type') === 'fixed';
  const updated = rows.map((row) => {
    const cells = tableChildren(row, 'tableCell').map((cell) => {
      const [start, end] = ranges.get(cell.id)!;
      const span = indices.get(end)! - indices.get(start)!;
      return patch(cell, 'tcPr', {
        gridSpan: span === 1 ? null : { val: String(span) },
        ...(fixed && inferred.has(row.id) ? { tcW: { w: '360', type: 'dxa' } } : {}),
      });
    });
    let result = replaceTableChildren(row, new Map(cells.map((c) => [c.id, c])));
    const end = ends.get(row.id)!;
    const start = ranges.get(cells[0]!.id)![0];
    if (
      inferred.has(row.id) ||
      child(child(row, 'trPr'), 'gridBefore') ||
      child(child(row, 'trPr'), 'gridAfter')
    ) {
      result = patch(result, 'trPr', {
        gridBefore: start === 0 ? null : { val: String(indices.get(start)!) },
        gridAfter: end === total ? null : { val: String(sorted.length - 1 - indices.get(end)!) },
        ...(inferred.has(row.id)
          ? { wAfter: end === total ? null : { w: String(total - end), type: 'dxa' } }
          : {}),
      });
    }
    return result;
  });
  const table = replaceTableChildren(rebuilt, new Map(updated.map((r) => [r.id, r])));
  return {
    ...table,
    children: table.children.map((n) =>
      n.id !== grid.id
        ? n
        : {
            ...grid,
            children: sorted
              .slice(1)
              .map((end, i) => make(cols[0]!, 'gridCol', { w: String(end - sorted[i]!) })),
          }
    ),
  } as OoxmlElement;
}
