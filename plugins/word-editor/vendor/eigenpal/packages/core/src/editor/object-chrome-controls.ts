// The contextual groups of a selected shape and a selected chart: one slot for each property the
// Format shape pane and the Chart pane edit. A slot is placement-free. A host renders it in its
// own toolbar, a context menu, a popover, a drawer, or a side pane, and the packaged panes are
// arrangements of the same slots (`PANE_SECTIONS`). Enabled state and the value each control
// shows come from `toolbarCommandState`; a pick runs through `runToolbarCommand`.
//
// Slot ids are public API forever: renaming one is a breaking change. Diagram frames have no
// group of their own: a diagram takes the frame edits of the `image` group (`image.wrap`,
// `image.altText`, `image.properties`).

import { GENERATED_ICON_PATHS } from './generated-icon-paths.ts';

export const SHAPE_CHROME_GROUP = {
  id: 'shape',
  labelKey: 'formattingBar.groups.shape',
  contextual: true,
  controls: [
    {
      // A colour pick (`accent1:40`, `#4472C4`) or `none` for No fill.
      id: 'fill',
      shape: 'colorSplit',
      swatch: '#4472c4',
      labelKey: 'shape.pane.fillColor',
      paths: GENERATED_ICON_PATHS['format_color_fill'],
      state: { kind: 'value' },
    },
    {
      // A whole percent from 0 (opaque) to 100 (clear).
      id: 'fillTransparency',
      shape: 'stepper',
      labelKey: 'shape.pane.transparency',
      paths: GENERATED_ICON_PATHS['visibility'],
      defaultToolbar: false,
      state: { kind: 'value' },
    },
    {
      // A colour pick or `none` for No line.
      id: 'outlineColor',
      shape: 'colorSplit',
      swatch: '#000000',
      labelKey: 'shape.pane.outlineColor',
      paths: GENERATED_ICON_PATHS['border_color'],
      state: { kind: 'value' },
    },
    {
      // A width in points, from 0.25 to 1584.
      id: 'outlineWidth',
      shape: 'dropdown',
      labelKey: 'shape.pane.width',
      paths: GENERATED_ICON_PATHS['line_weight'],
      state: { kind: 'value' },
    },
    {
      // A preset dash (`ShapeOutlineDash`), or `solid`.
      id: 'outlineDash',
      shape: 'dropdown',
      labelKey: 'shape.pane.dash',
      paths: GENERATED_ICON_PATHS['horizontal_rule'],
      state: { kind: 'value' },
    },
  ],
} as const;

export const CHART_CHROME_GROUP = {
  id: 'chart',
  labelKey: 'formattingBar.groups.chart',
  contextual: true,
  controls: [
    {
      id: 'type',
      shape: 'dropdown',
      labelKey: 'chart.format.type',
      paths: GENERATED_ICON_PATHS['bar_chart'],
      state: { kind: 'value' },
    },
    {
      // The title text; empty text or null turns the title off.
      id: 'title',
      shape: 'dropdown',
      labelKey: 'chart.format.titleText',
      paths: GENERATED_ICON_PATHS['text_rotation_none'],
      state: { kind: 'value' },
    },
    {
      id: 'legend',
      shape: 'dropdown',
      labelKey: 'chart.format.legend',
      paths: GENERATED_ICON_PATHS['format_list_bulleted'],
      state: { kind: 'value' },
    },
    {
      // A toggle: a bare run turns the data labels on or off; a boolean value sets them.
      id: 'dataLabels',
      labelKey: 'chart.format.dataLabels',
      paths: GENERATED_ICON_PATHS['pie_chart'],
      state: { kind: 'command' },
    },
    {
      id: 'axes',
      labelKey: 'chart.format.axes',
      paths: GENERATED_ICON_PATHS['show_chart'],
      defaultToolbar: false,
      state: { kind: 'command' },
    },
    {
      id: 'gridlines',
      labelKey: 'chart.format.gridlines',
      paths: GENERATED_ICON_PATHS['grid_on'],
      defaultToolbar: false,
      state: { kind: 'command' },
    },
    {
      id: 'categoryAxisTitle',
      shape: 'dropdown',
      labelKey: 'chart.format.categoryAxisTitle',
      paths: GENERATED_ICON_PATHS['fit_width'],
      defaultToolbar: false,
      state: { kind: 'value' },
    },
    {
      id: 'valueAxisTitle',
      shape: 'dropdown',
      labelKey: 'chart.format.valueAxisTitle',
      paths: GENERATED_ICON_PATHS['height'],
      defaultToolbar: false,
      state: { kind: 'value' },
    },
    {
      // `{ index, color }`: the colour pick of one series, or of one point of a pie chart.
      id: 'seriesColor',
      shape: 'colorSplit',
      swatch: '#4472c4',
      labelKey: 'chart.format.colors',
      paths: GENERATED_ICON_PATHS['format_paint'],
      defaultToolbar: false,
      state: { kind: 'value' },
    },
    {
      // A data change (`ChartPaneChange`), or the whole data to write.
      id: 'data',
      shape: 'dropdown',
      labelKey: 'chart.data.series',
      paths: GENERATED_ICON_PATHS['table_chart'],
      defaultToolbar: false,
      state: { kind: 'value' },
    },
  ],
} as const;
