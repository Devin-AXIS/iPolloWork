// The chart types of the public contract: the values a chart plots, as `chartData` reads them
// and `setChartData` writes them, and the chart's type and elements, as `chartFormat` reads
// them and `insertChart`, `setChartType`, `setChartFormat`, and `setChartColor` write them.
// DOM-free.

/**
 * How a chart plots its data. `category`: each series has one value per category (bar, column,
 * line, area, pie, doughnut, and radar charts). `xy`: each series has one Y value per X value
 * (scatter charts); the categories are the X values. @public
 */
export type ChartDataKind = 'category' | 'xy';

/**
 * Where the chart's workbook is, and what an edit does to it. `embedded`: an edit writes the
 * new values into the embedded workbook too. `kept`: the embedded workbook has a structure that
 * the editor does not change, so it keeps its old values. `external`: the workbook is a linked
 * file, which the editor never opens; an edit turns off its automatic update. `none`: the chart
 * has no workbook. @public
 */
export type ChartWorkbookState = 'embedded' | 'kept' | 'external' | 'none';

/** One category (or X value) of a chart. @public */
export interface ChartDataCategory {
  /** The label, or the X value of a scatter chart as text. */
  readonly label: string;
  /**
   * On read: the position of the category in the chart. On write: the category this one
   * continues, so its data point formatting and data labels stay with it. Absent: a new
   * category.
   */
  readonly source?: number;
}

/** One series of a chart. @public */
export interface ChartDataSeries {
  /** The series name, as the legend shows it. */
  readonly name: string;
  /** One value for each category; `null` is a blank cell. */
  readonly values: readonly (number | null)[];
  /**
   * On read: the position of the series in the chart. On write: the series this one continues,
   * so its formatting stays with it. Absent: a new series, with automatic formatting.
   */
  readonly source?: number;
}

/** The data of one chart: its categories and its series. @public */
export interface ChartData {
  readonly kind: ChartDataKind;
  readonly categories: readonly ChartDataCategory[];
  readonly series: readonly ChartDataSeries[];
  /** On read only: where the chart's workbook is. A write ignores it. */
  readonly workbook?: ChartWorkbookState;
}

/**
 * The data of a chart, or why it cannot be edited. `reason` is a translation key, such as
 * `chart.errors.unsupportedType`. @public
 */
export type ChartDataRead =
  { readonly ok: true; readonly data: ChartData } | { readonly ok: false; readonly reason: string };

/** The selected chart, while exactly one chart drawing is selected. @public */
export interface SelectedChartState {
  /** The node id of the chart's `w:drawing`. */
  readonly drawingNodeId: string;
  /** Whether `setChartData` can edit the chart's data. */
  readonly editable: boolean;
  /** Why the data cannot be edited, as a translation key, when `editable` is false. */
  readonly reason?: string;
  /** Whether `setChartType`, `setChartFormat`, and `setChartColor` can edit the chart. */
  readonly formattable: boolean;
  /** Why the type and elements cannot be edited, as a translation key. */
  readonly formatReason?: string;
  /** Rises each time the chart part changes, so a pane knows when to read the chart again. */
  readonly version: number;
}

/**
 * A chart type that `insertChart` and `setChartType` write (ECMA-376 Part 1, 21.2.2): the plot
 * element, and its direction, grouping, or style. Column and bar charts are `c:barChart` with
 * vertical or horizontal bars; `lineMarkers` shows a marker at each point; `scatter` shows
 * markers only, and `scatterLines` joins them with lines. @public
 */
export type ChartType =
  | 'columnClustered'
  | 'columnStacked'
  | 'columnPercentStacked'
  | 'barClustered'
  | 'barStacked'
  | 'barPercentStacked'
  | 'line'
  | 'lineMarkers'
  | 'area'
  | 'areaStacked'
  | 'areaPercentStacked'
  | 'pie'
  | 'doughnut'
  | 'radar'
  | 'scatter'
  | 'scatterLines';

/** A theme color of a chart color (`a:schemeClr`, ECMA-376 Part 1, 20.1.2.3.29). @public */
export type ChartThemeColor =
  | 'bg1'
  | 'tx1'
  | 'bg2'
  | 'tx2'
  | 'accent1'
  | 'accent2'
  | 'accent3'
  | 'accent4'
  | 'accent5'
  | 'accent6';

/**
 * A chart color: `#RRGGBB`, or a theme color. `shift` is the luminance variant of a theme
 * color: a positive number is "Lighter n%" (`a:lumMod` 100−n, `a:lumOff` n), and a negative
 * number is "Darker n%" (`a:lumMod` 100−n). @public
 */
export type ChartColor = string | { readonly theme: ChartThemeColor; readonly shift?: number };

/** Where a chart shows its legend (`c:legendPos`), or `none` for no legend. @public */
export type ChartLegendPosition = 'none' | 'top' | 'bottom' | 'left' | 'right';

/** The color of one series, or of one data point of a pie or doughnut chart. @public */
export interface ChartColorEntry {
  /** The series name, or the category label of a pie or doughnut point. */
  readonly name: string;
  /** The color the chart part sets, or null for the automatic color. */
  readonly color: ChartColor | null;
  /** The theme color that the automatic color starts from, for a swatch. */
  readonly automatic: ChartColor;
}

/**
 * The type and elements of a chart, as `chartFormat` reads them. A field is null when the
 * chart type has no such element: a pie chart has no axes. @public
 */
export interface ChartFormat {
  /** The chart type, or null for a type that `setChartType` does not write (3-D, stock). */
  readonly type: ChartType | null;
  /** The title text, or null for no title. An automatic title reads as its series name. */
  readonly title: string | null;
  readonly legend: ChartLegendPosition;
  /** Whether the chart shows a value label at each data point. */
  readonly dataLabels: boolean;
  /** Whether the value axis shows major gridlines; null for a chart with no axes. */
  readonly gridlines: boolean | null;
  /** Whether the chart shows its axes; null for a chart with no axes. */
  readonly axes: boolean | null;
  /** The axis titles, or null for no title; null for a chart with no axes. */
  readonly axisTitles: {
    readonly category: string | null;
    readonly value: string | null;
  } | null;
  /** What `colors` and `setChartColor` color: each series, or each point of a pie chart. */
  readonly colorsBy: 'series' | 'point';
  readonly colors: readonly ChartColorEntry[];
}

/**
 * The type and elements of a chart, or why the editor does not edit them. `reason` is a
 * translation key, such as `chart.errors.combination`. @public
 */
export type ChartFormatRead =
  | { readonly ok: true; readonly format: ChartFormat }
  | { readonly ok: false; readonly reason: string };

/**
 * The chart elements that `setChartFormat` changes. An absent field keeps its value. A title of
 * null removes the title; a string sets its text and keeps its formatting. @public
 */
export interface ChartFormatChange {
  readonly title?: string | null;
  readonly legend?: ChartLegendPosition;
  readonly dataLabels?: boolean;
  readonly gridlines?: boolean;
  readonly axes?: boolean;
  readonly categoryAxisTitle?: string | null;
  readonly valueAxisTitle?: string | null;
}

/** The data of a new chart: its categories (or X values) and its series. @public */
export interface NewChartData {
  readonly categories: readonly string[];
  readonly series: readonly {
    readonly name: string;
    readonly values: readonly (number | null)[];
  }[];
}
