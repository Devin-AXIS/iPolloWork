/** Priority of an editor-owned popup renderer. @public */
export interface PopupChromeRegistrationOptions {
  /** Use only when no manually registered renderer exists. */
  readonly fallback?: boolean;
}
/**
 * A core-owned content-control value edit.
 *
 * `kind` names the widget that was pressed. A `checkbox` session carries the current state as
 * `'true'` / `'false'` and expects the opposite (or the same) back through `apply`; the
 * packaged pop-ups apply the toggle at once, so a host only sees it when it renders the
 * widget itself. A `buildingBlockGallery` session is a list session: `items` are the
 * glossary's blocks for the control's gallery, named by `w:docPartPr/w:name`, and `apply`
 * takes a name. A `picture` session carries the control's drawing node id as `value` and
 * takes new image bytes through `replaceImage`; `apply` refuses, since no text stands for an
 * image.
 * @public
 */
export interface ContentControlWidgetSession {
  readonly controlId: string;
  readonly kind: 'dropdown' | 'comboBox' | 'date' | 'checkbox' | 'picture' | 'buildingBlockGallery';
  readonly items: readonly { readonly displayText: string; readonly value: string }[];
  readonly value: string;
  /** The editor's regional locale, for a date picker's month, weekday and first-day rules. */
  readonly locale: string;
  readonly anchor: HTMLElement | null;
  readonly signal: AbortSignal;
  canApply(): boolean;
  apply(value: string): boolean;
  cancel(): void;
  /**
   * Picture sessions only: replace the control's image with these bytes. The engine sniffs
   * the format (PNG, JPEG, GIF, BMP or WebP) and keeps the drawing's size. Resolves false
   * when the bytes are not a supported image, the control no longer takes a write, or the
   * document is open for viewing or suggesting. Cancellation during decoding prevents
   * the commit; only one replacement may be pending for a session.
   */
  replaceImage?(bytes: Uint8Array): Promise<boolean>;
}
/** Framework rendering for content-control value widgets. @public */
export interface ContentControlWidgetChromeHandlers {
  readonly onRequest?: (session: ContentControlWidgetSession) => void;
  /**
   * Session kinds this renderer takes. Defaults to `dropdown`, `comboBox`, `date` and
   * `buildingBlockGallery` (the list-shaped sessions), so a renderer written for the pop-ups
   * never receives a checkbox or picture press it does not expect. Include `'checkbox'` to
   * take those presses too; the engine then leaves the toggle to `apply`, and a press nobody
   * takes toggles the box as before. Include `'picture'` to own the image pick; a press nobody
   * takes opens the engine's own file picker.
   */
  readonly kinds?: readonly ContentControlWidgetSession['kind'][];
}
/** An invalid protected-field acknowledgement. @public */
export interface InvalidTextFormFieldSession {
  readonly type: 'number' | 'date';
  readonly signal: AbortSignal;
  /** Clear the unchanged invalid value, if the target still permits it. */
  acknowledge(): void;
  /** Dismiss without clearing the authored value. */
  cancel(): void;
}
/** Framework rendering for invalid protected-field acknowledgements. @public */
export interface InvalidTextFormFieldChromeHandlers {
  readonly onRequest?: (session: InvalidTextFormFieldSession) => void;
}
