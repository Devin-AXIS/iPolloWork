import { useCallback, useMemo } from 'react';
import {
  IMAGE_WRAP_TARGETS,
  runToolbarCommand,
  toolbarCommandState,
  type ImageWrapTarget,
  type ObjectSlotValueMap,
  type ToolbarValueMap,
} from '@docx-editor.dev/core/editor';
import type { EditorExecOptions, ExecResult } from '@docx-editor.dev/core/contracts/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { useTranslation } from '../i18n';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

/** Live state and typed execution for a value control. @public */
export interface EditorValueCommandState<T extends string | number> {
  readonly execute: (value: T, options?: EditorExecOptions) => ExecResult;
  /** Null for mixed or unavailable formatting. */
  readonly value: T | null;
  readonly options: readonly T[];
  readonly isEnabled: boolean;
  readonly disabledReason: string | null;
}
/**
 * Bind a value slot. Font size values use half-points; colors use six digits without `#`. The
 * `shape.*` and `chart.*` slots bind through `useObjectControl`. @public
 */
export function useEditorValueCommand<
  K extends Exclude<keyof ToolbarValueMap, keyof ObjectSlotValueMap>,
>(slotId: K): EditorValueCommandState<ToolbarValueMap[K]> {
  const editor = useDocxEditor();
  const { t } = useTranslation();
  const select = useCallback(() => toolbarCommandState(editor, slotId), [editor, slotId]);
  const state = useEditorState(
    select,
    (a, b) =>
      a.value === b.value && a.enabled === b.enabled && a.disabledReason === b.disabledReason
  );
  return useMemo(
    () => ({
      execute: (value: ToolbarValueMap[K], options?: EditorExecOptions) =>
        runToolbarCommand(editor, slotId, value, options),
      value: (state.value === undefined
        ? null
        : slotId === 'font.size' || slotId === 'list.lineSpacing'
          ? Number(state.value)
          : state.value) as ToolbarValueMap[K] | null,
      options: (slotId === 'image.wrap' ? IMAGE_WRAP_TARGETS : []) as readonly ToolbarValueMap[K][],
      isEnabled: state.enabled,
      // Translated, as `useEditorCommand` gives it.
      disabledReason: localizeDisabledReason(state.disabledReason, t),
    }),
    [editor, slotId, state, t]
  );
}
/** @public */
export type { ImageWrapTarget };
