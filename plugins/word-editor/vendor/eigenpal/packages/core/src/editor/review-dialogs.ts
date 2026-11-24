import type { CanResult, EditorCommand, ExecResult } from '../contracts/editor.ts';
import type { RevisionMarkupOptions } from '../contracts/revision-markup.ts';
import {
  createCompareDocumentsState,
  type CompareDocumentsStateHost,
} from './compare-documents-state.ts';
import { createRevisionMarkupState } from './revision-markup-state.ts';

type RevisionMarkupHost = Parameters<typeof createRevisionMarkupState>[1];

/**
 * The review module's dialogs: Track changes options and Compare documents. Both open from a
 * command, render through host chrome or the module's own DOM, and close with the mount.
 */
export function createReviewDialogs(
  initial: RevisionMarkupOptions | undefined,
  host: RevisionMarkupHost & CompareDocumentsStateHost
) {
  const markup = createRevisionMarkupState(initial, host);
  const compare = createCompareDocumentsState(host);
  return {
    markup,
    compare,
    /** Close both dialogs: their pickers listen to the window they opened in. */
    destroyDialogs(): void {
      markup.destroyDialog();
      compare.destroyDialog();
    },
    /** `exec` for the dialog and compare commands; null for every other command. */
    exec(command: EditorCommand): ExecResult | null {
      if (command.type === 'openRevisionMarkupDialog') return markup.open();
      return compare.exec(command);
    },
    /** `can` for the dialog and compare commands; null for every other command. */
    can(command: EditorCommand): CanResult | null {
      if (command.type === 'openRevisionMarkupDialog') return markup.canOpen();
      return compare.can(command);
    },
  };
}
