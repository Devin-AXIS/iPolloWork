// The new series of a chart part after a data edit (`setChartData`). Each series keeps every
// child it had, in place, except its data: the name (`c:tx`), the categories (`c:cat` or
// `c:xVal`), and the values (`c:val` or `c:yVal`) are written again from the plan, with their
// caches, point counts, and cell references in agreement. Data point formatting (`c:dPt`) and
// data labels (`c:dLbl`) follow their category, and go with it. A new series copies the plain
// structure of a neighbor (ECMA-376 Part 1, 21.2.2.168 and the other `CT_*Ser` types) with no
// formatting of its own, so it takes the automatic look of its index.

import {
  attr,
  ChartRefusal,
  child,
  elements,
  isValidXmlText,
  NS,
  plainAttr,
  type Element,
  type Node,
} from './tree.ts';
import type { ChartData } from './types.ts';
import {
  MAX_CHART_LABEL,
  MAX_CHART_POINTS,
  MAX_CHART_SERIES,
  maxOf,
  minOf,
  rangeFormula,
  type ChartModel,
  type DataSource,
  type ReadSeries,
  type SheetLayout,
} from './data-model.ts';

/** One series of the edit, with its line in the new workbook table. */
export interface PlannedSeries {
  readonly name: string;
  readonly values: readonly (number | null)[];
  readonly source?: number;
  readonly line?: number;
}

/** A checked data edit: the new categories and series, and the new workbook table. */
export interface ChartEditPlan {
  readonly model: ChartModel;
  readonly labels: readonly string[];
  /** For each new category, the old category it continues. */
  readonly categorySources: readonly (number | undefined)[];
  readonly series: readonly PlannedSeries[];
  /** Whether the categories stay numbers. */
  readonly numericCategories: boolean;
  /** The workbook table after the edit, when the chart has one. */
  readonly layout?: SheetLayout;
}

const isNumber = (label: string): boolean => label.trim() !== '' && Number.isFinite(Number(label));

function checkLabel(label: unknown): string {
  if (typeof label !== 'string' || label.length > MAX_CHART_LABEL || !isValidXmlText(label))
    throw new ChartRefusal('chart.errors.invalidText');
  return label;
}

function checkSource(source: unknown, length: number, seen: Set<number>): number | undefined {
  if (source === undefined) return undefined;
  if (typeof source !== 'number' || !Number.isInteger(source) || source < 0 || source >= length)
    throw new ChartRefusal('chart.errors.unsupported', 'source');
  if (seen.has(source)) throw new ChartRefusal('chart.errors.unsupported', 'source');
  seen.add(source);
  return source;
}

/** Check new data against the read chart, and plan the edit. Throws `ChartRefusal`. */
export function planChartEdit(model: ChartModel, data: Omit<ChartData, 'workbook'>): ChartEditPlan {
  if (!data || typeof data !== 'object' || data.kind !== model.kind)
    throw new ChartRefusal('chart.errors.unsupported', 'kind');
  const { categories, series } = data;
  if (!Array.isArray(categories) || !Array.isArray(series))
    throw new ChartRefusal('chart.errors.unsupported', 'data');
  if (categories.length === 0 || series.length === 0) throw new ChartRefusal('chart.errors.empty');
  if (categories.length > MAX_CHART_POINTS || series.length > MAX_CHART_SERIES)
    throw new ChartRefusal('chart.errors.tooLarge');
  const seenCategories = new Set<number>();
  const labels = categories.map((cat) => checkLabel(cat?.label));
  const categorySources = categories.map((cat) =>
    checkSource(cat.source, model.categories.length, seenCategories)
  );
  const seenSeries = new Set<number>();
  const planned = series.map((s) => {
    const name = checkLabel(s?.name);
    if (!Array.isArray(s.values) || s.values.length !== labels.length)
      throw new ChartRefusal('chart.errors.unsupported', 'values');
    for (const v of s.values)
      if (v !== null && (typeof v !== 'number' || !Number.isFinite(v)))
        throw new ChartRefusal('chart.errors.notNumber');
    const source = checkSource(s.source, model.series.length, seenSeries);
    return { name, values: [...s.values], ...(source !== undefined ? { source } : {}) };
  });
  // The X values of a scatter chart are numbers, unless the chart names them as text.
  const numericX = model.kind === 'xy' && (model.numericCategories || !model.hasCategories);
  if (numericX && !labels.every(isNumber)) throw new ChartRefusal('chart.errors.notNumber');
  const numericCategories = (model.numericCategories || numericX) && labels.every(isNumber);
  const structural =
    labels.length !== model.categories.length ||
    categorySources.some((s, i) => s !== i) ||
    planned.length !== model.series.length ||
    planned.some((s, i) => s.source !== i);
  if (structural && model.hasFormulas && !model.layout)
    throw new ChartRefusal('chart.errors.layout');
  const layout = model.layout;
  if (!layout) return { model, labels, categorySources, series: planned, numericCategories };
  const firstLine = minOf(layout.lines);
  const linesOf = compactTable(layout) ? (j: number) => firstLine + j : undefined;
  let next = maxOf(layout.lines, layout.categoryLine ?? 0);
  const withLines = planned.map((s, j) => ({
    ...s,
    line: linesOf ? linesOf(j) : s.source !== undefined ? layout.lines[s.source]! : (next += 1),
  }));
  next = maxOf(
    withLines.map((s) => s.line),
    next
  );
  if (next > (layout.orientation === 'cols' ? 16_384 : 1_048_576))
    throw new ChartRefusal('chart.errors.tooLarge');
  if (layout.start + labels.length - 1 > (layout.orientation === 'cols' ? 1_048_576 : 16_384))
    throw new ChartRefusal('chart.errors.tooLarge');
  return {
    model,
    labels,
    categorySources,
    series: withLines,
    numericCategories,
    layout: { ...layout, lines: withLines.map((s) => s.line) },
  };
}

/**
 * Whether the categories and the series fill one block of adjacent lines, categories first and
 * series in plot order, as a workbook table holds them. Such a table stays one block after an
 * edit: the series move up to fill the line of a removed one, and a new one takes the next line.
 */
function compactTable(layout: SheetLayout): boolean {
  const lines = layout.lines;
  if (lines.some((v, i) => i > 0 && v !== lines[i - 1]! + 1)) return false;
  return layout.categoryLine === undefined || layout.categoryLine === lines[0]! - 1;
}

// --- Building elements ------------------------------------------------------------------------

function el(local: string, attrs: Record<string, string> = {}, kids: Node[] = []): Element {
  return {
    id: '',
    kind: 'generic',
    namespaceUri: NS.c,
    localName: local,
    // The writer binds the part's own prefix for the namespace when `c` is not in scope.
    prefix: 'c',
    namespaceBindings: [],
    attributes: Object.entries(attrs).map(([name, value]) => plainAttr(name, value)),
    children: kids,
  };
}

const text = (value: string): Node => ({ kind: 'textValue', id: '', value });
const val = (local: string, value: string | number): Element => el(local, { val: String(value) });
const is = (e: Node, local: string): e is Element =>
  e.kind !== 'textValue' && e.namespaceUri === NS.c && e.localName === local;

/** A formula for the cells of one series or of the categories in the new table. */
function lineFormula(layout: SheetLayout, line: number, count: number): string {
  const end = layout.start + count - 1;
  return layout.orientation === 'cols'
    ? rangeFormula(layout.sheet, line, layout.start, line, end)
    : rangeFormula(layout.sheet, layout.start, line, end, line);
}

function headerFormula(layout: SheetLayout, line: number): string {
  const at = layout.header!;
  return layout.orientation === 'cols'
    ? rangeFormula(layout.sheet, line, at, line, at)
    : rangeFormula(layout.sheet, at, line, at, line);
}

const numberText = (v: number): string => String(Object.is(v, -0) ? 0 : v);

function points(values: readonly (string | null)[]): Element[] {
  const out: Element[] = [val('ptCount', values.length)];
  values.forEach((v, idx) => {
    if (v !== null) out.push(el('pt', { idx: String(idx) }, [el('v', {}, [text(v)])]));
  });
  return out;
}

/**
 * A data reference: `c:strRef` or `c:numRef` with `formula`, else a literal. The old reference
 * keeps its extensions while its formula stays.
 */
function source(
  numeric: boolean,
  values: readonly (string | null)[],
  formula: string | undefined,
  old: DataSource | undefined,
  oldEl: Element | undefined
): Element {
  const format = numeric ? [el('formatCode', {}, [text(old?.formatCode ?? 'General')])] : [];
  if (formula === undefined)
    return el(numeric ? 'numLit' : 'strLit', {}, [...format, ...points(values)]);
  const ref = numeric ? 'numRef' : 'strRef';
  const cache = el(numeric ? 'numCache' : 'strCache', {}, [...format, ...points(values)]);
  const ext =
    oldEl && old?.formula === formula
      ? elements(oldEl).filter((e) => e.localName === 'extLst')
      : [];
  return el(ref, {}, [el('f', {}, [text(formula)]), cache, ...ext]);
}

/** The reference element inside `c:tx`, `c:cat`, …, of a series, if any. */
const refOf = (holder: Element | undefined): Element | undefined =>
  holder ? elements(holder).find((e) => e.namespaceUri === NS.c) : undefined;

/** The new `c:tx` of a series, or undefined for a series with no name. */
function nameElement(plan: ChartEditPlan, s: PlannedSeries, old?: ReadSeries): Element | undefined {
  const layout = plan.layout;
  if (layout?.header !== undefined && s.line !== undefined)
    return el('tx', {}, [
      source(
        false,
        [s.name],
        headerFormula(layout, s.line),
        old?.tx,
        refOf(child(old?.el, 'c:tx'))
      ),
    ]);
  if (old?.tx?.kind === 'strRef' && old.tx.formula)
    return el('tx', {}, [
      source(false, [s.name], old.tx.formula, old.tx, refOf(child(old.el, 'c:tx'))),
    ]);
  if (!old?.tx && s.name === '') return undefined;
  return el('tx', {}, [el('v', {}, [text(s.name)])]);
}

/** The new categories of a series, or undefined when the chart keeps none. */
function categoryElement(
  plan: ChartEditPlan,
  local: string,
  old?: ReadSeries
): Element | undefined {
  const { model, labels, layout } = plan;
  const defaults = labels.every((l, i) => l === String(i + 1));
  if (!model.hasCategories && defaults) return undefined;
  const oldCat = old?.cat ?? model.series.find((s) => s.cat)?.cat;
  const formula =
    layout?.categoryLine !== undefined
      ? lineFormula(layout, layout.categoryLine, labels.length)
      : oldCat?.formula && !layout
        ? oldCat.formula
        : undefined;
  const values = plan.numericCategories ? labels.map((l) => numberText(Number(l))) : labels;
  const holder = old ? child(old.el, `c:${local}`) : undefined;
  return el(local, {}, [source(plan.numericCategories, values, formula, oldCat, refOf(holder))]);
}

function valueElement(
  plan: ChartEditPlan,
  local: string,
  s: PlannedSeries,
  old?: ReadSeries
): Element {
  const layout = plan.layout;
  const template = old?.val ?? plan.model.series.find((x) => x.val)?.val;
  // Without a table, only an edit that keeps every cell (`planChartEdit`) keeps a formula.
  const formula = layout
    ? lineFormula(layout, s.line!, s.values.length)
    : old?.val?.formula || undefined;
  const values = s.values.map((v) => (v === null ? null : numberText(v)));
  const holder = old ? child(old.el, `c:${local}`) : undefined;
  return el(local, {}, [source(true, values, formula, template, refOf(holder))]);
}

/** `c:dPt` and `c:dLbl` children of `parent` that follow their category, or go with it. */
function remapPoints(parent: Element, map: ReadonlyMap<number, number>): Element {
  const kids: Node[] = [];
  for (const k of parent.children) {
    if (is(k, 'dPt') || is(k, 'dLbl')) {
      const idx = Number(attr(child(k, 'c:idx'), 'val'));
      const to = map.get(idx);
      if (to === undefined) continue;
      kids.push({
        ...k,
        children: k.children.map((g) => (is(g, 'idx') ? val('idx', to) : g)),
      });
    } else if (is(k, 'dLbls')) kids.push(remapPoints(k, map));
    else kids.push(k);
  }
  return { ...parent, children: kids };
}

/** The children a new series copies from its neighbor: plain structure, no formatting. */
const NEW_SERIES_DROPS = new Set([
  'spPr',
  'dPt',
  'trendline',
  'errBars',
  'explosion',
  'pictureOptions',
  'extLst',
]);

/** A new series' copy of a neighbor's child: its marker keeps its symbol, not its colors. */
function plainChild(k: Node): Node | undefined {
  if (k.kind === 'textValue' || k.namespaceUri !== NS.c) return k;
  if (NEW_SERIES_DROPS.has(k.localName)) return undefined;
  if (k.localName !== 'marker') return k;
  return { ...k, children: k.children.filter((g) => !is(g, 'spPr')) };
}

/**
 * Replace the child `local` of a series, or insert it: after the last of `after` that the
 * series has, else first.
 */
function put(
  kids: readonly Node[],
  next: Element | undefined,
  local: string,
  after: readonly string[]
): Node[] {
  const out = [...kids];
  const at = out.findIndex((k) => is(k, local));
  if (at >= 0) {
    if (next) out[at] = next;
    else out.splice(at, 1);
    return out;
  }
  if (!next) return out;
  let index = 0;
  out.forEach((k, i) => {
    if (after.some((a) => is(k, a))) index = i + 1;
  });
  out.splice(index, 0, next);
  return out;
}

/** The children before `c:cat` (or `c:xVal`) in every series type of ECMA-376 Part 1, 21.2.2. */
const BEFORE_DATA = [
  'idx',
  'order',
  'tx',
  'spPr',
  'invertIfNegative',
  'pictureOptions',
  'marker',
  'explosion',
  'dPt',
  'dLbls',
  'trendline',
  'errBars',
];

/** The series after the edit, in their new order. */
function seriesElements(plan: ChartEditPlan): Element[] {
  const { model } = plan;
  const xy = model.kind === 'xy';
  const [catName, valName] = xy ? ['xVal', 'yVal'] : ['cat', 'val'];
  const map = new Map<number, number>();
  plan.categorySources.forEach((from, to) => {
    if (from !== undefined) map.set(from, to);
  });
  let nextIdx = maxOf(
    elements(model.plot)
      .filter((e) => is(e, 'ser'))
      .map((e) => Number(attr(child(e, 'c:idx'), 'val')))
      .filter(Number.isFinite),
    -1
  );
  const template = model.series[model.series.length - 1]!;
  return plan.series.map((s, order) => {
    const old = s.source !== undefined ? model.series[s.source] : undefined;
    let base: Element;
    if (old) base = remapPoints(old.el, map);
    else {
      const plain = template.el.children.map(plainChild).filter((k): k is Node => k !== undefined);
      // Data labels stay on for the new series as for its neighbor, with no point override.
      base = remapPoints({ ...template.el, children: plain }, new Map());
      base = { ...base, children: put(base.children, val('idx', (nextIdx += 1)), 'idx', []) };
    }
    let kids = put(base.children, val('order', order), 'order', ['idx']);
    kids = put(kids, nameElement(plan, s, old), 'tx', ['idx', 'order']);
    kids = put(kids, categoryElement(plan, catName, old), catName, BEFORE_DATA);
    kids = put(kids, valueElement(plan, valName, s, old), valName, [...BEFORE_DATA, catName]);
    return { ...base, children: kids };
  });
}

/** The chart part with its plot's series written from the plan. */
export function rewriteChartSpace(chartSpace: Element, plan: ChartEditPlan): Element {
  const sers = seriesElements(plan);
  const plot = plan.model.plot;
  const first = plot.children.findIndex((k) => is(k, 'ser'));
  const rest = plot.children.filter((k) => !is(k, 'ser'));
  const before = plot.children.slice(0, first).filter((k) => !is(k, 'ser')).length;
  const newPlot: Element = {
    ...plot,
    children: [...rest.slice(0, before), ...sers, ...rest.slice(before)],
  };
  const chart = child(chartSpace, 'c:chart')!;
  const plotArea = child(chart, 'c:plotArea')!;
  const swap = (parent: Element, from: Element, to: Element): Element => ({
    ...parent,
    children: parent.children.map((k) => (k === from ? to : k)),
  });
  return swap(chartSpace, chart, swap(chart, plotArea, swap(plotArea, plot, newPlot)));
}
