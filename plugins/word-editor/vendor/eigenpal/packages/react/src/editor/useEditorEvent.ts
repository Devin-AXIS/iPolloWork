// Thin typed subscription to a facade event.
//
// The handler rides in a ref: a fresh inline closure every render does NOT
// resubscribe (only the editor instance or the event name does), and the latest
// closure is always the one called.

import { useEffect, useRef } from 'react';
import type { EditorEvents } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';

/**
 * Subscribe to an editor event (`'change'`, `'selectionChange'`, `'error'`, …) for the
 * lifetime of the component. No-op until the nearest `DocxEditor.Root` has created the
 * editor; resubscribes automatically when the instance is replaced.
 *
 * @public
 */
export function useEditorEvent<E extends keyof EditorEvents>(
  event: E,
  handler: EditorEvents[E]
): void {
  const editor = useDocxEditor();

  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!editor) return undefined;
    const forward = ((...args: unknown[]) => {
      (handlerRef.current as (...forwarded: unknown[]) => void)(...args);
    }) as unknown as EditorEvents[E];
    return editor.on(event, forward);
  }, [editor, event]);
}
