// Host chrome for comment drafts: the UI the `review.addComment` control asks to open a draft.
//
// The press runs no engine command. A comment needs its text first, and the text comes from a
// draft that host chrome owns, the way the link popover owns `text.link`. So the control is
// enabled only while some chrome is registered to open that draft: the review rail when it
// mounts, or a host's own comment UI. Without one, an enabled control would do nothing.
//
// The registration lives on the editor, not on a surface: chrome mounts after the editor
// exists, and a document that reloads must keep it.

import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import type { ChromeSlotId } from './chrome-controls.ts';
import type { ToolbarCommandState } from './toolbar-commands.ts';
import type { SemanticPosition } from '@docx-editor.dev/core/layout';
import { caretWordRange, caretWordSelection } from '../layout/caret-word.ts';
import { paragraphTextOf } from '../store/store/paragraph-model-text.ts';
import type { CommentDraftChromeHandlers } from './docx-editor-types.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { createRequestChrome, type BookmarkChromeHost } from './bookmark-chrome.ts';
import { textboxHostParagraphOf } from './review-story-entry.ts';
import { partOfNodeId } from './surface-scope.ts';

/** What the toolbar asks of the registered comment draft chrome. */
export interface CommentDraftRequests {
  /** Whether any chrome is registered to open a draft. */
  readonly canOpen: () => boolean;
  /** Ask the registered chrome to open a draft; false when none is registered. */
  readonly open: () => boolean;
}

/** The refusal while no chrome is registered to open a draft. */
export const NO_COMMENT_DRAFT_VIEW = 'no comment draft view is registered';

// Keyed by facade, so the toolbar can reach the requests without a member on the public
// instance type.
const requestsByEditor = new WeakMap<object, CommentDraftRequests>();

export function createCommentDraftChrome(host: BookmarkChromeHost = {}) {
  const chrome = createRequestChrome(host.changed);
  const requests: CommentDraftRequests = { canOpen: chrome.canOpen, open: chrome.open };
  return {
    requests,
    setters: {
      setCommentDraftChrome: (handlers: CommentDraftChromeHandlers): (() => void) =>
        chrome.register(handlers),
    },
  };
}

/** Make a facade's comment draft requests reachable from `commentDraftRequestsOf`. */
export function bindCommentDraftRequests(editor: object, requests: CommentDraftRequests): void {
  requestsByEditor.set(editor, requests);
}

/** The comment draft requests of a facade, or null for an editor that has none. */
export function commentDraftRequestsOf(editor: object): CommentDraftRequests | null {
  return requestsByEditor.get(editor) ?? null;
}

/**
 * The word a comment takes when the caret is collapsed inside one and nothing is selected.
 * Null while a review card is activated, which the selection placement also declines.
 */
export function commentWordAtCaret(
  editor: Editor
): { readonly from: SemanticPosition; readonly to: SemanticPosition } | null {
  const surface = (editor as Editor & { readonly surface?: PaginatedSurface | null }).surface;
  if (!surface || surface.activatedReviewKey() !== null) return null;
  const selection = surface.state().selection;
  return (
    caretWordSelection(surface.publishedLayout(), selection) ?? textboxCaretWord(surface, selection)
  );
}

/**
 * The word at a collapsed caret in a text box, read from the paragraph's text. Box text is
 * laid out inside its drawing, never in the page lines the layout word reads, so the caret
 * there found no word and the control refused.
 */
function textboxCaretWord(
  surface: PaginatedSurface,
  { anchor, head }: { readonly anchor: SemanticPosition; readonly head: SemanticPosition }
): { readonly from: SemanticPosition; readonly to: SemanticPosition } | null {
  if (anchor.paragraphId !== head.paragraphId || anchor.offset !== head.offset) return null;
  if (textboxHostParagraphOf(surface, head.paragraphId) === null) return null;
  const part = partOfNodeId(surface.session, head.paragraphId);
  const text = part && paragraphTextOf(part, head.paragraphId);
  const word = text ? caretWordRange(text, head.offset, new Set()) : null;
  if (!word) return null;
  return {
    from: { paragraphId: head.paragraphId, offset: word.start },
    to: { paragraphId: head.paragraphId, offset: word.end },
  };
}

/**
 * Whether a comment could be started at the selection: the review module is installed, the
 * document is not open for viewing, chrome is registered to open the draft, and the selection
 * is on the page. The click does not run an engine command; the registered chrome (the review
 * rail, or the host's own, through `setCommentDraftChrome`) opens the draft, the way the link
 * popover owns `text.link`.
 */
export function addCommentState(editor: Editor): ToolbarCommandState {
  const id: ChromeSlotId = 'review.addComment';
  const refuse = (reason: string): ToolbarCommandState => ({
    id,
    enabled: false,
    disabledReason: reason,
    active: false,
  });
  const review = editor.can({ type: 'toggleReviewPane' });
  if (!review.ok) return refuse(review.reason);
  if ((editor.getEditingMode?.() ?? 'editing') === 'viewing') {
    return refuse('the document is open for viewing');
  }
  if (!commentDraftRequestsOf(editor)?.canOpen()) return refuse(NO_COMMENT_DRAFT_VIEW);
  if (editor.getSelectionPlacement() === null && !commentWordAtCaret(editor)) {
    return refuse('a comment needs a selected range');
  }
  return { id, enabled: true, disabledReason: null, active: false };
}
