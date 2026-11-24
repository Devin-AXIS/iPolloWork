/**
 * Format painter commands for the Editor facade.
 *
 * Separated from `editor.ts` so the facade file stays under the max-lines gate while the
 * painter keeps one cohesive vocabulary. Re-exported from `editor.ts`, so consumers keep
 * importing `@docx-editor.dev/core/contracts/editor`.
 */

/**
 * Word's Format Painter, as the two halves a keyboard user drives separately.
 *
 * The pair is deliberately NOT one command with a direction flag: `copyFormatting` reads
 * and `pasteFormatting` writes, so they answer `can` differently — copying is allowed on a
 * document open for viewing, and applying is not.
 */
export interface EditorFormatPainterCommands {
  /**
   * Capture the formatting at the selection (Word's Ctrl+Shift+C).
   *
   * Reads the RESOLVED cascade rather than the direct run properties, so painting from a
   * styled paragraph carries what the reader sees rather than the little the paragraph
   * happens to state itself.
   *
   * The LEVEL follows the selection, as Word's does. A range inside one paragraph captures
   * character formatting alone; a range that covers a paragraph mark — a whole paragraph, a
   * multi-paragraph selection, or a collapsed caret — captures the paragraph style and its
   * direct paragraph properties as well.
   *
   * Non-mutating: the capture lives on the editor, not in the document, and it survives
   * until the next capture, a document load, or `destroy()`, including across a `detach()`
   * and a later `attach()`.
   */
  copyFormatting: Record<never, never>;
  /**
   * Apply the captured formatting to the current selection (Word's Ctrl+Shift+V).
   *
   * Refused with `no formatting has been copied` until `copyFormatting` has run. Paragraph
   * formatting is applied only when the capture carries it; the text itself never moves.
   *
   * Three things stay on the TARGET rather than being painted over, because they are outside
   * the property vocabulary an op may name — the same limit `clearFormatting` states:
   * paragraph borders (`w:pBdr`), the run's character style (`w:rStyle`), and character
   * shading (`w:rPr/w:shd`), which is resolved and painted but cannot be authored.
   */
  pasteFormatting: Record<never, never>;
}

/**
 * How long the painter stays armed.
 *
 * Word's two gestures, named: a single press arms it for ONE application, a double press
 * locks it on until the user presses `Esc`. `'off'` is the resting state.
 */
export type FormatPainterMode = 'off' | 'once' | 'locked';

/**
 * What a capture carries.
 *
 * `'run'` is character formatting alone — the level a range INSIDE one paragraph copies.
 * `'paragraph'` adds the paragraph style and its direct paragraph properties, which is what
 * a selection covering a paragraph mark copies. `'none'` means nothing has been captured.
 */
export type FormatPainterLevel = 'none' | 'run' | 'paragraph';

/**
 * Painter state, as the editor publishes it.
 *
 * Chrome state rather than document state, so it moves through the same report every other
 * observable surface state uses — a toolbar's pressed state has one source. It lives in the
 * CONTRACTS lane rather than beside the surface implementation because `EditorSnapshot`
 * names it, and the contracts lane may not reach into the editor lane.
 */
export interface FormatPainterSurfaceState {
  readonly mode: FormatPainterMode;
  readonly level: FormatPainterLevel;
}
