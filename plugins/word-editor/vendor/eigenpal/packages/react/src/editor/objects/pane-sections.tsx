// The part of each `shape.*` and `chart.*` slot, and `DocxEditor.PaneSections`, which renders the
// sections of a pane (`PANE_SECTIONS`) from those parts. The packaged panes are this component
// and nothing more; a host renders it in its own popover or drawer, or renders the parts one by
// one. The Vue twin is `packages/vue/src/editor/objects/pane-sections.tsx`.

import type { ComponentType, ReactElement } from 'react';
import {
  paneSections,
  type EditorPaneId,
  type PaneSection,
  type PaneSectionId,
} from '@docx-editor.dev/core/editor';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import { useTranslation } from '../../i18n';
import {
  ObjectControlVariantContext,
  type ObjectControlProps,
  type ObjectSlotId,
} from './object-controls';
import {
  DocxEditorShapeFill,
  DocxEditorShapeFillTransparency,
  DocxEditorShapeOutlineColor,
  DocxEditorShapeOutlineDash,
  DocxEditorShapeOutlineWidth,
} from './shape-parts';
import {
  DocxEditorChartAxes,
  DocxEditorChartCategoryAxisTitle,
  DocxEditorChartDataLabels,
  DocxEditorChartGridlines,
  DocxEditorChartLegend,
  DocxEditorChartSeriesColors,
  DocxEditorChartTitle,
  DocxEditorChartType,
  DocxEditorChartValueAxisTitle,
} from './chart-parts';
import { DocxEditorChartData } from './chart-data-part';

/** The packaged part of each shape and chart slot. @public */
export const OBJECT_SLOT_PARTS: Readonly<Record<ObjectSlotId, ComponentType<ObjectControlProps>>> =
  {
    'shape.fill': DocxEditorShapeFill,
    'shape.fillTransparency': DocxEditorShapeFillTransparency,
    'shape.outlineColor': DocxEditorShapeOutlineColor,
    'shape.outlineWidth': DocxEditorShapeOutlineWidth,
    'shape.outlineDash': DocxEditorShapeOutlineDash,
    'chart.type': DocxEditorChartType,
    'chart.title': DocxEditorChartTitle,
    'chart.legend': DocxEditorChartLegend,
    'chart.dataLabels': DocxEditorChartDataLabels,
    'chart.axes': DocxEditorChartAxes,
    'chart.gridlines': DocxEditorChartGridlines,
    'chart.categoryAxisTitle': DocxEditorChartCategoryAxisTitle,
    'chart.valueAxisTitle': DocxEditorChartValueAxisTitle,
    'chart.seriesColor': DocxEditorChartSeriesColors,
    'chart.data': DocxEditorChartData,
  };

/** Props for `DocxEditor.PaneSections`. @public */
export interface DocxEditorPaneSectionsProps<P extends EditorPaneId = EditorPaneId> {
  /** The pane whose sections to render: `shape` or `chart`. */
  pane: P;
  /** Only these sections, by id (`fill` and `outline`; `type`, `elements`, `colors`, and `data`); default all. */
  sections?: readonly PaneSectionId<P>[];
  /** Leaves out sections; `ChartPane` leaves out the format sections of a chart it cannot read. */
  filter?: (section: PaneSection<P>) => boolean;
}

/**
 * The sections of a pane, each a heading over its slot parts. The parts render as fields, also
 * inside a toolbar. @public
 */
export function DocxEditorPaneSections<P extends EditorPaneId>({
  pane,
  sections,
  filter,
}: DocxEditorPaneSectionsProps<P>): ReactElement {
  const { t } = useTranslation();
  const shown = paneSections(pane).filter(
    (section) => (!sections || sections.includes(section.id)) && (!filter || filter(section))
  );
  return (
    <ObjectControlVariantContext.Provider value="field">
      {shown.map((section) => (
        <section
          key={section.id}
          className="docx-chart-pane__section"
          data-section={section.id}
          aria-label={section.labelKey ? t(section.labelKey as TranslationKey) : undefined}
        >
          {section.labelKey ? (
            <h3 className="docx-chart-pane__title">{t(section.labelKey as TranslationKey)}</h3>
          ) : null}
          {section.slots.map((slot) => {
            const Part = OBJECT_SLOT_PARTS[slot as ObjectSlotId];
            return Part ? <Part key={slot} /> : null;
          })}
        </section>
      ))}
    </ObjectControlVariantContext.Provider>
  );
}
