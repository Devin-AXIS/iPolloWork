import { UnsupportedElementRegistryContext } from './unsupported-element-registry';
import { EnginePopups } from './engine-popups';
import { ConfiguredPopups } from './popup-config';
import { DialogMount } from './dialog-host';
// The engine's mount point: where the pages actually paint.
//
// Renders the `docx-paginated-surface` element and hands it to the facade with
// `attach` in a layout effect — after the element is connected under the Viewport, so
// the engine's scroller discovery (`docx-editor__scroll-container` ancestor) finds the
// right element on the first paint. The facade owns everything inside this div.
//
// Paste and drop of supported raster formats route through the shared image-insert path.

import { useCallback, useContext, useLayoutEffect, useRef } from 'react';
import {
  clipboardPasteLandsContent,
  editorDropHandled,
  openChartPaneAt,
} from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';
import { useImageInsertOptional } from './images/ImageInsert';
import { ImageSelectionOverlay } from './images/ImageSelectionOverlay.tsx';

import type { DocxEditorChildren } from '../docx-editor-children';

function hasImageFile(transfer: DataTransfer): boolean {
  return [...transfer.items].some((item) => item.kind === 'file' && item.type.startsWith('image/'));
}

/** Props for `DocxEditor.Content`. @public */
export interface DocxEditorContentProps {
  /** Appended after the load-bearing `docx-paginated-surface` class. */
  className?: string;
  children?: DocxEditorChildren;
}

/**
 * The element the engine paints pages into. Must render inside a
 * `DocxEditor.Viewport`; the facade attaches here and detaches on unmount. Detaching parks
 * the editor, so mounting the content elsewhere, even in another window, moves it with its
 * undo history, selection and reading position.
 *
 * Its centring margin lives in the STYLESHEET, not in an inline style here, and behind
 * `:where()` so it carries no specificity: a host that places the page itself — inside its
 * own stage, beside its own art — overrides it with a plain class and no `!important`. An
 * inline style could not be beaten by a class at all, which is exactly the trap that makes
 * a library feel like something to fight.
 *
 * @public
 */
export function DocxEditorContent({ className }: DocxEditorContentProps) {
  const editor = useDocxEditor();
  const imageInsert = useImageInsertOptional();
  const elementRef = useRef<HTMLDivElement | null>(null);
  const registry = useContext(UnsupportedElementRegistryContext);
  const contentRef = useCallback(
    (element: HTMLDivElement | null) => {
      elementRef.current = element;
      registry?.setContainer(element);
    },
    [registry]
  );
  const portalRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = elementRef.current;
    if (!editor || !el) return undefined;
    try {
      editor.attach(el);
    } catch (error) {
      // A crashed open is already a refusal on the snapshot, which `DocxEditor.OpenFailure`
      // shows. Rethrowing here would unmount the editor, and the dialog with it.
      if (editor.snapshot().openFailure?.code !== 'open.failed') throw error;
      console.error('[docx-editor] The document failed to open.', error);
    }
    return () => {
      // No-op when the Root already destroyed the instance (unmount ordering runs this
      // first, but a document-identity remount can interleave).
      editor.detach();
    };
  }, [editor]);

  const onPaste = useCallback(
    (event: React.ClipboardEvent) => {
      if (!imageInsert?.isEnabled) return;
      const items = event.clipboardData;
      if (!items) return;
      if (!hasImageFile(items)) return;
      // STAND DOWN whenever the ENGINE will land content from the payload — see the
      // predicate's contract in core. Word on macOS pastes a rendered PNG of copied TEXT
      // beside the HTML; taking this file lane for it inserted that rendering on top of
      // the text. (`defaultPrevented` says nothing — the engine prevents every paste,
      // even ones it ignores.)
      if (clipboardPasteLandsContent(items)) return;
      event.preventDefault();
      void imageInsert.insertFromDataTransfer(items);
    },
    [imageInsert]
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      // Keep unsupported file drops on the mount from navigating away from the editor.
      event.preventDefault();
      if (editorDropHandled(event.nativeEvent) || !imageInsert) return;
      if (!hasImageFile(event.dataTransfer)) return;
      const at = editor?.positionAtPoint(event.clientX, event.clientY);
      if (!at) return;
      const selected = editor!.exec({ type: 'setSelection', range: { anchor: at, head: at } });
      if (!selected.ok) return;
      editor!.focus();
      void imageInsert.insertFromDataTransfer(event.dataTransfer, at);
    },
    [editor, imageInsert]
  );

  return (
    <div ref={portalRef} className="docx-content-mount">
      <div
        ref={contentRef}
        className={`docx-paginated-surface${className ? ` ${className}` : ''}`}
        onPaste={onPaste}
        onDrop={onDrop}
        // A double press on a chart opens the Chart pane, as Edit chart does.
        onDoubleClick={(event) => {
          if (editor && openChartPaneAt(editor, event)) event.preventDefault();
        }}
      />
      <DialogMount />
      <ConfiguredPopups />
      <EnginePopups />
      {editor ? <ImageSelectionOverlay containerRef={elementRef} portalRef={portalRef} /> : null}
    </div>
  );
}
