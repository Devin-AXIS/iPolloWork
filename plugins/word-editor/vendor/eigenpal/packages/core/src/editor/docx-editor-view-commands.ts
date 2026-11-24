import type {
  CanResult,
  DocumentEditingMode,
  EditorCommand,
  ExecResult,
} from '../contracts/editor.ts';
import { PRO_REVIEW_REASON, type CommandRefusal } from './opening-editing-mode.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { createEditorPopupChrome } from './text-form-field-chrome.ts';
import { bookmarkDialogResult } from './docx-editor-bookmarks.ts';
import { editorError } from './docx-editor-support.ts';

/** View commands remain available in a read-only document, but never after destruction. */
export function canEditorViewCommand(
  command: EditorCommand,
  destroyed: boolean,
  reviewEnabled: boolean,
  editingModeRefusal: (mode: DocumentEditingMode) => CommandRefusal | null
): CanResult | null {
  if (
    command.type !== 'toggleReviewPane' &&
    command.type !== 'toggleParagraphMarks' &&
    command.type !== 'toggleBookmarks' &&
    command.type !== 'setEditingMode'
  )
    return null;
  if (destroyed) return { ok: false, code: 'notFound', reason: 'the editor was destroyed' };
  if (command.type === 'toggleReviewPane' && !reviewEnabled)
    return { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
  if (command.type === 'setEditingMode') return editingModeRefusal(command.mode) ?? { ok: true };
  return { ok: true };
}

/**
 * A per-editor view toggle, independent of the document and its history: paragraph marks and
 * bookmark marks.
 */
export function createEditorParagraphMarks(onChange: (visible: boolean) => void) {
  let visible = false;
  return {
    get: () => visible,
    toggle: () => {
      visible = !visible;
      onChange(visible);
    },
  };
}

/**
 * The editor's view state and host chrome: paragraph marks, bookmark marks, and the popup
 * chrome registrations, with the commands that read them. None of it is document state.
 */
export function createEditorViews(host: {
  readonly surface: () => PaginatedSurface | null;
  readonly destroyed: () => boolean;
  /** View state changed: publish a new snapshot. */
  readonly changed: () => void;
  readonly emitError: (error: Error) => void;
  /** `canEditorViewCommand` with the editor's own state. */
  readonly capability: (command: EditorCommand) => CanResult | null;
}) {
  // Registrations change what `can` answers for chrome commands, which no snapshot field
  // carries; a counter makes the next snapshot a new reference so chrome re-asks.
  let chromeRevision = 0;
  let settledRevision = 0;
  const popupChrome = createEditorPopupChrome({
    changed: () => {
      chromeRevision += 1;
      host.changed();
    },
    error: (error) =>
      host.emitError(
        editorError(
          'hostCallback',
          `a bookmark mark callback failed: ${error instanceof Error ? error.message : String(error)}`
        )
      ),
  });
  const paragraphMarks = createEditorParagraphMarks((visible) => {
    host.surface()?.setShowParagraphMarks(visible);
    host.changed();
  });
  const bookmarkMarks = createEditorParagraphMarks((visible) => {
    host.surface()?.bookmarkEditing.setShown(visible);
    host.changed();
  });
  return {
    popupChrome,
    /** Whether no chrome registration changed since the last call. */
    chromeSettled(): boolean {
      const settled = settledRevision === chromeRevision;
      settledRevision = chromeRevision;
      return settled;
    },
    capability: host.capability,
    /** What a surface mounts with. */
    surfaceOptions: () => ({
      showParagraphMarks: paragraphMarks.get(),
      onToggleParagraphMarks: paragraphMarks.toggle,
      showBookmarks: bookmarkMarks.get(),
      ...popupChrome.surfaceOptions,
    }),
    snapshot: () => ({
      showParagraphMarks: paragraphMarks.get(),
      showBookmarks: bookmarkMarks.get(),
    }),
    /** `openBookmarkDialog` and `openGoTo`, answered before any document gate; else null. */
    dialog(command: EditorCommand, run: boolean): ExecResult | null {
      if (command.type === 'openGoTo') {
        const goTo = popupChrome.goTo;
        const fromShortcut = command.fromShortcut === true;
        if (fromShortcut && goTo.canOpen() && !goTo.shortcutOn() && !host.destroyed())
          return { ok: false, code: 'unsupported', reason: 'the Go To shortcut is turned off' };
        return bookmarkDialogResult(
          fromShortcut ? { canOpen: goTo.canOpen, open: goTo.openFromShortcut } : goTo,
          host.destroyed(),
          run,
          'Go To view'
        );
      }
      if (command.type !== 'openBookmarkDialog') return null;
      return bookmarkDialogResult(popupChrome.bookmarkDialog, host.destroyed(), run);
    },
    /** Run a mark toggle; null for other commands. */
    toggle(command: EditorCommand): ExecResult | null {
      if (command.type === 'toggleParagraphMarks') paragraphMarks.toggle();
      else if (command.type === 'toggleBookmarks') bookmarkMarks.toggle();
      else return null;
      return { ok: true, changed: false };
    },
    /** Whether a mark toggle is on; null for other commands. */
    isActive(command: EditorCommand): boolean | null {
      if (command.type === 'toggleParagraphMarks') return paragraphMarks.get();
      if (command.type === 'toggleBookmarks') return bookmarkMarks.get();
      return null;
    },
  };
}
