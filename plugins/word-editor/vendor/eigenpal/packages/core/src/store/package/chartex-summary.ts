// The plain-text summary of a chartex drawing (see `chart-summary.ts`): its title and the plot
// types its series layouts name. Chart text is file-derived, so the title is bounded and never
// parsed as markup.

import {
  MAX_PLOT_TYPES,
  plainText,
  type DrawingChartPlotType,
  type DrawingChartSummary,
} from './chart-summary.ts';
import { CHARTEX_NAMESPACE_URI, type ChartexPartResolver } from './chartex-parts.ts';
import { findGraphicData } from './drawing-group-frame.ts';
import type { OoxmlElement } from './ooxml-tree.ts';

/** Series a chartex summary reads; past it the summary stops listing plot types. */
const MAX_SERIES = 64;

// A Map, so a `layoutId` of `__proto__` or `constructor` answers undefined.
const LAYOUT_PLOT_TYPES: ReadonlyMap<string, DrawingChartPlotType> = new Map([
  ['waterfall', 'waterfall'],
  ['funnel', 'funnel'],
  ['clusteredColumn', 'histogram'],
  ['paretoLine', 'pareto'],
  ['boxWhisker', 'boxWhisker'],
  ['treemap', 'treemap'],
  ['sunburst', 'sunburst'],
  ['regionMap', 'regionMap'],
]);

function cx(element: OoxmlElement | null, localName: string): OoxmlElement | null {
  for (const child of element?.children ?? []) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri === CHARTEX_NAMESPACE_URI && child.localName === localName) return child;
  }
  return null;
}

/**
 * The summary of the chartex chart behind a drawing anchor, or null when it holds none. A
 * title element without text of its own shows a generic caption, so its title reads null.
 */
export function readChartexSummary(
  anchor: OoxmlElement,
  resolveChartexPart: ChartexPartResolver | undefined
): DrawingChartSummary | null {
  if (!resolveChartexPart) return null;
  const reference = cx(findGraphicData(anchor), 'chart');
  const part = reference ? resolveChartexPart(reference) : null;
  const chart = part ? cx(part.chartSpace, 'chart') : null;
  if (!chart) return null;
  const types: DrawingChartPlotType[] = [];
  let seen = 0;
  for (const series of cx(cx(chart, 'plotArea'), 'plotAreaRegion')?.children ?? []) {
    if (series.kind === 'textValue' || series.localName !== 'series') continue;
    if (series.namespaceUri !== CHARTEX_NAMESPACE_URI || ++seen > MAX_SERIES) break;
    const layout = series.attributes.find((attribute) => attribute.localName === 'layoutId');
    const type = layout ? LAYOUT_PLOT_TYPES.get(layout.value) : undefined;
    if (type && !types.includes(type) && types.length < MAX_PLOT_TYPES) types.push(type);
  }
  // A chartex chart is one chart type. A Pareto chart is its column series and their Pareto
  // line; otherwise the first layout the series name counts.
  const plotTypes = types.includes('pareto') ? ['pareto' as const] : types.slice(0, 1);
  const tx = cx(cx(chart, 'title'), 'tx');
  return Object.freeze({
    title: tx ? plainText(tx, true, CHARTEX_NAMESPACE_URI) : null,
    plotTypes: Object.freeze(plotTypes),
    shownAs: 'placeholder',
  });
}
