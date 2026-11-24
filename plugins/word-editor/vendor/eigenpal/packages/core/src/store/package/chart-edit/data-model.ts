// The data of a chart part (`c:chartSpace`, ECMA-376 Part 1, 21.2.2.27), as the Chart Data
// tab and `setChartData` read it: the series of the one plot of the chart, their names
// (`c:tx`), their categories (`c:cat`, or `c:xVal` of a scatter chart), and their values
// (`c:val`, or `c:yVal`), from the caches the chart part holds (`c:strCache`, `c:numCache`) or
// from literal values (`c:strLit`, `c:numLit`). The cell references (`c:f`) give the place of
// each value in the chart's workbook: `sheetLayout` finds one table of categories by series that
// all references agree on, so an edit can write the same table back.
//
// Every value comes from an untrusted part: counts are capped, and a chart whose data does not
// have one of the supported shapes reads as not editable, with the reason as a translation key.

import { attr, child, children, elements, NS, type Element } from './tree.ts';
import type { ChartDataKind } from './types.ts';

/** The most categories and series an edit reads or writes. */
export const MAX_CHART_POINTS = 4000;
export const MAX_CHART_SERIES = 255;
/** The longest series name or category label, in UTF-16 code units. */
export const MAX_CHART_LABEL = 255;

/** The largest of `values` and `floor`, by a loop: a spread is unbounded on file data. */
export function maxOf(values: Iterable<number>, floor = -Infinity): number {
  let max = floor;
  for (const v of values) if (v > max) max = v;
  return max;
}

/** The smallest of `values` and `ceiling`, by a loop. */
export function minOf(values: Iterable<number>, ceiling = Infinity): number {
  let min = ceiling;
  for (const v of values) if (v < min) min = v;
  return min;
}

/** The plot elements whose data the editor edits, with their data shape. */
const PLOTS: Readonly<Record<string, ChartDataKind>> = {
  barChart: 'category',
  bar3DChart: 'category',
  lineChart: 'category',
  line3DChart: 'category',
  areaChart: 'category',
  area3DChart: 'category',
  pieChart: 'category',
  pie3DChart: 'category',
  doughnutChart: 'category',
  radarChart: 'category',
  scatterChart: 'xy',
};

/** Plot elements whose data shape the editor does not edit (ECMA-376 Part 1, 21.2.2). */
const OTHER_PLOTS = new Set([
  'bubbleChart',
  'stockChart',
  'surfaceChart',
  'surface3DChart',
  'ofPieChart',
]);

/** Where the values of one data reference come from. */
export type SourceKind = 'strRef' | 'numRef' | 'strLit' | 'numLit' | 'v';

/** One read data reference: `c:tx`, `c:cat`, `c:val`, `c:xVal`, or `c:yVal`. */
export interface DataSource {
  readonly kind: SourceKind;
  /** The cell reference (`c:f`), for `strRef` and `numRef`. */
  readonly formula?: string;
  /** The number format of a numeric cache or literal (`c:formatCode`). */
  readonly formatCode?: string;
  /** The values by point index; a missing point is undefined. */
  readonly values: readonly (string | undefined)[];
}

/** One read series. */
export interface ReadSeries {
  readonly el: Element;
  readonly name: string;
  readonly tx?: DataSource;
  readonly cat?: DataSource;
  readonly val?: DataSource;
}

/** The read data of a chart part. */
export interface ChartModel {
  readonly kind: ChartDataKind;
  /** The plot element (`c:barChart`, `c:scatterChart`, …). */
  readonly plot: Element;
  /** The series in plot order (`c:order`). */
  readonly series: readonly ReadSeries[];
  /** The category labels (X values), or `1`, `2`, … when no series has categories. */
  readonly categories: readonly string[];
  /** Whether a series has categories (`c:cat` or `c:xVal`). */
  readonly hasCategories: boolean;
  /** Whether the categories are numbers (`c:numRef`, `c:numLit`). */
  readonly numericCategories: boolean;
  /** The workbook table that every reference agrees on, or undefined. */
  readonly layout?: SheetLayout;
  /** Whether any data reference names cells (`c:f`). */
  readonly hasFormulas: boolean;
}

/** A read chart model, or the translation key of why its data is not editable. */
export type ChartModelRead =
  | { readonly ok: true; readonly model: ChartModel }
  | { readonly ok: false; readonly reason: string };

/** A cell range of one formula, in 1-based columns and rows. */
export interface CellRange {
  /** The sheet as the formula spells it, quotes included: written back as it was. */
  readonly sheet: string;
  readonly c1: number;
  readonly r1: number;
  readonly c2: number;
  readonly r2: number;
}

/**
 * The table of categories by series in one sheet, as the references name it. In `cols`
 * orientation each series is a column, and the categories run down the rows; in `rows`
 * orientation each series is a row. `line` is a series' column (or row); `start` is the first
 * category's row (or column); `header` is the row (or column) of the series names.
 */
export interface SheetLayout {
  readonly sheet: string;
  readonly orientation: 'cols' | 'rows';
  readonly start: number;
  readonly header?: number;
  readonly categoryLine?: number;
  /** The line of each series, in plot order. */
  readonly lines: readonly number[];
}

const MAX_COLUMN = 16_384;
const MAX_ROW = 1_048_576;

/** The 1-based column of letters (`A` is 1, `XFD` is 16384), or undefined. */
export function columnNumber(letters: string): number | undefined {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n >= 1 && n <= MAX_COLUMN ? n : undefined;
}

/** The letters of a 1-based column. */
export function columnLetters(n: number): string {
  let s = '';
  for (let v = n; v > 0; v = Math.floor((v - 1) / 26))
    s = String.fromCharCode(65 + ((v - 1) % 26)) + s;
  return s;
}

const REF = /^(.+)!\$?([A-Z]{1,3})\$?([0-9]{1,7})(?::\$?([A-Z]{1,3})\$?([0-9]{1,7}))?$/;

/** The range of a one-area formula such as `Sheet1!$B$2:$B$5`, or undefined. */
export function parseRange(formula: string | undefined): CellRange | undefined {
  const m = formula === undefined ? null : REF.exec(formula.trim());
  if (!m) return undefined;
  const sheet = m[1]!;
  // A quoted name is `'…'` with `''` for a quote; an unquoted one has no quote or separator.
  if (sheet.startsWith("'") ? !/^'(?:[^']|'')+'$/.test(sheet) : /[' !,()]/.test(sheet))
    return undefined;
  const c1 = columnNumber(m[2]!);
  const r1 = Number(m[3]);
  const c2 = m[4] ? columnNumber(m[4]) : c1;
  const r2 = m[5] ? Number(m[5]) : r1;
  if (!c1 || !c2 || r1 < 1 || r2 < 1 || r1 > MAX_ROW || r2 > MAX_ROW) return undefined;
  if (c2 < c1 || r2 < r1) return undefined;
  return { sheet, c1, r1, c2, r2 };
}

/** The sheet name of a formula's sheet part, without quotes. */
export function sheetName(sheet: string): string {
  return sheet.startsWith("'") ? sheet.slice(1, -1).replaceAll("''", "'") : sheet;
}

/** A formula for one cell or one line of cells. */
export function rangeFormula(
  sheet: string,
  c1: number,
  r1: number,
  c2: number,
  r2: number
): string {
  const one = `$${columnLetters(c1)}$${r1}`;
  return c1 === c2 && r1 === r2 ? `${sheet}!${one}` : `${sheet}!${one}:$${columnLetters(c2)}$${r2}`;
}

const c = (el: Element | undefined, local: string): Element | undefined =>
  child(el, { namespaceUri: NS.c, local });

/** The points of a cache or literal (`c:ptCount`, `c:pt`), capped; undefined past the cap. */
function pointsOf(el: Element): (string | undefined)[] | undefined {
  const count = Number(attr(c(el, 'ptCount'), 'val') ?? 0);
  const pts = children(el, { namespaceUri: NS.c, localName: 'pt' });
  if (!Number.isInteger(count) || count < 0 || count > MAX_CHART_POINTS) return undefined;
  if (pts.length > MAX_CHART_POINTS) return undefined;
  const out: (string | undefined)[] = Array.from({ length: count }, () => undefined);
  for (const pt of pts) {
    const idx = Number(attr(pt, 'idx'));
    if (!Number.isInteger(idx) || idx < 0 || idx >= count) continue;
    const v = c(pt, 'v');
    out[idx] = v ? textOf(v) : undefined;
  }
  return out;
}

function textOf(el: Element): string {
  let s = '';
  for (const n of el.children) if (n.kind === 'textValue') s += n.value;
  return s;
}

/** Read one data reference, or a reason. `parent` is `c:tx`, `c:cat`, `c:val`, … */
function sourceOf(parent: Element): DataSource | string {
  const v = c(parent, 'v');
  if (v) return { kind: 'v', values: [textOf(v)] };
  for (const kind of ['strRef', 'numRef', 'strLit', 'numLit'] as const) {
    const el = c(parent, kind);
    if (!el) continue;
    const ref = kind === 'strRef' || kind === 'numRef';
    const store = ref ? c(el, kind === 'strRef' ? 'strCache' : 'numCache') : el;
    const values = store ? pointsOf(store) : [];
    if (!values) return 'chart.errors.tooLarge';
    const formatCode = store ? textOf(c(store, 'formatCode') ?? EMPTY) : undefined;
    return {
      kind,
      ...(ref ? { formula: textOf(c(el, 'f') ?? EMPTY) } : {}),
      ...(kind === 'numRef' || kind === 'numLit' ? { formatCode: formatCode || 'General' } : {}),
      values,
    };
  }
  // `c:multiLvlStrRef`: categories in more than one level.
  return 'chart.errors.multiLevel';
}

const EMPTY: Element = {
  id: '',
  kind: 'generic',
  namespaceUri: NS.c,
  localName: 'f',
  namespaceBindings: [],
  attributes: [],
  children: [],
};

/** The plot elements of a chart's plot area. */
function plotsOf(chartSpace: Element): Element[] {
  const plotArea = c(c(chartSpace, 'chart'), 'plotArea');
  return elements(plotArea).filter(
    (e) => e.namespaceUri === NS.c && (e.localName in PLOTS || OTHER_PLOTS.has(e.localName))
  );
}

/** Whether a plot hides series behind a filter (`c15:filtered…Series`, in `c:extLst`). */
function hasFilteredSeries(chartSpace: Element): boolean {
  const plotArea = c(c(chartSpace, 'chart'), 'plotArea');
  for (const plot of elements(plotArea))
    for (const ext of children(c(plot, 'extLst'), { namespaceUri: NS.c, localName: 'ext' }))
      if (elements(ext).some((e) => /^filtered.*Series$/.test(e.localName))) return true;
  return false;
}

/** Read the data of a chart part, or the reason why it is not editable. */
export function readChartModel(chartSpace: Element): ChartModelRead {
  const plots = plotsOf(chartSpace);
  if (plots.length === 0) return { ok: false, reason: 'chart.errors.noData' };
  if (plots.length > 1) return { ok: false, reason: 'chart.errors.combination' };
  const plot = plots[0]!;
  const kind = PLOTS[plot.localName];
  if (!kind) return { ok: false, reason: 'chart.errors.unsupportedType' };
  if (hasFilteredSeries(chartSpace)) return { ok: false, reason: 'chart.errors.filtered' };
  const sers = children(plot, { namespaceUri: NS.c, localName: 'ser' });
  if (sers.length === 0) return { ok: false, reason: 'chart.errors.noData' };
  if (sers.length > MAX_CHART_SERIES) return { ok: false, reason: 'chart.errors.tooLarge' };
  const catName = kind === 'xy' ? 'xVal' : 'cat';
  const valName = kind === 'xy' ? 'yVal' : 'val';
  const read: { el: Element; order: number; at: number; s: ReadSeries }[] = [];
  for (const [at, el] of sers.entries()) {
    const parts: Partial<Record<'tx' | 'cat' | 'val', DataSource>> = {};
    for (const [key, local] of [
      ['tx', 'tx'],
      ['cat', catName],
      ['val', valName],
    ] as const) {
      const holder = c(el, local);
      if (!holder) continue;
      const source = sourceOf(holder);
      if (typeof source === 'string') return { ok: false, reason: source };
      if (key === 'val' && source.kind !== 'numRef' && source.kind !== 'numLit')
        return { ok: false, reason: 'chart.errors.unsupportedType' };
      if (key === 'tx' && source.kind !== 'v' && source.kind !== 'strRef')
        return { ok: false, reason: 'chart.errors.unsupportedType' };
      parts[key] = source;
    }
    const order = Number(attr(c(el, 'order'), 'val'));
    const name = parts.tx?.values.find((v) => v !== undefined) ?? '';
    read.push({ el, order: Number.isFinite(order) ? order : at, at, s: { el, name, ...parts } });
  }
  read.sort((a, b) => a.order - b.order || a.at - b.at);
  const series = read.map((r) => r.s);
  const withCats = series.filter((s) => s.cat);
  const first = withCats[0]?.cat;
  // One set of categories for the chart: every series that names categories names the same.
  for (const s of withCats) {
    const cat = s.cat!;
    if (
      cat.formula !== first!.formula ||
      cat.values.join('\u0000') !== first!.values.join('\u0000')
    )
      return { ok: false, reason: 'chart.errors.mixedCategories' };
  }
  const count = maxOf(
    series.map((s) => s.val?.values.length ?? 0),
    first?.values.length ?? 0
  );
  if (count === 0) return { ok: false, reason: 'chart.errors.noData' };
  if (count > MAX_CHART_POINTS) return { ok: false, reason: 'chart.errors.tooLarge' };
  const categories = Array.from({ length: count }, (_, i) =>
    first ? (first.values[i] ?? '') : String(i + 1)
  );
  const numericCategories = first?.kind === 'numRef' || first?.kind === 'numLit';
  const hasFormulas = series.some((s) => s.tx?.formula || s.cat?.formula || s.val?.formula);
  const layout = sheetLayout(series, count);
  return {
    ok: true,
    model: {
      kind,
      plot,
      series,
      categories,
      hasCategories: !!first,
      numericCategories,
      ...(layout ? { layout } : {}),
      hasFormulas,
    },
  };
}

/** A range as a line: its line, its first and last cell along the line, by orientation. */
function lineOf(
  r: CellRange,
  orientation: 'cols' | 'rows'
): { line: number; from: number; to: number } | undefined {
  if (orientation === 'cols')
    return r.c1 === r.c2 ? { line: r.c1, from: r.r1, to: r.r2 } : undefined;
  return r.r1 === r.r2 ? { line: r.r1, from: r.c1, to: r.c2 } : undefined;
}

/**
 * The table that every reference of the chart names, or undefined. Each series names its values
 * as one line of `count` cells, all in one sheet, starting at the same place; the names, when
 * referenced, are one cell each in the same header line before the values; and the categories,
 * when referenced, are one line beside them.
 */
export function sheetLayout(series: readonly ReadSeries[], count: number): SheetLayout | undefined {
  for (const orientation of ['cols', 'rows'] as const) {
    const layout = layoutFor(series, count, orientation);
    if (layout) return layout;
  }
  return undefined;
}

function layoutFor(
  series: readonly ReadSeries[],
  count: number,
  orientation: 'cols' | 'rows'
): SheetLayout | undefined {
  let sheet: string | undefined;
  let start: number | undefined;
  let header: number | undefined;
  let headerSeen: boolean | undefined;
  const lines: number[] = [];
  const sameSheet = (r: CellRange): boolean => (sheet ??= r.sheet) === r.sheet;
  for (const s of series) {
    const range = parseRange(s.val?.formula);
    const line = range && lineOf(range, orientation);
    if (!range || !line || !sameSheet(range) || line.to - line.from + 1 !== count) return undefined;
    if ((start ??= line.from) !== line.from || lines.includes(line.line)) return undefined;
    lines.push(line.line);
    const tx = s.tx?.formula ? parseRange(s.tx.formula) : undefined;
    if (s.tx?.formula && !tx) return undefined;
    if ((headerSeen ??= !!tx) !== !!tx) return undefined;
    if (tx) {
      const [cell, at] = orientation === 'cols' ? [tx.c1, tx.r1] : [tx.r1, tx.c1];
      if (tx.c1 !== tx.c2 || tx.r1 !== tx.r2 || !sameSheet(tx) || cell !== line.line)
        return undefined;
      if ((header ??= at) !== at || at >= start) return undefined;
    }
  }
  const catFormula = series.find((s) => s.cat)?.cat?.formula;
  let categoryLine: number | undefined;
  if (catFormula) {
    const range = parseRange(catFormula);
    const line = range && lineOf(range, orientation);
    if (!range || !line || !sameSheet(range)) return undefined;
    if (line.from !== start || line.to - line.from + 1 !== count || lines.includes(line.line))
      return undefined;
    categoryLine = line.line;
  }
  return {
    sheet: sheet!,
    orientation,
    start: start!,
    ...(header !== undefined ? { header } : {}),
    ...(categoryLine !== undefined ? { categoryLine } : {}),
    lines,
  };
}
