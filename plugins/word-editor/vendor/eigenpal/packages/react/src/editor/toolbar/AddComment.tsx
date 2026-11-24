// Add Comment (`review.addComment`): starts a comment draft on the selection.
//
// `review.comments` is the "Comments & Changes" pane toggle, not an authoring command, so a
// host that wanted a button that ADDS a comment had none. Enabled state and the disabled
// reason come from `toolbarCommandState`, like every other slot. The press asks the
// composed review rail for a draft, the same request the context menu's row makes. Without
// a mounted review rail there is nothing to open the draft, so the part renders nothing.

import { useContext } from 'react';
import type { ChromeSlotId } from '@docx-editor.dev/core/editor';
import { ReviewRailContext } from '../context';
import { useAddCommentState } from './add-comment-state';
import { useToolbarLabel } from './toolbar-context';
import { Slot } from './Slot';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from './ToolbarButton';
import { useToolbarOverflowClose } from './ToolbarOverflow';
import type { ToolbarPartComponent, ToolbarPartProps } from './parts';

const SLOT: ChromeSlotId = 'review.addComment';

function ToolbarAddCommentImpl({ className, hidden, icon, asChild, children }: ToolbarPartProps) {
  const rail = useContext(ReviewRailContext);
  const label = useToolbarLabel();
  const { isEnabled, reason } = useAddCommentState(label);
  // Inside the "⋯" panel, the press also closes the panel. Outside it this does nothing.
  const closePanel = useToolbarOverflowClose();
  if (hidden || (rail?.mounted ?? 0) === 0) return null;
  const control = chromeControlForSlot(SLOT);
  const text = label(control?.labelKey ?? SLOT);
  const shared = {
    type: 'button' as const,
    className: `docx-toolbar__button${className ? ` ${className}` : ''}`,
    'data-slot': SLOT,
    disabled: !isEnabled,
    ...(!isEnabled ? { 'data-disabled': '' } : {}),
    'aria-label': text,
    title: reason ?? text,
    onMouseDown: guardToolbarMousedown,
    onClick: () => {
      if (rail?.requestCommentDraft()) closePanel(false);
    },
  };
  if (asChild) return <Slot {...shared}>{children}</Slot>;
  return <button {...shared}>{icon ?? children ?? chromeIcon(control?.paths)}</button>;
}

/**
 * Add Comment (`DocxEditorToolbar.AddComment`, slot `review.addComment`): opens a comment
 * draft on the selection in the review rail. It needs a mounted review rail to open the
 * draft. It is not part of the default arrangement; place it with `Toolbar.Group`.
 *
 * @example
 * ```tsx
 * <DocxEditor.Toolbar>
 *   <DocxEditor.Toolbar.Group id="review">
 *     <DocxEditor.Toolbar.AddComment />
 *   </DocxEditor.Toolbar.Group>
 * </DocxEditor.Toolbar>
 * ```
 *
 * @public
 */
export const ToolbarAddComment: ToolbarPartComponent = Object.assign(ToolbarAddCommentImpl, {
  docxSlot: SLOT,
});
