import type { DocAnchor } from './types.ts';

/**
 * Where a scroll places its target in the viewport.
 *
 * - `'start'`: near the top, like a jump to a heading.
 * - `'center'`: centred.
 * - `'centerIfNeeded'`: still while the target is on screen, centred when it has to move.
 * - `'nearest'`: the minimum scroll, which leaves the target at the edge it came in from.
 *
 * Each method that takes a placement states its own default.
 *
 * @public
 */
export type ScrollPlacement = 'start' | 'center' | 'centerIfNeeded' | 'nearest';

/**
 * Scroll settings for {@link EditorAnchorNavigation.scrollToAnchor}. Every field is optional.
 * The fields match document refresh `NavigateToChangeOptions`. @public
 */
export interface ScrollToAnchorOptions {
  /**
   * Target placement. The default depends on the method: `scrollToAnchor` uses
   * `'centerIfNeeded'`, which keeps the viewport still for a visible target, and
   * `scrollToBlock` uses `'start'`.
   */
  readonly block?: ScrollPlacement;
  /** Default: instant. Reduced motion uses instant even when smooth is requested. */
  readonly behavior?: 'instant' | 'smooth';
  /** Edge padding for start/nearest placement, in CSS pixels. Default: 24. Finite and nonnegative. */
  readonly offsetPx?: number;
}

/** Opacity fade settings. Reduced motion limits fades to 125 milliseconds. @public */
export interface AnchorHighlightAnimation {
  /** Fade duration in milliseconds. Default: 180. Must be finite and between 0 and 10000. */
  readonly durationMs?: number;
  /** Automatic and explicit exit fade duration. Defaults to durationMs. Range: 0 through 10000. */
  readonly exitDurationMs?: number;
  /** CSS timing function for both fades. Defaults to --doc-motion-ease-out. This option does not accept CSS variables. */
  readonly easing?: string;
}

/**
 * Presentation for temporary paragraph highlights. Each call starts from these defaults.
 * Document refresh `RefreshHighlightOptions` extends this type, so one style object serves both. @public
 */
export interface AnchorHighlightOptions {
  /**
   * CSS color, including var(). Default: a light blue theme token,
   * var(--doc-anchor-highlight-color) for anchors and var(--doc-refresh-highlight-color) for refresh.
   */
  readonly color?: string;
  /** Fill opacity, from 0 to 1. Default: 0.14. Does not change document text opacity. */
  readonly opacity?: number;
  /** Extra space on each edge, in CSS pixels at 100% zoom. Default: 4. Must be finite and nonnegative. */
  readonly padding?: number;
  /** Corner radius in CSS pixels at 100% zoom. Default: 6. Must be finite and nonnegative. */
  readonly borderRadius?: number;
  /** Border width in CSS pixels at 100% zoom. Default: 0. Finite and nonnegative. */
  readonly borderWidth?: number;
  /** CSS border color. Defaults to color. Use an alpha color for a translucent border; opacity controls only the fill. */
  readonly borderColor?: string;
  /** Border pattern. Default: solid. */
  readonly borderStyle?: 'solid' | 'dashed' | 'dotted';
  /** Optional CSS classes for shadows or patterns. The editor controls highlight placement and size. */
  readonly className?: string;
  /** Milliseconds before dismissal starts. Default: 3000. Set `null` to keep highlights until you dismiss them. Maximum: 2147483647. */
  readonly timeoutMs?: number | null;
  /** Default: true, a 180-millisecond fade. False disables motion. Repeated calls for the same paragraph do not restart the fade. */
  readonly animation?: boolean | AnchorHighlightAnimation;
}

/** Explicit highlight dismissal. @public */
export interface ClearAnchorHighlightOptions {
  /** Defaults to the last highlight call's exit animation. False removes highlights immediately. */
  readonly animation?: boolean | AnchorHighlightAnimation;
}

/** Navigation and temporary highlights for external paragraph references. @public */
export interface EditorAnchorNavigation {
  /**
   * Reveal a paragraph by its `w14:paraId` without changing selection, focus, or editing scope.
   * With `search`, reveal the start of the matched text. Matching follows {@link DocAnchor}.
   * By default, an offscreen target is centered and an already visible target does not move the viewport.
   *
   * Supports laid-out body, table, header, footer, footnote, and endnote paragraphs.
   * Repeated headers and footers use their first laid-out occurrence. Text boxes are unsupported.
   * Returns true when the target is visible or scrolling succeeds. Returns false for invalid,
   * missing, or ambiguous targets, or targets without layout positions.
   * Also returns false without a mounted, measurable scroll container.
   * Invalid options throw `TypeError` or `RangeError`. Works in viewing mode.
   * Does not change document content or undo history.
   *
   * @example
   * ```ts
   * const revealed = editor.scrollToAnchor({ paraId: '1B4C77A2' });
   * ```
   * @public
   */
  scrollToAnchor(anchor: DocAnchor, options?: ScrollToAnchorOptions): boolean;
  /**
   * Highlight the paragraph that a {@link DocAnchor} resolves to, without scrolling.
   * Matching follows `scrollToAnchor`; `search` must resolve, and the whole paragraph is marked.
   * A new call replaces the previous anchor highlight. Repeating a call resets its timeout.
   *
   * Supports body, table, and block content control paragraphs with layout positions.
   * Returns false for invalid, missing, or ambiguous targets, or targets without layout positions.
   * Also returns false for headers, footers, notes, and text boxes, or without a mounted document.
   * A false result leaves the current highlight unchanged.
   * The method validates options first. Invalid numbers throw `RangeError`.
   * Invalid colors, border styles, or animation settings throw `TypeError`.
   *
   * The highlight never changes selection, focus, document content, or undo history. Loading or
   * replacing the document removes it.
   *
   * @example
   * ```ts
   * if (editor.scrollToAnchor(anchor)) editor.highlightAnchor(anchor, { timeoutMs: 1500 });
   * ```
   * @public
   */
  highlightAnchor(anchor: DocAnchor, options?: AnchorHighlightOptions): boolean;
  /**
   * Dismiss the anchor highlight with a fade, or immediately with `animation: false`.
   * Validates options even when nothing is highlighted. @public
   */
  clearAnchorHighlight(options?: ClearAnchorHighlightOptions): void;
}
