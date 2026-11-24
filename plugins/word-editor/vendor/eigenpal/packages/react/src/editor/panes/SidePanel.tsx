// `DocxEditor.SidePanel`: one packaged host for the pane requests, a panel beside the pages that
// holds the Chart pane or the Format shape pane. Any other UI can answer the same requests
// (`usePaneRequest`). The host shows or hides it by rendering it, and opens it when the chrome asks
// (`usePaneRequest`): Insert > Chart opens it without the focus, and Edit chart and Format shape
// move the focus into their pane, which takes the request itself. The selection picks the pane
// (`sidePanelPane`): a chart shows the Chart pane, a shape the Format shape pane, and otherwise
// the pane that was asked for last stays. The Vue twin is
// `packages/vue/src/editor/panes/SidePanel.tsx`; both render the same markup.

import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import {
  focusChartPane,
  listenPaneRequests,
  paneTitleKey,
  selectionPane,
  takePaneRequest,
  type EditorPaneId,
  type PaneRequest,
  type PaneRequestListenerOptions,
} from '@docx-editor.dev/core/editor';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorChildren } from '../../docx-editor-children';
import { MaterialSymbol } from '../../components/ui/Icons';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { DocxEditorChartPane } from '../charts/ChartPane';
import { DocxEditorShapePane } from '../shapes/ShapePane';

/** The panes the side panel shows. */
const SIDE_PANEL_PANES = { panes: ['chart', 'shape'] } as const;

/**
 * Call `listener` for each request for a pane in `options.panes`: Insert > Chart and Edit chart
 * ask for `'chart'`, and Format shape asks for `'shape'`. The default is `['chart']`. A request
 * says what the user asked to see, not where: answer it with any UI, such as a popover, a
 * drawer, a dialog, or `DocxEditor.SidePanel`, and render `DocxEditor.PaneSections` or single
 * parts in it. Listening for a pane makes its chrome available, so list only the panes the host
 * shows.
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false);
 * usePaneRequest(() => setOpen(true), { panes: ['chart'] });
 * return open ? (
 *   <div role="dialog" aria-label="Chart">
 *     <DocxEditor.PaneSections pane="chart" sections={['type', 'elements']} />
 *   </div>
 * ) : null;
 * ```
 *
 * @public
 */
export function usePaneRequest(
  listener: (request: PaneRequest) => void,
  options?: PaneRequestListenerOptions
): void {
  const editor = useDocxEditor();
  const latest = useRef(listener);
  latest.current = listener;
  const panes = (options?.panes ?? ['chart']).join(' ');
  useEffect(
    () =>
      editor
        ? listenPaneRequests(editor, (request) => latest.current(request), {
            panes: panes.split(' ') as EditorPaneId[],
          })
        : undefined,
    [editor, panes]
  );
}

/** Props for `DocxEditor.SidePanel`. @public */
export interface DocxEditorSidePanelProps {
  /** A class name added to the panel. */
  className?: string;
  /** Shows a close button that calls it. */
  onClose?: () => void;
  /**
   * Content that replaces the packaged panes. When Edit chart or Format shape asks for the
   * focus, the panel moves it to the first field in this content.
   */
  children?: DocxEditorChildren;
}

const selectPaneSelection = (snapshot: EditorSnapshot) => selectionPane(snapshot);

/** The side panel that holds the Chart pane or the Format shape pane. @public */
export function DocxEditorSidePanel({
  className,
  onClose,
  children,
}: DocxEditorSidePanelProps): ReactElement {
  const { t } = useTranslation();
  const editor = useDocxEditor();
  const body = useRef<HTMLDivElement>(null);
  const custom = children !== undefined && children !== null;
  // The pane that was asked for or selected last, for a selection that picks none, so a text
  // click after a shape keeps the Format shape pane.
  const [requested, setRequested] = useState<EditorPaneId>('chart');
  const selected = useEditorState(selectPaneSelection);
  if (selected && selected !== requested) setRequested(selected);
  const pane = selected ?? requested;
  useEffect(
    () =>
      editor
        ? listenPaneRequests(editor, (request) => setRequested(request.pane), SIDE_PANEL_PANES)
        : undefined,
    [editor]
  );
  // The packaged panes take their own focus requests; custom content gets them here.
  useEffect(() => {
    if (!editor || !custom) return undefined;
    const focus = () => queueMicrotask(() => focusChartPane(body.current));
    if (takePaneRequest(editor)?.focus) focus();
    return listenPaneRequests(
      editor,
      () => {
        if (takePaneRequest(editor)?.focus) focus();
      },
      SIDE_PANEL_PANES
    );
  }, [editor, custom]);
  const title = t(paneTitleKey(pane));
  // Closing hands the keyboard back to the document; the drawing stays selected.
  const close = (): void => {
    onClose?.();
    editor?.focus();
  };
  return (
    <aside
      className={`docx-side-panel${className ? ` ${className}` : ''}`}
      aria-label={title}
      data-pane={pane}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !onClose || e.defaultPrevented) return;
        e.preventDefault();
        close();
      }}
    >
      <div className="docx-side-panel__head">
        <h2 className="docx-side-panel__title">{title}</h2>
        {onClose ? (
          <button
            type="button"
            className="docx-side-panel__close"
            aria-label={t(pane === 'shape' ? 'shape.pane.close' : 'chart.pane.close')}
            title={t(pane === 'shape' ? 'shape.pane.close' : 'chart.pane.close')}
            onClick={close}
          >
            <MaterialSymbol name="close" size={18} />
          </button>
        ) : null}
      </div>
      <div className="docx-side-panel__body" ref={body}>
        {children ?? (pane === 'shape' ? <DocxEditorShapePane /> : <DocxEditorChartPane />)}
      </div>
    </aside>
  );
}
