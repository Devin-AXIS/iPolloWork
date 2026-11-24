// The embedded workbook of a chart (`c:externalData`, ECMA-376 Part 1, 21.2.2.63): the package
// part that holds the chart's cells, usually a SpreadsheetML package (ECMA-376 Part 1, 18). A
// data edit writes the same values into the cells that the chart's references name, so the
// workbook and the caches agree. The workbook is untrusted: it is read with the bounded zip and
// XML readers, and a structure that the edit cannot keep valid leaves the workbook as it was:
// a formula in a target cell, a merged cell or a table that crosses the chart's table in
// another shape, or names that a table cannot take. Only the worksheet and its tables are
// written again; every other entry keeps its bytes.

import { DEFAULT_ZIP_LIMITS, readZip, strFromU8, writeZip } from '../zip.ts';
import { resolveInternalTarget } from '../opc-names.ts';
import {
  attr,
  child,
  children,
  elements,
  parseXmlPart,
  plainAttr,
  serializeXmlPart,
  type Element,
  type Node,
} from './tree.ts';
import type { ChartWorkbookState } from './types.ts';
import {
  columnLetters,
  columnNumber,
  maxOf,
  minOf,
  sheetName,
  type SheetLayout,
} from './data-model.ts';
import type { ChartEditPlan } from './data-write.ts';

const NS_S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_XML = 'http://www.w3.org/XML/1998/namespace' as const;
const REL_PACKAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/package';
const REL_OFFICE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const REL_SHEET = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
const REL_TABLE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/table';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The largest embedded workbook an edit opens. */
const MAX_WORKBOOK_BYTES = 32 * 1024 * 1024;

/** The workbook of a chart part. */
export interface ChartWorkbook {
  readonly state: ChartWorkbookState;
  /** The package part of an embedded workbook. */
  readonly part?: string;
  /** The `c:externalData` element. */
  readonly externalData?: Element;
}

/** What a chart edit reads from the package around a chart part. */
export interface ChartPackageView {
  /** The relationship `id` of the chart part, or undefined. */
  relationship(
    id: string
  ): { readonly type: string; readonly external: boolean; readonly target?: string } | undefined;
  /** The content type of a part, or undefined. */
  contentType(part: string): string | undefined;
  /** The bytes of a binary part, or undefined. */
  bytes(part: string): Uint8Array | undefined;
}

/** The workbook that a chart part names, and where it is. Never opens it. */
export function chartWorkbook(view: ChartPackageView, chartSpace: Element): ChartWorkbook {
  const externalData = child(chartSpace, 'c:externalData');
  const id = attr(externalData, 'r:id');
  if (!externalData || !id) return { state: 'none' };
  const rel = view.relationship(id);
  if (!rel) return { state: 'none', externalData };
  if (rel.external) return { state: 'external', externalData };
  const part = rel.target;
  const type = part ? view.contentType(part)?.trim().toLowerCase() : undefined;
  if (!part || rel.type !== REL_PACKAGE || type !== XLSX_TYPE)
    return { state: 'kept', externalData };
  return { state: 'embedded', part, externalData };
}

// --- Reading the package ------------------------------------------------------------------------

type Entries = Map<string, Uint8Array>;

function xmlOf(entries: Entries, name: string): Element | undefined {
  const bytes = entries.get(name);
  if (!bytes) return undefined;
  const tree = parseXmlPart(name, strFromU8(bytes));
  return tree.ok ? tree.part.root : undefined;
}

/** The internal targets of a part's relationships of one type, by id. */
function relsOf(entries: Entries, owner: string, type: string): Map<string, string> {
  const slash = owner.lastIndexOf('/');
  const root = xmlOf(entries, `${owner.slice(0, slash)}/_rels/${owner.slice(slash + 1)}.rels`);
  const out = new Map<string, string>();
  for (const r of children(root, { namespaceUri: NS_REL, localName: 'Relationship' })) {
    const id = attr(r, 'Id');
    const target = attr(r, 'Target');
    if (!id || !target || attr(r, 'Type') !== type || attr(r, 'TargetMode') === 'External')
      continue;
    const name = resolveInternalTarget(owner === '/' ? '/x' : owner, target);
    if (name.ok) out.set(id, name.partName);
  }
  return out;
}

const s = (el: Element | undefined, local: string): Element | undefined =>
  child(el, { namespaceUri: NS_S, local });
const ss = (el: Element | undefined, local: string): Element[] =>
  children(el, { namespaceUri: NS_S, local });

// --- The cells of the edit ----------------------------------------------------------------------

/** A cell value to write: a number, text, or nothing (a cleared cell). */
type CellValue = number | string | null;

/** A rectangle of cells, 1-based and inclusive. */
interface Rect {
  readonly c1: number;
  readonly r1: number;
  readonly c2: number;
  readonly r2: number;
}

/** The sheet cell of a table position: `line` across, `at` along the categories. */
function cellAt(layout: SheetLayout, line: number, at: number): [number, number] {
  return layout.orientation === 'cols' ? [line, at] : [at, line];
}

/** The rectangle of the chart's table: the header, the categories, and every series. */
function tableRect(layout: SheetLayout, count: number): Rect {
  const lines = [
    ...layout.lines,
    ...(layout.categoryLine !== undefined ? [layout.categoryLine] : []),
  ];
  const first = layout.header ?? layout.start;
  const [c1, r1] = cellAt(layout, minOf(lines), first);
  const [c2, r2] = cellAt(layout, maxOf(lines), layout.start + count - 1);
  return { c1, r1, c2, r2 };
}

/** Every cell the edit writes, by `column,row`: the new table, and the old cells it clears. */
function cellsOf(
  plan: ChartEditPlan,
  old: SheetLayout,
  layout: SheetLayout
): Map<string, CellValue> {
  const out = new Map<string, CellValue>();
  const set = (line: number, at: number, v: CellValue): void => {
    const [col, row] = cellAt(layout, line, at);
    out.set(`${col},${row}`, v);
  };
  const oldCount = plan.model.categories.length;
  // The old table goes first, so the new values replace what it clears.
  for (const line of [
    ...old.lines,
    ...(old.categoryLine !== undefined ? [old.categoryLine] : []),
  ]) {
    if (old.header !== undefined && line !== old.categoryLine) set(line, old.header, null);
    for (let k = 0; k < oldCount; k += 1) set(line, old.start + k, null);
  }
  const count = plan.labels.length;
  if (layout.categoryLine !== undefined)
    plan.labels.forEach((label, k) =>
      set(layout.categoryLine!, layout.start + k, plan.numericCategories ? Number(label) : label)
    );
  plan.series.forEach((series, j) => {
    const line = layout.lines[j]!;
    if (layout.header !== undefined) set(line, layout.header, series.name);
    for (let k = 0; k < count; k += 1) set(line, layout.start + k, series.values[k] ?? null);
  });
  return out;
}

// --- Writing cells ------------------------------------------------------------------------------

function sEl(local: string, attrs: readonly [string, string][], kids: Node[] = []): Element {
  return {
    id: '',
    kind: 'generic',
    namespaceUri: NS_S,
    localName: local,
    namespaceBindings: [],
    attributes: attrs.map(([name, value]) => plainAttr(name, value)),
    children: kids,
  };
}

const text = (value: string): Node => ({ kind: 'textValue', id: '', value });

/** A cell with a new value, keeping its style (`s`). Undefined: no cell is needed. */
function writtenCell(ref: string, old: Element | undefined, v: CellValue): Element | undefined {
  const style = attr(old, 's');
  const attrs: [string, string][] = [
    ['r', ref],
    ...(style ? [['s', style] as [string, string]] : []),
  ];
  if (v === null) return style ? sEl('c', attrs) : undefined;
  if (typeof v === 'number') return sEl('c', attrs, [sEl('v', [], [text(String(v))])]);
  // An inline string (ECMA-376 Part 1, 18.3.1.53): the shared string table stays as it is.
  const t: Element = {
    ...sEl('t', [], v === '' ? [] : [text(v)]),
    attributes:
      v.trim() === v
        ? []
        : [
            {
              kind: 'xmlSpace',
              namespaceUri: NS_XML,
              localName: 'space',
              prefix: 'xml',
              value: 'preserve',
            },
          ],
  };
  return sEl('c', [...attrs, ['t', 'inlineStr']], [sEl('is', [], [t])]);
}

const CELL_REF = /^([A-Z]{1,3})([0-9]{1,7})$/;

/** The column and row of a cell reference, or undefined. */
function parseCell(ref: string | undefined): [number, number] | undefined {
  const m = ref ? CELL_REF.exec(ref) : null;
  const col = m ? columnNumber(m[1]!) : undefined;
  return m && col ? [col, Number(m[2])] : undefined;
}

/**
 * The new `sheetData`, or undefined when a target cell holds a formula, a reference is missing,
 * or a target cell outside `owned` (the chart's table before the edit) holds content: a grown
 * table never overwrites the cells beside it.
 */
function writeSheetData(
  sheetData: Element,
  cells: Map<string, CellValue>,
  owned: Rect
): Element | undefined {
  const rows = new Map<number, { el: Element; cells: Map<number, Element> }>();
  for (const row of ss(sheetData, 'row')) {
    const r = Number(attr(row, 'r'));
    if (!Number.isInteger(r) || r < 1 || rows.has(r)) return undefined;
    const byCol = new Map<number, Element>();
    for (const cell of ss(row, 'c')) {
      const at = parseCell(attr(cell, 'r'));
      if (!at || at[1] !== r || byCol.has(at[0])) return undefined;
      byCol.set(at[0], cell);
    }
    if (elements(row).length !== byCol.size) return undefined;
    rows.set(r, { el: row, cells: byCol });
  }
  for (const [key, v] of cells) {
    const [col, row] = key.split(',').map(Number) as [number, number];
    let entry = rows.get(row);
    const old = entry?.cells.get(col);
    if (old && (s(old, 'f') || attr(old, 'cm') || attr(old, 'vm'))) return undefined;
    const inside = col >= owned.c1 && col <= owned.c2 && row >= owned.r1 && row <= owned.r2;
    if (old && !inside && elements(old).length > 0) return undefined;
    const next = writtenCell(`${columnLetters(col)}${row}`, old, v);
    if (!entry) {
      if (!next) continue;
      entry = { el: sEl('row', [['r', String(row)]]), cells: new Map() };
      rows.set(row, entry);
    }
    if (next) entry.cells.set(col, next);
    else entry.cells.delete(col);
  }
  const rowEls: Node[] = [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, { el, cells: byCol }]) => ({
      ...el,
      // `spans` is an optional hint of the row's columns; an edit can change them.
      attributes: el.attributes.filter((a) => !(a.namespaceUri === '' && a.localName === 'spans')),
      children: [...byCol.entries()].sort(([a], [b]) => a - b).map(([, c]) => c),
    }))
    .filter((row) => row.children.length > 0 || row.attributes.length > 1);
  return { ...sheetData, children: rowEls };
}

/** The used range of a sheet's cells, as `A1:D5`. */
function dimensionOf(sheetData: Element): string {
  let c1 = Infinity;
  let r1 = Infinity;
  let c2 = 0;
  let r2 = 0;
  for (const row of ss(sheetData, 'row'))
    for (const cell of ss(row, 'c')) {
      const [col, r] = parseCell(attr(cell, 'r'))!;
      c1 = Math.min(c1, col);
      r1 = Math.min(r1, r);
      c2 = Math.max(c2, col);
      r2 = Math.max(r2, r);
    }
  if (c2 === 0) return 'A1';
  const a = `${columnLetters(c1)}${r1}`;
  const b = `${columnLetters(c2)}${r2}`;
  return a === b ? a : `${a}:${b}`;
}

function parseRect(ref: string | undefined): Rect | undefined {
  const [a, b = a] = (ref ?? '').split(':');
  const from = parseCell(a);
  const to = parseCell(b);
  return from && to ? { c1: from[0], r1: from[1], c2: to[0], r2: to[1] } : undefined;
}

const rectText = (r: Rect): string => `${columnLetters(r.c1)}${r.r1}:${columnLetters(r.c2)}${r.r2}`;
const sameRect = (a: Rect, b: Rect): boolean =>
  a.c1 === b.c1 && a.r1 === b.r1 && a.c2 === b.c2 && a.r2 === b.r2;
const crosses = (a: Rect, b: Rect): boolean =>
  a.c1 <= b.c2 && b.c1 <= a.c2 && a.r1 <= b.r2 && b.r1 <= a.r2;

/** `el` with the attribute `local` set, in its place when it has one. */
function withAttr(el: Element, local: string, value: string): Element {
  const at = el.attributes.findIndex((a) => a.namespaceUri === '' && a.localName === local);
  const attrs = [...el.attributes];
  if (at >= 0) attrs[at] = { ...attrs[at]!, kind: 'genericExtension', value };
  else attrs.push(plainAttr(local, value));
  return { ...el, attributes: attrs };
}

/**
 * A table (`table`, ECMA-376 Part 1, 18.5.1.2) that held the chart's table, reshaped to the new
 * one, or undefined when it cannot take the new shape: a total row, no header row, or names that
 * are empty, repeated, or hold a line break. Its columns keep their ids and names by position;
 * each series column takes its series name, as its header cell does.
 */
function reshapedTable(
  table: Element,
  next: Rect,
  layout: SheetLayout,
  names: readonly string[]
): Element | undefined {
  if (Number(attr(table, 'totalsRowCount') ?? 0) > 0 || attr(table, 'headerRowCount') === '0')
    return undefined;
  if ((attr(table, 'tableType') ?? 'worksheet') !== 'worksheet') return undefined;
  // Filter and sort state, and column formulas and formats, name columns by position.
  const filter = s(table, 'autoFilter');
  if (filter && elements(filter).length > 0) return undefined;
  if (s(table, 'sortState')) return undefined;
  if (ss(s(table, 'tableColumns'), 'tableColumn').some((c) => elements(c).length > 0))
    return undefined;
  const columns = s(table, 'tableColumns');
  const old = ss(columns, 'tableColumn');
  if (layout.orientation !== 'cols' || layout.header === undefined || !columns) return undefined;
  const width = next.c2 - next.c1 + 1;
  const ids = old.map((c) => Number(attr(c, 'id')));
  let nextId = maxOf(ids.filter(Number.isFinite), 0);
  const seriesAt = new Map(layout.lines.map((line, j) => [line, names[j]!]));
  const cols: Element[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < width; i += 1) {
    const name = seriesAt.get(next.c1 + i) ?? attr(old[i], 'name');
    if (!name || /[\r\n]/.test(name) || seen.has(name.toLowerCase())) return undefined;
    seen.add(name.toLowerCase());
    const kept = old[i];
    cols.push(
      kept
        ? withAttr(kept, 'name', name)
        : sEl('tableColumn', [
            ['id', String((nextId += 1))],
            ['name', name],
          ])
    );
  }
  const ref = rectText(next);
  const kids = table.children.map((k) => {
    if (k === columns) return withAttr({ ...columns, children: cols }, 'count', String(width));
    if (k.kind !== 'textValue' && k.namespaceUri === NS_S && k.localName === 'autoFilter')
      return withAttr(k, 'ref', ref);
    return k;
  });
  return withAttr({ ...table, children: kids }, 'ref', ref);
}

/**
 * The workbook with the edit's values in the cells its references name, or undefined when the
 * workbook cannot take them safely. `old` is the chart's table before the edit.
 */
export function updatedWorkbook(
  bytes: Uint8Array,
  plan: ChartEditPlan,
  old: SheetLayout
): Uint8Array | undefined {
  const layout = plan.layout;
  if (!layout || bytes.length > MAX_WORKBOOK_BYTES) return undefined;
  const zip = readZip(bytes, DEFAULT_ZIP_LIMITS);
  if (!zip.ok) return undefined;
  const entries: Entries = new Map(zip.entries);
  const book = [...relsOf(entries, '/', REL_OFFICE).values()][0];
  const workbook = book ? xmlOf(entries, book) : undefined;
  if (!book || !workbook) return undefined;
  const want = sheetName(layout.sheet).toLowerCase();
  const sheet = ss(s(workbook, 'sheets'), 'sheet').find(
    (e) => attr(e, 'name')?.toLowerCase() === want
  );
  const sheetPart = relsOf(entries, book, REL_SHEET).get(
    attr(sheet, { namespaceUri: NS_R, localName: 'id' }) ?? ''
  );
  const root = sheetPart ? xmlOf(entries, sheetPart) : undefined;
  const sheetData = s(root, 'sheetData');
  if (!sheetPart || !root || !sheetData) return undefined;
  const before = tableRect(old, plan.model.categories.length);
  const after = tableRect(layout, plan.labels.length);
  for (const merge of ss(s(root, 'mergeCells'), 'mergeCell')) {
    const r = parseRect(attr(merge, 'ref'));
    if (!r || crosses(r, before) || crosses(r, after)) return undefined;
  }
  // Tables that hold the chart's table take its new shape; any other table must stay clear.
  const tableParts = relsOf(entries, sheetPart, REL_TABLE);
  const writes = new Map<string, Element>();
  for (const tp of ss(s(root, 'tableParts'), 'tablePart')) {
    const name = tableParts.get(attr(tp, { namespaceUri: NS_R, localName: 'id' }) ?? '');
    const table = name ? xmlOf(entries, name) : undefined;
    const r = parseRect(attr(table, 'ref'));
    if (!name || !table || !r) return undefined;
    if (!crosses(r, before) && !crosses(r, after)) continue;
    if (!sameRect(r, before)) return undefined;
    const next = reshapedTable(
      table,
      after,
      layout,
      plan.series.map((x) => x.name)
    );
    if (!next) return undefined;
    writes.set(name, next);
  }
  const data = writeSheetData(sheetData, cellsOf(plan, old, layout), before);
  if (!data) return undefined;
  const kids = root.children.map((k) => {
    if (k === sheetData) return data;
    if (k.kind !== 'textValue' && k.namespaceUri === NS_S && k.localName === 'dimension')
      return withAttr(k, 'ref', dimensionOf(data));
    return k;
  });
  writes.set(sheetPart, { ...root, children: kids });
  const encoder = new TextEncoder();
  try {
    for (const [name, el] of writes) entries.set(name, encoder.encode(serializeXmlPart(name, el)));
    return writeZip(entries);
  } catch {
    // A value the writer refuses: the workbook stays as it was.
    return undefined;
  }
}
