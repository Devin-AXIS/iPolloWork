// Which history groups an editor owns, for the browser automation host.
//
// A browser automation run that names a history group binds that group's store token around
// each commit it makes, so the run's writes join the gesture the review UI started. The
// token is the editor's own: the registry hands it only to code inside this lane, keyed by
// the editor instance, and never puts it on a public type.

import type { HistoryGroup } from '../contracts/editor.ts';
import type { AutomationHistoryFrames, EditorHistoryGroups } from './editor-history-groups.ts';

const groupsByEditor = new WeakMap<object, EditorHistoryGroups>();

/** Called once by the editor factory. */
export function registerEditorHistoryGroups(editor: object, groups: EditorHistoryGroups): void {
  groupsByEditor.set(editor, groups);
}

/**
 * The automation frames of `group` when it is an open handle `editor` owns, or `null` for a
 * closed handle, a handle from another editor, or a value that is not a handle.
 */
export function editorAutomationFrames(
  editor: object,
  group: HistoryGroup
): AutomationHistoryFrames | null {
  return groupsByEditor.get(editor)?.automationFrames(group) ?? null;
}

/** Whether `group` is an open handle `editor` owns. */
export function editorOwnsOpenHistoryGroup(editor: object, group: HistoryGroup): boolean {
  return groupsByEditor.get(editor)?.token(group) !== undefined;
}
