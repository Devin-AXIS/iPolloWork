// The Chart pane, headless: the text of each field, the check of what the user types, and the
// one command that each committed field, or each add or remove, sends: the chart's data
// (`setChartData`), its type (`setChartType`), its elements (`setChartFormat`), and its colors
// (`setChartColor`). The React and Vue panes render from these, so both check the same input
// with the same keys. DOM-free, except `focusChartPane`, which takes the pane element.

import type { EditorCommand } from '../contracts/editor.ts';
import type {
  ChartColor,
  ChartColorEntry,
  ChartData,
  ChartFormat,
  ChartLegendPosition,
  ChartThemeColor,
  ChartType,
} from '../contracts/chart.ts';
import { CHART_TYPES } from '../store/package/chart-edit/type.ts';
import {
  COLOR_PICKER_STANDARD_COLORS,
  COLOR_PICKER_THEME_SLOTS,
  colorPickerGrid,
  colorPickHex,
  colorPickLabel,
  documentThemeHexes,
  focusColorSwatch,
  moveColorSwatchFocus,
  type ColorPick,
  type ColorPickerGrid,
  type ColorPickerTranslate,
  type ColorSwatch,
} from './color-picker.ts';
import {
  MAX_CHART_LABEL,
  MAX_CHART_POINTS,
  MAX_CHART_SERIES,
} from '../store/package/chart-edit/data-model.ts';

export { MAX_CHART_POINTS, MAX_CHART_SERIES };

/**
 * The key of the chart and its grid labels, which keeps the pane's unsaved field text while it
 * stays the same. @public
 */
export function chartPaneDraftKey(drawingNodeId: string, data: ChartData): string {
  return JSON.stringify([
    drawingNodeId,
    data.kind,
    data.categories.map((category) => category.label),
    data.series.map((series) => series.name),
  ]);
}

/**
 * Whether the pane keeps its unsaved field text from `previous` to `next`: the chart and its
 * labels stay in place, and categories or series are only added at the end. @public
 */
export function chartPaneDraftContinues(previous: string, next: string): boolean {
  if (previous === next) return true;
  type Scope = [string, string, string[], string[]];
  const before = JSON.parse(previous) as Scope;
  const after = JSON.parse(next) as Scope;
  return (
    before[0] === after[0] &&
    before[1] === after[1] &&
    before[2].length <= after[2].length &&
    before[3].length <= after[3].length &&
    before[2].every((label, index) => label === after[2][index]) &&
    before[3].every((name, index) => name === after[3][index])
  );
}

/** One change of the Chart pane's data: a committed field, or an add or a remove. @public */
export type ChartPaneChange =
  | {
      readonly type: 'value';
      readonly series: number;
      readonly category: number;
      readonly text: string;
    }
  | { readonly type: 'seriesName'; readonly series: number; readonly text: string }
  | { readonly type: 'label'; readonly category: number; readonly text: string }
  | { readonly type: 'addSeries'; readonly name: string }
  | { readonly type: 'removeSeries'; readonly series: number }
  | { readonly type: 'addCategory'; readonly label: string }
  | { readonly type: 'removeCategory'; readonly category: number };

/** The command of a change, or the i18n key of why the typed text is refused. @public */
export type ChartPaneResult =
  | { readonly ok: true; readonly command: EditorCommand }
  | {
      readonly ok: false;
      readonly error:
        | 'chart.data.fieldErrors.number'
        | 'chart.data.fieldErrors.xNumber'
        | 'chart.data.fieldErrors.tooLong'
        | 'chart.data.fieldErrors.limit';
    };

/** A value as its field shows it: empty for no value. @public */
export const chartValueText = (v: number | null | undefined): string =>
  v === null || v === undefined ? '' : String(v);

/** The number a value field holds, null when it is empty, or undefined for other text. @public */
export function parseChartValue(text: string): number | null | undefined {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Whether the categories of `data` are numbers that the pane checks: the X values of a
 * scatter chart, unless the chart names them as text. @public
 */
export function chartPaneNumericX(data: Pick<ChartData, 'kind' | 'categories'>): boolean {
  return (
    data.kind === 'xy' && data.categories.every((c) => typeof parseChartValue(c.label) === 'number')
  );
}

/**
 * The label of a new category: the next X value of a scatter chart with number X values, else
 * `fallback`. @public
 */
export function nextChartCategoryLabel(
  data: Pick<ChartData, 'kind' | 'categories'>,
  fallback: string
): string {
  if (!chartPaneNumericX(data)) return fallback;
  let max = 0;
  for (const c of data.categories) max = Math.max(max, Number(parseChartValue(c.label)));
  return String(Math.floor(max) + 1);
}

const fail = (error: Extract<ChartPaneResult, { ok: false }>['error']): ChartPaneResult => ({
  ok: false,
  error,
});

/**
 * The `setChartData` command of one change to the chart's current data, or why the typed text
 * is refused. Every series and category keeps its `source`, so formatting stays with it.
 * @public
 */
export function chartPaneCommand(
  drawingNodeId: string,
  data: ChartData,
  change: ChartPaneChange
): ChartPaneResult {
  const numericX = chartPaneNumericX(data);
  let categories: { label: string; source?: number }[] = data.categories.map((c) => ({ ...c }));
  let series: { name: string; values: (number | null)[]; source?: number }[] = data.series.map(
    (s) => ({ ...s, values: [...s.values] })
  );
  switch (change.type) {
    case 'value': {
      const v = parseChartValue(change.text);
      const target = series[change.series];
      if (v === undefined || !target || change.category >= categories.length)
        return fail('chart.data.fieldErrors.number');
      target.values[change.category] = v;
      break;
    }
    case 'seriesName': {
      const target = series[change.series];
      if (!target || change.text.length > MAX_CHART_LABEL)
        return fail('chart.data.fieldErrors.tooLong');
      target.name = change.text;
      break;
    }
    case 'label': {
      const target = categories[change.category];
      if (!target || change.text.length > MAX_CHART_LABEL)
        return fail('chart.data.fieldErrors.tooLong');
      const x = parseChartValue(change.text);
      if (numericX && typeof x !== 'number') return fail('chart.data.fieldErrors.xNumber');
      target.label = numericX ? String(x) : change.text;
      break;
    }
    case 'addSeries':
      if (series.length >= MAX_CHART_SERIES) return fail('chart.data.fieldErrors.limit');
      series = [...series, { name: change.name, values: categories.map(() => null) }];
      break;
    case 'removeSeries':
      if (series.length <= 1 || !series[change.series]) return fail('chart.data.fieldErrors.limit');
      series = series.filter((_, i) => i !== change.series);
      break;
    case 'addCategory':
      if (categories.length >= MAX_CHART_POINTS) return fail('chart.data.fieldErrors.limit');
      categories = [...categories, { label: change.label }];
      series = series.map((s) => ({ ...s, values: [...s.values, null] }));
      break;
    case 'removeCategory':
      if (categories.length <= 1 || !categories[change.category])
        return fail('chart.data.fieldErrors.limit');
      categories = categories.filter((_, i) => i !== change.category);
      series = series.map((s) => ({
        ...s,
        values: s.values.filter((_, i) => i !== change.category),
      }));
      break;
  }
  return {
    ok: true,
    command: { type: 'setChartData', drawingNodeId, data: { kind: data.kind, categories, series } },
  };
}

/**
 * The index of the row that gets the focus after a row is removed at `removed` from a list of
 * `count` rows: the next row, or the last one. @public
 */
export const chartRowFocusAfterRemove = (removed: number, count: number): number =>
  Math.max(0, Math.min(removed, count - 2));

// --- The chart's type and elements ------------------------------------------------------------

/** The chart types the pane offers, in the order of its type list. @public */
export const CHART_TYPE_CHOICES: readonly ChartType[] = CHART_TYPES;

/** The legend positions the pane offers. @public */
export const CHART_LEGEND_CHOICES: readonly ChartLegendPosition[] = [
  'none',
  'top',
  'bottom',
  'left',
  'right',
];

/** Whether a chart plots X values by Y values: its axis titles are X and Y. */
const plotsXy = (format: ChartFormat): boolean =>
  format.type === 'scatter' || format.type === 'scatterLines';

/**
 * The note after a type change, when the new type drops what the user set: the colors move
 * between series and points, or the axes and their titles go. Undo restores them. Null when
 * the new type keeps everything. @public
 */
export function chartTypeChangeNote(
  before: ChartFormat,
  after: ChartFormat
): 'chart.format.typeChangeRemoved' | null {
  const colors = before.colorsBy !== after.colorsBy && before.colors.some((c) => c.color !== null);
  const titles =
    after.axisTitles === null && !!(before.axisTitles?.category || before.axisTitles?.value);
  return colors || titles ? 'chart.format.typeChangeRemoved' : null;
}

/**
 * The hint before a type change: the chart has colors or axis titles that some types cannot
 * keep. Null when it has none. @public
 */
export function chartTypeHint(format: ChartFormat): 'chart.format.typeChangeHint' | null {
  const colors = format.colors.some((c) => c.color !== null);
  const titles = !!(format.axisTitles?.category || format.axisTitles?.value);
  return colors || titles ? 'chart.format.typeChangeHint' : null;
}

/** The note of a pie chart with more than one series: it draws the first one only. @public */
export function chartSeriesNote(
  format: ChartFormat,
  seriesCount: number
): 'chart.format.pieFirstSeries' | null {
  return format.type === 'pie' && seriesCount > 1 ? 'chart.format.pieFirstSeries' : null;
}

/** The labels of the two axis title fields: category and value, or X and Y. @public */
export function chartAxisTitleLabels(format: ChartFormat): {
  readonly category: 'chart.format.categoryAxisTitle' | 'chart.format.xAxisTitle';
  readonly value: 'chart.format.valueAxisTitle' | 'chart.format.yAxisTitle';
} {
  return plotsXy(format)
    ? { category: 'chart.format.xAxisTitle', value: 'chart.format.yAxisTitle' }
    : { category: 'chart.format.categoryAxisTitle', value: 'chart.format.valueAxisTitle' };
}

/**
 * The `setChartFormat` command of a typed title: an empty or blank title turns the title (or
 * the axis title) off. Null when the text is what the chart shows already. @public
 */
export function chartTitleCommand(
  drawingNodeId: string,
  format: ChartFormat,
  field: 'title' | 'categoryAxisTitle' | 'valueAxisTitle',
  text: string
): EditorCommand | null {
  const next = text.trim() === '' ? null : text;
  const now =
    field === 'title'
      ? format.title
      : field === 'categoryAxisTitle'
        ? (format.axisTitles?.category ?? null)
        : (format.axisTitles?.value ?? null);
  if (next === now) return null;
  return { type: 'setChartFormat', drawingNodeId, format: { [field]: next } };
}

// --- Colors -----------------------------------------------------------------------------------
// The grid, the names, and the keyboard model live in `color-picker.ts` under neutral names; the
// chart names below stay as deprecated aliases.

/** @deprecated Use `COLOR_PICKER_THEME_SLOTS`. @public */
export const CHART_THEME_SLOTS: readonly ChartThemeColor[] = COLOR_PICKER_THEME_SLOTS;

/** @deprecated Use `COLOR_PICKER_STANDARD_COLORS`. @public */
export const CHART_STANDARD_COLORS: readonly { readonly hex: string; readonly nameKey: string }[] =
  COLOR_PICKER_STANDARD_COLORS;

/** @deprecated Use `documentThemeHexes`. @public */
export const chartThemeHexes: (
  entries: readonly { readonly hex: string }[] | undefined
) => readonly string[] = documentThemeHexes;

/**
 * A color list's value: the automatic color (`auto`), a theme color, a theme tint or shade
 * (`accent1:40` is Lighter 40%, `accent1:-25` Darker 25%), or `#RRGGBB`. The same value as
 * `ColorPick`. @public
 */
export type ChartColorPick = ColorPick;

/** The pick of a chart color. @public */
export function chartColorPickOf(color: ChartColor): ChartColorPick {
  if (typeof color === 'string') return `#${color.replace(/^#/, '').toUpperCase()}`;
  return color.shift ? `${color.theme}:${color.shift}` : color.theme;
}

/** The chart color of a pick, or null for `auto`. @public */
export function chartColorOfPick(pick: ChartColorPick): ChartColor | null {
  if (pick === 'auto') return null;
  if (pick.startsWith('#')) return pick;
  const [theme, shift] = pick.split(':') as [ChartThemeColor, string?];
  return shift ? { theme, shift: Number(shift) } : { theme };
}

/** The pick of one series' or point's color: `auto` for its automatic color. @public */
export const chartColorPick = (entry: ChartColorEntry): ChartColorPick =>
  entry.color === null ? 'auto' : chartColorPickOf(entry.color);

/**
 * The picks a color list offers: Automatic, the ten theme colors, and the current pick when
 * the grid chose it (a tint, a shade, or a standard color). @public
 */
export function chartColorPicks(value: ChartColorPick): readonly ChartColorPick[] {
  const listed = value === 'auto' || (CHART_THEME_SLOTS as readonly string[]).includes(value);
  return ['auto', ...CHART_THEME_SLOTS, ...(listed ? [] : [value])];
}

/** The `setChartColor` command of a pick for series or point `index`. @public */
export function chartColorCommand(
  drawingNodeId: string,
  index: number,
  pick: ChartColorPick
): EditorCommand {
  return { type: 'setChartColor', drawingNodeId, index, color: chartColorOfPick(pick) };
}

/** @deprecated Use `ColorPickerTranslate`. @public */
export type ChartTranslate = ColorPickerTranslate;

/** The chart keys of a tint and a shade, which this older name keeps. */
const CHART_SHIFT_KEYS: Readonly<Record<string, string>> = {
  'colorPicker.lighterPercent': 'chart.format.colorLighter',
  'colorPicker.darkerPercent': 'chart.format.colorDarker',
};

/**
 * The name of a pick, with the `chart.format.colorLighter` and `chart.format.colorDarker` keys
 * for a tint or shade. @deprecated Use `colorPickLabel`. @public
 */
export function chartColorLabel(pick: ChartColorPick, t: ChartTranslate): string {
  return colorPickLabel(pick, (key, params) => t(CHART_SHIFT_KEYS[key] ?? key, params));
}

/**
 * The `#RRGGBB` that a pick paints, from the document's theme colors (`documentThemeHexes`).
 * `auto` paints `automatic`, the series' automatic color. @public
 */
export function chartPickHex(
  pick: ChartColorPick,
  themeHexes: readonly string[],
  automatic?: ChartColor
): string {
  if (pick === 'auto')
    return automatic ? colorPickHex(chartColorPickOf(automatic), themeHexes) : '#000000';
  return colorPickHex(pick, themeHexes);
}

/** @deprecated Use `ColorSwatch`. @public */
export type ChartSwatch = ColorSwatch;

/** @deprecated Use `colorPickerGrid`. @public */
export const chartColorGrid: (themeHexes: readonly string[]) => ColorPickerGrid = colorPickerGrid;

/** @deprecated Use `focusColorSwatch`. @public */
export const focusChartSwatch: (grid: HTMLElement | null) => void = focusColorSwatch;

/** @deprecated Use `moveColorSwatchFocus`. @public */
export const moveChartSwatchFocus: (grid: HTMLElement | null, key: string) => boolean =
  moveColorSwatchFocus;

/** The frames that {@link focusChartPane} waits for a hidden pane to show. */
const PANE_FOCUS_FRAMES = 3;

/**
 * Move the focus to the first enabled field of the Chart pane, unless the pane has it already.
 * The pane calls it for a pane request that asks for the focus (Edit chart). A pane in a hidden
 * tab cannot take the focus, so it tries again for a few frames while the host shows the tab.
 * @public
 */
export function focusChartPane(pane: HTMLElement | null): void {
  if (!pane) return;
  const doc = pane.ownerDocument;
  const attempt = (framesLeft: number): void => {
    if (!pane.isConnected || pane.contains(doc.activeElement)) return;
    const field = pane.querySelector<HTMLElement>(
      'input:not(:disabled), select:not(:disabled), button:not(:disabled)'
    );
    if (!field) return;
    field.focus();
    if (doc.activeElement === field || framesLeft === 0) return;
    doc.defaultView?.requestAnimationFrame(() => attempt(framesLeft - 1));
  };
  attempt(PANE_FOCUS_FRAMES);
}
