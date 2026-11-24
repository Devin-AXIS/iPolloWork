import type { TextFormFieldOptions, TextFormFieldRange } from '@docx-editor.dev/core/store';

/** A core-owned options edit. Its signal aborts when the dialog must close. @public */
export interface TextFormFieldDialogSession {
  readonly field: TextFormFieldRange;
  readonly signal: AbortSignal;
  /** Whether the current target exists and permits editing. Draft validation happens on apply. */
  canApply(): boolean;
  /** Save one undoable edit. A refused write leaves the session open. */
  apply(text: string, options: TextFormFieldOptions): boolean;
  /** Close without changing the document. Safe to call more than once. */
  cancel(): void;
}

/** Framework-owned presentation for core-owned Field Options sessions. @public */
export interface TextFormFieldChromeHandlers {
  readonly onRequest?: (session: TextFormFieldDialogSession) => void;
}
