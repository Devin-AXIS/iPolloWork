// The shape parts: one exported control for each `shape.*` slot. Each works alone, in a host's
// toolbar, popover, drawer, or pane, and `DocxEditor.ShapePane` is an arrangement of them
// (`PANE_SECTIONS.shape`). The Vue twin is `packages/vue/src/editor/objects/shape-parts.tsx`.

import type { ReactElement } from 'react';
import {
  SHAPE_OUTLINE_DASHES,
  SHAPE_OUTLINE_WIDTHS,
  documentThemeHexes,
  shapeDashLabelKey,
  shapeFillEditable,
  shapeFillLabelKey,
  shapeFillSummary,
  shapeOutlineSummary,
} from '@docx-editor.dev/core/editor';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { useChartTranslate } from '../charts/chart-fields';
import { useSelectedShape } from '../shapes/useSelectedShape';
import {
  ChoiceControl,
  ColorControl,
  TextControl,
  objectPart,
  useObjectControlVariant,
  type ObjectButtonPartProps,
  type ObjectControlProps,
} from './object-controls';

/** Props of a shape part. @public */
export type ShapePartProps = ObjectControlProps;

/** Props of a shape colour part: it also takes `icon` and `asChild`. @public */
export type ShapeColorPartProps = ObjectButtonPartProps;

function ShapeFill(props: ShapeColorPartProps): ReactElement | null {
  const { t } = useTranslation();
  const translate = useChartTranslate();
  const editor = useDocxEditor();
  const shape = useSelectedShape();
  const hexes = documentThemeHexes(editor?.getDocumentThemeColors());
  const fill = shape.format?.fill;
  const summary = fill ? shapeFillSummary(fill, hexes, translate) : '';
  return (
    <ColorControl
      {...props}
      slotId="shape.fill"
      summary={summary}
      noneLabel={t('shape.pane.noFill')}
      after={
        fill && !shapeFillEditable(fill) ? (
          <p className="docx-chart-pane__note" data-fill-type={fill.type}>
            {t('shape.pane.readOnlyFill', { fill: translate(shapeFillLabelKey(fill)) })}
          </p>
        ) : null
      }
    />
  );
}

function ShapeFillTransparency(props: ShapePartProps): ReactElement | null {
  const shape = useSelectedShape();
  return (
    <TextControl
      {...props}
      slotId="shape.fillTransparency"
      numeric
      draftKey={shape.memberId ?? shape.drawingNodeId ?? ''}
    />
  );
}

function ShapeOutlineColor(props: ShapeColorPartProps): ReactElement | null {
  const { t } = useTranslation();
  const translate = useChartTranslate();
  const editor = useDocxEditor();
  const shape = useSelectedShape();
  const hexes = documentThemeHexes(editor?.getDocumentThemeColors());
  const summary = shape.format ? shapeOutlineSummary(shape.format.outline, hexes, translate) : '';
  return (
    <ColorControl
      {...props}
      slotId="shape.outlineColor"
      summary={summary}
      noneLabel={t('shape.pane.noOutline')}
    />
  );
}

function ShapeOutlineWidth(props: ShapePartProps): ReactElement | null {
  const { t } = useTranslation();
  const shape = useSelectedShape();
  const variant = useObjectControlVariant(props.variant);
  if (props.hidden) return null;
  const options = SHAPE_OUTLINE_WIDTHS.map(
    (value) => [String(value), t('shape.pane.widthPoints', { value })] as const
  );
  const list = (
    <ChoiceControl
      {...props}
      variant={variant}
      {...(variant === 'compact' ? {} : { label: t('shape.pane.widthPreset') })}
      slotId="shape.outlineWidth"
      options={options}
      other={
        // A compact list has no number box, so it names the width it cannot list.
        variant === 'compact' && typeof shape.format?.outline.widthPt === 'number'
          ? t('shape.pane.widthPoints', {
              value: Math.round(shape.format.outline.widthPt * 100) / 100,
            })
          : t('shape.pane.otherWidth')
      }
      parse={Number}
    />
  );
  if (variant === 'compact') return list;
  return (
    <div className="docx-chart-pane__pair">
      {list}
      <TextControl
        slotId="shape.outlineWidth"
        {...(props.label ? { label: props.label } : {})}
        numeric
        draftKey={shape.memberId ?? shape.drawingNodeId ?? ''}
      />
    </div>
  );
}

function ShapeOutlineDash(props: ShapePartProps): ReactElement | null {
  const { t } = useTranslation();
  const translate = useChartTranslate();
  const shape = useSelectedShape();
  const options = SHAPE_OUTLINE_DASHES.map(
    (dash) => [dash, translate(shapeDashLabelKey(dash))] as const
  );
  return (
    <ChoiceControl
      {...props}
      slotId="shape.outlineDash"
      options={options}
      other={
        shape.format?.outline.dash === 'custom'
          ? t('shape.pane.dashes.custom')
          : t('shape.pane.fillTypes.mixed')
      }
    />
  );
}

/** The fill colour of the selected shape (`shape.fill`), with No fill. @public */
export const DocxEditorShapeFill = objectPart('shape.fill', ShapeFill);

/** The transparency of a solid fill, in percent (`shape.fillTransparency`). @public */
export const DocxEditorShapeFillTransparency = objectPart(
  'shape.fillTransparency',
  ShapeFillTransparency
);

/** The outline colour of the selected shape (`shape.outlineColor`), with No line. @public */
export const DocxEditorShapeOutlineColor = objectPart('shape.outlineColor', ShapeOutlineColor);

/**
 * The outline width in points (`shape.outlineWidth`): a list of preset widths, and in a field a
 * number box for any other width. @public
 */
export const DocxEditorShapeOutlineWidth = objectPart('shape.outlineWidth', ShapeOutlineWidth);

/** The outline dash (`shape.outlineDash`): solid, dotted, or dashed. @public */
export const DocxEditorShapeOutlineDash = objectPart('shape.outlineDash', ShapeOutlineDash);
