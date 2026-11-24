// The document the editor is mounted in, for chrome that listens or measures outside its own
// element.

import { useCallback, useSyncExternalStore } from 'react';
import { editorHostDocument } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';

const NOOP_UNSUBSCRIBE = (): void => {};

/** What {@link useEditorHostDocument} returns: the host document, or `null` on the server. @public */
export type UseEditorHostDocumentReturn = Document | null;

/**
 * The document the editor's pages are mounted in: a pop-out window's or an iframe's when the
 * host attached the editor there, otherwise the page's own. `null` during server rendering.
 *
 * Custom chrome that adds document listeners, reads focus, or injects a `<style>` uses this
 * instead of the global `document`, which belongs to the window the script runs in. The value
 * changes when the editor moves to another window, so effects keyed on it re-bind.
 * Its `defaultView` is the editor's window, for timers, viewport size and the clipboard.
 *
 * @example
 * ```tsx
 * function ShortcutListener() {
 *   const hostDocument = useEditorHostDocument();
 *   useEffect(() => {
 *     if (!hostDocument) return;
 *     hostDocument.addEventListener('keydown', onShortcut);
 *     return () => hostDocument.removeEventListener('keydown', onShortcut);
 *   }, [hostDocument]);
 *   return null;
 * }
 * ```
 *
 * @public
 */
export function useEditorHostDocument(): UseEditorHostDocumentReturn {
  const editor = useDocxEditor();
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!editor) return NOOP_UNSUBSCRIBE;
      return editor.on('hostChange', onChange);
    },
    [editor]
  );
  const read = useCallback(
    (): Document | null =>
      editor
        ? editorHostDocument(editor)
        : typeof globalThis.document === 'undefined'
          ? null
          : globalThis.document,
    [editor]
  );
  return useSyncExternalStore(subscribe, read, () => null);
}
