// A plain-text summary of a chart drawing: its title and plot types, read from the chart part
// for a host component that replaces the chart's placeholder. Chart text is file-derived, so
// the title is bounded and never parsed as markup.

import { CHART_NAMESPACE_URI, type ChartPartResolver } from './chart-parts.ts';
import { findGraphicData } from './drawing-group-frame.ts';
import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

const DRAWINGML_MAIN = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const MAX_TITLE_UNITS = 200;
/** @internal */
export const MAX_PLOT_TYPES = 8;
const MAX_TITLE_NODES = 2000;

/**
 * A chart plot type. A classic chart names it by its element without the `Chart` suffix:
 * column and bar charts are both `bar`, and `ofPie` is a pie-of-pie or bar-of-pie chart. A
 * chartex chart names it by its series layout: `waterfall`, `funnel`, `boxWhisker`,
 * `treemap`, `sunburst` and `regionMap` by their layout id, `histogram` for a clustered
 * column series, and `pareto` for a Pareto chart (a clustered column series with its
 * Pareto line).
 *
 * @public
 */
export type DrawingChartPlotType =
  | 'area'
  | 'area3D'
  | 'bar'
  | 'bar3D'
  | 'bubble'
  | 'doughnut'
  | 'line'
  | 'line3D'
  | 'ofPie'
  | 'pie'
  | 'pie3D'
  | 'radar'
  | 'scatter'
  | 'stock'
  | 'surface'
  | 'surface3D'
  | 'waterfall'
  | 'funnel'
  | 'histogram'
  | 'pareto'
  | 'boxWhisker'
  | 'treemap'
  | 'sunburst'
  | 'regionMap';

const PLOT_TYPES: ReadonlySet<string> = new Set<DrawingChartPlotType>([
  'area',
  'area3D',
  'bar',
  'bar3D',
  'bubble',
  'doughnut',
  'line',
  'line3D',
  'ofPie',
  'pie',
  'pie3D',
  'radar',
  'scatter',
  'stock',
  'surface',
  'surface3D',
]);

/**
 * How the page shows a chart: `chart` when the installed chart renderer draws it,
 * `fallback` when it shows the content saved in its `mc:AlternateContent` fallback (a
 * picture, a shape, a group or VML), and `placeholder` when it shows the labeled chart
 * placeholder.
 *
 * @public
 */
export type DrawingChartShownAs = 'chart' | 'fallback' | 'placeholder';

/**
 * The title and plot types of a chart, as text, and how the page shows it.
 *
 * A drawing record carries it as `chart` whenever the drawing holds a chart whose chart part
 * can be read, in each of the three states that `shownAs` names. A visible drawing in a
 * skipped `mc:Choice` can retain a placeholder when its bounds are usable. Chart metadata
 * is present only when the projection resolves the chart part.
 *
 * @public
 */
export interface DrawingChartSummary {
  /**
   * The title the chart shows, as plain text: its own title, typed or from a cell, or the name
   * of its only series for an automatic title. Null when it shows none, and when a title with
   * no text of its own sits on a chart with several series. Runs of white space collapse to one
   * space, and the text is cut to at most 200 UTF-16 code units.
   *
   * A chartex chart (waterfall, funnel, histogram, Pareto, box and whisker, treemap, sunburst,
   * region map) reads only its own title text. Its title is null when the title element has
   * no text of its own and the chart shows its default caption, and a chartex chart never uses
   * a series name as an automatic title.
   */
  readonly title: string | null;
  /**
   * The chart's plot types in document order; a classic combination chart has more than one.
   * A chartex chart reports exactly one plot type, or none when its series layout is not one
   * of the chartex types.
   */
  readonly plotTypes: readonly DrawingChartPlotType[];
  /**
   * How the page shows the chart. The projection sets it from the renderers installed when
   * the document opened: `chart` (the record has a `vectorShape`), `fallback` (the record
   * paints the fallback content, such as a picture `resource`), or `placeholder` (the record
   * has `placeholderGraphicKind` `'chart'`). Read this field rather than the other fields.
   */
  readonly shownAs: DrawingChartShownAs;
}

function chartChild(element: OoxmlElement, localName: string): OoxmlElement | null {
  for (const child of element.children) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri === CHART_NAMESPACE_URI && child.localName === localName) return child;
  }
  return null;
}

/**
 * The text under a title or series name: rich text runs (`a:t`, a space at each paragraph
 * and line break) and cached cell text (`v` in `valueNamespace`), depth-first, bounded in
 * nodes and length.
 */
export function plainText(
  element: OoxmlElement,
  firstValueOnly = false,
  valueNamespace = CHART_NAMESPACE_URI
): string | null {
  let text = '';
  let visited = 0;
  const stack: OoxmlNode[] = [element];
  while (stack.length > 0 && visited < MAX_TITLE_NODES && text.length < MAX_TITLE_UNITS) {
    const node = stack.pop()!;
    visited += 1;
    if (node.kind === 'textValue') continue;
    const drawing = node.namespaceUri === DRAWINGML_MAIN;
    if (drawing && (node.localName === 'p' || node.localName === 'br')) text += ' ';
    const textual =
      (drawing && node.localName === 't') ||
      (node.namespaceUri === valueNamespace && node.localName === 'v');
    if (textual) {
      for (const child of node.children) {
        if (child.kind === 'textValue') text += child.value.slice(0, MAX_TITLE_UNITS);
      }
      // A series name shows its first cell only.
      if (firstValueOnly && node.localName === 'v') break;
      continue;
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push(node.children[index]!);
    }
  }
  const trimmed = text
    .slice(0, 2 * MAX_TITLE_UNITS)
    .replace(/\s+/g, ' ')
    .trim();
  let bounded = trimmed.slice(0, MAX_TITLE_UNITS);
  // The cut must not leave half of a surrogate pair.
  if (/[\uD800-\uDBFF]$/.test(bounded)) bounded = bounded.slice(0, -1);
  return bounded.length > 0 ? bounded : null;
}

/**
 * The title a chart shows: its own title text, or, when its title has no text of its own (or it
 * keeps its automatic title), the name of its only series.
 */
function chartTitle(chart: OoxmlElement, plotArea: OoxmlElement | null): string | null {
  const title = chartChild(chart, 'title');
  const own = title ? chartChild(title, 'tx') : null;
  // An authored title shows its own text, even when that text is empty.
  if (own) return plainText(own);
  const deleted = chartChild(chart, 'autoTitleDeleted');
  const value = deleted?.attributes.find((attribute) => attribute.localName === 'val')?.value;
  // A bare `c:autoTitleDeleted` is true by its schema default.
  if (!title && deleted && (value === undefined || value === '1' || value === 'true')) return null;
  let only: OoxmlElement | null = null;
  for (const plot of plotArea?.children ?? []) {
    if (plot.kind === 'textValue' || !plot.localName.endsWith('Chart')) continue;
    for (const series of plot.children) {
      if (series.kind === 'textValue' || series.localName !== 'ser') continue;
      if (only) return null;
      only = series;
    }
  }
  const name = only ? chartChild(only, 'tx') : null;
  return name ? plainText(name, true) : null;
}

/** The summary of the chart behind a drawing anchor, or null when it holds no chart part. */
export function readChartSummary(
  anchor: OoxmlElement,
  resolveChartPart: ChartPartResolver | undefined
): DrawingChartSummary | null {
  if (!resolveChartPart) return null;
  const data = findGraphicData(anchor);
  const reference = data ? chartChild(data, 'chart') : null;
  const part = reference ? resolveChartPart(reference) : null;
  const chart = part ? chartChild(part.chartSpace, 'chart') : null;
  if (!chart) return null;
  const plotArea = chartChild(chart, 'plotArea');
  const plotTypes: DrawingChartPlotType[] = [];
  for (const child of plotArea?.children ?? []) {
    if (plotTypes.length >= MAX_PLOT_TYPES) break;
    if (child.kind === 'textValue' || child.namespaceUri !== CHART_NAMESPACE_URI) continue;
    const type = child.localName.endsWith('Chart') ? child.localName.slice(0, -5) : '';
    if (PLOT_TYPES.has(type)) plotTypes.push(type as DrawingChartPlotType);
  }
  return Object.freeze({
    title: chartTitle(chart, plotArea),
    plotTypes: Object.freeze(plotTypes),
    shownAs: 'placeholder',
  });
}
