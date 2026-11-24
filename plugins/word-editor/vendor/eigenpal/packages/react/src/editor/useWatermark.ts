// The document watermark as a hook: the read side through `getWatermark()`, the write side
// through the engine's `setWatermark` command. The watermark is not part of the snapshot,
// so the read is a getter selected on every tick and kept reference-stable when unchanged.

import { useCallback, useMemo } from 'react';
import type {
  EditorSnapshot,
  ExecResult,
  Watermark,
  WatermarkState,
} from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';
import { watermarkStateEqual } from './watermark-dialog-model';

/** What `useWatermark` returns. @public */
export interface UseWatermarkReturn {
  /** The document's watermark, or null when it has none. Reference-stable while unchanged. */
  readonly watermark: WatermarkState | null;
  /** Whether the engine can write a watermark right now (mounted, editable). */
  readonly isEnabled: boolean;
  /** The full current watermark, with picture bytes, through `query({ type: 'watermark' })`. */
  readonly read: () => Watermark | null;
  /** Set the watermark as one undo step. Null removes it. */
  readonly apply: (watermark: Watermark | null) => ExecResult;
}

const selectEditable = (snapshot: EditorSnapshot): boolean => snapshot.editable;
const NOT_READY: ExecResult = { ok: false, code: 'unsupported', reason: 'editor is not ready' };

/**
 * The document watermark plus the command to change it.
 *
 * @public
 */
export function useWatermark(): UseWatermarkReturn {
  const editor = useDocxEditor();
  const select = useCallback(
    (_snapshot: EditorSnapshot): WatermarkState | null => editor?.getWatermark() ?? null,
    [editor]
  );
  const watermark = useEditorState(select, watermarkStateEqual);
  const editable = useEditorState(selectEditable);
  // `can` needs a well-formed payload; a short text is always classifiable, so the answer
  // reflects only the mount and mode gates.
  const isEnabled = useMemo(
    () =>
      editable &&
      editor !== null &&
      editor.can({ type: 'setWatermark', watermark: { text: 'DRAFT' } }).ok,
    [editor, editable]
  );
  const read = useCallback(
    (): Watermark | null => editor?.query({ type: 'watermark' }) ?? null,
    [editor]
  );
  const apply = useCallback(
    (next: Watermark | null): ExecResult =>
      editor ? editor.exec({ type: 'setWatermark', watermark: next }) : NOT_READY,
    [editor]
  );
  return useMemo(
    () => ({ watermark, isEnabled, read, apply }),
    [watermark, isEnabled, read, apply]
  );
}
