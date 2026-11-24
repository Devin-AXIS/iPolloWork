// The commands, enabled state, and current value of the `shape.*` and `chart.*` slots. The
// shared toolbar helpers call these, so a slot rendered in a toolbar, a menu, a popover, or a
// pane enables, refuses, and applies the same way. The checks come from the pane models
// (`shape-pane.ts`, `chart-pane.ts`): a pick that the object already shows sends nothing and
// adds no undo step, and text the model cannot read refuses with its translation key.
// DOM-free.

import type { Editor, EditorCommand, EditorExecOptions, ExecResult } from '../contracts/editor.ts';
import type {
  ChartData,
  ChartFormat,
  ChartFormatChange,
  ChartLegendPosition,
} from '../contracts/chart.ts';
import type { ShapeOutlineDash } from '../store/store/tree-op-types.ts';
import type { ChromeSlotId } from './chrome-controls.ts';
import type { ToolbarCommandState } from './toolbar-commands.ts';
import { isChartType } from '../store/package/chart-edit/type.ts';
import { isShapeOutlineDash } from '../store/package/drawing-line-dash.ts';
import { shapeColorHex } from '../store/package/shape-format.ts';
import { colorPickTheme, documentThemeHexes, type ColorPick } from './color-picker.ts';
import {
  CHART_LEGEND_CHOICES,
  CHART_TYPE_CHOICES,
  chartColorOfPick,
  chartColorPick,
  chartPaneCommand,
  chartTitleCommand,
  type ChartPaneChange,
} from './chart-pane.ts';
import { readSelectedChart } from './selected-chart.ts';
import { readSelectedShape, SHAPE_NONE_REASON, type SelectedShapeView } from './selected-shape.ts';
import {
  SHAPE_OUTLINE_DASHES,
  SHAPE_OUTLINE_WIDTHS,
  shapeFillPick,
  shapeOutlinePick,
  shapePaneCommand,
  shapeTransparencyText,
  shapeWidthText,
  type ShapePaneChange,
} from './shape-pane.ts';

/** The slots of the contextual `shape` group. @public */
export type ShapeChromeSlotId = Extract<ChromeSlotId, `shape.${string}`>;

/** The slots of the contextual `chart` group. @public */
export type ChartChromeSlotId = Extract<ChromeSlotId, `chart.${string}`>;

/**
 * The value each object slot takes in `runToolbarCommand` and `commandForSlotValue`. @public
 */
export interface ObjectSlotValueMap {
  /** A colour pick (`accent1:40`, `#4472C4`), a colour name, or `none` for No fill. */
  'shape.fill': ColorPick | 'none' | (string & {});
  /** A whole percent from 0 (opaque) to 100 (clear). */
  'shape.fillTransparency': number;
  /** A colour pick, a colour name, or `none` for No line. */
  'shape.outlineColor': ColorPick | 'none' | (string & {});
  /** Points, from 0.25 to 1584. */
  'shape.outlineWidth': number;
  'shape.outlineDash': ShapeOutlineDash;
  'chart.type': import('../contracts/chart.ts').ChartType;
  /** The title text; empty text or null turns the title off. */
  'chart.title': string | null;
  'chart.legend': ChartLegendPosition;
  'chart.dataLabels': boolean;
  'chart.axes': boolean;
  'chart.gridlines': boolean;
  /** The axis title; empty text or null removes it. */
  'chart.categoryAxisTitle': string | null;
  'chart.valueAxisTitle': string | null;
  /** The colour of series (or pie point) `index`; `auto` is the automatic colour. */
  'chart.seriesColor': { readonly index: number; readonly color: ColorPick };
  /** One data change, as the Chart pane sends it, or the whole data to write. */
  'chart.data': ChartPaneChange | Omit<ChartData, 'workbook'>;
}

const SHAPE_SLOTS: ReadonlySet<string> = new Set<ShapeChromeSlotId>([
  'shape.fill',
  'shape.fillTransparency',
  'shape.outlineColor',
  'shape.outlineWidth',
  'shape.outlineDash',
]);

/** The chart slots that toggle an element: a bare run turns it on or off. */
const CHART_TOGGLES: Record<ObjectToggleSlotId, 'dataLabels' | 'axes' | 'gridlines'> = {
  'chart.dataLabels': 'dataLabels',
  'chart.axes': 'axes',
  'chart.gridlines': 'gridlines',
};

const CHART_SLOTS: ReadonlySet<string> = new Set<ChartChromeSlotId>([
  'chart.type',
  'chart.title',
  'chart.legend',
  'chart.dataLabels',
  'chart.axes',
  'chart.gridlines',
  'chart.categoryAxisTitle',
  'chart.valueAxisTitle',
  'chart.seriesColor',
  'chart.data',
]);

/** The reason of an axis slot on a chart type with no axes, such as a pie chart. */
export const CHART_NO_AXES_REASON = 'chart.errors.noAxes';
/** The reason of a gridlines or axis title slot while the axes are off. */
export const CHART_AXES_OFF_REASON = 'chart.format.axesOff';
const NO_VALUE_REASON = 'pass a value for this control';

/** Whether `id` is a `shape.*` slot. @public */
export const isShapeChromeSlot = (id: string): id is ShapeChromeSlotId => SHAPE_SLOTS.has(id);

/** Whether `id` is a `chart.*` slot. @public */
export const isChartChromeSlot = (id: string): id is ChartChromeSlotId => CHART_SLOTS.has(id);

/** Whether `id` is a `shape.*` or `chart.*` slot. @public */
export const isObjectChromeSlot = (id: string): id is ShapeChromeSlotId | ChartChromeSlotId =>
  SHAPE_SLOTS.has(id) || CHART_SLOTS.has(id);

/** Whether a chart slot toggles an element, so its control carries `aria-pressed`. @public */
export const chartSlotIsToggle = (id: string): boolean => id in CHART_TOGGLES;

/**
 * The value each object slot reads back, as `objectSlotValue` and `useObjectControl` give it.
 * It is the value the slot takes, except for the colour slots: they take a colour name too, but
 * read back only a grid pick or `none`, which `ColorPicker.Root` takes as its `value`. @public
 */
export interface ObjectSlotReadValueMap extends Omit<
  ObjectSlotValueMap,
  'shape.fill' | 'shape.outlineColor'
> {
  /** The grid pick of a solid fill, or `none` for No fill. */
  'shape.fill': ColorPick | 'none';
  /** The grid pick of a visible outline, or `none` for No line. */
  'shape.outlineColor': ColorPick | 'none';
}

/** Whether `value` is a grid pick or `none`, as a colour slot reads back. */
const isReadColor = (value: string): value is ColorPick | 'none' =>
  value === 'none' ||
  value === 'auto' ||
  /^#[0-9A-F]{6}$/i.test(value) ||
  colorPickTheme(value) !== null;

/** The object slots that toggle: a run with no value turns the element on or off. @public */
export type ObjectToggleSlotId = 'chart.dataLabels' | 'chart.axes' | 'chart.gridlines';

/** Text of a state value, or null for no value. */
const textOf = (text: string | undefined): string | null =>
  text === undefined || text === '' ? null : text;

/**
 * The typed value of an object slot, from the text its toolbar state carries
 * (`ToolbarCommandState.value`). Null when nothing is selected, when the object shows several
 * values or a value the slot cannot name (a custom dash), or for a slot with no single value
 * (`chart.seriesColor`, `chart.data`). A title that is off is null. @public
 */
export function objectSlotValue<K extends keyof ObjectSlotValueMap>(
  id: K,
  text: string | undefined
): ObjectSlotReadValueMap[K] | null {
  const value = textOf(text);
  if (value === null) return null;
  let typed: unknown = null;
  switch (id) {
    case 'shape.fill':
    case 'shape.outlineColor':
      typed = isReadColor(value) ? value : null;
      break;
    case 'chart.title':
    case 'chart.categoryAxisTitle':
    case 'chart.valueAxisTitle':
      typed = value;
      break;
    case 'shape.fillTransparency':
    case 'shape.outlineWidth': {
      const number = Number(value);
      typed = Number.isFinite(number) ? number : null;
      break;
    }
    case 'shape.outlineDash':
      typed = isShapeOutlineDash(value) ? value : null;
      break;
    case 'chart.type':
      typed = isChartType(value) ? value : null;
      break;
    case 'chart.legend':
      typed = CHART_LEGEND_CHOICES.includes(value as ChartLegendPosition) ? value : null;
      break;
    case 'chart.dataLabels':
    case 'chart.axes':
    case 'chart.gridlines':
      typed = value === 'true' ? true : value === 'false' ? false : null;
      break;
    default:
      typed = null;
  }
  return typed as ObjectSlotReadValueMap[K] | null;
}

/**
 * The values a list slot offers, in list order: chart types, legend positions, outline dashes,
 * and outline widths. Empty for every other slot. @public
 */
export function objectSlotOptions<K extends keyof ObjectSlotValueMap>(
  id: K
): readonly ObjectSlotValueMap[K][] {
  const options: Partial<Record<keyof ObjectSlotValueMap, readonly unknown[]>> = {
    'chart.type': CHART_TYPE_CHOICES,
    'chart.legend': CHART_LEGEND_CHOICES,
    'shape.outlineDash': SHAPE_OUTLINE_DASHES,
    'shape.outlineWidth': SHAPE_OUTLINE_WIDTHS,
  };
  return (options[id] ?? []) as readonly ObjectSlotValueMap[K][];
}

const isFullData = (value: unknown): value is Omit<ChartData, 'workbook'> =>
  !!value && typeof value === 'object' && 'categories' in value && 'series' in value;

/** A shape colour command field of a pick: a theme reference, or `RRGGBB`; null for other text. */
function shapeColorOf(value: unknown) {
  if (typeof value !== 'string') return null;
  const theme = colorPickTheme(value);
  if (theme) return { theme: theme.name, shift: theme.shift };
  return shapeColorHex(value.trim());
}

/** A title of a slot value: blank text is no title. */
const titleOf = (value: unknown): string | null | undefined =>
  value === null ? null : typeof value === 'string' ? (value.trim() ? value : null) : undefined;

/**
 * The command of an object slot carrying `value`, for the selected shape or chart, or null when
 * the value is not one the slot takes. `chart.data` with a single change needs the chart's
 * current data, so it resolves only through `runToolbarCommand`. @public
 */
export function commandForObjectSlotValue(id: ChromeSlotId, value: unknown): EditorCommand | null {
  switch (id) {
    case 'shape.fill': {
      if (value === 'none') return { type: 'setShapeFill', visible: false };
      const color = shapeColorOf(value);
      return color ? { type: 'setShapeFill', color } : null;
    }
    case 'shape.fillTransparency':
      return typeof value === 'number' && value >= 0 && value <= 100
        ? { type: 'setShapeFill', transparency: value / 100 }
        : null;
    case 'shape.outlineColor': {
      if (value === 'none') return { type: 'setShapeOutline', visible: false };
      const color = shapeColorOf(value);
      return color ? { type: 'setShapeOutline', visible: true, color } : null;
    }
    case 'shape.outlineWidth':
      return typeof value === 'number' && Number.isFinite(value)
        ? { type: 'setShapeOutline', visible: true, widthPt: value }
        : null;
    case 'shape.outlineDash':
      return isShapeOutlineDash(value)
        ? { type: 'setShapeOutline', visible: true, dash: value }
        : null;
    case 'chart.type':
      return isChartType(value) ? { type: 'setChartType', chartType: value } : null;
    case 'chart.legend':
      return CHART_LEGEND_CHOICES.includes(value as ChartLegendPosition)
        ? { type: 'setChartFormat', format: { legend: value as ChartLegendPosition } }
        : null;
    case 'chart.dataLabels':
    case 'chart.axes':
    case 'chart.gridlines':
      return typeof value === 'boolean'
        ? { type: 'setChartFormat', format: { [CHART_TOGGLES[id]]: value } }
        : null;
    case 'chart.title':
    case 'chart.categoryAxisTitle':
    case 'chart.valueAxisTitle': {
      const text = titleOf(value);
      if (text === undefined) return null;
      const field = id === 'chart.title' ? 'title' : id.slice('chart.'.length);
      return { type: 'setChartFormat', format: { [field]: text } as ChartFormatChange };
    }
    case 'chart.seriesColor': {
      const pick = value as ObjectSlotValueMap['chart.seriesColor'] | null;
      if (!pick || typeof pick !== 'object' || !Number.isInteger(pick.index) || pick.index < 0)
        return null;
      if (
        pick.color !== 'auto' &&
        !colorPickTheme(pick.color) &&
        !/^#[0-9A-Fa-f]{6}$/.test(pick.color)
      )
        return null;
      return { type: 'setChartColor', index: pick.index, color: chartColorOfPick(pick.color) };
    }
    case 'chart.data':
      return isFullData(value) ? { type: 'setChartData', data: value } : null;
    default:
      return null;
  }
}

/** The state of a shape slot from what `readSelectedShape` read. */
function shapeState(editor: Editor, id: ShapeChromeSlotId, view: SelectedShapeView) {
  const format = view.format;
  if (!format) return { id, enabled: false, disabledReason: SHAPE_NONE_REASON, active: false };
  const hexes = documentThemeHexes(editor.getDocumentThemeColors());
  const reason =
    id === 'shape.fill'
      ? view.fillDisabledReason
      : id === 'shape.fillTransparency'
        ? view.transparencyDisabledReason
        : view.outlineDisabledReason;
  const { fill, outline } = format;
  const value =
    id === 'shape.fill'
      ? fill.type === 'none'
        ? 'none'
        : (shapeFillPick(fill, hexes) ?? '')
      : id === 'shape.fillTransparency'
        ? shapeTransparencyText(fill)
        : id === 'shape.outlineColor'
          ? outline.visible === false
            ? 'none'
            : (shapeOutlinePick(outline, hexes) ?? '')
          : id === 'shape.outlineWidth'
            ? outline.visible === false
              ? ''
              : shapeWidthText(outline.widthPt)
            : (outline.dash ?? '');
  return { id, enabled: reason === null, disabledReason: reason, active: false, value };
}

/** The current value of a chart slot, as a string, and whether a toggle is on. */
function chartValue(
  id: ChartChromeSlotId,
  format: ChartFormat
): { value?: string; active: boolean } {
  switch (id) {
    case 'chart.type':
      return { value: format.type ?? '', active: false };
    case 'chart.title':
      return { value: format.title ?? '', active: format.title !== null };
    case 'chart.legend':
      return { value: format.legend, active: format.legend !== 'none' };
    case 'chart.dataLabels':
    case 'chart.axes':
    case 'chart.gridlines': {
      const on = format[CHART_TOGGLES[id]] === true;
      return { value: String(on), active: on };
    }
    case 'chart.categoryAxisTitle':
      return { value: format.axisTitles?.category ?? '', active: false };
    case 'chart.valueAxisTitle':
      return { value: format.axisTitles?.value ?? '', active: false };
    default:
      return { active: false };
  }
}

/** Why an axis slot cannot change for `format`, or null. */
function axisRefusal(id: ChartChromeSlotId, format: ChartFormat): string | null {
  const axisSlot =
    id === 'chart.axes' ||
    id === 'chart.gridlines' ||
    id === 'chart.categoryAxisTitle' ||
    id === 'chart.valueAxisTitle';
  if (!axisSlot) return null;
  if (format.axes === null) return CHART_NO_AXES_REASON;
  return id !== 'chart.axes' && format.axes === false ? CHART_AXES_OFF_REASON : null;
}

/** The state of a chart slot. */
function chartState(editor: Editor, id: ChartChromeSlotId): ToolbarCommandState {
  const snapshot = editor.snapshot();
  const view = readSelectedChart(editor, snapshot.chart, snapshot);
  if (id === 'chart.data')
    return {
      id,
      enabled: view.canEditData,
      disabledReason: view.canEditData ? null : view.dataDisabledReason,
      active: false,
    };
  const format = view.format;
  const shown = format ? chartValue(id, format) : { active: false };
  const reason = view.canEditFormat
    ? axisRefusal(id, format!)
    : (view.formatDisabledReason ?? 'chart.errors.noChart');
  return {
    id,
    enabled: reason === null,
    disabledReason: reason,
    ...shown,
  };
}

/** The enabled state and value of an object slot, or null for another slot. */
export function objectChromeState(editor: Editor, id: ChromeSlotId): ToolbarCommandState | null {
  if (isShapeChromeSlot(id))
    return shapeState(editor, id, readSelectedShape(editor, editor.snapshot().image));
  if (isChartChromeSlot(id)) return chartState(editor, id);
  return null;
}

/** The pane change of a shape slot value, or null for a value the slot does not take. */
function shapeChange(id: ShapeChromeSlotId, value: unknown): ShapePaneChange | null {
  switch (id) {
    case 'shape.fill':
      return value === 'none'
        ? { type: 'noFill' }
        : typeof value === 'string'
          ? { type: 'fillColor', color: value }
          : null;
    case 'shape.outlineColor':
      return value === 'none'
        ? { type: 'noOutline' }
        : typeof value === 'string'
          ? { type: 'outlineColor', color: value }
          : null;
    case 'shape.fillTransparency':
      return typeof value === 'number' || typeof value === 'string'
        ? { type: 'fillTransparency', text: String(value) }
        : null;
    case 'shape.outlineWidth':
      return typeof value === 'number' || typeof value === 'string'
        ? { type: 'outlineWidth', text: String(value) }
        : null;
    case 'shape.outlineDash':
      return { type: 'outlineDash', dash: value as ShapeOutlineDash };
    default:
      return null;
  }
}

const refuse = (code: Extract<ExecResult, { ok: false }>['code'], reason: string): ExecResult => ({
  ok: false,
  code,
  reason,
});

/** Can before exec, with the drawing the state read bound; a null command changes nothing. */
function send(
  editor: Editor,
  command: EditorCommand | null,
  options: EditorExecOptions | undefined
): ExecResult {
  if (!command) return { ok: true, changed: false };
  const allowed = editor.can(command, options);
  if (!allowed.ok) return refuse(allowed.code, allowed.reason);
  return editor.exec(command, options);
}

function runShape(
  editor: Editor,
  id: ShapeChromeSlotId,
  value: unknown,
  options: EditorExecOptions | undefined
): ExecResult {
  const image = editor.snapshot().image;
  const format = image?.shapeFormat;
  if (!image || !format) return refuse('notFound', SHAPE_NONE_REASON);
  if (value === undefined) return refuse('invalidArgs', NO_VALUE_REASON);
  const change = shapeChange(id, value);
  if (!change) return refuse('invalidArgs', 'invalid value for toolbar command');
  const planned = shapePaneCommand(
    format,
    change,
    documentThemeHexes(editor.getDocumentThemeColors())
  );
  if (!planned.ok) return refuse('invalidArgs', planned.error);
  return send(
    editor,
    planned.command ? ({ ...planned.command, drawingNodeId: image.id } as EditorCommand) : null,
    options
  );
}

function runChart(
  editor: Editor,
  id: ChartChromeSlotId,
  value: unknown,
  options: EditorExecOptions | undefined
): ExecResult {
  const chart = editor.snapshot().chart;
  if (!chart) return refuse('notFound', 'chart.errors.noChart');
  const drawingNodeId = chart.drawingNodeId;
  const formatRead = editor.query({ type: 'chartFormat', drawingNodeId });
  const format = formatRead.ok ? formatRead.format : null;
  if (id === 'chart.data') {
    if (isFullData(value))
      return send(editor, { type: 'setChartData', drawingNodeId, data: value }, options);
    const read = editor.query({ type: 'chartData', drawingNodeId });
    if (!read.ok) return refuse('unsupported', read.reason);
    if (!value || typeof value !== 'object') return refuse('invalidArgs', NO_VALUE_REASON);
    const planned = chartPaneCommand(drawingNodeId, read.data, value as ChartPaneChange);
    if (!planned.ok) return refuse('invalidArgs', planned.error);
    return send(editor, planned.command, options);
  }
  if (!format)
    return refuse('unsupported', formatRead.ok ? 'chart.errors.noChart' : formatRead.reason);
  let next = value;
  if (next === undefined) {
    // A bare run of a toggle flips it; every other chart slot needs its value.
    if (!(id in CHART_TOGGLES)) return refuse('invalidArgs', NO_VALUE_REASON);
    next = format[CHART_TOGGLES[id as keyof typeof CHART_TOGGLES]] !== true;
  }
  const axes = axisRefusal(id, format);
  if (axes) return refuse('unsupported', axes);
  if (id === 'chart.title' || id === 'chart.categoryAxisTitle' || id === 'chart.valueAxisTitle') {
    const text = titleOf(next);
    if (text === undefined) return refuse('invalidArgs', 'invalid value for toolbar command');
    const field = id === 'chart.title' ? 'title' : id.slice('chart.'.length);
    return send(
      editor,
      chartTitleCommand(drawingNodeId, format, field as 'title', text ?? ''),
      options
    );
  }
  const command = commandForObjectSlotValue(id, next);
  if (!command) return refuse('invalidArgs', 'invalid value for toolbar command');
  // A pick the chart already shows sends nothing.
  if (id === 'chart.type' && format.type === next) return { ok: true, changed: false };
  if (id === 'chart.seriesColor') {
    const pick = next as ObjectSlotValueMap['chart.seriesColor'];
    const entry = format.colors[pick.index];
    if (!entry) return refuse('invalidArgs', 'invalid value for toolbar command');
    if (chartColorPick(entry).toUpperCase() === pick.color.toUpperCase())
      return { ok: true, changed: false };
  }
  return send(editor, { ...command, drawingNodeId } as EditorCommand, options);
}

/** Run an object slot with `value`, or null for another slot. */
export function runObjectControl(
  editor: Editor,
  id: ChromeSlotId,
  value: unknown,
  options?: EditorExecOptions
): ExecResult | null {
  if (isShapeChromeSlot(id)) return runShape(editor, id, value, options);
  if (isChartChromeSlot(id)) return runChart(editor, id, value, options);
  return null;
}
