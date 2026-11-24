// What the browser automation host reads from an editor, registered once by the factory.
//
// The history groups and the review module's compare engine stay off every public type. The
// automation host finds them through the editor instance.

import type { CompareDocumentsEngine } from '../contracts/modules.ts';
import { registerEditorCompareEngine } from './editor-compare-engine-registry.ts';
import { registerEditorHistoryGroups } from './editor-history-group-registry.ts';
import type { EditorHistoryGroups } from './editor-history-groups.ts';

/** Called once by the editor factory. */
export function registerEditorAutomation(
  editor: object,
  historyGroups: EditorHistoryGroups,
  compareEngine: CompareDocumentsEngine | undefined
): void {
  registerEditorHistoryGroups(editor, historyGroups);
  registerEditorCompareEngine(editor, compareEngine);
}
