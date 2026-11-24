// The chart controls of the chrome: the Insert > Chart list of types (`insert.chart`) and the
// Edit chart control of a selected chart (`image.editChart`), and the pane requests that they
// send. A host's side panel listens for the requests and shows its Chart pane.
//
// A new chart opens the pane with `focus: false`: the pane shows the chart, and the keyboard
// stays on the document, so Undo and Delete act on the new chart. Edit chart moves the focus
// into the pane.

import type { Editor, ExecResult } from '@docx-editor.dev/core/contracts/editor';
import type { ChartType } from '../contracts/chart.ts';
import type { ChromeSlotId } from './chrome-controls.ts';
import type { ToolbarCommandState } from './toolbar-commands.ts';
import { CHART_TYPES, isChartType } from '../store/package/chart-edit/type.ts';
import { isElementNode } from './host-realm.ts';
import { GENERATED_ICON_PATHS } from './generated-icon-paths.ts';
import { paneAvailable, requestPane } from './pane-requests.ts';

export {
  listenPaneRequests,
  paneAvailable,
  requestPane,
  takePaneRequest,
  takePaneRequestFor,
  type EditorPaneId,
  type PaneRequest,
  type PaneRequestListenerOptions,
  type PaneRequestOptions,
} from './pane-requests.ts';

/**
 * Whether the host shows the Chart pane: a mounted side panel or Chart pane, or a
 * `usePaneRequest` listener for it. Without one, Edit chart has nowhere to go, so the toolbar
 * and the context menu leave it out. @public
 */
export const chartPaneAvailable = (editor: Editor | null): boolean =>
  paneAvailable(editor, 'chart');

/** The chart types of the Insert > Chart list, in list order. @public */
export const CHART_INSERT_CHOICES: readonly ChartType[] = [
  'columnClustered',
  'barClustered',
  'line',
  'area',
  'pie',
  'doughnut',
  'scatter',
];

/** The Material Symbol of each chart family, for the chart type menus. */
const CHART_TYPE_ICONS: Readonly<Record<string, string>> = {
  column: 'bar_chart',
  bar: 'align_horizontal_left',
  line: 'show_chart',
  area: 'area_chart',
  pie: 'pie_chart',
  doughnut: 'donut_large',
  radar: 'hexagon',
  scatter: 'scatter_plot',
};

/**
 * The icon path data of a chart type, for the chart type menus: one icon per family, so a
 * stacked column has the column icon. An empty list when the family has none.
 * @public
 */
export function chartTypeIconPaths(type: ChartType): readonly string[] {
  const family = Object.keys(CHART_TYPE_ICONS).find((name) => type.startsWith(name));
  return (family && GENERATED_ICON_PATHS[CHART_TYPE_ICONS[family]!]) || [];
}

/** The i18n key of a chart type's name. @public */
export const chartTypeLabelKey = (type: ChartType): `chart.types.${ChartType}` =>
  `chart.types.${type}`;

/** The command that `insert.chart` sends for a picked type, or null for another value. */
export function chartInsertCommand(value: unknown) {
  return isChartType(value) ? { type: 'insertChart' as const, chartType: value } : null;
}

/** The enabled state of a chart control, or null for another slot. */
export function chartChromeState(editor: Editor, id: ChromeSlotId): ToolbarCommandState | null {
  if (id === 'insert.chart') {
    const allowed = editor.can({ type: 'insertChart', chartType: CHART_TYPES[0]! });
    return allowed.ok
      ? { id, enabled: true, disabledReason: null, active: false }
      : { id, enabled: false, disabledReason: allowed.reason, active: false };
  }
  if (id === 'image.editChart') {
    const chart = editor.snapshot().chart;
    return chart
      ? { id, enabled: true, disabledReason: null, active: false }
      : { id, enabled: false, disabledReason: 'chart.errors.noChart', active: false };
  }
  return null;
}

/**
 * A double press on the selected chart: ask for the Chart pane with the focus, as Edit chart
 * does. Returns false, and asks for nothing, when `drawingNodeId` is not the selected chart.
 * @public
 */
export function openChartPaneFor(editor: Editor, drawingNodeId: string): boolean {
  if (editor.snapshot().chart?.drawingNodeId !== drawingNodeId) return false;
  requestPane(editor, 'chart');
  return true;
}

/** The drawing node id of an element, or of the drawing that contains it. */
const drawingIdOf = (node: unknown): string | null =>
  isElementNode(node)
    ? (node.closest('[data-drawing-node-id]')?.getAttribute('data-drawing-node-id') ?? null)
    : null;

/**
 * A double press on the pages: when it reached the selected chart, ask for the Chart pane with
 * the focus, as {@link openChartPaneFor} does. Pass the `dblclick` event. The first press can
 * repaint the chart, so the browser can send the event to the pages instead; then the element
 * under the pointer names the drawing. @public
 */
export function openChartPaneAt(
  editor: Editor,
  event: Pick<MouseEvent, 'target' | 'clientX' | 'clientY'>
): boolean {
  const { target } = event;
  const id =
    drawingIdOf(target) ??
    (isElementNode(target)
      ? drawingIdOf(target.ownerDocument.elementFromPoint(event.clientX, event.clientY))
      : null);
  return id ? openChartPaneFor(editor, id) : false;
}

/**
 * Run a chart control. `insert.chart` inserts the picked type and opens the Chart pane without
 * the focus; `image.editChart` opens the pane with the focus. Null for another slot.
 */
export function runChartControl(
  editor: Editor,
  id: ChromeSlotId,
  value: unknown
): ExecResult | null {
  if (id === 'image.editChart') {
    if (!editor.snapshot().chart)
      return { ok: false, code: 'notFound', reason: 'chart.errors.noChart' };
    requestPane(editor, 'chart', { focus: true });
    return { ok: true, changed: false };
  }
  if (id !== 'insert.chart' || value === undefined) return null;
  const command = chartInsertCommand(value);
  if (!command) return { ok: false, code: 'invalidArgs', reason: 'chart.errors.unsupportedType' };
  const allowed = editor.can(command);
  if (!allowed.ok) return { ok: false, code: allowed.code, reason: allowed.reason };
  const result = editor.exec(command);
  if (result.ok) requestPane(editor, 'chart', { focus: false });
  return result;
}
