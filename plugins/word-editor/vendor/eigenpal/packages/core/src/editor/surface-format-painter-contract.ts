// Format painter contract types (paginated-surface seam).
//
// Split from `paginated-surface-contract.ts` the way the content-control ops are, so the
// surface contract names the lane and this file describes it. The CAPTURE itself never
// appears here: what a host needs is whether something is held and at which level, and
// publishing the OOXML property bags would make an internal vocabulary part of the surface
// contract that hosts then program against.

import type {
  FormatPainterLevel,
  FormatPainterMode,
  FormatPainterSurfaceState,
} from '../contracts/editor-format-painter.ts';

// Declared in the CONTRACTS lane, because `EditorSnapshot` names them and that lane may not
// reach into this one. Re-exported here so the surface contract stays one import path.
export type { FormatPainterLevel, FormatPainterMode, FormatPainterSurfaceState };

/**
 * The refusal an apply gets before anything has been copied.
 *
 * A constant rather than a literal at each site, because THREE lanes state it — `can`, the
 * exec dispatch, and the toolbar's enabled state — and the i18n catalogue keys the localized
 * sentence on this exact English (`DISABLED_REASON_KEYS`). A paraphrase in one of them is a
 * refusal that reaches every locale raw.
 */
export const NO_COPIED_FORMATTING = 'no formatting has been copied';

/**
 * The refusal a capture gets when the selection resolves to nothing to read.
 *
 * Stated here for the same reason its sibling above is: two lanes return it — the chrome
 * press and the `copyFormatting` exec — and the i18n catalogue keys the localized sentence
 * on this exact English.
 */
export const NOTHING_TO_COPY_FORMATTING = 'there is nothing at the selection to copy';

/** The refusal a paint gets when the selection holds nothing the capture can reach. */
export const NOTHING_TO_PAINT = 'the selection has nothing to paint';

/**
 * The resting state, as one shared frozen value.
 *
 * `EditorSnapshot` is value-cached by REFERENCE comparison, so a fresh `{ mode: 'off' }`
 * object per derivation would report every tick as a change and defeat the cache for every
 * consumer, not just this one.
 */
export const FORMAT_PAINTER_OFF: FormatPainterSurfaceState = Object.freeze({
  mode: 'off',
  level: 'none',
});

/**
 * What one paint did.
 *
 * Four answers rather than a boolean, because the two FAILURES are different problems with
 * different words for the user: `'nothingToPaint'` says the selection holds nothing the
 * capture can reach, and `'refused'` says the document would not take the write — a locked
 * content control, a collaboration gate, a document open for viewing. Collapsed to false,
 * a refused paint told the reader to select some text.
 *
 * `'armed'` is the collapsed-caret outcome: no text to paint, so the character half went to
 * the stored-marks lane and the next characters typed will carry it.
 */
export type FormatPainterPaintResult = 'painted' | 'armed' | 'nothingToPaint' | 'refused';

/** Word's Format Painter over the surface. */
export interface FormatPainterOps {
  state(): FormatPainterSurfaceState;
  /**
   * Capture the formatting at the selection. False when the selection resolves to no span
   * the layout has published yet — there is nothing to read.
   */
  capture(): boolean;
  /** Paint the captured formatting over the current selection. */
  apply(): FormatPainterPaintResult;
  /**
   * One press of the painter control, with Word's meaning.
   *
   * A press while the painter is off captures and arms it for a single application. A press
   * that lands within the double-press window locks it on. A press while it is armed and
   * outside that window turns it off.
   *
   * The double-press window is the ENGINE's, deliberately: the alternative is each adapter
   * binding its own `dblclick` beside its own `click`, which is two hosts deciding
   * separately what a double-click means and drifting the moment one of them changes.
   *
   * False when there was nothing at the selection to capture, so a control can report a
   * refusal rather than looking as though it armed.
   */
  press(): boolean;
  /** Turn the painter off, keeping the capture. `Esc` and a finished single application. */
  disarm(): void;
}
