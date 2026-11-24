// The chart parts: one exported control for each `chart.*` slot. Each works alone, in a host's
// toolbar, popover, drawer, or pane, and `DocxEditor.ChartPane` is an arrangement of them
// (`PANE_SECTIONS.chart`). The data editor is `DocxEditorChartData` (chart-data-part.tsx). The Vue
// twin is `packages/vue/src/editor/objects/chart-parts.tsx`.

import { useId, useState } from 'react';
import type { ReactElement } from 'react';
import {
  CHART_LEGEND_CHOICES,
  CHART_TYPE_CHOICES,
  chartAxisTitleLabels,
  chartColorPick,
  chartPickHex,
  chartSeriesNote,
  chartTypeChangeNote,
  chartTypeHint,
  chartTypeLabelKey,
  colorPickLabel,
  documentThemeHexes,
  type ChartFormat,
  type ChartType,
  type ColorPick,
} from '@docx-editor.dev/core/editor';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { useChartTranslate } from '../charts/chart-fields';
import { useSelectedChart } from '../charts/useSelectedChart';
import { ColorPicker } from '../color/ColorPicker';
import {
  ChoiceControl,
  ObjectControlFrame,
  TextControl,
  ToggleControl,
  objectPart,
  useObjectControlVariant,
  useObjectSlot,
  type ObjectButtonPartProps,
  type ObjectControlProps,
} from './object-controls';

/** Props of a chart part. @public */
export type ChartPartProps = ObjectControlProps;

/** Props of a chart toggle part: it also takes `icon` and `asChild`. @public */
export type ChartTogglePartProps = ObjectButtonPartProps;

/** Props of `DocxEditor.ChartSeriesColors`. @public */
export interface ChartSeriesColorsProps extends ChartPartProps {
  /** Shows the colour of this series (or pie point) only. */
  index?: number;
}

/** The most colour fields `ChartSeriesColors` shows: a pie chart can have thousands of points. */
const MAX_COLOR_FIELDS = 100;

function ChartType(props: ChartPartProps): ReactElement | null {
  const { t } = useTranslation();
  const translate = useChartTranslate();
  const selected = useSelectedChart();
  const variant = useObjectControlVariant(props.variant);
  const [note, setNote] = useState<{ id: string; key: string; before: ChartFormat } | null>(null);
  const id = selected.chart?.drawingNodeId ?? '';
  const format = selected.format;
  const changed =
    note && note.id === id && format ? chartTypeChangeNote(note.before, format) : null;
  const notes =
    format && variant !== 'compact'
      ? [
          note?.id === id ? changed : chartTypeHint(format),
          chartSeriesNote(format, selected.data?.series.length ?? 0),
        ].filter((key): key is NonNullable<typeof key> => key !== null)
      : [];
  return (
    <ChoiceControl
      {...props}
      variant={variant}
      slotId="chart.type"
      options={CHART_TYPE_CHOICES.map((v) => [v, t(chartTypeLabelKey(v))] as const)}
      other={t('chart.types.other')}
      parse={(text) => text as ChartType}
      onApplied={(refusal) => {
        if (refusal === null && format) setNote({ id, key: 'type', before: format });
      }}
      after={
        variant === 'compact' ? null : (
          <div role="status" className="docx-chart-pane__status">
            {notes.map((key) => (
              <p key={key} className="docx-chart-pane__note">
                {translate(key)}
              </p>
            ))}
          </div>
        )
      }
    />
  );
}

function ChartTitle(props: ChartPartProps): ReactElement | null {
  const { t } = useTranslation();
  const { control, apply } = useObjectSlot('chart.title');
  const selected = useSelectedChart();
  const reasonId = useId();
  const variant = useObjectControlVariant(props.variant);
  if (props.hidden) return null;
  const draftKey = selected.chart?.drawingNodeId ?? '';
  if (variant === 'compact')
    return <TextControl {...props} variant="compact" slotId="chart.title" draftKey={draftKey} />;
  return (
    <ObjectControlFrame
      slotId="chart.title"
      variant="field"
      className={props.className}
      reason={control.disabledReason}
      reasonId={reasonId}
      active={control.isActive}
    >
      <label className="docx-dialog__checkbox-row">
        <input
          type="checkbox"
          checked={control.isActive}
          disabled={!control.isEnabled}
          aria-describedby={control.disabledReason !== null ? reasonId : undefined}
          onChange={(event) =>
            apply(event.currentTarget.checked ? t('chart.format.defaultTitle') : null)
          }
        />
        {t('chart.format.showTitle')}
      </label>
      {control.isActive ? (
        <div className="docx-chart-pane__sub">
          <TextControl
            slotId="chart.title"
            variant="field"
            {...(props.label ? { label: props.label } : {})}
            draftKey={draftKey}
          />
        </div>
      ) : null}
    </ObjectControlFrame>
  );
}

function ChartLegend(props: ChartPartProps): ReactElement | null {
  const { t } = useTranslation();
  return (
    <ChoiceControl
      {...props}
      slotId="chart.legend"
      options={CHART_LEGEND_CHOICES.map(
        (v) => [v, t(`chart.format.legendPositions.${v}`)] as const
      )}
    />
  );
}

function ChartDataLabels(props: ChartTogglePartProps): ReactElement | null {
  return <ToggleControl {...props} slotId="chart.dataLabels" />;
}

/** Whether the selected chart has axes; a pie or doughnut chart has none. */
const useHasAxes = (): boolean => useSelectedChart().format?.axes !== null;

function ChartAxes(props: ChartTogglePartProps): ReactElement | null {
  return useHasAxes() ? <ToggleControl {...props} slotId="chart.axes" /> : null;
}

function ChartGridlines(props: ChartTogglePartProps): ReactElement | null {
  return useHasAxes() ? <ToggleControl {...props} slotId="chart.gridlines" /> : null;
}

/** One axis title; X and Y for a scatter chart. Empty text removes the title. */
function AxisTitle(
  props: ChartPartProps & { slotId: 'chart.categoryAxisTitle' | 'chart.valueAxisTitle' }
): ReactElement | null {
  const { t } = useTranslation();
  const selected = useSelectedChart();
  const helpId = useId();
  const variant = useObjectControlVariant(props.variant);
  if (props.hidden || selected.format?.axes === null) return null;
  const labels = selected.format ? chartAxisTitleLabels(selected.format) : null;
  const key = labels
    ? props.slotId === 'chart.categoryAxisTitle'
      ? labels.category
      : labels.value
    : null;
  const field = variant !== 'compact';
  return (
    <>
      <TextControl
        {...props}
        variant={variant}
        {...(key && !props.label ? { label: t(key) } : {})}
        slotId={props.slotId}
        draftKey={selected.chart?.drawingNodeId ?? ''}
        {...(field ? { describedBy: helpId } : {})}
      />
      {field ? (
        <p className="docx-chart-pane__note" id={helpId}>
          {t('chart.format.axisTitleHelp')}
        </p>
      ) : null}
    </>
  );
}

function ChartCategoryAxisTitle(props: ChartPartProps): ReactElement | null {
  return <AxisTitle {...props} slotId="chart.categoryAxisTitle" />;
}

function ChartValueAxisTitle(props: ChartPartProps): ReactElement | null {
  return <AxisTitle {...props} slotId="chart.valueAxisTitle" />;
}

function ChartSeriesColors(props: ChartSeriesColorsProps): ReactElement | null {
  const { t } = useTranslation();
  const translate = useChartTranslate();
  const editor = useDocxEditor();
  const selected = useSelectedChart();
  const { control, apply } = useObjectSlot('chart.seriesColor');
  const reasonId = useId();
  const [refusal, setRefusal] = useState<string | null>(null);
  const variant = useObjectControlVariant(props.variant);
  if (props.hidden) return null;
  const hexes = documentThemeHexes(editor?.getDocumentThemeColors());
  const entries = (selected.format?.colors ?? [])
    .slice(0, MAX_COLOR_FIELDS)
    .map((entry, index) => ({ entry, index }))
    .filter(({ index }) => props.index === undefined || props.index === index);
  return (
    <ObjectControlFrame
      slotId="chart.seriesColor"
      variant={variant}
      className={props.className}
      reason={control.disabledReason}
      reasonId={reasonId}
    >
      {refusal ? (
        <p className="docx-chart-pane__error" role="alert">
          {refusal}
        </p>
      ) : null}
      {entries.map(({ entry, index }) => {
        const name = entry.name || t('chart.data.unnamed');
        const pick = chartColorPick(entry);
        const label = props.label ?? t('chart.format.seriesColor', { name });
        return (
          <ColorPicker.Root
            key={index}
            value={pick}
            noColor="auto"
            automaticHex={chartPickHex('auto', hexes, entry.automatic)}
            themeHexes={hexes}
            disabled={!control.isEnabled}
            onPick={(next) =>
              setRefusal(apply({ index, color: (next === 'none' ? 'auto' : next) as ColorPick }))
            }
          >
            {variant === 'field' ? (
              <span className="docx-chart-pane__label" aria-hidden="true">
                {name}
              </span>
            ) : null}
            <ColorPicker.Trigger
              aria-label={label}
              title={variant === 'compact' ? label : undefined}
              {...(control.disabledReason !== null && variant === 'field'
                ? { 'aria-describedby': reasonId }
                : {})}
            >
              {variant === 'compact' ? null : (
                <span className="docx-color-picker__summary docx-shape-pane__summary">
                  {colorPickLabel(pick, translate)}
                </span>
              )}
            </ColorPicker.Trigger>
            <ColorPicker.Content aria-label={t('chart.format.openColors', { name })} />
          </ColorPicker.Root>
        );
      })}
    </ObjectControlFrame>
  );
}

/**
 * The chart type (`chart.type`). A field notes when a type change drops colours or axis titles,
 * and when a pie chart shows only its first series. @public
 */
export const DocxEditorChartType = objectPart('chart.type', ChartType);

/**
 * The chart title (`chart.title`). A field shows a Title check box and, while it is on, the title
 * text; a toolbar shows the text field alone, where empty text removes the title. @public
 */
export const DocxEditorChartTitle = objectPart('chart.title', ChartTitle);

/** Where the legend sits, or none (`chart.legend`). @public */
export const DocxEditorChartLegend = objectPart('chart.legend', ChartLegend);

/** Whether each point shows its value (`chart.dataLabels`). @public */
export const DocxEditorChartDataLabels = objectPart('chart.dataLabels', ChartDataLabels);

/** Whether the chart shows its axes (`chart.axes`). Nothing for a chart with no axes. @public */
export const DocxEditorChartAxes = objectPart('chart.axes', ChartAxes);

/** Whether the value axis shows major gridlines (`chart.gridlines`). @public */
export const DocxEditorChartGridlines = objectPart('chart.gridlines', ChartGridlines);

/** The category (or X) axis title (`chart.categoryAxisTitle`). @public */
export const DocxEditorChartCategoryAxisTitle = objectPart(
  'chart.categoryAxisTitle',
  ChartCategoryAxisTitle
);

/** The value (or Y) axis title (`chart.valueAxisTitle`). @public */
export const DocxEditorChartValueAxisTitle = objectPart(
  'chart.valueAxisTitle',
  ChartValueAxisTitle
);

/**
 * The colour of each series, or of each point of a pie chart (`chart.seriesColor`): one shared
 * colour picker per entry, with Automatic. `index` shows one entry only. @public
 */
export const DocxEditorChartSeriesColors = objectPart('chart.seriesColor', ChartSeriesColors);
