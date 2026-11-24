import { implicitGridRows, restoreImplicitRowGrid } from './revision-table-implicit-grid.ts';
import { parentNodeOf } from '../package/ooxml-edit.ts';
import type { OoxmlPart } from '../package/ooxml-tree.ts';
import type { RevisionSite } from './tree-op-revisions.ts';
import { recordedProperties } from './tree-op-tracked-properties.ts';
import { tableChildren, replaceTableChildren } from './revision-table-children.ts';
import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from '../package/ooxml-tree.ts';
import { isWmlNamed } from './tree-op-tracked.ts';
import { revisionAttribute } from './revision-table-plan.ts';
import { readTwipsMeasure } from '../units.ts';

function elements(node: OoxmlElement): OoxmlElement[] {
  const result: OoxmlElement[] = [];
  for (const entry of node.children) if (entry.kind !== 'textValue') result.push(entry);
  return result;
}
function child(node: OoxmlElement, name: string): OoxmlElement | undefined {
  return elements(node).find((n) => isWmlNamed(n, name));
}
function number(node: OoxmlElement | undefined, name: string, fallback: number): number {
  const value = node && Number(revisionAttribute(node, name));
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}
/** A positive `w:w` in whole units: a decimal truncates, as every width reader reads it. */
function positiveWidth(node: OoxmlElement | undefined, fallback: number): number {
  const value = readTwipsMeasure(node && revisionAttribute(node, 'w'));
  return value !== null && value > 0 ? value : fallback;
}
function element(
  source: OoxmlElement,
  name: string,
  attrs: Record<string, string>,
  mint: () => string
): OoxmlElement {
  return {
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
  } as OoxmlElement;
}
function properties(cell: OoxmlElement, mint: () => string): OoxmlElement {
  return child(cell, 'tcPr') ?? element(cell, 'tcPr', {}, mint);
}
function patch(
  cell: OoxmlElement,
  values: Record<string, Record<string, string> | null>,
  mint: () => string
): OoxmlElement {
  const pr = properties(cell, mint);
  const order = [
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
  ];
  const children = pr.children.filter(
    (n) =>
      n.kind === 'textValue' || n.namespaceUri !== WML_NAMESPACE_URI || !(n.localName in values)
  );
  for (const [name, attrs] of Object.entries(values)) {
    if (!attrs) continue;
    const index = children.findIndex(
      (n) =>
        n.kind !== 'textValue' &&
        n.namespaceUri === WML_NAMESPACE_URI &&
        order.indexOf(n.localName) > order.indexOf(name)
    );
    const existing = child(pr, name);
    const replacement = element(existing ?? pr, name, attrs, mint);
    const updated = existing
      ? ({
          ...existing,
          attributes: [
            ...existing.attributes.filter(
              (attribute) =>
                attribute.namespaceUri !== WML_NAMESPACE_URI || !(attribute.localName in attrs)
            ),
            ...replacement.attributes,
          ],
        } as OoxmlElement)
      : replacement;
    children.splice(index < 0 ? children.length : index, 0, updated);
  }
  return {
    ...cell,
    children: [
      { ...pr, children } as OoxmlElement,
      ...cell.children.filter((n) => !isWmlNamed(n, 'tcPr')),
    ],
  } as OoxmlElement;
}
export function applyCellMerge(
  cell: OoxmlElement,
  value: string | undefined,
  mint: () => string
): OoxmlElement {
  return patch(
    cell,
    { vMerge: value === undefined ? null : { val: value === 'cont' ? 'continue' : 'restart' } },
    mint
  );
}

export function restoredCellRows(part: OoxmlPart, sites: readonly RevisionSite[]): string[] {
  const rows = new Set<string>();
  for (const site of sites) {
    if (
      site.refused ||
      !['trPrChange', 'tblPrExChange', 'tcPrChange'].includes(site.node.localName)
    )
      continue;
    let node = site.parent && parentNodeOf(part, site.parent.id);
    while (node && node.kind !== 'tableRow' && node.kind !== 'table')
      node = parentNodeOf(part, node.id);
    if (node?.kind === 'tableRow') rows.add(node.id);
  }
  const selected = new Set(sites.map((s) => s.node.id));
  const tables = new Map<string, OoxmlElement>();
  for (const id of rows) {
    let table = parentNodeOf(part, id);
    while (table && table.kind !== 'table') table = parentNodeOf(part, table.id);
    if (table) tables.set(table.id, table);
  }
  for (const table of tables.values())
    if (implicitGridRows(table, selected).size) rows.add(table.id);
  return [...rows];
}

/** A rejected row formatting decision restores unrecorded cells to default formatting. */
export function restoresRowCells(row: OoxmlElement, restored: ReadonlySet<string>): boolean {
  const containers = [
    child(row, 'trPr'),
    child(row, 'tblPrEx'),
    ...tableChildren(row, 'tableCell').map((cell) => child(cell, 'tcPr')),
  ];
  return containers.some((pr) => pr?.children.some((record) => restored.has(record.id)));
}
function hasExtensionData(node: OoxmlNode): boolean {
  return (
    node.kind !== 'textValue' &&
    (node.namespaceUri !== WML_NAMESPACE_URI ||
      node.attributes.some((a) => a.namespaceUri !== WML_NAMESPACE_URI) ||
      node.children.some(hasExtensionData))
  );
}
function unrecordedDefaults(cell: OoxmlElement): Record<string, Record<string, string> | null> {
  const values: Record<string, Record<string, string> | null> = { tcW: { w: '0', type: 'auto' } };
  for (const name of [
    'cnfStyle',
    'tcBorders',
    'shd',
    'noWrap',
    'tcMar',
    'textDirection',
    'tcFitText',
    'vAlign',
    'hideMark',
  ]) {
    const property = child(child(cell, 'tcPr') ?? cell, name);
    // Unknown extension payloads do not belong to the recorded formatting decision.
    if (!property || !hasExtensionData(property)) values[name] = null;
  }
  return values;
}
function restoreUnrecordedCells(
  original: OoxmlElement,
  row: OoxmlElement,
  restored: ReadonlySet<string>,
  mint: () => string
): OoxmlElement {
  if (!restoresRowCells(original, restored)) return row;
  const recorded = new Set(
    tableChildren(original, 'tableCell')
      .filter((cell) => {
        const pr = child(cell, 'tcPr');
        return pr && child(pr, 'tcPrChange');
      })
      .map((cell) => cell.id)
  );
  return replaceTableChildren(
    row,
    new Map(
      tableChildren(row, 'tableCell').map((cell) => [
        cell.id,
        recorded.has(cell.id) ? cell : patch(cell, unrecordedDefaults(cell), mint),
      ])
    )
  );
}

/** Word gives deleted cell space to the preceding survivor (or the first following cell). */
export function rebuildRevisionTable(
  original: OoxmlElement,
  rebuilt: OoxmlElement,
  removed: ReadonlySet<string>,
  mint: () => string,
  mergedCells: ReadonlyMap<string, OoxmlElement>,
  restoredProperties: ReadonlySet<string>
): OoxmlElement {
  const originalRows = new Map(tableChildren(original, 'tableRow').map((n) => [n.id, n]));
  let rows: OoxmlElement[] = tableChildren(rebuilt, 'tableRow');
  rows = rows.map((row) => {
    const prior = originalRows.get(row.id);
    if (!prior) return row;
    row = restoreUnrecordedCells(prior, row, restoredProperties, mint);
    const priorCells = tableChildren(prior, 'tableCell');
    if (!priorCells.some((c) => removed.has(c.id))) return row;
    const additions = new Map<string, { span: number; width: number; type: string | undefined }>();
    let previous: string | undefined;
    let leadingSpan = 0,
      leadingWidth = 0;
    let leadingType: string | undefined;
    for (const cell of priorCells) {
      const pr = child(cell, 'tcPr');
      if (removed.has(cell.id)) {
        const span = number(pr && child(pr, 'gridSpan'), 'val', 1);
        const widthNode = pr && child(pr, 'tcW');
        const width = positiveWidth(widthNode, 0);
        const type = widthNode && revisionAttribute(widthNode, 'type');
        if (previous) {
          const existing = additions.get(previous) ?? { span: 0, width: 0, type };
          additions.set(previous, {
            span: existing.span + span,
            width: existing.width + width,
            type: existing.type === type ? type : undefined,
          });
        } else {
          leadingType = leadingSpan === 0 ? type : leadingType === type ? type : undefined;
          leadingSpan += span;
          leadingWidth += width;
        }
      } else {
        previous = cell.id;
        if (leadingSpan) {
          additions.set(cell.id, { span: leadingSpan, width: leadingWidth, type: leadingType });
          leadingSpan = 0;
          leadingWidth = 0;
          leadingType = undefined;
        }
      }
    }
    const cells = tableChildren(row, 'tableCell').map((c) => {
      const extra = additions.get(c.id);
      if (!extra || c.kind !== 'tableCell') return c;
      const originalCell = priorCells.find((cell) => cell.id === c.id);
      const originalProperties = originalCell && child(originalCell, 'tcPr');
      // A rejected cell-property record already describes the pre-insertion geometry.
      if (originalProperties?.children.some((property) => restoredProperties.has(property.id)))
        return c;
      const pr = child(c, 'tcPr');
      const width = pr && child(pr, 'tcW');
      const currentSpan = number(pr && child(pr, 'gridSpan'), 'val', 1);
      const record = originalProperties && child(originalProperties, 'tcPrChange');
      const recorded = record && recordedProperties(record);
      const historical = recorded
        ? ({ ...originalProperties!, children: recorded } as OoxmlElement)
        : undefined;
      const absorbedSpan = historical
        ? Math.max(0, currentSpan - number(child(historical, 'gridSpan'), 'val', 1))
        : 0;
      // Horizontal merges may already express the deleted neighbour in the current span.
      if (absorbedSpan >= extra.span) return c;
      const historicalWidth = historical && child(historical, 'tcW');
      const absorbedWidth =
        absorbedSpan &&
        historicalWidth &&
        width &&
        revisionAttribute(historicalWidth, 'type') === extra.type
          ? Math.max(0, positiveWidth(width, 0) - positiveWidth(historicalWidth, 0))
          : 0;
      return patch(
        c,
        {
          gridSpan: { val: String(currentSpan + extra.span - absorbedSpan) },
          ...(width &&
          extra.type &&
          ['dxa', 'pct'].includes(extra.type) &&
          revisionAttribute(width, 'type') === extra.type
            ? {
                tcW: {
                  type: extra.type,
                  w: String(positiveWidth(width, 0) + Math.max(0, extra.width - absorbedWidth)),
                },
              }
            : {}),
        },
        mint
      );
    });
    return replaceTableChildren(row, new Map(cells.map((c) => [c.id, c])));
  });
  let above = new Set<string>();
  let promotedAbove = new Set<string>();
  const hasText = (node: OoxmlNode): boolean =>
    node.kind === 'textValue'
      ? false
      : ['text', 'deletedText'].includes(node.kind)
        ? node.children.some((child) => child.kind === 'textValue' && child.value.length > 0)
        : node.children.some(hasText);
  // The grid intervals a row continues from the row above, by live merge or, with `tracked`,
  // by a merge change too.
  const continuationsOf = (row: OoxmlElement, tracked = false) => {
    const result = new Set<string>();
    const pr = child(row, 'trPr');
    let at = number(pr && child(pr, 'gridBefore'), 'val', 0);
    for (const cell of tableChildren(row, 'tableCell')) {
      const pr = child(cell, 'tcPr');
      const end = at + number(pr && child(pr, 'gridSpan'), 'val', 1);
      const merge = pr && child(pr, 'vMerge');
      const change = tracked ? pr && child(pr, 'cellMerge') : undefined;
      if (
        (merge && revisionAttribute(merge, 'val') !== 'restart') ||
        (change && revisionAttribute(change, 'vMerge') === 'cont')
      )
        result.add(`${at}:${end}`);
      at = end;
    }
    return result;
  };
  const continuations = rows.map((row) => continuationsOf(row));
  const trackedContinuations = rows.map((row) => continuationsOf(row, true));
  // Whether the row below `index` continues the merge, live or by a pending change.
  const mergesBelow = (index: number, key: string): boolean =>
    !!trackedContinuations[index + 1]?.has(key);
  const originalOrder = tableChildren(original, 'tableRow');
  // What continued below each row before the decision.
  const continuedBelow = new Map(
    originalOrder.map((row, index) => {
      const below = originalOrder[index + 1];
      return [row.id, below ? continuationsOf(below, true) : new Set<string>()];
    })
  );
  rows = rows.map((row, rowIndex) => {
    const active = new Set<string>();
    const promoted = new Set<string>();
    const rowPr = child(row, 'trPr');
    let column = number(rowPr && child(rowPr, 'gridBefore'), 'val', 0);
    const cells = tableChildren(row, 'tableCell').map((cell) => {
      if (cell.kind !== 'tableCell') return cell;
      const pr = child(cell, 'tcPr');
      const end = column + number(pr && child(pr, 'gridSpan'), 'val', 1);
      const key = `${column}:${end}`;
      column = end;
      const merge = pr && child(pr, 'vMerge');
      if (!merge) {
        // A pending merge continuation carries the merge to the rows below it.
        const change = pr && child(pr, 'cellMerge');
        if (change && revisionAttribute(change, 'vMerge') === 'cont' && above.has(key)) {
          active.add(key);
          if (promotedAbove.has(key)) promoted.add(key);
        }
        return cell;
      }
      const continuation = revisionAttribute(merge, 'val') !== 'restart';
      // A merge head whose continuation below the decision removes merges nothing.
      if (!continuation && continuedBelow.get(row.id)?.has(key) && !mergesBelow(rowIndex, key))
        return patch(cell, { vMerge: null }, mint);
      if (continuation && !above.has(key)) {
        if (continuations[rowIndex + 1]?.has(key)) {
          active.add(key);
          promoted.add(key);
          return patch(cell, { vMerge: { val: 'restart' } }, mint);
        }
        return patch(cell, { vMerge: null }, mint);
      }
      // Word keeps nonempty legacy continuation content visible after its head is removed.
      if (continuation && promotedAbove.has(key) && !mergedCells.has(cell.id) && hasText(cell))
        return patch(cell, { vMerge: null }, mint);
      active.add(key);
      if (continuation && promotedAbove.has(key)) promoted.add(key);
      if (!continuation || !mergedCells.has(cell.id)) return cell;
      const paragraph = elements(cell).find((n) => n.kind === 'paragraph');
      const empty = paragraph
        ? ({
            ...paragraph,
            children: paragraph.children.filter((n) => isWmlNamed(n, 'pPr')),
          } as OoxmlElement)
        : ({ ...element(cell, 'p', {}, mint), kind: 'paragraph' } as OoxmlElement);
      return {
        ...cell,
        children: [...cell.children.filter((n) => isWmlNamed(n, 'tcPr')), empty],
      } as OoxmlElement;
    });
    above = active;
    promotedAbove = promoted;
    return replaceTableChildren(row, new Map(cells.map((c) => [c.id, c])));
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return restoreImplicitRowGrid(
    original,
    replaceTableChildren(rebuilt, byId),
    restoredProperties,
    mint
  );
}

/** Remove grid boundaries unused by any surviving cell; keep pending history in its original grid. */
export function compactRevisionGrid(table: OoxmlElement, mint: () => string): OoxmlElement {
  const grid = child(table, 'tblGrid');
  if (!grid) return table;
  if (
    tableChildren(table, 'tableRow').some(
      (row) =>
        !table.children.some((n) => n.id === row.id) ||
        tableChildren(row, 'tableCell').some((cell) => !row.children.some((n) => n.id === cell.id))
    )
  )
    return table;
  const columns = elements(grid).filter((n) => isWmlNamed(n, 'gridCol'));
  if (
    !columns.length ||
    columns.some((col) =>
      col.attributes.some(
        (attr) => attr.namespaceUri !== WML_NAMESPACE_URI || attr.localName !== 'w'
      )
    )
  )
    return table;
  const hasHistory = (n: OoxmlNode): boolean =>
    n.kind !== 'textValue' &&
    ((n.namespaceUri === WML_NAMESPACE_URI && /Change$/.test(n.localName)) ||
      n.children.some(hasHistory));
  if (hasHistory(table)) return table;
  const boundaries = new Set([0]);
  const ranges = new Map<string, [number, number]>();
  const rowRanges = new Map<string, [number, number]>();
  for (const row of table.children) {
    if (row.kind !== 'tableRow') continue;
    const trPr = child(row, 'trPr');
    let at = number(trPr && child(trPr, 'gridBefore'), 'val', 0);
    boundaries.add(at);
    const start = at;
    for (const cell of row.children) {
      if (cell.kind !== 'tableCell') continue;
      const pr = child(cell, 'tcPr');
      const end = at + number(pr && child(pr, 'gridSpan'), 'val', 1);
      ranges.set(cell.id, [at, end]);
      boundaries.add(end);
      at = end;
    }
    rowRanges.set(row.id, [start, at]);
    boundaries.add(at + number(trPr && child(trPr, 'gridAfter'), 'val', 0));
  }
  const sorted = [...boundaries].sort((a, b) => a - b);
  if (sorted.at(-1)! > columns.length || sorted.length < 2) return table;
  if (sorted.length === columns.length + 1) return table;
  const newColumns = sorted.slice(1).map((end, i) =>
    element(
      columns[sorted[i]!]!,
      'gridCol',
      {
        w: String(
          columns.slice(sorted[i], end).reduce((sum, col) => sum + positiveWidth(col, 0), 0)
        ),
      },
      mint
    )
  );
  const positions = new Map(sorted.map((pos, index) => [pos, index]));
  return {
    ...table,
    children: table.children.map((n) => {
      if (n.id === grid.id)
        return {
          ...grid,
          children: [...newColumns, ...grid.children.filter((c) => !isWmlNamed(c, 'gridCol'))],
        } as OoxmlElement;
      if (n.kind !== 'tableRow') return n;
      const range = rowRanges.get(n.id)!;
      const before = positions.get(range[0])!;
      const after = sorted.length - 1 - positions.get(range[1])!;
      const pr = child(n, 'trPr');
      const properties =
        pr?.children.filter((c) => !isWmlNamed(c, 'gridBefore') && !isWmlNamed(c, 'gridAfter')) ??
        [];
      const insertion = properties.findIndex((property) => !isWmlNamed(property, 'cnfStyle'));
      const offsets = [
        ...(before ? [element(pr ?? n, 'gridBefore', { val: String(before) }, mint)] : []),
        ...(after ? [element(pr ?? n, 'gridAfter', { val: String(after) }, mint)] : []),
      ];
      properties.splice(insertion < 0 ? properties.length : insertion, 0, ...offsets);
      const rowProperties = pr
        ? ({ ...pr, children: properties } as OoxmlElement)
        : properties.length
          ? ({ ...element(n, 'trPr', {}, mint), children: properties } as OoxmlElement)
          : undefined;
      const rest = n.children
        .filter((c) => !isWmlNamed(c, 'trPr'))
        .map((c) => {
          const range = ranges.get(c.id);
          if (!range || c.kind !== 'tableCell') return c;
          const span = positions.get(range[1])! - positions.get(range[0])!;
          return patch(c, { gridSpan: span === 1 ? null : { val: String(span) } }, mint);
        });
      // A row states `w:tblPrEx` first, then `w:trPr`.
      const at = rest.findIndex((c) => isWmlNamed(c, 'tblPrEx')) + 1;
      return {
        ...n,
        children: rowProperties ? [...rest.slice(0, at), rowProperties, ...rest.slice(at)] : rest,
      } as OoxmlElement;
    }),
  } as OoxmlElement;
}
