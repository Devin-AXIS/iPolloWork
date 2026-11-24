// Which document compare engine an editor was given, for the browser automation host.
//
// The engine comes from the review module. The registry keeps it off every public type and
// hands it only to code inside this lane, keyed by the editor instance. An editor without the
// review module registers nothing, and `compareFromBase64` refuses on it.

import type { CompareDocumentsEngine } from '../contracts/modules.ts';

const enginesByEditor = new WeakMap<object, CompareDocumentsEngine>();

/** Called once by the editor factory. */
export function registerEditorCompareEngine(
  editor: object,
  engine: CompareDocumentsEngine | undefined
): void {
  if (engine) enginesByEditor.set(editor, engine);
}

/** The compare engine of `editor`, or `undefined` when its modules supply none. */
export function editorCompareEngine(editor: object): CompareDocumentsEngine | undefined {
  return enginesByEditor.get(editor);
}
