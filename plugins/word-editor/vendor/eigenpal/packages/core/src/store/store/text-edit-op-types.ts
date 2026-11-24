import type { RevisionAttributionInput } from './tree-op-types.ts';

export type InsertTextOp = {
  readonly op: 'insertText';
  readonly paragraphId: string;
  /** Legacy text form identity for protected filling; never an inline wrapper owner. */
  readonly textFormFieldId?: string;
  readonly offset: number;
  readonly text: string;
  /**
   * Write this as a TRACKED insertion, attributed here.
   *
   * On the op rather than on the store, so suggesting stays a decision the surface makes
   * per edit and the write vocabulary stays explicit — a global "everything is tracked
   * now" flag is exactly what `DocEdits` refuses, because it makes the meaning of an op
   * depend on state the op does not carry.
   */
  readonly revision?: RevisionAttributionInput;
  /**
   * When set, the text belongs INSIDE this content control, whatever sits at the offset.
   *
   * A boundary offset is owned by the run that starts there, which at a control's trailing
   * edge is the run after the control — so an offset alone cannot say "append to this field",
   * the way it cannot say which run of a field result to format (see `targetRunIds`). A
   * caller that names the control gets the text in the control; one that does not gets the
   * plain offset rule, which is what a keystroke beside a field means.
   */
  readonly inside?: string;
  /**
   * Which side of a run BOUNDARY the text joins. Default `'left'` — Word's typing rule:
   * the next character takes the formatting of the character before the caret.
   *
   * `'right'` is for a caller that is not typing but placing text inside the run that
   * STARTS at the offset — the hyperlink editor rewriting a link's display text, where
   * landing left of the boundary would put the new text outside the link. Ignored when
   * the offset falls strictly inside a run, which has no boundary to choose.
   * Explicit `'left'` keeps an inline placeholder at its leading edge outside the write.
   * An omitted bias retains the ordinary placeholder-filling rule. A named owner takes precedence.
   */
  readonly bias?: 'left' | 'right';
};

export type DeleteTextOp = {
  readonly op: 'deleteText';
  readonly paragraphId: string;
  /** Legacy text form identity for protected filling; never an inline wrapper owner. */
  readonly textFormFieldId?: string;
  readonly start: number;
  readonly end: number;
  /** Write this as a TRACKED deletion — the characters stay, wrapped in `w:del`. */
  readonly revision?: RevisionAttributionInput;
};
