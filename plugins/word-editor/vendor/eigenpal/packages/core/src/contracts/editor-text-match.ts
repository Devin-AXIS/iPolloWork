// One `findMatches` result. Split from `editor.ts`, which re-exports it.

import type { ViewScope } from './editor-scope.ts';

/**
 * One occurrence of a search query in the document.
 *
 * Carries TWO addresses on purpose. `blockId` + `start` is the engine's own: stable
 * across edits and independent of ordering. `paragraphIndex` + `runIndex` + `runOffset`
 * is the positional one a find/replace UI needs to show and navigate results, and it is
 * derived from the same walk rather than left to the caller to reconstruct — a caller
 * guessing at run boundaries would send the selection to the wrong place.
 *
 * A match can span runs when formatting changes mid-word; the run address is where it
 * STARTS. `scope` identifies a non-body story so navigation opens the correct surface.
 * A frame scope selects its anchoring drawing and never places a caret inside its story.
 * A match inside a field result reports the field atom's model range. Its `length` is one,
 * while `text` carries the visible match and can be longer. Select with `start` and `length`.
 * Never derive the selected length from `text.length`. When `text` is only part of the field
 * result, `selectMatch` selects the whole field and the `replaceMatch` command refuses with
 * `unsupported`, because it would replace the whole field.
 */
export interface TextMatch {
  readonly blockId: string;
  /** Character offset within the paragraph's concatenated run text. */
  readonly start: number;
  readonly length: number;
  /**
   * Paragraph ordinal within this match's story. Table and nested-table paragraphs count.
   * Non-paragraph blocks add no ordinal.
   */
  readonly paragraphIndex: number;
  /** Index of the run the match starts in, and the offset within that run. */
  readonly runIndex: number;
  readonly runOffset: number;
  /** Story containing the match. Absence means the body. */
  readonly scope?: ViewScope;
  /**
   * The matched text as it appears in the document. `selectMatch` and `replaceMatch` return
   * `notFound` and change nothing when the match's offsets no longer hold this text. Search
   * also finds tracked deleted and moved text: `selectMatch` selects it for review, and
   * `replaceMatch` refuses it with `unsupported`.
   */
  readonly text: string;
  /**
   * Paragraph text immediately before and after the match, bounded at the derivation
   * boundary. A results list shows the match in its sentence — "…as described in this
   * **Exhi**bit A" — and nothing else in the contract can reach paragraph text, so a
   * caller would otherwise have to re-read the document to render one row.
   *
   * Optional and additive: an implementation that has not derived them omits them, and a
   * consumer treats absent as empty.
   */
  readonly contextBefore?: string;
  readonly contextAfter?: string;
}

/**
 * What one `replaceAllMatches` command did, as `replacements` on its result.
 *
 * `replaced` counts the matches written. `skipped` counts the matches found but left
 * unchanged: struck (tracked-deleted or moved-away) text, a field result, whose visible text
 * is not editable text, and content that a lock, a table of contents, or the editing mode
 * protects. A result with `replaced: 0` and `skipped: 0` means that the query found nothing.
 * The selection and scroll position stay put.
 *
 * The command is refused, with no `replacements`, when matches exist but every one that could
 * be written is protected (`locked`, `bound`), and under document protection that allows only
 * forms, comments, or reading (`locked`). A refused result that DOES carry `replacements`
 * stopped part-way, for example on a collaboration failure: the replaced matches stay and
 * undo as one step, and `skipped` counts only the matches judged before it stopped.
 *
 * @public
 */
export interface ReplaceAllMatchesOutcome {
  /** Matches replaced. */
  readonly replaced: number;
  /** Matches found but not replaced, because their content cannot take the replacement. */
  readonly skipped: number;
}
