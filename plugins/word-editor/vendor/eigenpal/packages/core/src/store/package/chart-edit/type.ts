// The chart types that `insertChart` and `setChartType` write, and the one a chart part has: the
// plot element of each type (ECMA-376 Part 1, 21.2.2: `c:barChart`, `c:lineChart`, …), its
// series, and its axes. A type change writes the plot element again: each series keeps its
// index, order, name, data, color, and extensions, and gets the parts its new type needs
// (markers, `c:invertIfNegative`, `c:smooth`). The axes stay when the new type uses the same
// kind of axes; else the plot area gets new default axes. DOM-free.

import { attr, ChartRefusal, elements, NS, type ChartColor, type Element } from './tree.ts';
import type { ChartType } from './types.ts';
import {
  AXIS_ORDER,
  CHART_ORDER,
  cChild,
  cChildren,
  cFlag,
  chartElement,
  chartFragment,
  colorOfFill,
  cVal,
  FILLS,
  placeChild,
  solidFillXml,
  withKids,
  without,
} from './xml.ts';

/** Every chart type the editor writes. */
export const CHART_TYPES: readonly ChartType[] = [
  'columnClustered',
  'columnStacked',
  'columnPercentStacked',
  'barClustered',
  'barStacked',
  'barPercentStacked',
  'line',
  'lineMarkers',
  'area',
  'areaStacked',
  'areaPercentStacked',
  'pie',
  'doughnut',
  'radar',
  'scatter',
  'scatterLines',
];

/** Whether `value` names a chart type the editor writes. */
export const isChartType = (value: unknown): value is ChartType =>
  typeof value === 'string' && (CHART_TYPES as readonly string[]).includes(value);

/** The axes a chart type plots on: categories by values, X by Y values, or none. */
export type AxisKind = 'category' | 'xy' | 'none';

/** The plot of a chart type. */
interface TypeSpec {
  readonly plot: string;
  readonly axes: AxisKind;
  /** The series draw as lines (with markers), not as filled shapes. */
  readonly lines: boolean;
  readonly barDir?: 'col' | 'bar';
  readonly grouping?: 'clustered' | 'stacked' | 'percentStacked' | 'standard';
  readonly markers?: boolean;
}

const SPECS: Readonly<Record<ChartType, TypeSpec>> = {
  columnClustered: {
    plot: 'barChart',
    axes: 'category',
    lines: false,
    barDir: 'col',
    grouping: 'clustered',
  },
  columnStacked: {
    plot: 'barChart',
    axes: 'category',
    lines: false,
    barDir: 'col',
    grouping: 'stacked',
  },
  columnPercentStacked: {
    plot: 'barChart',
    axes: 'category',
    lines: false,
    barDir: 'col',
    grouping: 'percentStacked',
  },
  barClustered: {
    plot: 'barChart',
    axes: 'category',
    lines: false,
    barDir: 'bar',
    grouping: 'clustered',
  },
  barStacked: {
    plot: 'barChart',
    axes: 'category',
    lines: false,
    barDir: 'bar',
    grouping: 'stacked',
  },
  barPercentStacked: {
    plot: 'barChart',
    axes: 'category',
    lines: false,
    barDir: 'bar',
    grouping: 'percentStacked',
  },
  line: { plot: 'lineChart', axes: 'category', lines: true, grouping: 'standard', markers: false },
  lineMarkers: {
    plot: 'lineChart',
    axes: 'category',
    lines: true,
    grouping: 'standard',
    markers: true,
  },
  area: { plot: 'areaChart', axes: 'category', lines: false, grouping: 'standard' },
  areaStacked: { plot: 'areaChart', axes: 'category', lines: false, grouping: 'stacked' },
  areaPercentStacked: {
    plot: 'areaChart',
    axes: 'category',
    lines: false,
    grouping: 'percentStacked',
  },
  pie: { plot: 'pieChart', axes: 'none', lines: false },
  doughnut: { plot: 'doughnutChart', axes: 'none', lines: false },
  radar: { plot: 'radarChart', axes: 'category', lines: true, markers: false },
  scatter: { plot: 'scatterChart', axes: 'xy', lines: true, markers: true },
  scatterLines: { plot: 'scatterChart', axes: 'xy', lines: true, markers: true },
};

/** The axes a chart type plots on. */
export const axisKindOf = (type: ChartType): AxisKind => SPECS[type].axes;

/** Whether the series of a plot element draw as lines: line, scatter, and unfilled radar. */
export function plotDrawsLines(plot: Element): boolean {
  if (plot.localName === 'radarChart') return cVal(plot, 'radarStyle') !== 'filled';
  return (
    plot.localName === 'lineChart' ||
    plot.localName === 'line3DChart' ||
    plot.localName === 'scatterChart'
  );
}

/** Whether a plot element colors each data point (`c:varyColors`): pie and doughnut charts. */
export const plotColorsPoints = (plot: Element): boolean =>
  plot.localName === 'pieChart' ||
  plot.localName === 'pie3DChart' ||
  plot.localName === 'doughnutChart';

/** The axes of a plot element. */
export function plotAxisKind(plot: Element): AxisKind {
  if (plotColorsPoints(plot) || plot.localName === 'ofPieChart') return 'none';
  return plot.localName === 'scatterChart' || plot.localName === 'bubbleChart' ? 'xy' : 'category';
}

/** Whether a series hides its markers (`c:marker/c:symbol val="none"`). */
const hidesMarkers = (ser: Element): boolean => cVal(cChild(ser, 'marker'), 'symbol') === 'none';

/** Whether a series hides its line (`c:spPr/a:ln/a:noFill`). */
const hidesLine = (ser: Element): boolean => {
  const ln = elements(cChild(ser, 'spPr')).find(
    (e) => e.namespaceUri === NS.a && e.localName === 'ln'
  );
  return elements(ln).some((e) => e.localName === 'noFill');
};

/** The chart type of a plot element, or null for one the editor does not write. */
export function chartTypeOf(plot: Element): ChartType | null {
  const sers = cChildren(plot, 'ser');
  const grouping = cVal(plot, 'grouping') ?? 'standard';
  switch (plot.localName) {
    case 'barChart': {
      const bar = cVal(plot, 'barDir') === 'bar';
      if (grouping === 'stacked') return bar ? 'barStacked' : 'columnStacked';
      if (grouping === 'percentStacked') return bar ? 'barPercentStacked' : 'columnPercentStacked';
      return bar ? 'barClustered' : 'columnClustered';
    }
    case 'lineChart':
      if (grouping !== 'standard') return null;
      // Markers show unless every series hides them, or the plot turns them off.
      return !cFlag(plot, 'marker', true) || sers.every(hidesMarkers) ? 'line' : 'lineMarkers';
    case 'areaChart':
      if (grouping === 'stacked') return 'areaStacked';
      if (grouping === 'percentStacked') return 'areaPercentStacked';
      return 'area';
    case 'pieChart':
      return 'pie';
    case 'doughnutChart':
      return 'doughnut';
    case 'radarChart':
      return cVal(plot, 'radarStyle') === 'filled' ? null : 'radar';
    case 'scatterChart':
      return sers.length > 0 && sers.every(hidesLine) ? 'scatter' : 'scatterLines';
    default:
      return null;
  }
}

// --- Colors ---------------------------------------------------------------------------------

/** The `a:ln` of a shape properties element. */
const lineOf = (spPr: Element | undefined): Element | undefined =>
  elements(spPr).find((e) => e.namespaceUri === NS.a && e.localName === 'ln');

/** The fill of a shape properties element or of a line. */
const fillOf = (el: Element | undefined): Element | undefined =>
  elements(el).find((e) => e.namespaceUri === NS.a && FILLS.has(e.localName));

/** The color a series (or a data point) sets: its line color when it draws as a line. */
export function seriesColor(el: Element, lines: boolean): ChartColor | null {
  const spPr = cChild(el, 'spPr');
  if (lines)
    return (
      colorOfFill(fillOf(lineOf(spPr))) ??
      colorOfFill(fillOf(cChild(cChild(el, 'marker'), 'spPr'))) ??
      colorOfFill(fillOf(spPr))
    );
  return colorOfFill(fillOf(spPr));
}

// --- Writing --------------------------------------------------------------------------------

/** The markup of a series' shape properties and markers for a type, in its color. */
function seriesLookXml(spec: TypeSpec, type: ChartType, color: ChartColor | null): string {
  const fill = color ? solidFillXml(color) : '';
  if (!spec.lines) return color ? `<c:spPr>${fill}</c:spPr>` : '';
  // A scatter chart of markers only hides its lines (`a:noFill`).
  const line =
    type === 'scatter'
      ? '<a:ln w="25400" cap="rnd"><a:noFill/><a:round/></a:ln>'
      : `<a:ln w="28575" cap="rnd">${fill}<a:round/></a:ln>`;
  const spPr = type === 'scatter' || color ? `<c:spPr>${line}</c:spPr>` : '';
  const marker = !spec.markers
    ? '<c:marker><c:symbol val="none"/></c:marker>'
    : color
      ? `<c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr>${fill}<a:ln w="9525">${fill}</a:ln></c:spPr></c:marker>`
      : '<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>';
  return spPr + marker;
}

/** A data holder (`c:cat`, `c:val`, …) under another name, with the same content. */
const renamed = (el: Element, local: string): Element => ({ ...el, localName: local });

/**
 * One series of the new plot from a series of the old one: its index, order, name, data,
 * color, pie point colors (between pie and doughnut charts), and extensions.
 */
function convertSeries(
  ser: Element,
  at: number,
  from: Element,
  type: ChartType,
  spec: TypeSpec
): Element {
  const xy = spec.axes === 'xy';
  const pointsKept = spec.axes === 'none' && plotColorsPoints(from);
  const color = plotColorsPoints(from) ? null : seriesColor(ser, plotDrawsLines(from));
  const idx = cChild(ser, 'idx') ?? chartElement(`<c:idx val="${at}"/>`);
  const order = cChild(ser, 'order') ?? chartElement(`<c:order val="${at}"/>`);
  const cat = cChild(ser, 'cat') ?? cChild(ser, 'xVal');
  const val = cChild(ser, 'val') ?? cChild(ser, 'yVal');
  const tx = cChild(ser, 'tx');
  const kids: Element[] = [idx, order];
  if (tx) kids.push(tx);
  for (const el of chartFragment(seriesLookXml(spec, type, color))) kids.push(el);
  if (spec.plot === 'barChart') kids.push(chartElement('<c:invertIfNegative val="0"/>'));
  // A series can have a point of its own for each of thousands of points: a loop, no spread.
  if (pointsKept) for (const dPt of cChildren(ser, 'dPt')) kids.push(dPt);
  if (cat) kids.push(renamed(cat, xy ? 'xVal' : 'cat'));
  if (val) kids.push(renamed(val, xy ? 'yVal' : 'val'));
  if (spec.plot === 'lineChart' || spec.plot === 'scatterChart')
    kids.push(chartElement('<c:smooth val="0"/>'));
  const ext = cChild(ser, 'extLst');
  if (ext) kids.push(ext);
  return withKids(ser, kids);
}

/** The plot element of a type, with its series, data labels, and axis ids. */
function plotXml(type: ChartType, axisIds: readonly string[]): { open: string; close: string } {
  const spec = SPECS[type];
  const ids = axisIds.map((id) => `<c:axId val="${id}"/>`).join('');
  switch (spec.plot) {
    case 'barChart': {
      const stacked = spec.grouping !== 'clustered';
      return {
        open: `<c:barChart><c:barDir val="${spec.barDir}"/><c:grouping val="${spec.grouping}"/><c:varyColors val="0"/>`,
        close: `<c:gapWidth val="${stacked ? 150 : 219}"/><c:overlap val="${stacked ? 100 : -27}"/>${ids}</c:barChart>`,
      };
    }
    case 'lineChart':
      return {
        open: '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>',
        close: `<c:marker val="1"/>${ids}</c:lineChart>`,
      };
    case 'areaChart':
      return {
        open: `<c:areaChart><c:grouping val="${spec.grouping}"/><c:varyColors val="0"/>`,
        close: `${ids}</c:areaChart>`,
      };
    case 'pieChart':
      return {
        open: '<c:pieChart><c:varyColors val="1"/>',
        close: '<c:firstSliceAng val="0"/></c:pieChart>',
      };
    case 'doughnutChart':
      return {
        open: '<c:doughnutChart><c:varyColors val="1"/>',
        close: '<c:firstSliceAng val="0"/><c:holeSize val="75"/></c:doughnutChart>',
      };
    case 'radarChart':
      return {
        open: '<c:radarChart><c:radarStyle val="marker"/><c:varyColors val="0"/>',
        close: `${ids}</c:radarChart>`,
      };
    default:
      return {
        open: '<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>',
        close: `${ids}</c:scatterChart>`,
      };
  }
}

/** Shape properties for an axis line or gridline: text color at 15 %. */
const RULE =
  '<c:spPr><a:noFill/><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="15000"/><a:lumOff val="85000"/></a:schemeClr></a:solidFill><a:round/></a:ln></c:spPr>';

/** Axis label text: 9 pt, text color at 65 %. */
const AXIS_TEXT =
  '<c:txPr><a:bodyPr rot="-60000000" vert="horz"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1197" b="0" i="0" u="none" strike="noStrike" baseline="0"><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="65000"/><a:lumOff val="35000"/></a:schemeClr></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>';

/** A category axis. */
function categoryAxisXml(id: string, cross: string, pos: string): string {
  return (
    `<c:catAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${pos}"/>` +
    `<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    `${RULE}${AXIS_TEXT}<c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`
  );
}

/** A value axis, with major gridlines when `grid`. */
function valueAxisXml(
  id: string,
  cross: string,
  pos: string,
  grid: boolean,
  between: string
): string {
  const gridlines = grid ? `<c:majorGridlines>${RULE}</c:majorGridlines>` : '';
  return (
    `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${pos}"/>${gridlines}` +
    `<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${AXIS_TEXT}<c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:crossBetween val="${between}"/></c:valAx>`
  );
}

/** The default axes of a type: the category (or X) axis first, then the value axis. */
export function defaultAxesXml(type: ChartType, ids: readonly [string, string]): string {
  const spec = SPECS[type];
  const [a, b] = ids;
  if (spec.axes === 'none') return '';
  if (spec.axes === 'xy')
    return valueAxisXml(a, b, 'b', false, 'midCat') + valueAxisXml(b, a, 'l', true, 'midCat');
  const bar = spec.barDir === 'bar';
  return (
    categoryAxisXml(a, b, bar ? 'l' : 'b') +
    valueAxisXml(b, a, bar ? 'b' : 'l', true, spec.plot === 'areaChart' ? 'midCat' : 'between')
  );
}

/** The axis elements of a plot area. */
const AXES = new Set(['catAx', 'valAx', 'dateAx', 'serAx']);
export const axesOf = (plotArea: Element | undefined): Element[] =>
  elements(plotArea).filter((e) => e.namespaceUri === NS.c && AXES.has(e.localName));

/** The chart elements of 3-D charts (§21.2.2.228 view3D, floor, and walls). */
const THREE_D = ['view3D', 'floor', 'sideWall', 'backWall'];

/** Two axis ids that no other axis of the chart uses. */
function freshAxisIds(plotArea: Element): [string, string] {
  const used = new Set(axesOf(plotArea).map((ax) => cVal(ax, 'axId')));
  const ids: string[] = [];
  for (let n = 500_000_001; ids.length < 2; n += 1) if (!used.has(String(n))) ids.push(String(n));
  return [ids[0]!, ids[1]!];
}

/**
 * The axes of the plot area for a type: the old axes when they are the kind the type plots on,
 * with their positions turned for a change between columns and bars; else new default axes.
 */
function axesFor(
  plotArea: Element,
  plot: Element,
  type: ChartType
): { ids: string[]; axes: Element[] } {
  const spec = SPECS[type];
  if (spec.axes === 'none') return { ids: [], axes: [] };
  const old = axesOf(plotArea);
  const ids = cChildren(plot, 'axId').map((e) => attr(e, 'val') ?? '');
  const mine = ids.map((id) => old.find((ax) => cVal(ax, 'axId') === id));
  const fits =
    plotAxisKind(plot) === spec.axes &&
    mine.length === 2 &&
    mine.every((ax) => ax !== undefined) &&
    (spec.axes === 'xy'
      ? mine.every((ax) => ax!.localName === 'valAx')
      : mine.some((ax) => ax!.localName === 'valAx') &&
        mine.some((ax) => ax!.localName !== 'valAx'));
  if (!fits) {
    const fresh = freshAxisIds(plotArea);
    return { ids: fresh, axes: chartFragment(defaultAxesXml(type, fresh)) };
  }
  if (spec.plot !== 'barChart') return { ids, axes: mine as Element[] };
  // Columns put the categories at the bottom and values on the left; bars turn them.
  const bar = spec.barDir === 'bar';
  const axes = (mine as Element[]).map((ax) => {
    const values = ax.localName === 'valAx';
    const pos = values === bar ? 'b' : 'l';
    return placeChild(ax, chartElement(`<c:axPos val="${pos}"/>`), AXIS_ORDER);
  });
  return { ids, axes };
}

/**
 * The chart element (`c:chart`) with the plot of `plot` changed to `type`. Throws
 * `ChartRefusal` for a plot area that the edit cannot keep valid.
 */
export function changeChartType(chart: Element, plot: Element, type: ChartType): Element {
  const plotArea = cChild(chart, 'plotArea');
  if (!plotArea) throw new ChartRefusal('chart.errors.noData');
  const spec = SPECS[type];
  const { ids, axes } = axesFor(plotArea, plot, type);
  const series = cChildren(plot, 'ser').map((ser, at) => convertSeries(ser, at, plot, type, spec));
  const labels = cChild(plot, 'dLbls');
  const { open, close } = plotXml(type, ids);
  const shell = chartElement(`${open}${close}`);
  // The series and the data labels go after `c:varyColors`, before the rest of the plot.
  const head = elements(shell).findIndex((e) => e.localName === 'varyColors') + 1;
  const kids = elements(shell);
  const nextPlot = withKids(shell, [
    ...kids.slice(0, head),
    ...series,
    ...(labels ? [labels] : []),
    ...kids.slice(head),
  ]);
  const oldAxes = new Set(axesOf(plotArea));
  const area = withKids(plotArea, [
    ...plotArea.children.filter((k) => k !== plot && !(k.kind !== 'textValue' && oldAxes.has(k))),
  ]);
  // The plot goes where it was: after `c:layout`, before the axes and the plot area's own shape.
  const at = area.children.findIndex(
    (k) =>
      k.kind !== 'textValue' &&
      k.namespaceUri === NS.c &&
      (k.localName === 'dTable' || k.localName === 'spPr' || k.localName === 'extLst')
  );
  const rest = at < 0 ? area.children.length : at;
  const nextArea = withKids(area, [
    ...area.children.slice(0, rest),
    nextPlot,
    ...axes,
    ...area.children.slice(rest),
  ]);
  let next = without(chart, (e) => e.namespaceUri === NS.c && THREE_D.includes(e.localName));
  next = placeChild(next, nextArea, CHART_ORDER);
  return next;
}
