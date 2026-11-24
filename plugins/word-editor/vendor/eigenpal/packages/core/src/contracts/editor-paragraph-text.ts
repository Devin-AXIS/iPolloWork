import type { ViewScope } from './editor-scope.ts';

/** A continuous accepted-text span mapped to model offsets. @public */
export interface ParagraphTextSpan {
  /** UTF-16 offset in `ParagraphText.text`. */
  readonly start: number;
  /** Number of UTF-16 code units in both texts. */
  readonly length: number;
  /** UTF-16 offset in `ParagraphText.acceptedText`. */
  readonly acceptedStart: number;
}

/**
 * Proofing settings of a continuous stretch of `ParagraphText.acceptedText`. Check the text
 * in `lang`, and skip it when `noProof` is true. @public
 */
export interface ParagraphTextProofing {
  /** UTF-16 offset in `ParagraphText.acceptedText`. */
  readonly acceptedStart: number;
  /** Number of UTF-16 code units. */
  readonly length: number;
  /**
   * The language tag the document sets for this text, such as `en-GB`, or `null` when the
   * document sets none. Right-to-left and complex-script text (`w:rtl`, `w:cs`) uses its
   * complex-script tag (`w:lang/@w:bidi`). East Asian characters use their East Asian tag
   * (`w:lang/@w:eastAsia`), or `null` when no level sets one. Other text uses `w:lang/@w:val`.
   */
  readonly lang: string | null;
  /** True when the document asks proofing tools to skip this text (`w:noProof`). */
  readonly noProof: boolean;
}

/** Immutable paragraph text and offsets for `setHighlights()`. @public */
export interface ParagraphText {
  /** The paragraph's `HighlightRange.blockId`, scoped to the open document. */
  readonly blockId: string;
  /**
   * Model text in the editor's configured `fieldResults` offsets, including tracked deletions
   * and hidden text. Highlight offsets and the caret (`getSelectionRange()`) count in this
   * text. Check `acceptedText`, not this text.
   */
  readonly text: string;
  /**
   * The paragraph text with every tracked change accepted: insertions are in, and tracked
   * deletions and move sources (`w:moveFrom`) are out. Hidden text (`w:vanish`) and optional
   * hyphens are left out too. It does not depend on the review display mode, so it is the
   * same in the `original` view. Check spelling and grammar in this text.
   *
   * A tab reads as `\t` and a line break as `\n`. A non-breaking hyphen reads as U+2011. An
   * object, such as a picture, a note reference, a symbol, or a field whose result is not
   * text in the editor's `fieldResults` mode, reads as U+FFFC, so treat U+FFFC as a word
   * boundary. To read saved field results instead, pass `{ fields: 'result' }`.
   */
  readonly acceptedText: string;
  /**
   * Ordered spans mapping `acceptedText` to `text`. Each span has the same length in both
   * texts. A range that crosses a gap between spans needs one highlight per span. To convert
   * an `acceptedText` range, call `acceptedTextRanges()`. With `{ fields: 'result' }`, the
   * text of a field result has no span, because `text` holds the field as one object.
   */
  readonly acceptedSpans: readonly ParagraphTextSpan[];
  /** Ordered stretches that cover all of `acceptedText`, with their language and proofing flag. */
  readonly proofing: readonly ParagraphTextProofing[];
}

/** Options for `getParagraphs()` and `getParagraphText()`. @public */
export interface ParagraphTextReadOptions {
  /**
   * How `acceptedText` reads a field that the editor's `fieldResults` mode holds as one
   * object. `'object'` (the default) reads U+FFFC. `'result'` reads the field's saved result
   * text with every tracked change in it accepted, for proofing. A field result read this way
   * has no `text` offsets, so `acceptedTextRanges()` skips it. `replaceAcceptedText` offsets
   * count in the default read. This option does not change the editor's `fieldResults` mode.
   */
  readonly fields?: 'object' | 'result';
}

/** Read paragraph text to compute highlight ranges, such as spelling marks. @public */
export interface EditorParagraphText {
  /**
   * One paragraph's text, or `null` if the open document has no paragraph with that id.
   * Returns the same object while the underlying paragraph node is unchanged.
   * @public
   */
  getParagraphText(blockId: string, options?: ParagraphTextReadOptions): ParagraphText | null;
  /**
   * Paragraphs across document stories, including pages that have not been painted.
   * Includes body text, tables, content controls, headers, footers, notes and supported text boxes.
   * Body comes first, then other story parts; paragraphs follow model order within each story.
   * Text-box paragraphs follow their host paragraph. Repeated headers and footers appear once.
   *
   * The list is empty until a document opens. Read again after a `change` event. An unchanged
   * paragraph returns the same object for the same `options`, so an object you have already
   * checked needs no new check. A change to the document styles returns new objects.
   * @public
   */
  getParagraphs(options?: ParagraphTextReadOptions): readonly ParagraphText[];
}

/**
 * A range of `ParagraphText.acceptedText`, for `replaceAcceptedText`. Offsets count in the
 * default read, without `{ fields: 'result' }`. @public
 */
export interface AcceptedTextRange {
  /** The paragraph's `ParagraphText.blockId`. */
  readonly blockId: string;
  /** UTF-16 offset in `ParagraphText.acceptedText`. */
  readonly start: number;
  /** Number of UTF-16 code units of `acceptedText`. Zero is a point for an insertion. */
  readonly length: number;
  /**
   * The `acceptedText` you checked at the range. When the paragraph no longer holds it, the
   * command returns `notFound` and changes nothing. Pass it for any result that arrives
   * after the document could change, such as a result from a server.
   */
  readonly expectedText?: string;
  /**
   * The story that holds the paragraph, such as the `frame` scope of its text box. Omitted,
   * the story comes from `blockId`. A scope that does not hold the paragraph returns
   * `invalidArgs`.
   */
  readonly scope?: ViewScope;
}

/**
 * Replace a range of `ParagraphText.acceptedText` with `text`, for a spelling or grammar fix.
 *
 * The command compares the range with `text` and edits only the graphemes that differ, so the
 * tracked changes of other authors around them stay where they are. A word that a tracked
 * deletion splits into several parts is one range: the command edits each part, from the
 * end to the start. The new text joins the hyperlink, content control and run formatting of
 * the first character it replaces. A pure insertion lands at the end of the accepted text
 * before it.
 *
 * An object, such as a field, a picture, a note reference or a symbol, reads as U+FFFC. An
 * object stays in place when `text` keeps its U+FFFC at the same position. A fix that would
 * remove an object returns `unsupported`, and `text` that adds U+FFFC returns `invalidArgs`.
 *
 * It is one undo step, which joins an open `historyGroup`. In suggesting mode it is a tracked
 * change under the editor's author. The selection, the active story and the scroll position
 * stay put. A paragraph in a header, footer, note, or text box is edited without opening it.
 * A range that the paragraph no longer holds (`expectedText`), an unknown `blockId`, or offsets
 * outside `acceptedText` return `notFound`. Locked or bound content returns `locked` or
 * `bound`. Other refusals are the ones `replaceMatch` gives.
 *
 * @example
 * ```ts
 * // "agre" + a deleted "e" + "ment" reads "agrement"; the fix inserts one "e".
 * editor.exec({
 *   type: 'replaceAcceptedText',
 *   match: { blockId: paragraph.blockId, start: 0, length: 8, expectedText: 'agrement' },
 *   text: 'agreement',
 * });
 * ```
 * @public
 */
export interface ReplaceAcceptedTextCommand {
  /** The range to replace. */
  readonly match: AcceptedTextRange;
  /**
   * The new text, without a paragraph mark. It holds U+FFFC only where the range keeps an
   * object. An empty string deletes the range.
   */
  readonly text: string;
}
