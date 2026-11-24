import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  bindHistoryGroup,
  type HistoryGroupBinding,
  type HistoryGroupBindingOptions,
} from '@docx-editor.dev/core/editor';
import type { EditorExecOptions } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';

/** @public */
export interface UseHistoryGroupReturn {
  readonly ref: (element: HTMLElement | null) => void;
  readonly options: () => EditorExecOptions;
}
/** Bind a control's native gesture lifecycle. Apply values through the existing command hooks. @public */
export function useHistoryGroup({ kind }: HistoryGroupBindingOptions): UseHistoryGroupReturn {
  const editor = useDocxEditor();
  const [element, ref] = useState<HTMLElement | null>(null);
  const binding = useRef<HistoryGroupBinding | null>(null);
  useLayoutEffect(() => {
    if (!editor || !element) return;
    const current = bindHistoryGroup(editor, element, { kind });
    binding.current = current;
    return () => {
      current.dispose();
      binding.current = null;
    };
  }, [editor, element, kind]);
  const options = useCallback(() => {
    if (!binding.current) throw new Error('history group control is not mounted');
    return binding.current.options();
  }, []);
  return { ref, options };
}
