/** An editor-local view action must stay between the same document undo entries. */
export interface UndoHistoryPosition {
  current(): object | null;
  /** End capture and discard the abandoned redo branch without changing document content. */
  split(): void;
}
const positions = new WeakMap<object, UndoHistoryPosition>();

/** Register a document history authority for editor-local undo actions. @internal */
export function registerUndoHistoryPosition(owner: object, position: UndoHistoryPosition): void {
  positions.set(owner, position);
}

export function undoHistoryPosition(owner: object): UndoHistoryPosition | undefined {
  return positions.get(owner);
}

export function shareUndoHistoryPosition<T extends object>(owner: T, authority: object): T {
  const position = positions.get(authority);
  if (position) positions.set(owner, position);
  return owner;
}
