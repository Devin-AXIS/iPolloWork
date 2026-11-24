// The chart types of the public contract. The store defines them, because its chart edits
// read and write them; this module names them for the editor contract. DOM-free.

export type {
  ChartColor,
  ChartColorEntry,
  ChartData,
  ChartDataCategory,
  ChartDataKind,
  ChartDataRead,
  ChartDataSeries,
  ChartFormat,
  ChartFormatChange,
  ChartFormatRead,
  ChartLegendPosition,
  ChartThemeColor,
  ChartType,
  ChartWorkbookState,
  NewChartData,
  SelectedChartState,
} from '../store/package/chart-edit/types.ts';

import type {
  ChartColor,
  ChartData,
  ChartDataRead,
  ChartFormatChange,
  ChartFormatRead,
  ChartType,
  NewChartData,
} from '../store/package/chart-edit/types.ts';

/**
 * The chart commands. Each is one undo step. Viewing and suggesting refuse them, because a
 * chart part has no tracked form. A refusal's `reason` is a translation key, such as
 * `chart.errors.noChart`, or the text of a mode refusal. @public
 */
export interface EditorChartCommands {
  /**
   * Insert an inline chart of `chartType` at the caret, with an embedded workbook that holds
   * the same data. `data` absent: three series over four categories of sample values, or one
   * series for a pie or doughnut chart. The new chart is selected.
   */
  insertChart: { chartType: ChartType; data?: NewChartData };
  /**
   * Replace the data of the selected chart, or of the chart drawing `drawingNodeId`: its
   * categories, series names, and values, with series and categories added or removed. The
   * value caches, the point counts, and the cell references change together, and an embedded
   * workbook gets the same values when its structure allows it (`ChartData.workbook`).
   * Formatting stays with each series and point by its `source`.
   */
  setChartData: { drawingNodeId?: string; data: Omit<ChartData, 'workbook'> };
  /**
   * Change the type of the selected chart. Each series keeps its name, data, and color.
   * Formatting that the new type does not have, such as markers and 3-D views, goes.
   */
  setChartType: { drawingNodeId?: string; chartType: ChartType };
  /** Show, hide, or change the title, legend, data labels, gridlines, and axes. */
  setChartFormat: { drawingNodeId?: string; format: ChartFormatChange };
  /**
   * Set the color of one series (`index` in plot order), or of one point of a pie or
   * doughnut chart (`ChartFormat.colorsBy`). Null gives back the automatic color.
   */
  setChartColor: { drawingNodeId?: string; index: number; color: ChartColor | null };
}

/** The chart queries: the selected chart, or the chart drawing `drawingNodeId`. @public */
export interface EditorChartQueries {
  chartData: { drawingNodeId?: string };
  chartFormat: { drawingNodeId?: string };
}

/** What each chart query returns. @public */
export interface EditorChartQueryResults {
  chartData: ChartDataRead;
  chartFormat: ChartFormatRead;
}
