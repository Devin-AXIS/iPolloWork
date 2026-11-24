// The options of `Editor.setActiveReviewItem`.

import type { ScrollPlacement } from './editor-anchor.ts';

/**
 * How activating a review item places it in the viewport, and whether it announces the
 * reveal.
 *
 * @public
 */
export interface ReviewActivationOptions {
  /**
   * Where the item lands, or `false` to open it without scrolling at all.
   *
   * Default `'centerIfNeeded'`: silent while the item is already on screen, centred when it
   * has to travel. `'nearest'` scrolls the minimum instead, which parks the item flush
   * against the edge it came in from; `'start'` puts it near the top, the way a jump to a
   * heading reads. `false` is for a host whose own list already drives the scroll and does
   * not want the engine competing with it.
   *
   * It governs the reveal of the ITEM. An item in a header, a footer or a note also opens
   * that story, and opening one always brings its band into view — a story the reader cannot
   * see is one they cannot read the change in, which is the whole point of activating it.
   */
  readonly reveal?: ScrollPlacement | false;
  /**
   * Whether a successful activation fires the `reviewItemReveal` event. Default `false`.
   *
   * Pass `true` to open the item the way Next Change does: the packaged review UI opens its
   * balloon, or opens a closed review pane at its card when the pane's `opening` setting is
   * `'auto'`. The item becomes active either way.
   *
   * @example
   * ```ts
   * editor.setActiveReviewItem(key, { announce: true });
   * ```
   */
  readonly announce?: boolean;
}
