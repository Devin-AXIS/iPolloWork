// `DocxEditorChartData`: the data editor of the selected chart (`chart.data`): the categories (or X values)
// and one card per series with its name and a value for each category. A field applies on Enter
// or blur, and each add or remove applies at once, each as one undo step. The checks come from
// core (`chartPaneCommand`). The Vue twin is `packages/vue/src/editor/objects/chart-data-part.tsx`.

import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import {
  chartPaneDraftContinues,
  chartPaneDraftKey,
  chartRowFocusAfterRemove,
  chartValueText,
  nextChartCategoryLabel,
  type ChartPaneChange,
} from '@docx-editor.dev/core/editor';
import { useTranslation } from '../../i18n';
import { chromeIcon } from '../toolbar/ToolbarButton';
import { DELETE_PATHS } from '../contextmenu/contextmenu-icons';
import { ChartField } from '../charts/chart-fields';
import { useSelectedChart } from '../charts/useSelectedChart';
import { objectPart, useObjectSlot, type ObjectControlProps } from './object-controls';

/**
 * Focus the element that `selector` names under `root` once a render shows it: the row it names
 * is new after an add or a remove. `selectText` selects a new row's sample name.
 */
function useRowFocus(root: { current: HTMLElement | null }) {
  const pending = useRef<{ selector: string; selectText: boolean } | null>(null);
  const [, rerender] = useState(0);
  useEffect(() => {
    const request = pending.current;
    const target = request ? root.current?.querySelector<HTMLElement>(request.selector) : null;
    if (!request || !target) return;
    pending.current = null;
    target.focus();
    if (request.selectText && 'select' in target) (target as HTMLInputElement).select();
  });
  return (selector: string, selectText = false) => {
    pending.current = { selector, selectText };
    rerender((n) => n + 1);
  };
}

function ChartData(props: ObjectControlProps): ReactElement | null {
  const { t } = useTranslation();
  const selected = useSelectedChart();
  const { control, apply: applySlot } = useObjectSlot('chart.data');
  const root = useRef<HTMLDivElement>(null);
  const focusLater = useRowFocus(root);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set([0]));
  const [draftScope, setDraftScope] = useState({ key: '', reset: 0 });
  const data = selected.data;
  const id = selected.chart?.drawingNodeId ?? '';
  const scopeKey = data ? chartPaneDraftKey(id, data) : id;
  const nextScope =
    scopeKey === draftScope.key
      ? draftScope
      : {
          key: scopeKey,
          reset:
            draftScope.reset +
            (draftScope.key && data && chartPaneDraftContinues(draftScope.key, scopeKey) ? 0 : 1),
        };
  if (nextScope !== draftScope) setDraftScope(nextScope);
  if (props.hidden) return null;
  if (!selected.chart) return null;
  if (!data)
    return (
      <div className="docx-chart-pane__empty">
        <p className="docx-chart-pane__empty-title">{t('chart.pane.notEditableTitle')}</p>
        <p className="docx-chart-pane__empty-body">{selected.readReason ?? ''}</p>
      </div>
    );
  const draftKey = String(nextScope.reset);
  const disabled = !control.isEnabled;
  const xy = data.kind === 'xy';
  /** Applies one change: null when it applied, else the reason. */
  const apply = (change: ChartPaneChange): string | null => {
    const reason = applySlot(change);
    if (reason === null) setRefusal(null);
    return reason;
  };
  /** Applies an add or a remove; the part announces a refusal, as no field shows it. */
  const run = (change: ChartPaneChange): boolean => {
    const reason = applySlot(change);
    setRefusal(reason);
    return reason === null;
  };
  const toggle = (index: number, isOpen: boolean): void =>
    setOpen((prev) => {
      if (prev.has(index) === isOpen) return prev;
      const next = new Set(prev);
      if (isOpen) next.add(index);
      else next.delete(index);
      return next;
    });
  const workbookNote =
    data.workbook === 'kept'
      ? t('chart.data.workbookKept')
      : data.workbook === 'external'
        ? t('chart.data.workbookExternal')
        : null;
  return (
    <div
      ref={root}
      className={`docx-object-control docx-object-control--field docx-chart-data${props.className ? ` ${props.className}` : ''}`}
      data-slot="chart.data"
    >
      <p className="docx-chart-pane__alert" role="alert">
        {refusal ?? ''}
      </p>
      {disabled && control.disabledReason ? (
        <p className="docx-chart-pane__note">{control.disabledReason}</p>
      ) : null}
      <section className="docx-chart-pane__section">
        <h3 className="docx-chart-pane__title">
          {t(xy ? 'chart.data.xValues' : 'chart.data.categories')}
        </h3>
        <p className="docx-chart-pane__note">{t('chart.data.help')}</p>
        {workbookNote ? <p className="docx-chart-pane__note">{workbookNote}</p> : null}
        <ul className="docx-chart-pane__list">
          {data.categories.map((c, i) => (
            <li key={i} className="docx-chart-pane__row">
              <ChartField
                draftKey={draftKey}
                label={t(xy ? 'chart.data.xValueLabel' : 'chart.data.categoryLabel', {
                  number: i + 1,
                })}
                value={c.label}
                numeric={xy}
                row={i}
                disabled={disabled}
                onCommit={(text) => apply({ type: 'label', category: i, text })}
              />
              <button
                type="button"
                className="docx-chart-pane__icon-button"
                aria-label={t('chart.data.removeCategoryNamed', { name: c.label })}
                title={t('chart.data.removeCategoryNamed', { name: c.label })}
                disabled={disabled || data.categories.length <= 1}
                onClick={() => {
                  const count = data.categories.length;
                  if (run({ type: 'removeCategory', category: i }))
                    focusLater(
                      `.docx-chart-pane__list [data-row="${chartRowFocusAfterRemove(i, count)}"]`
                    );
                }}
              >
                {chromeIcon(DELETE_PATHS)}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="docx-dialog__button"
          disabled={disabled}
          onClick={() => {
            const at = data.categories.length;
            const label = nextChartCategoryLabel(
              data,
              t('chart.sample.category', { number: at + 1 })
            );
            if (run({ type: 'addCategory', label }))
              focusLater(`.docx-chart-pane__list [data-row="${at}"]`, true);
          }}
        >
          {t('chart.data.addCategory')}
        </button>
      </section>
      <section className="docx-chart-pane__section">
        <h3 className="docx-chart-pane__title">{t('chart.data.series')}</h3>
        {data.series.map((series, j) => {
          const name = series.name || t('chart.data.unnamed');
          return (
            <details
              key={j}
              className="docx-chart-pane__card"
              open={open.has(j)}
              onToggle={(e) => toggle(j, e.currentTarget.open)}
            >
              <summary className="docx-chart-pane__summary" data-series={j}>
                {name}
              </summary>
              <div className="docx-chart-pane__card-body">
                <ChartField
                  draftKey={draftKey}
                  label={t('chart.data.seriesName', { number: j + 1 })}
                  visibleLabel={t('chart.data.name')}
                  value={series.name}
                  disabled={disabled}
                  onCommit={(text) => apply({ type: 'seriesName', series: j, text })}
                />
                <div className="docx-chart-pane__pair">
                  {data.categories.map((c, i) => (
                    <ChartField
                      key={i}
                      draftKey={draftKey}
                      label={t('chart.data.cellLabel', { series: name, category: c.label })}
                      visibleLabel={c.label}
                      value={chartValueText(series.values[i])}
                      numeric
                      disabled={disabled}
                      onCommit={(text) => apply({ type: 'value', series: j, category: i, text })}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="docx-dialog__button"
                  disabled={disabled || data.series.length <= 1}
                  aria-label={t('chart.data.removeSeriesNamed', { name })}
                  onClick={() => {
                    const count = data.series.length;
                    if (run({ type: 'removeSeries', series: j }))
                      focusLater(
                        `.docx-chart-pane__summary[data-series="${chartRowFocusAfterRemove(j, count)}"]`
                      );
                  }}
                >
                  {t('chart.data.removeSeries')}
                </button>
              </div>
            </details>
          );
        })}
        <button
          type="button"
          className="docx-dialog__button"
          disabled={disabled}
          onClick={() => {
            const at = data.series.length;
            if (run({ type: 'addSeries', name: t('chart.sample.series', { number: at + 1 }) })) {
              toggle(at, true);
              focusLater(
                `.docx-chart-pane__summary[data-series="${at}"] + .docx-chart-pane__card-body input`,
                true
              );
            }
          }}
        >
          {t('chart.data.addSeries')}
        </button>
      </section>
    </div>
  );
}

/** The categories and series of the selected chart, or why they cannot change. @public */
export const DocxEditorChartData = objectPart('chart.data', ChartData);
