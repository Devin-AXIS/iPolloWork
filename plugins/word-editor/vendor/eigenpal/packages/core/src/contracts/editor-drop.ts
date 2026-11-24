/**
 * A point resolved in the mounted editor's active story.
 * Keep this exact object for `insertImage.at`; copies do not retain its identity guard.
 * Document edits, reloads, and scope changes invalidate the insertion target.
 * @public
 */
export interface EditorPointPosition {
  readonly part: string;
  readonly paragraphId: string;
  readonly offset: number;
}

/** The native drag event in browser hosts. @public */
export type EditorHostDragEvent = typeof globalThis extends {
  readonly DragEvent: { readonly prototype: infer E };
}
  ? E
  : object;

/**
 * A drag over a valid position in the active story.
 * Call `event.preventDefault()` synchronously to accept a custom payload.
 * A drop handler must read its payload before it returns.
 * @public
 */
export interface EditorDropEvent {
  readonly position: EditorPointPosition;
  readonly event: EditorHostDragEvent;
}
