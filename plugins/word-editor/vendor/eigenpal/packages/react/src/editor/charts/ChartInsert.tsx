import type { DocxEditorChildren } from '../../docx-editor-children';
// Insert > Chart as a toolbar dropdown: the chart types of `CHART_INSERT_CHOICES`. A pick
// inserts the chart at the caret, selects it, and asks the host to show the Chart pane
// without the focus (`runToolbarCommand` on `insert.chart`).

import { useEffect, useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import {
  CHART_INSERT_CHOICES,
  chartTypeIconPaths,
  chartTypeLabelKey,
  hostDocumentOf,
  isDomNode,
} from '@docx-editor.dev/core/editor';
import type { ChartType } from '@docx-editor.dev/core/editor';
import { useTranslation } from '../../i18n';
import { useEditorValueCommand } from '../useEditorValueCommand';
import { useToolbarLabel } from '../toolbar/toolbar-context';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from '../toolbar/ToolbarButton';
import { Slot } from '../toolbar/Slot';
import { PanelRowContent, triggerClassName, usePanelRow } from '../toolbar/panel-row';

/** Props for `DocxEditor.Toolbar.ChartInsert`. @public */
export interface ChartInsertProps {
  className?: string;
  hidden?: boolean;
  asChild?: boolean;
  children?: DocxEditorChildren;
}

/** The Insert chart dropdown: one item for each chart type. @public */
export function ChartInsert({ className, hidden, asChild, children }: ChartInsertProps) {
  const { t } = useTranslation();
  const label = useToolbarLabel();
  const { execute, isEnabled, disabledReason } = useEditorValueCommand('insert.chart');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();
  const panelRow = usePanelRow(asChild, children);

  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (event: MouseEvent): void => {
      const root = rootRef.current;
      if (root && isDomNode(event.target) && root.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const doc = hostDocumentOf(rootRef.current);
    doc.addEventListener('mousedown', onMouseDown, true);
    doc.addEventListener('keydown', onKeyDown);
    return () => {
      doc.removeEventListener('mousedown', onMouseDown, true);
      doc.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (hidden) return null;

  const control = chromeControlForSlot('insert.chart');
  const text = label(control?.labelKey ?? 'chart.insert');
  const choose = (type: ChartType): void => {
    setOpen(false);
    execute(type);
  };
  const shared = {
    type: 'button' as const,
    ref: triggerRef,
    className: `${triggerClassName(panelRow)} docx-toolbar__chart-insert-trigger${className ? ` ${className}` : ''}`,
    'data-slot': 'insert.chart',
    disabled: !isEnabled,
    ...(!isEnabled ? { 'data-disabled': '' } : {}),
    'aria-haspopup': 'menu' as const,
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    'aria-label': text,
    title: disabledReason ?? text,
    onMouseDown: guardToolbarMousedown,
    onClick: () => setOpen((was) => !was),
  };

  return (
    <div ref={rootRef} className="docx-toolbar__chart-insert">
      {asChild ? (
        <Slot {...shared}>{children}</Slot>
      ) : (
        <button {...shared}>
          {panelRow ? (
            <PanelRowContent icon={chromeIcon(control?.paths)} label={text} />
          ) : (
            (children ?? chromeIcon(control?.paths))
          )}
        </button>
      )}
      {open ? (
        <div
          id={menuId}
          role="menu"
          className="docx-toolbar__image-wrap-menu docx-toolbar__chart-insert-menu"
          aria-label={text}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {CHART_INSERT_CHOICES.map((type) => (
            <button
              key={type}
              type="button"
              role="menuitem"
              className="docx-toolbar__image-wrap-item"
              data-value={type}
              aria-label={t('chart.insertType', { type: t(chartTypeLabelKey(type)) })}
              onMouseDown={guardToolbarMousedown}
              onClick={() => choose(type)}
            >
              {chromeIcon(chartTypeIconPaths(type))}
              <span>{t(chartTypeLabelKey(type))}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

ChartInsert.docxSlot = 'insert.chart' as const;

/** @public */
export interface ChartInsertPartComponent {
  (props: ChartInsertProps): ReactElement | null;
  readonly docxSlot: 'insert.chart';
}

export const ToolbarChartInsert: ChartInsertPartComponent = Object.assign(ChartInsert, {
  docxSlot: 'insert.chart' as const,
});
