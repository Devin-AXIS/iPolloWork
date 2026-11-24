// `DocxEditor.Window`: render the editor panel in a pop-out window while `open`, and inline
// otherwise. The editor keeps its document, undo history and selection across each move.

import { useEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { openEditorWindow, type EditorWindow } from '@docx-editor.dev/core/editor';
import type { DocxEditorChildren } from '../docx-editor-children';
import { useTranslation } from '../i18n';
import { useChromeDark } from './color-mode-context';

/** Props for `DocxEditor.Window`. @public */
export interface DocxEditorWindowProps {
  /** Render `children` in a pop-out window. While `false`, they render in place. */
  open: boolean;
  /** A same-origin page to open. Defaults to `about:blank`. */
  url?: string;
  /**
   * The window name. Defaults to `docx-editor`. Two `DocxEditor.Window` components with the
   * same name share one browser window, so give each editor its own name.
   */
  name?: string;
  /** The `window.open` features. Defaults to `popup,width=1000,height=900`. */
  features?: string;
  /** The pop-out's title. */
  title?: string;
  /** Copy this page's stylesheets into the window, and keep copying new ones. Default `true`. */
  styles?: boolean | ((from: Document, to: Document) => () => void);
  /**
   * The pop-out went away: the user closed it, or the browser blocked it. Set `open` to
   * `false` here. The panel is already back in place when this runs.
   */
  onClose?: () => void;
  /** The editor panel: toolbar, viewport and content, or any part of them. */
  children?: DocxEditorChildren;
}

/**
 * Render the editor panel in its own browser window while `open` is `true`.
 *
 * Place it inside `DocxEditor.Root` around the parts to pop out. The Root stays in this
 * window, so the editor moves into the pop-out and back with its undo history, selection and
 * collaboration session. The window gets this page's stylesheets, and closing it brings the
 * panel back and calls `onClose`.
 *
 * @example
 * ```tsx
 * const [popped, setPopped] = useState(false);
 *
 * <DocxEditor.Root document={bytes}>
 *   <button onClick={() => setPopped(!popped)}>Pop out</button>
 *   <DocxEditor.Window open={popped} onClose={() => setPopped(false)}>
 *     <DocxEditor.Toolbar />
 *     <DocxEditor.Viewport>
 *       <DocxEditor.Content />
 *     </DocxEditor.Viewport>
 *   </DocxEditor.Window>
 * </DocxEditor.Root>
 * ```
 *
 * @public
 */
export function DocxEditorWindow({
  open,
  onClose,
  children,
  url,
  name,
  features,
  title,
  styles,
}: DocxEditorWindowProps) {
  const [popup, setPopup] = useState<EditorWindow | null>(null);
  // The window's own document has no host direction to inherit, so a right-to-left
  // catalog sets it on the window's editor root.
  const { dir } = useTranslation();
  // The window's editor root carries `Root`'s colour mode, as the composed parts do.
  const dark = useChromeDark();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Read when the window opens: changing them later does not reopen it.
  const optionsRef = useRef({ url, name, features, title, styles });
  optionsRef.current = { url, name, features, title, styles };
  // The window being opened or open. StrictMode runs this effect, its cleanup and the effect
  // again: the second run takes over the first one's window instead of opening it twice, and
  // the first cleanup's close stands down.
  const sessionRef = useRef<{ promise: Promise<EditorWindow | null>; claimed: boolean } | null>(
    null
  );

  useEffect(() => {
    if (!open) return undefined;
    let session = sessionRef.current;
    if (session) session.claimed = true;
    else {
      const { url, name, features, title, styles } = optionsRef.current;
      session = {
        claimed: true,
        promise: openEditorWindow({
          ...(url !== undefined ? { url } : {}),
          ...(name !== undefined ? { name } : {}),
          ...(features !== undefined ? { features } : {}),
          ...(title !== undefined ? { title } : {}),
          ...(styles !== undefined ? { styles } : {}),
        }),
      };
      sessionRef.current = session;
    }
    const mine = session;
    let active = true;
    let unlisten: (() => void) | undefined;
    void mine.promise.then((opened) => {
      if (!active) return;
      if (!opened) {
        sessionRef.current = null;
        onCloseRef.current?.();
        return;
      }
      unlisten = opened.onClose(() => {
        if (!active) return;
        sessionRef.current = null;
        // Synchronously, inside the window's `pagehide`: the panel must be back in place
        // before the window's document unloads.
        flushSync(() => setPopup(null));
        onCloseRef.current?.();
      });
      setPopup(opened);
    });
    return () => {
      active = false;
      unlisten?.();
      mine.claimed = false;
      setPopup(null);
      // The panel is already back: the render that turned `open` off rendered it in place,
      // and its layout effects moved the editor before this cleanup ran. Close a moment
      // later, unless a StrictMode re-run has taken the window over.
      queueMicrotask(() => {
        if (mine.claimed) return;
        if (sessionRef.current === mine) sessionRef.current = null;
        void mine.promise.then((opened) => opened?.close());
      });
    };
  }, [open]);

  // In place as soon as `open` is off, in the same render: the editor moves back before the
  // window closes.
  if (!popup || !open) return <>{children}</>;
  return createPortal(
    <div className={`docx-editor${dark ? ' dark' : ''}`} style={{ height: '100%' }} dir={dir}>
      {children}
    </div>,
    popup.element
  );
}
