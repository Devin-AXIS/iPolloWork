// The one rule for an Add comment control's state, shared by the toolbar part and the
// context-menu row: enabled state comes from `toolbarCommandState`, and the reason shown when
// it is disabled is translated. Viewing mode explains itself with the editing-mode hint, as
// the mode pill does; every other reason is the slot's localized engine reason.

import type { ChromeSlotId } from '@docx-editor.dev/core/editor';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useEditorCommand } from '../useEditorCommand';
import { useEditorState } from '../useEditorState';

export const ADD_COMMENT_SLOT: ChromeSlotId = 'review.addComment';

const selectViewing = (snapshot: EditorSnapshot): boolean => snapshot.editingMode === 'viewing';

/** Whether Add comment is enabled, and the translated reason when it is not. */
export function useAddCommentState(label: (key: string) => string): {
  readonly isEnabled: boolean;
  readonly reason: string | null;
} {
  const { isEnabled, disabledReason } = useEditorCommand(ADD_COMMENT_SLOT);
  const viewing = useEditorState(selectViewing);
  if (isEnabled) return { isEnabled, reason: null };
  return { isEnabled, reason: viewing ? label('editingMode.viewingHint') : disabledReason };
}
