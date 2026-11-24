/**
 * What a fit mode fits the page to.
 *
 * One member today. It is a union rather than a boolean because Word's other two — the whole
 * sheet including its height, and the text column inside the margins — are the same
 * computation with a different numerator, and a later change adds one without breaking the
 * shape a host already stores.
 */
export type ZoomFitTarget = 'pageWidth';

/**
 * Where the display scale comes from.
 *
 * `fixed` is a number the engine holds until someone changes it. `fit` is a number the engine
 * recomputes whenever the room beside the page changes — a resized window, an opened comments
 * rail, a docked navigation pane — bounded by `minZoom`/`maxZoom`.
 *
 * The bounds are what make one mode serve both cases. The default, `'auto'`, is this fit
 * bounded at both ends: it leaves a page that fits at 100%, shrinks one that does not, and
 * stops at 50% — past which it would be trading a scrollbar nobody minds for a page nobody
 * can read.
 */
export type ZoomMode =
  | { readonly type: 'fixed' }
  | {
      readonly type: 'fit';
      readonly fit: ZoomFitTarget;
      /** Never shrink past this. Defaults to the contract floor, 0.1. */
      readonly minZoom?: number;
      /** Never grow past this. `1` is the "shrink only" rule. Defaults to the ceiling, 5. */
      readonly maxZoom?: number;
    };
