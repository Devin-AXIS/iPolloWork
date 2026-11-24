export {
  ChartInsert,
  ToolbarChartInsert,
  type ChartInsertPartComponent,
  type ChartInsertProps,
} from './ChartInsert';
export { DocxEditorChartPane, type DocxEditorChartPaneProps } from './ChartPane';
// The side panel moved to `editor/panes/`; this path keeps its exports.
export { DocxEditorSidePanel, usePaneRequest, type DocxEditorSidePanelProps } from '../panes';
export { useSelectedChart, type UseSelectedChartReturn } from './useSelectedChart';
