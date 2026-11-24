import type { ViewScope } from './editor-scope.ts';

/**
 * One text range to mark, select, or replace. A `TextMatch` from `findMatches()` is a valid
 * range, so search results pass straight through. `selectMatch()` and the `replaceMatch`
 * command also take a range you computed, such as a proofing result. @public
 */
export interface HighlightRange {
  /** Paragraph that holds the range: `TextMatch.blockId`. IDs belong to the open document. */
  readonly blockId: string;
  /** UTF-16 offset in the paragraph's model text, as `TextMatch.start` counts it. */
  readonly start: number;
  /** Range length in the same units. A zero length marks nothing. */
  readonly length: number;
  /**
   * Story that holds the paragraph. Optional, because `blockId` already names the paragraph.
   * `selectMatch()` and `replaceMatch` refuse a scope that names another story.
   */
  readonly scope?: ViewScope;
  /**
   * Model text the range must cover to paint. Set it for ranges computed outside the editor,
   * such as on a server, so a range that no longer matches the document never paints. When it
   * is omitted, a range must keep covering the text it covered when it was first set.
   * `selectMatch()` and `replaceMatch` refuse a range whose text differs, with `notFound`.
   */
  readonly expectedText?: string;
  /**
   * What the mark says, for assistive technology, such as `Possible spelling mistake`. In a
   * set with a `kind`, the covered text references this text with `aria-describedby`.
   * Other sets ignore it.
   */
  readonly description?: string;
}

/** Presentation for one named highlight set. Every field is optional. @public */
export interface HighlightOptions {
  /**
   * Fill for every range: a CSS color or `var()` expression.
   * Default: `var(--doc-text-highlight-color)`, a translucent yellow.
   */
  readonly color?: string;
  /**
   * Index of the active range, or `-1` for none. An index past the last range also means
   * none. The active range takes `activeColor` and the `docx-text-highlight--active` class.
   * Default: `-1`.
   */
  readonly activeIndex?: number;
  /** Fill for the active range. Default: `var(--doc-text-highlight-active-color)`, orange. */
  readonly activeColor?: string;
  /** Space-separated CSS classes added to every mark of this set. */
  readonly className?: string;
  /**
   * Stacking order between sets, as an integer from -1000 to 1000. A higher value paints
   * on top. Sets with equal priority stack in the order they were first set. Default: `0`.
   * The built-in Find pane uses the set name `search` with priority `10`.
   */
  readonly priority?: number;
  /**
   * What the marks mean, for assistive technology. `'spelling'` and `'grammar'` mark proofing
   * issues: the covered text reports `aria-invalid` with that value, browsers with the CSS
   * Custom Highlight API also paint the set as a `spelling-error` or `grammar-error`
   * highlight, and the editor announces a change of the issue count in a polite live region.
   * Omit it for marks without a proofing meaning, such as search results. Default: none.
   */
  readonly kind?: HighlightKind;
}

/** The proofing meaning of a highlight set. See {@link HighlightOptions.kind}. @public */
export type HighlightKind = 'spelling' | 'grammar';

/**
 * Move the selection to the next or previous mark of one highlight set. See the
 * `navigateHighlight` command. @public
 */
export interface NavigateHighlightCommand {
  /** The highlight set name passed to `setHighlights()`. */
  readonly name: string;
  /** `'next'` selects the first mark after the selection, `'previous'` the last one before it. */
  readonly direction: 'next' | 'previous';
}

/** What `setHighlights()` resolved against the open document. @public */
export interface HighlightResult {
  /** Ranges that resolve to their text in the open document and can paint. */
  readonly applied: number;
  /**
   * Ranges that do not resolve or cannot paint: an unknown paragraph, offsets past the
   * paragraph end, a zero length, text that differs from `expectedText`, or a story without
   * a layout position.
   */
  readonly unavailable: number;
}

/** A client-space rectangle, compatible with `DOMRect` readers such as positioning libraries. @public */
export interface HighlightRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * One painted mark under a point. `R` is your range type: pass ranges with extra fields,
 * such as a glossary definition, and read them back from `range`. @public
 */
export interface HighlightHit<R extends HighlightRange = HighlightRange> {
  /** Set name passed to `setHighlights()`. */
  readonly name: string;
  /** Index of the range in the array passed to `setHighlights()`. */
  readonly index: number;
  /**
   * The range object exactly as it was passed, including your own fields. Its offsets are
   * the ones you passed; `start` and `length` are where the text is now.
   */
  readonly range: R;
  /** Current start of the highlighted text in its paragraph, after edits moved it. */
  readonly start: number;
  /** Current length of the highlighted text. */
  readonly length: number;
  /** Whether this range is the set's active range. */
  readonly active: boolean;
  /** The marked line box under the point, in client coordinates. Anchor popovers to it. */
  readonly rect: HighlightRect;
}

/**
 * Paint-only text highlights: search results, glossary terms, review findings.
 *
 * Highlights are view state. They never change the document, selection, focus, or undo
 * history, they are never saved, and they are not shared with collaborators. @public
 */
export interface EditorHighlights {
  /**
   * Mark text ranges as one named set, replacing the set's previous ranges and options.
   *
   * Names are 1 to 64 letters, digits, `-`, or `_`, and start with a letter. Each set paints
   * in its own layer, so sets never replace each other. An empty `ranges` array clears the
   * set. At most 32 sets exist at once. A set paints its first 10000 ranges and counts the
   * rest as unavailable. The name `search` belongs to the shared document search.
   *
   * Ranges cover the body, tables, headers, footers, footnotes, endnotes, and anchored text
   * boxes in the body. A range moves with its text when an edit before it shifts the
   * paragraph. When an edit changes the text inside a range, the range stops painting, so a
   * mark never covers the wrong text. Search again after edits to mark new occurrences.
   *
   * Loading, refreshing, or recovering the document removes every set. Invalid names,
   * ranges, or options throw
   * `TypeError` or `RangeError` and leave the current highlights unchanged.
   *
   * @example
   * ```ts
   * const matches = editor.findMatches('Supplier', { wholeWord: true });
   * editor.setHighlights('search', matches, { activeIndex: 0 });
   * ```
   * @public
   */
  setHighlights(
    name: string,
    ranges: readonly HighlightRange[],
    options?: HighlightOptions
  ): HighlightResult;
  /** Remove one highlight set, or every set when `name` is omitted. @public */
  clearHighlights(name?: string): void;
  /**
   * The marks under a client point, topmost first. Use it from `pointermove` or `click`
   * handlers on the editor to show definitions or details for a marked term.
   * Only marks on painted pages are reported. @public
   */
  getHighlightsAt<R extends HighlightRange = HighlightRange>(
    clientX: number,
    clientY: number
  ): readonly HighlightHit<R>[];
}
