import { useEffect, useRef } from 'react';
import type { RevisionMarkupOptions, ResolvedRevisionMarkup } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';

/** Viewer-local markup declarations. @public */
export interface DocxEditorRevisionMarkupProps extends RevisionMarkupOptions {
  onRevisionMarkupChange?: (settings: ResolvedRevisionMarkup) => void;
}

/** Declares markup settings without rendering an element. @public */
export function DocxEditorRevisionMarkup(props: DocxEditorRevisionMarkupProps) {
  const editor = useDocxEditor();
  const callback = useRef(props.onRevisionMarkupChange);
  callback.current = props.onRevisionMarkupChange;
  const { onRevisionMarkupChange: _callback, ...settings } = props;
  const serialized = JSON.stringify(settings);
  useEffect(
    () => editor?.on('revisionMarkupChange', (value) => callback.current?.(value)),
    [editor]
  );
  useEffect(() => {
    if (editor) editor.setRevisionMarkup(JSON.parse(serialized) as RevisionMarkupOptions);
  }, [editor, serialized]);
  return null;
}
