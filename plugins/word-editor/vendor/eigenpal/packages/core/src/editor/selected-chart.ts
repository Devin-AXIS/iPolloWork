// The selected chart for a host's own chart controls: what `useSelectedChart` returns in both
// adapters. Reads come from the `chartData` and `chartFormat` queries, and edits are the
// `editor.exec` chart commands with the chart id bound, so a custom pane speaks the same
// command language as the packaged one. DOM-free.

import type { Editor, EditorCommand, EditorSnapshot, ExecResult } from '../contracts/editor.ts';
import type { ChartData, ChartFormat, SelectedChartState } from '../contracts/chart.ts';
import { CHART_SUGGESTING_REFUSAL, CHART_VIEWING_REFUSAL } from './surface-chart-ops.ts';
import { chartPaneCommand, type ChartPaneChange } from './chart-pane.ts';

type ChartEditCommand = Extract<
  EditorCommand,
  { type: 'setChartData' | 'setChartType' | 'setChartFormat' | 'setChartColor' }
>;

/**
 * A chart edit as `editor.exec` takes it, without `drawingNodeId`: the hook binds the chart it
 * shows. For example `{ type: 'setChartType', chartType: 'line' }`. @public
 */
export type SelectedChartCommand =
  | Omit<Extract<EditorCommand, { type: 'setChartData' }>, 'drawingNodeId'>
  | Omit<Extract<EditorCommand, { type: 'setChartType' }>, 'drawingNodeId'>
  | Omit<Extract<EditorCommand, { type: 'setChartFormat' }>, 'drawingNodeId'>
  | Omit<Extract<EditorCommand, { type: 'setChartColor' }>, 'drawingNodeId'>;

/** The selected chart, its data and format, and whether each can change. @public */
export interface SelectedChartView {
  /** The selected chart, or null when no single chart is selected. */
  readonly chart: SelectedChartState | null;
  /** The categories and series, or null when there is no chart or they cannot be read. */
  readonly data: ChartData | null;
  /** The type, elements, and colors, or null when there is no chart or they cannot be read. */
  readonly format: ChartFormat | null;
  /** Why `data` or `format` is null for a selected chart, as a translation key. */
  readonly readReason: string | null;
  /** Whether a `setChartData` command can run now. */
  readonly canEditData: boolean;
  /** Whether `setChartType`, `setChartFormat`, and `setChartColor` can run now. */
  readonly canEditFormat: boolean;
  /** Why the data cannot change, for `localizeDisabledReason`, or null when it can. */
  readonly dataDisabledReason: string | null;
  /** Why the type and elements cannot change, or null when they can. */
  readonly formatDisabledReason: string | null;
}

const NO_CHART: SelectedChartView = Object.freeze({
  chart: null,
  data: null,
  format: null,
  readReason: null,
  canEditData: false,
  canEditFormat: false,
  dataDisabledReason: 'chart.errors.noChart',
  formatDisabledReason: 'chart.errors.noChart',
});

/** Why the editing mode refuses chart edits, or null when it allows them. */
function modeRefusal(snapshot: Pick<EditorSnapshot, 'editable' | 'editingMode'>): string | null {
  if (!snapshot.editable || snapshot.editingMode === 'viewing') return CHART_VIEWING_REFUSAL;
  return snapshot.editingMode === 'suggesting' ? CHART_SUGGESTING_REFUSAL : null;
}

/**
 * Read `chart`, the snapshot's selected chart, for a host's chart controls. Call it again when
 * `chart` changes: the snapshot gives a new object each time the chart part changes. @public
 */
export function readSelectedChart(
  editor: Editor | null,
  chart: SelectedChartState | null,
  snapshot: Pick<EditorSnapshot, 'editable' | 'editingMode'>
): SelectedChartView {
  if (!editor || !chart) return NO_CHART;
  const id = chart.drawingNodeId;
  const dataRead = editor.query({ type: 'chartData', drawingNodeId: id });
  const formatRead = editor.query({ type: 'chartFormat', drawingNodeId: id });
  const mode = modeRefusal(snapshot);
  const data = dataRead.ok ? dataRead.data : null;
  const format = formatRead.ok ? formatRead.format : null;
  const dataDisabledReason = mode ?? (chart.editable ? null : (chart.reason ?? null));
  const formatDisabledReason = mode ?? (chart.formattable ? null : (chart.formatReason ?? null));
  return {
    chart,
    data,
    format,
    readReason: !dataRead.ok ? dataRead.reason : !formatRead.ok ? formatRead.reason : null,
    canEditData: data !== null && chart.editable && mode === null,
    canEditFormat: format !== null && chart.formattable && mode === null,
    dataDisabledReason:
      data === null && dataDisabledReason === null ? 'chart.errors.noChart' : dataDisabledReason,
    formatDisabledReason:
      format === null && formatDisabledReason === null
        ? 'chart.errors.noChart'
        : formatDisabledReason,
  };
}

/**
 * Run a chart edit on `chart`, the chart a host's controls show, through `editor.exec`. One
 * undo step; a refusal names its reason, as `editor.exec` does. @public
 */
export function execSelectedChart(
  editor: Editor | null,
  chart: SelectedChartState | null,
  command: SelectedChartCommand
): ExecResult {
  if (!editor || !chart) return { ok: false, code: 'notFound', reason: 'chart.errors.noChart' };
  return editor.exec({ ...command, drawingNodeId: chart.drawingNodeId } as ChartEditCommand);
}

/**
 * Apply one checked data change to `chart`, as the packaged pane does: a value, a series name,
 * a category label, or an added or removed series or category. Text that is not a number for
 * a value refuses with a translation key, such as `chart.data.fieldErrors.number`. @public
 */
export function editSelectedChartData(
  editor: Editor | null,
  chart: SelectedChartState | null,
  change: ChartPaneChange
): ExecResult {
  if (!editor || !chart) return { ok: false, code: 'notFound', reason: 'chart.errors.noChart' };
  const read = editor.query({ type: 'chartData', drawingNodeId: chart.drawingNodeId });
  if (!read.ok) return { ok: false, code: 'unsupported', reason: read.reason };
  const planned = chartPaneCommand(chart.drawingNodeId, read.data, change);
  if (!planned.ok) return { ok: false, code: 'invalidArgs', reason: planned.error };
  return editor.exec(planned.command);
}
