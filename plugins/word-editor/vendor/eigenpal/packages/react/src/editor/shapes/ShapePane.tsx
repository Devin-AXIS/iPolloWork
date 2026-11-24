// `DocxEditor.ShapePane`: the fill and the outline of the selected shape, text box, line, or
// group, as an arrangement of the shape parts (`PANE_SECTIONS.shape`). Format shape moves the
// focus to its first field, wherever the host shows the pane. The pane holds no editing logic:
// each part runs its own slot. The Vue twin is `packages/vue/src/editor/shapes/ShapePane.tsx`.

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
import { useSelectedShape } from './useSelectedShape';

/** Props for `DocxEditor.ShapePane`. @public */
export interface DocxEditorShapePaneProps {
  /** A class name added to the pane. */
  className?: string;
}

/** The fill and outline of the selected shape, or why the pane shows none. @public */
export function DocxEditorShapePane({ className }: DocxEditorShapePaneProps): ReactElement {
  const { t } = useTranslation();
  const editor = useDocxEditor();
  const shape = useSelectedShape();
  const root = useRef<HTMLDivElement>(null);
  // Format shape asks for the focus. A host that mounts the pane for the request mounts it
  // after the request, so the pane takes a pending one when it mounts.
  useEffect(() => {
    if (!editor) return undefined;
    if (takePaneRequestFor(editor, 'shape')?.focus) focusChartPane(root.current);
    return listenPaneRequests(
      editor,
      () => {
        if (takePaneRequestFor(editor, 'shape')?.focus)
          queueMicrotask(() => focusChartPane(root.current));
      },
      { panes: ['shape'] }
    );
  }, [editor]);
  // The pane carries the scope, so its parts need none of their own.
  const scope = useChromeScopeClassName();
  const classes = `${scope}docx-chart-pane docx-shape-pane${className ? ` ${className}` : ''}`;
  const scoped = (node: ReactElement): ReactElement => (
    <ScopedByAncestorContext.Provider value={true}>{node}</ScopedByAncestorContext.Provider>
  );
  if (!shape.format || !shape.drawingNodeId)
    return scoped(
      <div className={classes} ref={root} data-shape="">
        <div className="docx-chart-pane__empty">
          <p className="docx-chart-pane__empty-title">{t('shape.pane.emptyTitle')}</p>
          <p className="docx-chart-pane__empty-body">{t('shape.pane.emptyBody')}</p>
        </div>
      </div>
    );
  // Parts keep unsaved text per shape: a group, or one shape in it.
  const key = shape.memberId ?? shape.drawingNodeId;
  return scoped(
    <div className={classes} ref={root} data-shape={shape.drawingNodeId}>
      <DocxEditorPaneSections key={key} pane="shape" />
      {shape.format.outline.visible === null ? (
        <p className="docx-chart-pane__note">{t('shape.pane.mixedOutline')}</p>
      ) : null}
    </div>
  );
}
