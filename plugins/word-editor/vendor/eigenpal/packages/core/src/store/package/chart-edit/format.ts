// The type and elements of a chart part: the read that the Chart tab shows (`chartFormat`),
// and the `setChartType`, `setChartFormat`, and `setChartColor` edits. Each edit takes the
// part's `c:chartSpace` and gives the new one. The chart's data, its workbook, and every
// element that an edit does not name keep their markup (ECMA-376 Part 1, 21.2). DOM-free.

import {
  attr,
  ChartRefusal,
  elements,
  isChartColor,
  isValidXmlText,
  NS,
  textOf,
  type Element,
} from './tree.ts';
import type {
  ChartColorEntry,
  ChartFormat,
  ChartFormatChange,
  ChartFormatRead,
  ChartLegendPosition,
  ChartType,
  ChartColor,
} from './types.ts';
import { MAX_CHART_LABEL, readChartModel, type ChartModel } from './data-model.ts';
import {
  AXIS_ORDER,
  CHART_ORDER,
  cChild,
  cChildren,
  cFlag,
  chartElement,
  cVal,
  FILLS,
  LEGEND_ORDER,
  placeChild,
  POINT_ORDER,
  replaceKid,
  richXml,
  SERIES_ORDER,
  SHAPE_PROPS_ORDER,
  solidFillXml,
  withKids,
  without,
  withoutC,
} from './xml.ts';
import {
  axesOf,
  changeChartType,
  chartTypeOf,
  isChartType,
  plotAxisKind,
  plotColorsPoints,
  plotDrawsLines,
  seriesColor,
} from './type.ts';

const LEGEND_POSITIONS: Readonly<Record<string, ChartLegendPosition>> = {
  t: 'top',
  b: 'bottom',
  l: 'left',
  r: 'right',
  tr: 'right',
};
const LEGEND_CODES: Readonly<Record<Exclude<ChartLegendPosition, 'none'>, string>> = {
  top: 't',
  bottom: 'b',
  left: 'l',
  right: 'r',
};

/** The text of a title (`c:title`): its rich text, or its cell's cached value. */
function titleText(title: Element): string | undefined {
  const tx = cChild(title, 'tx');
  const rich = cChild(tx, 'rich');
  if (rich)
    return elements(rich)
      .filter((p) => p.namespaceUri === NS.a && p.localName === 'p')
      .map((p) => collectText(p))
      .join(' ');
  const cache = cChild(cChild(tx, 'strRef'), 'strCache');
  const v = cChild(cChild(cache, 'pt'), 'v');
  return v ? textOf(v) : undefined;
}

/** The `a:t` text of a paragraph, in order. */
function collectText(el: Element): string {
  let s = '';
  for (const k of elements(el))
    s += k.namespaceUri === NS.a && k.localName === 't' ? textOf(k) : collectText(k);
  return s;
}

/** The chart's title as it shows: its own text, the one series' name, or `Chart Title`. */
function chartTitle(chart: Element, model: ChartModel): string | null {
  const title = cChild(chart, 'title');
  const single = model.series.length === 1 ? model.series[0]!.name : undefined;
  if (title) return titleText(title) ?? single ?? 'Chart Title';
  if (!cFlag(chart, 'autoTitleDeleted', false) && single !== undefined) return single;
  return null;
}

/** The axis that shows the values, and the one that shows the categories (or X values). */
function axisPair(
  plotArea: Element | undefined,
  plot: Element
): {
  value?: Element;
  category?: Element;
} {
  const ids = cChildren(plot, 'axId').map((e) => attr(e, 'val'));
  const axes = axesOf(plotArea).filter((ax) => ids.includes(cVal(ax, 'axId')));
  if (plotAxisKind(plot) === 'xy') {
    const vertical = axes.find((ax) => ['l', 'r'].includes(cVal(ax, 'axPos') ?? ''));
    return {
      value: vertical ?? axes[1],
      category: axes.find((ax) => ax !== (vertical ?? axes[1])),
    };
  }
  return {
    value: axes.find((ax) => ax.localName === 'valAx'),
    category: axes.find((ax) => ax.localName === 'catAx' || ax.localName === 'dateAx'),
  };
}

/** Whether a data labels element (`c:dLbls`) shows anything. */
function labelsShow(dLbls: Element | undefined): boolean {
  if (!dLbls || cFlag(dLbls, 'delete', false)) return false;
  return ['showVal', 'showPercent', 'showCatName', 'showSerName'].some((k) =>
    cFlag(dLbls, k, false)
  );
}

/** The automatic color of series (or point) `n`: the theme accents in turn. */
const automatic = (n: number): ChartColor => ({
  theme: `accent${(n % 6) + 1}` as 'accent1',
});

/** The colors of a chart: by series, or by point for a pie or doughnut chart. */
function colorsOf(model: ChartModel): { by: 'series' | 'point'; colors: ChartColorEntry[] } {
  const plot = model.plot;
  if (plotColorsPoints(plot)) {
    const first = model.series[0]?.el;
    const points = cChildren(first, 'dPt');
    return {
      by: 'point',
      colors: model.categories.map((name, i) => {
        const dPt = points.find((p) => cVal(p, 'idx') === String(i));
        return { name, color: dPt ? seriesColor(dPt, false) : null, automatic: automatic(i) };
      }),
    };
  }
  const lines = plotDrawsLines(plot);
  return {
    by: 'series',
    colors: model.series.map((s, i) => {
      const idx = Number(cVal(s.el, 'idx'));
      return {
        name: s.name,
        color: seriesColor(s.el, lines),
        automatic: automatic(Number.isInteger(idx) && idx >= 0 ? idx : i),
      };
    }),
  };
}

/** The chart part's `c:chart`, its read data, or a refusal. */
function chartAt(chartSpace: Element): { chartSpace: Element; chart: Element; model: ChartModel } {
  const read = readChartModel(chartSpace);
  if (!read.ok) throw new ChartRefusal(read.reason);
  const chart = cChild(chartSpace, 'chart');
  if (!chart) throw new ChartRefusal('chart.errors.noData');
  return { chartSpace, chart, model: read.model };
}

/** The type and elements of a chart part, or why the editor does not edit them. */
export function readChartFormat(chartSpace: Element): ChartFormatRead {
  let at: ReturnType<typeof chartAt>;
  try {
    at = chartAt(chartSpace);
  } catch (e) {
    if (e instanceof ChartRefusal) return { ok: false, reason: e.reason };
    throw e;
  }
  const { chart, model } = at;
  const plot = model.plot;
  const plotArea = cChild(chart, 'plotArea');
  const legend = cChild(chart, 'legend');
  const axes = plotAxisKind(plot) !== 'none';
  const pair = axisPair(plotArea, plot);
  const axisTitle = (ax: Element | undefined): string | null => {
    const title = cChild(ax, 'title');
    return title ? (titleText(title) ?? 'Axis Title') : null;
  };
  const { by, colors } = colorsOf(model);
  const format: ChartFormat = {
    type: chartTypeOf(plot),
    title: chartTitle(chart, model),
    legend: legend ? (LEGEND_POSITIONS[cVal(legend, 'legendPos') ?? 'r'] ?? 'right') : 'none',
    dataLabels:
      labelsShow(cChild(plot, 'dLbls')) ||
      model.series.some((s) => labelsShow(cChild(s.el, 'dLbls'))),
    gridlines: axes ? !!cChild(pair.value, 'majorGridlines') : null,
    axes: axes ? axesOf(plotArea).some((ax) => !cFlag(ax, 'delete', false)) : null,
    axisTitles: axes ? { category: axisTitle(pair.category), value: axisTitle(pair.value) } : null,
    colorsBy: by,
    colors,
  };
  return { ok: true, format };
}

// --- Edits ------------------------------------------------------------------------------------

/** A title text from the caller. Throws `ChartRefusal`. */
function checkText(text: unknown): string {
  if (typeof text !== 'string' || text.length > MAX_CHART_LABEL || !isValidXmlText(text))
    throw new ChartRefusal('chart.errors.invalidText');
  return text;
}

/**
 * A title element (`c:title`) that shows `text`. An old title keeps its layout, overlay, shape,
 * and text properties, and the body and run properties of its first run.
 */
function titleWith(old: Element | undefined, text: string, rotated: boolean): Element {
  const rich = cChild(cChild(old, 'tx'), 'rich');
  const bodyPr = elements(rich).find((e) => e.namespaceUri === NS.a && e.localName === 'bodyPr');
  const firstRun = elements(rich)
    .filter((p) => p.namespaceUri === NS.a && p.localName === 'p')
    .flatMap((p) => elements(p))
    .find((r) => r.namespaceUri === NS.a && r.localName === 'r');
  const rPr = elements(firstRun).find((e) => e.namespaceUri === NS.a && e.localName === 'rPr');
  const body = rotated ? '<a:bodyPr rot="-5400000" vert="horz"/>' : '<a:bodyPr/>';
  const tx = chartElement(`<c:tx>${richXml(text, body)}</c:tx>`);
  // Keep the old body and run properties: their font, size, color, and rotation.
  const newRich = cChild(tx, 'rich')!;
  const keptRich = withKids(
    newRich,
    elements(newRich).map((e) => {
      if (e.localName === 'bodyPr' && bodyPr) return bodyPr;
      if (e.localName !== 'p' || !rPr) return e;
      return withKids(
        e,
        elements(e).map((r) =>
          r.localName === 'r'
            ? withKids(
                r,
                elements(r).map((k) => (k.localName === 'rPr' ? rPr : k))
              )
            : r
        )
      );
    })
  );
  const nextTx = withKids(tx, [keptRich]);
  if (!old) return chartElementWith('<c:title><c:overlay val="0"/></c:title>', nextTx);
  const rest = elements(old).filter((e) => !(e.namespaceUri === NS.c && e.localName === 'tx'));
  return withKids(old, [nextTx, ...rest]);
}

/** A new element of `xml` with `first` before its children. */
function chartElementWith(xml: string, first: Element): Element {
  const el = chartElement(xml);
  return withKids(el, [first, ...el.children]);
}

/** The chart with its title set or removed. */
function setTitle(chart: Element, title: string | null): Element {
  if (title === null) {
    const next = withoutC(chart, 'title');
    return placeChild(next, chartElement('<c:autoTitleDeleted val="1"/>'), CHART_ORDER);
  }
  const next = placeChild(
    chart,
    titleWith(cChild(chart, 'title'), checkText(title), false),
    CHART_ORDER
  );
  return placeChild(next, chartElement('<c:autoTitleDeleted val="0"/>'), CHART_ORDER);
}

/** The chart with its legend at `position`, or with no legend. */
function setLegend(chart: Element, position: ChartLegendPosition): Element {
  if (position === 'none') return withoutC(chart, 'legend');
  const code = Object.hasOwn(LEGEND_CODES, position)
    ? LEGEND_CODES[position as keyof typeof LEGEND_CODES]
    : undefined;
  if (!code) throw new ChartRefusal('chart.errors.unsupported', 'legend');
  const old = cChild(chart, 'legend');
  // A legend that moves drops its manual layout, so it takes its place beside the plot.
  const base = old
    ? withoutC(old, 'layout')
    : chartElement('<c:legend><c:overlay val="0"/></c:legend>');
  const legend = placeChild(base, chartElement(`<c:legendPos val="${code}"/>`), LEGEND_ORDER);
  return placeChild(chart, legend, CHART_ORDER);
}

/** The data labels a chart shows when they are on: the value at each point. */
const LABELS_ON =
  '<c:dLbls><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>';

/** The plot with its data labels on or off; the labels of each series give way to the plot's. */
function setDataLabels(plot: Element, on: boolean): Element {
  let next = withKids(
    plot,
    plot.children.map((k) =>
      k.kind !== 'textValue' && k.namespaceUri === NS.c && k.localName === 'ser'
        ? withoutC(k, 'dLbls')
        : k
    )
  );
  next = withoutC(next, 'dLbls');
  if (!on) return next;
  // The plot's labels come right after its last series (§21.2.2: `CT_BarChart` and its kin).
  const kids = next.children;
  let last = -1;
  kids.forEach((k, i) => {
    if (k.kind !== 'textValue' && k.namespaceUri === NS.c && k.localName === 'ser') last = i;
  });
  return withKids(next, [
    ...kids.slice(0, last + 1),
    chartElement(LABELS_ON),
    ...kids.slice(last + 1),
  ]);
}

/** Gridlines in the axis text color at 15 %. */
const GRIDLINES =
  '<c:majorGridlines><c:spPr><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="15000"/><a:lumOff val="85000"/></a:schemeClr></a:solidFill><a:round/></a:ln></c:spPr></c:majorGridlines>';

/** Apply `change` to the chart element, for the plot of `model`. Throws `ChartRefusal`. */
function formatChart(chart: Element, model: ChartModel, change: ChartFormatChange): Element {
  if (!change || typeof change !== 'object')
    throw new ChartRefusal('chart.errors.unsupported', 'format');
  const keys = [
    'title',
    'legend',
    'dataLabels',
    'gridlines',
    'axes',
    'categoryAxisTitle',
    'valueAxisTitle',
  ];
  for (const key of Object.keys(change))
    if (!keys.includes(key)) throw new ChartRefusal('chart.errors.unsupported', key);
  let next = chart;
  if (change.title !== undefined)
    next = setTitle(next, change.title === null ? null : checkText(change.title));
  if (change.legend !== undefined) next = setLegend(next, change.legend);
  const axisEdit =
    change.gridlines !== undefined ||
    change.axes !== undefined ||
    change.categoryAxisTitle !== undefined ||
    change.valueAxisTitle !== undefined;
  if (change.dataLabels === undefined && !axisEdit) return next;
  const plotArea = cChild(next, 'plotArea');
  const plot = elements(plotArea).find(
    (e) => e.namespaceUri === NS.c && e.localName === model.plot.localName
  );
  if (!plotArea || !plot) throw new ChartRefusal('chart.errors.noData');
  let area = plotArea;
  if (change.dataLabels !== undefined) {
    if (typeof change.dataLabels !== 'boolean')
      throw new ChartRefusal('chart.errors.unsupported', 'dataLabels');
    area = replaceKid(area, plot, setDataLabels(plot, change.dataLabels));
  }
  if (axisEdit) {
    if (plotAxisKind(model.plot) === 'none') throw new ChartRefusal('chart.errors.noAxes');
    const flag = (v: unknown, what: string): boolean => {
      if (typeof v !== 'boolean') throw new ChartRefusal('chart.errors.unsupported', what);
      return v;
    };
    const currentPlot = elements(area).find(
      (e) => e.namespaceUri === NS.c && e.localName === model.plot.localName
    )!;
    const pair = axisPair(area, currentPlot);
    const edits = new Map<Element, Element>();
    const edit = (ax: Element | undefined, fn: (el: Element) => Element): void => {
      if (!ax) return;
      edits.set(ax, fn(edits.get(ax) ?? ax));
    };
    if (change.gridlines !== undefined) {
      const on = flag(change.gridlines, 'gridlines');
      edit(pair.value, (ax) =>
        on
          ? cChild(ax, 'majorGridlines')
            ? ax
            : placeChild(ax, chartElement(GRIDLINES), AXIS_ORDER)
          : withoutC(ax, 'majorGridlines')
      );
    }
    if (change.axes !== undefined) {
      const on = flag(change.axes, 'axes');
      for (const ax of axesOf(area))
        edit(ax, (el) =>
          placeChild(el, chartElement(`<c:delete val="${on ? 0 : 1}"/>`), AXIS_ORDER)
        );
    }
    const axisTitle = (ax: Element | undefined, text: string | null | undefined): void => {
      if (text === undefined) return;
      edit(ax, (el) => {
        if (text === null) return withoutC(el, 'title');
        const vertical = ['l', 'r'].includes(cVal(el, 'axPos') ?? '');
        return placeChild(
          el,
          titleWith(cChild(el, 'title'), checkText(text), vertical),
          AXIS_ORDER
        );
      });
    };
    axisTitle(pair.category, change.categoryAxisTitle);
    axisTitle(pair.value, change.valueAxisTitle);
    if (
      (change.categoryAxisTitle !== undefined && !pair.category) ||
      (change.valueAxisTitle !== undefined && !pair.value)
    )
      throw new ChartRefusal('chart.errors.noAxes');
    area = withKids(
      area,
      area.children.map((k) => (k.kind !== 'textValue' && edits.has(k) ? edits.get(k)! : k))
    );
  }
  return replaceKid(next, plotArea, area);
}

/** Write the chart element back into its chart part. */
/** The chart part with `chart` in place of its old `c:chart`. */
const withChart = (at: ReturnType<typeof chartAt>, chart: Element): Element =>
  replaceKid(at.chartSpace, at.chart, chart);

/** The chart part with its elements changed (`setChartFormat`). Throws `ChartRefusal`. */
export function withChartFormat(chartSpace: Element, change: ChartFormatChange): Element {
  const at = chartAt(chartSpace);
  return withChart(at, formatChart(at.chart, at.model, change));
}

/** The chart part with another type (`setChartType`). Throws `ChartRefusal`. */
export function withChartType(chartSpace: Element, type: ChartType): Element {
  if (!isChartType(type)) throw new ChartRefusal('chart.errors.unsupported', 'chartType');
  const at = chartAt(chartSpace);
  if (chartTypeOf(at.model.plot) === type) throw new ChartRefusal('chart.errors.sameType');
  return withChart(at, changeChartType(at.chart, at.model.plot, type));
}

/** Shape properties with `fill` as their fill, or with no fill of their own (null). */
function withFill(spPr: Element | undefined, fill: Element | null): Element {
  const base = spPr
    ? without(spPr, (e) => e.namespaceUri === NS.a && FILLS.has(e.localName))
    : chartElement('<c:spPr/>');
  return fill ? placeChild(base, fill, SHAPE_PROPS_ORDER) : base;
}

/** A line (`a:ln`) of shape properties with `fill` as its color, or no color of its own. */
function withLineFill(spPr: Element | undefined, fill: Element | null): Element {
  const base = spPr ?? chartElement('<c:spPr/>');
  const ln = elements(base).find((e) => e.namespaceUri === NS.a && e.localName === 'ln');
  if (!ln && !fill) return base;
  // A hidden line (`a:noFill`, a scatter chart of markers only) stays hidden.
  if (ln && elements(ln).some((e) => e.localName === 'noFill')) return base;
  const stripped = ln
    ? without(ln, (e) => e.namespaceUri === NS.a && FILLS.has(e.localName))
    : chartElement('<a:ln w="28575" cap="rnd"/>');
  const line = fill ? withKids(stripped, [fill, ...stripped.children]) : stripped;
  return placeChild(base, line, SHAPE_PROPS_ORDER);
}

/** A series (or a data point) in `color`, or in its automatic color (null). */
function colored(
  el: Element,
  color: ChartColor | null,
  lines: boolean,
  order: readonly string[]
): Element {
  const fill = color ? chartElement(solidFillXml(color)) : null;
  const spPr = cChild(el, 'spPr');
  const nextSpPr = lines ? withLineFill(spPr, fill) : withFill(spPr, fill);
  let next = elements(nextSpPr).length > 0 ? placeChild(el, nextSpPr, order) : withoutC(el, 'spPr');
  const marker = cChild(next, 'marker');
  if (lines && marker && cVal(marker, 'symbol') !== 'none') {
    const mSpPr = cChild(marker, 'spPr');
    let m = withFill(mSpPr, fill);
    m = fill ? withLineFill(m, chartElement(solidFillXml(color!))) : m;
    const nextMarker =
      elements(m).length > 0
        ? placeChild(marker, m, ['symbol', 'size', 'spPr', 'extLst'])
        : withoutC(marker, 'spPr');
    next = replaceKid(next, marker, nextMarker);
  }
  return next;
}

/**
 * The chart part with another color for one series, or one pie point (`setChartColor`).
 * Throws `ChartRefusal`.
 */
export function withChartColor(
  chartSpace: Element,
  index: number,
  color: ChartColor | null
): Element {
  if (color !== null && !isChartColor(color))
    throw new ChartRefusal('chart.errors.unsupported', 'color');
  const at = chartAt(chartSpace);
  const { model } = at;
  const plotArea = cChild(at.chart, 'plotArea')!;
  const plot = model.plot;
  const points = plotColorsPoints(plot);
  const count = points ? model.categories.length : model.series.length;
  if (!Number.isInteger(index) || index < 0 || index >= count)
    throw new ChartRefusal('chart.errors.unsupported', 'index');
  let nextPlot: Element;
  if (points) {
    // Each point of the first series has its color in its own `c:dPt`.
    const ser = model.series[0]!.el;
    const old = cChildren(ser, 'dPt').find((p) => cVal(p, 'idx') === String(index));
    const base = old ?? chartElement(`<c:dPt><c:idx val="${index}"/><c:bubble3D val="0"/></c:dPt>`);
    const point = colored(base, color, false, POINT_ORDER);
    // A point with nothing of its own but its index and 3-D flag goes.
    const empty = elements(point).every((e) => e.localName === 'idx' || e.localName === 'bubble3D');
    let nextSer: Element;
    if (old)
      nextSer = empty
        ? withKids(
            ser,
            ser.children.filter((k) => k !== old)
          )
        : replaceKid(ser, old, point);
    else if (empty) nextSer = ser;
    else {
      // A new point goes after the points before it, in index order.
      const kids = ser.children;
      const pts = kids.filter((k) => k.kind !== 'textValue' && k.localName === 'dPt') as Element[];
      const after = pts.filter((p) => Number(cVal(p, 'idx')) < index).at(-1);
      if (after) {
        const at = kids.indexOf(after) + 1;
        nextSer = withKids(ser, [...kids.slice(0, at), point, ...kids.slice(at)]);
      } else {
        const first = pts[0];
        nextSer = first
          ? withKids(ser, [
              ...kids.slice(0, kids.indexOf(first)),
              point,
              ...kids.slice(kids.indexOf(first)),
            ])
          : placeChild(ser, point, SERIES_ORDER);
      }
    }
    nextPlot = replaceKid(plot, ser, nextSer);
  } else {
    const ser = model.series[index]!.el;
    nextPlot = replaceKid(plot, ser, colored(ser, color, plotDrawsLines(plot), SERIES_ORDER));
  }
  return withChart(at, replaceKid(at.chart, plotArea, replaceKid(plotArea, plot, nextPlot)));
}
