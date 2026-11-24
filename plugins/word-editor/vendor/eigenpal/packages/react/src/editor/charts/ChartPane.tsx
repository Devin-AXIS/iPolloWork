// `DocxEditor.ChartPane`: the type of the selected chart, its elements, its colors, and its data,
// as an arrangement of the chart parts (`PANE_SECTIONS.chart`). Edit chart moves the focus to
// its first field, wherever the host shows the pane. The pane holds no editing logic: each part
// runs its own slot. The Vue twin is `packages/vue/src/editor/charts/ChartPane.tsx`.

import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import {
  focusChartPane,
  listenPaneRequests,
  takePaneRequestFor,
} from '@docx-editor.dev/core/editor';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { useChromeScopeClassName } from '../color-mode-context';
import { ScopedByAncestorContext } from '../scope-context';
import { DocxEditorPaneSections } from '../objects/pane-sections';
import { useSelectedChart } from './useSelectedChart';

/** Props for `DocxEditor.ChartPane`. @public */
export interface DocxEditorChartPaneProps {
  /** A class name added to the pane. */
  className?: string;
}

/**
 * The type, elements, and colors of the selected chart, then its data; or why it shows none.
 * @public
 */
export function DocxEditorChartPane({ className }: DocxEditorChartPaneProps): ReactElement {
  const { t } = useTranslation();
  const editor = useDocxEditor();
  const selected = useSelectedChart();
  const root = useRef<HTMLDivElement>(null);
  // Edit chart asks for the focus. A host that mounts the pane for the request mounts it after
  // the request, so the pane takes a pending one when it mounts.
  useEffect(() => {
    if (!editor) return undefined;
    if (takePaneRequestFor(editor, 'chart')?.focus) focusChartPane(root.current);
    return listenPaneRequests(editor, () => {
      if (takePaneRequestFor(editor, 'chart')?.focus)
        queueMicrotask(() => focusChartPane(root.current));
    });
  }, [editor]);
  // The pane carries the scope, so its parts need none of their own.
  const scope = useChromeScopeClassName();
  const classes = `${scope}docx-chart-pane${className ? ` ${className}` : ''}`;
  const scoped = (node: ReactElement): ReactElement => (
    <ScopedByAncestorContext.Provider value={true}>{node}</ScopedByAncestorContext.Provider>
  );
  const chart = selected.chart;
  if (!chart)
    return scoped(
      <div className={classes} ref={root} data-chart-version="">
        <div className="docx-chart-pane__empty">
          <p className="docx-chart-pane__empty-title">{t('chart.pane.emptyTitle')}</p>
          <p className="docx-chart-pane__empty-body">{t('chart.pane.emptyBody')}</p>
        </div>
      </div>
    );
  return scoped(
    <div className={classes} ref={root} data-chart-version={chart.version}>
      {selected.format ? null : (
        <div className="docx-chart-pane__empty">
          <p className="docx-chart-pane__empty-title">{t('chart.pane.notEditableTitle')}</p>
          <p className="docx-chart-pane__empty-body">
            {selected.formatDisabledReason ?? selected.readReason ?? ''}
          </p>
        </div>
      )}
      <DocxEditorPaneSections
        key={chart.drawingNodeId}
        pane="chart"
        filter={(section) => section.id === 'data' || selected.format !== null}
      />
    </div>
  );
}
