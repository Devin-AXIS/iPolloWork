import type { UnsupportedElementRule } from '../layout/unsupported-content-types.ts';
import type {
  RevisionMarkupOptions,
  RevisionMarkupChromeHandlers,
} from '../contracts/revision-markup.ts';
import type { CompareDocumentsChromeHandlers } from '../contracts/compare-documents.ts';
import type { FieldResultsMode } from '../store/package/field-result-mode.ts';
import type { ReviewPaneOptions } from '../contracts/review-pane.ts';
import type { ReviewDisplayMode } from '../layout/revision-projection.ts';
import type { FontShapingOptions } from '../layout/font-shaping-policy.ts';
import type {
  PopupChromeRegistrationOptions,
  ContentControlWidgetChromeHandlers,
  InvalidTextFormFieldChromeHandlers,
} from './popup-sessions.ts';
import type { TextFormFieldChromeHandlers } from './text-form-field-session.ts';
import type { ContentLockPolicy } from '../store/package/ooxml-edit.ts';
import type { LockedControlNavigation } from './paginated-surface-options.ts';
/**
 * Instance-level types for `createDocxEditor` — kept out of the composition root so
 * `docx-editor.ts` stays under the max-lines gate. Re-exported from `docx-editor.ts`
 * and the editor package barrel so public import paths do not change.
 */

import type {
  DocumentSource,
  Editor,
  EditorFontError,
  ExecResult,
  FontConfiguration,
  Unsubscribe,
  ZoomMode,
  TableInteractionLabelKey,
} from '@docx-editor.dev/core/contracts/editor';
import type { EditorModule } from '../contracts/modules.ts';
import type { EditorCollaborationSession } from '../collaboration/index.ts';
import type {
  ReviewAuthorInfo,
  RevisionAuthorStyle,
  RevisionStyles,
} from '../output/revision-presentation.ts';
import type { FontConfigurationFragment, FontResolver } from './font-composition.ts';
import type { PaginatedSurface, RemoteCaretLabelHost } from './paginated-surface.ts';
import type { OpeningIndicatorHost } from './surface-opening-indicator.ts';
import type { HyperlinkActivation } from './surface-navigation.ts';
import type { EquationActivation } from './surface-equations.ts';
import type { BookmarkStory } from '../contracts/editor-bookmarks.ts';

/**
 * Everything {@link createDocxEditor} accepts. Every field is optional.
 *
 * `container` is the one that changes the shape of the whole lifecycle: omitting it produces an
 * instance that does no DOM work until `attach(el)`, which is what lets a provider own the editor
 * before any component has rendered a mount point.
 *
 * @public
 */
export interface DocxEditorConfig {
  /**
   * The element the paginated surface mounts into. The surface owns this subtree.
   *
   * Optional: an instance created WITHOUT a container stashes its document bytes and does
   * no DOM work until `attach(el)` — the provider-first shape, where the editor exists
   * before any component has rendered a mount point. With a container, the document mounts
   * immediately at construction, exactly as before.
   */
  container?: HTMLElement;
  /**
   * A document to load at construction: DOCX bytes, or `'blank'` for Word's blank
   * template. A `DocumentHandle` cannot be re-opened (the handle is identity, not
   * content), so passing one emits a typed `error` event rather than silently loading
   * nothing. Omitting this mounts NO document, which is not the same as an empty one.
   */
  document?: DocumentSource;
  /**
   * Font bytes for Word-accurate (HarfBuzz-shaped) line wrap and pagination. Omitted,
   * layout falls back to a fixed-width estimate; fonts embedded in the document are
   * wired in automatically either way. For Word's default faces (Calibri, Times New
   * Roman, …) pass `await loadDefaultFonts()` from `@docx-editor.dev/fonts` — a bare
   * fragment (`{ sources, substitutions }`) is accepted and composed with defaults, or
   * merge several origins yourself with `composeFontConfiguration`. Sampled per load;
   * failures degrade to the fixed measurer and report through `onFontError`.
   *
   * Pass a {@link FontResolver} instead to resolve ON DEMAND: the function is called once
   * per load, after the document is parsed, with the families it actually declares, and
   * only what it returns is loaded. A document naming nothing the resolver covers costs
   * nothing. Note that a fetching resolver makes opening a document perform network
   * requests — the engine never supplies one, so that stays your call.
   */
  fonts?: FontConfiguration | FontConfigurationFragment | FontResolver;
  /** Explicit shaping execution limits. Omitted, the per-face byte ceiling remains 16 MiB. */
  fontShaping?: FontShapingOptions;
  author?: string;
  /** BCP-47 locale for regional date input and generated labels; defaults to en-US. */
  locale?: string;
  /** Drawing and form-control UI labels; defaults to English when omitted. */
  translate?: (key: string, params?: Record<string, string | number>) => string;
  /**
   * Capability modules to register — the seam `@docx-editor.dev/pro` plugs in
   * through. Omitted, the editor runs the free tier: lossless round-trip,
   * final-state revision rendering, review chrome disabled with the engine's
   * reason. See {@link EditorModule}.
   */
  modules?: readonly EditorModule[];
  /**
   * Opt-in relaxation of content-control `w:lock`: with `allowFormattingInLockedContent`,
   * `contentLocked` / `sdtContentLocked` controls refuse typing, pasting and deleting their
   * text as always, but accept run formatting (toolbar, shortcuts, automation `setFont`) —
   * for hosts that protect WHAT a control says and let authors style it. Default: Word's
   * behaviour, where a content lock refuses every edit including formatting.
   */
  contentLockPolicy?: ContentLockPolicy;
  /**
   * The mode the editor opens in — one prop, matching the toolbar's three-state pill.
   *
   * - `'edit'` — opens in editing, even when the document's `w:trackRevisions` asks for
   *   tracked changes; the reader still moves between modes from the toolbar.
   * - `'suggesting'` — opens in suggesting. It needs what suggesting always needs — a
   *   review module and an {@link DocxEditorConfig.author} — and falls back to editing
   *   with the reason published when either is missing. A missing author is a host
   *   configuration error and is also reported once on the console; the editor enters
   *   suggesting as soon as {@link DocxEditorInstance.setAuthor} names one.
   * - `'view'` — read-only: every mutating command through the facade is refused, and
   *   the toolbar cannot leave viewing.
   * - Omitted — the DOCUMENT decides: a package carrying `w:trackRevisions` opens in
   *   suggesting, everything else in editing.
   */
  mode?: 'edit' | 'view' | 'suggesting';
  /**
   * How painted tracked changes are coloured. Presentation only — nothing is serialised.
   *
   * - `'author'` (the DEFAULT) — every change takes its author's colour from the
   *   `--doc-review-author-N` ramp, by order of first appearance, as Word does. Restyle a
   *   slot under `.docx-editor` to change the ramp.
   * - `'kind'` — insertions green, deletions red, so "added" and "removed" are what a
   *   glance tells apart, whoever proposed them.
   * - {@link RevisionAuthorAssignments} — style the named authors; `others` decides
   *   whether the rest take the ramp (the default) or the kind colours.
   *
   * The opening value. In React this is authored declaratively — `DocxEditor.ColorByChangeType`
   * and `DocxEditor.AuthorStyle` compose and apply it, seeding this config for the first
   * paint — so React hosts never pass it by hand; it is the entry for headless hosts. Read
   * the document's resolved roster with `getReviewAuthors`. Applies wherever revision
   * markup paints: the full all-markup view needs a review module registered; without one
   * the proposed view still marks surviving insertions.
   */
  revisionStyles?: RevisionStyles;
  /** Ordered unsupported-content registrations; the first matching rule reserves a layout box. */
  unsupportedElementRules?: readonly UnsupportedElementRule[];
  /** Initial local revision presentation and tracking preferences. */
  revisionMarkup?: RevisionMarkupOptions;
  /** Initial review projection. Markup modes require a review module. */
  reviewDisplayMode?: ReviewDisplayMode;
  /**
   * How the reader edits saved field results.
   *
   * - `'atomic'` (the DEFAULT) — every field is one unit: typing beside a field lands before
   *   or after it, and Backspace removes it whole.
   * - `'editable'` — fields that show their saved result (DATE, TIME, MERGEFIELD, HYPERLINK
   *   display text, QUOTE, FILENAME, FILLIN, SEQ, and the save, print, and creation dates)
   *   accept typing, deletion, and selection inside the result. Fields the engine computes
   *   live (PAGE, NUMPAGES, REF, PAGEREF, DOCPROPERTY, and others) stay one unit.
   *
   * Editable results must be unnested. Simple fields inside complex field results are not
   * supported in editable mode.
   *
   * Fixed for the instance. `'editable'` with a collaboration module throws a `TypeError`:
   * shared paragraph text keeps every field one unit.
   */
  fieldResults?: FieldResultsMode;
  /**
   * How the caret moves through an inline control with a content lock. `'atomic'` makes such a
   * control one caret unit; `'characters'` (the default) walks through its characters, as Word
   * does. Fixed for the instance.
   */
  lockedControlNavigation?: LockedControlNavigation;
  /** Override raster decode for insert/replace image commands; defaults to browser/headless. */
  imageDecodePort?: import('../store/package/image-resources.ts').ImageDecodePort;
  /**
   * The scale to open at, as a fixed number.
   *
   * Supplying one also picks the mode: an editor given a `zoom` and no `zoomMode` opens
   * FIXED at that value and stays there. An embedder that pinned 100% keeps 100%.
   */
  zoom?: number;
  /**
   * Where the scale comes from. Defaults to `'auto'` — fit the page width, between 50% and
   * 100% — unless {@link DocxEditorConfig.zoom} is supplied, which means fixed.
   *
   * `'auto'` leaves a window wide enough for the sheet exactly where it is today and shrinks
   * a narrower one instead of growing a horizontal scrollbar. Pass `{ type: 'fixed' }` for
   * the old unconditional behaviour.
   */
  zoomMode?: ZoomMode | 'auto';
  onFontError?: (error: EditorFontError) => void;
  /** Localized labels for table insertion furniture on the painted surface. */
  tableInteractionLabel?: (key: TableInteractionLabelKey) => string;
}

/**
 * Which measurer the current document's layout runs on, and whether shaped resolution is
 * still in flight. Returned by {@link DocxEditorInstance.fontMeasurement}.
 */
export interface FontMeasurementState {
  /** `fixed` estimates advance widths; `shaped` measures real font bytes with HarfBuzz. */
  readonly measurer: 'fixed' | 'shaped';
  /**
   * True until the document's text shows in its own fonts: while font resolution runs, and
   * while a face that the text uses is still on the way, such as a CJK face that loads later.
   * Extra faces that a resolver loads in the background, such as a bold face that no text uses
   * yet, do not hold it. A stalled load holds it for at most 10 seconds.
   */
  readonly resolving: boolean;
  /** The shaped measurer's identity (admitted face hashes); absent while fixed. */
  readonly producer?: string;
}

/**
 * The host chrome that answers the engine's hyperlink gestures.
 *
 * A CLICK on an external link and Ctrl/Cmd+K both mean "the user wants the link UI", and the
 * engine deliberately does not know what that looks like. Registered rather than passed at
 * construction because the chrome mounts after the editor does, and it survives a document
 * reload — the surface is rebuilt, the handlers are not.
 */
export interface HyperlinkChromeHandlers {
  /** A plain click on an external or inert link: show the popover at `activation.rect`. */
  readonly onPopover?: (activation: HyperlinkActivation) => void;
  /** Ctrl/Cmd+K: open insert-or-edit for the selection. */
  readonly onRequest?: () => void;
}

/**
 * Host chrome for bookmarks.
 *
 * @public
 */
export interface BookmarkChromeHandlers {
  /**
   * Open the Bookmark dialog for the selection: the `openBookmarkDialog` command, which the
   * Insert menu row and Ctrl/Cmd+Shift+F5 send.
   */
  readonly onRequest?: () => void;
}

/**
 * Host chrome for comment drafts: the review rail, or the host's own comment UI.
 *
 * @public
 */
export interface CommentDraftChromeHandlers {
  /**
   * Open a comment draft on the selection: the `review.addComment` control's press. The
   * handler takes no arguments. It reads the selection with `getSelectionPlacement`, and can
   * pin it with `retainSelection` while the draft is open. The most recent registration
   * receives each request.
   */
  readonly onRequest?: () => void;
}

/**
 * Host chrome for Go To: the Go to tab of `DocxEditor.Navigation`, or the host's own.
 *
 * @public
 */
export interface GoToChromeHandlers {
  /** Open the Go To UI: the `openGoTo` command, which its shortcut also sends. */
  readonly onRequest?: () => void;
  /**
   * Whether Ctrl+G (Cmd+Option+G on macOS) in the document opens this UI. Defaults to `true`.
   * With `false` the chord is left to the browser; `openGoTo` still opens the UI. The most
   * recent registration decides. It is read when the chord arrives, so a getter can follow a
   * setting without registering again.
   */
  readonly shortcut?: boolean;
}

/**
 * One painted bookmark mark, as `BookmarkMarkOptions` callbacks see it.
 *
 * @public
 */
export interface BookmarkMarkInfo {
  /** The bookmark's name as the document writes it. */
  readonly name: string;
  /** Whether the name starts with an underscore. */
  readonly hidden: boolean;
  /** The story the bookmark is in. */
  readonly story: BookmarkStory;
  /** Which mark this is: the start bracket, the end bracket, or a point bookmark's I-beam. */
  readonly edge: 'start' | 'end' | 'point';
}

/**
 * How Show bookmarks paints its marks. Register with `setBookmarkMarks`.
 *
 * @public
 */
export interface BookmarkMarkOptions {
  /**
   * Which bookmarks get marks: `'visible'` (the default) skips hidden bookmarks, `'all'`
   * includes them, and a function decides per bookmark.
   */
  readonly include?: 'visible' | 'all' | ((bookmark: Omit<BookmarkMarkInfo, 'edge'>) => boolean);
  /**
   * Adjust each mark before it is placed: add a class, a `title` tooltip, or attributes.
   * Return another element to replace the mark. The editor positions whatever comes back.
   * Marks ignore the pointer; set `pointer-events: auto` on a mark that shows a tooltip.
   */
  readonly decorate?: (element: HTMLElement, mark: BookmarkMarkInfo) => HTMLElement | void;
  /** Keep the marks when the browser prints the page. Exports never include them. */
  readonly print?: boolean;
}

/** Host chrome that edits a clicked Office Math equation. */
export interface EquationChromeHandlers {
  readonly onPopover?: (activation: EquationActivation) => void;
}

/**
 * How {@link DocxEditorInstance.attach} moves an open document.
 *
 * @example
 * ```ts
 * // Bring the editor home from a pop-out and keep typing there.
 * editor.attach(mainSlot, { focus: true });
 * ```
 *
 * @public
 */
export interface AttachOptions {
  /**
   * Focus the pages after the move, so the caret shows and typing continues. Default: focus
   * returns only when the pages had it before the move or the `detach()`. A first mount from
   * bytes does not take focus.
   */
  readonly focus?: boolean;
}

/**
 * The concrete facade type: the full `Editor` contract plus the instance-only surface.
 *
 * `surface`, `stateVersion`, `attach` and `detach` live HERE rather than on `Editor`:
 * they are what a store binding and a mounting host need, not what document commands
 * need. Production adapters program against `Editor` for everything else.
 */
export interface DocxEditorInstance extends Editor {
  /**
   * Replace host font resources without replacing the document or its edit history.
   * Old resolution is cancelled. Existing host faces are removed before the new
   * resolver runs; no answer keeps the bounded fallback. Document-embedded faces
   * remain independent of host fonts. Failures report through `onFontError`.
   *
   * The session, selection, undo, protection, and collaboration state stay intact.
   * Throws after `destroy()`. This does not grant permission to load native fonts.
   * @public
   */
  setFonts(fonts: DocxEditorConfig['fonts']): Promise<void>;

  /** Bumps on mount, detach, destroy, and document reload — guards async image intents. */
  readonly mountGeneration: number;
  /**
   * The underlying paginated surface for harnesses and tests that need capabilities the
   * contract does not carry yet (select-all, node-id addressed selection).
   */
  readonly surface: PaginatedSurface | null;
  /**
   * Wire the host's hyperlink chrome to the engine's gestures — a click on an external
   * link, and Ctrl/Cmd+K. Returns an unsubscribe that restores whatever was registered
   * before, so a popover component can register in an effect and clean up in its teardown.
   *
   * Instance-only, like `surface`: it is what a MOUNTING host needs, not what a document
   * command needs.
   */
  setHyperlinkChrome(handlers: HyperlinkChromeHandlers): Unsubscribe;
  /**
   * Wire the host's bookmark dialog to Ctrl/Cmd+Shift+F5. Returns an unsubscribe that
   * restores whatever was registered before, like {@link DocxEditorInstance.setHyperlinkChrome}.
   */
  setBookmarkChrome(handlers: BookmarkChromeHandlers): Unsubscribe;
  /**
   * Wire the host's Go To UI to the `openGoTo` command. Returns an unsubscribe that restores
   * whatever was registered before. `DocxEditor.Navigation` registers its Go to tab.
   */
  setGoToChrome(handlers: GoToChromeHandlers): Unsubscribe;
  /**
   * Wire the host's comment draft UI to the `review.addComment` control. Returns an
   * unsubscribe that restores whatever was registered before. While nothing is registered,
   * the control is disabled, because nothing could open the draft. The review rail registers
   * when it mounts.
   */
  setCommentDraftChrome(handlers: CommentDraftChromeHandlers): Unsubscribe;
  /**
   * Choose which bookmarks Show bookmarks marks and customize each mark. Returns an
   * unsubscribe that restores the previous options.
   */
  setBookmarkMarks(options: BookmarkMarkOptions): Unsubscribe;
  /**
   * Register local revision settings chrome. Disposal cancels its active sessions.
   * Manual renderers take priority over fallback renderers. Pass null to use native chrome
   * until disposal restores the previous registration.
   */
  setRevisionMarkupChrome(
    handlers: RevisionMarkupChromeHandlers | null,
    options?: PopupChromeRegistrationOptions
  ): Unsubscribe;
  /**
   * Register Compare documents chrome. Disposal cancels its active sessions. Manual renderers
   * take priority over fallback renderers. Pass null to use the review module's own dialog
   * until disposal restores the previous registration.
   */
  setCompareDocumentsChrome(
    handlers: CompareDocumentsChromeHandlers | null,
    options?: PopupChromeRegistrationOptions
  ): Unsubscribe;
  /** Register Field Options chrome. Disposal closes sessions owned by this registration. */
  setTextFormFieldChrome(
    handlers: TextFormFieldChromeHandlers,
    options?: PopupChromeRegistrationOptions
  ): Unsubscribe;
  /** Register typed content-control widget chrome. */
  setContentControlWidgetChrome(
    handlers: ContentControlWidgetChromeHandlers,
    options?: PopupChromeRegistrationOptions
  ): Unsubscribe;
  /** Register invalid protected-field acknowledgement chrome. */
  setInvalidTextFormFieldChrome(
    handlers: InvalidTextFormFieldChromeHandlers,
    options?: PopupChromeRegistrationOptions
  ): Unsubscribe;
  /** Wire the host equation popover to painted equation clicks. */
  setEquationChrome(handlers: EquationChromeHandlers): Unsubscribe;
  /**
   * Render the host's own component as the remote-caret label, or restore the default
   * collaborator-name label with `null`. The engine keeps owning label geometry, class,
   * and presence colour; the host owns the content of each published element.
   *
   * Instance-only, like `setHyperlinkChrome`: it is what a MOUNTING host needs. Tolerated
   * before `attach` and after `detach` — the registration waits and applies on the next
   * mount, and it survives a document reload the way the hyperlink chrome does.
   */
  setRemoteCaretLabelHost(host: RemoteCaretLabelHost | null): void;
  /**
   * Render the host's own loading indicator on the first page while a large document lays out
   * its remaining pages, or restore the packaged spinner with `null`. The engine keeps owning
   * the element and its place on the page; the host owns its content.
   *
   * Instance-only, like `setRemoteCaretLabelHost`, and tolerated at any time: a host set
   * before the open applies when the first pages show. `DocxEditor.Loading` with `overlay`
   * registers one for you, so set this only when you build your own loading screen.
   *
   * @example
   * ```ts
   * editor.setOpeningIndicatorHost({
   *   publish(element) {
   *     element?.replaceChildren(document.createTextNode('Opening…'));
   *   },
   * });
   * ```
   */
  setOpeningIndicatorHost(host: OpeningIndicatorHost | null): void;
  /**
   * Monotonic version of the observable editor state. Bumps whenever anything
   * `snapshot()` reports could have moved — a committed change, a selection move, zoom,
   * load success or failure, attach/detach, destroy. An external store (React's
   * `useSyncExternalStore`) uses it as a cheap "did anything change" signal; `snapshot()`
   * itself is cached per version and returns a stable reference between bumps.
   */
  stateVersion(): number;
  /**
   * Which measurer the current document's layout runs on, and whether shaped
   * resolution is still in flight — the honest "are wrap points Word-accurate yet?"
   * readout a host shows instead of guessing. `fixed` with `resolving: false` is the
   * steady state for a document with no usable font source (the documented zero-config
   * fallback); `shaped` means HarfBuzz measurement over real font bytes. Changes bump
   * `stateVersion()`.
   */
  fontMeasurement(): FontMeasurementState;
  /**
   * Every author the review surface DRAWS, in Word's slot order, with the colour the review
   * chrome draws them in. The discovery surface a legend or colour picker builds on —
   * authors depend on the loaded file, so they cannot be known at configuration time.
   *
   * The colour is the author's, not the document's: under `'kind'` the painted text goes to
   * the insertion/deletion colours while the cards keep these accents, so a legend built
   * from this describes the rail rather than the page.
   *
   * BOTH HALVES OF REVIEW. Authors of tracked changes come first, numbered by where their
   * first change appears; authors who only commented follow. One person therefore draws in
   * one colour across their comments and their edits, which is what a reader assumes the
   * moment they learn the pairing on either. The order puts commenters last so that adding
   * a comment can never renumber a tracked change the painter has already drawn.
   *
   * The complete attached-document roster. A reviewer remains listed while this view hides
   * their changes, so the reviewer menu can turn them on again. Empty while detached.
   * Reference-stable between changes, so it is safe as a dependency; changes bump
   * `stateVersion()`.
   */
  getReviewAuthors(): readonly ReviewAuthorInfo[];
  /** Whether this author's revisions and comments are shown in the current review view. */
  isReviewAuthorVisible(author: string): boolean;
  /**
   * Show one author's markup, or render their revisions as accepted and hide their comments.
   * This changes view state only. It does not apply tree operations or change saved bytes.
   */
  setReviewAuthorVisible(author: string, visible: boolean): void;
  /** Show or hide every reviewer in one layout pass. */
  setAllReviewAuthorsVisible(visible: boolean): void;
  /** Restore every reviewer to the shown state. */
  showAllReviewAuthors(): void;
  /**
   * The presence colour the engine paints for one display name — the answer the remote
   * caret label takes, so chrome built on this cannot disagree with the painted caret.
   *
   * A name the review roster draws takes its resolved colour, sanitized exactly as the
   * paint sink sanitizes it: a declared colour the paint refuses falls to the author's
   * ramp-slot token. Any other name takes the next slot from the engine's stable
   * allocator, in first-resolution order, and keeps it for the session. While no document
   * is attached this returns `'var(--doc-accent)'`, the same default the overlay CSS
   * falls back to.
   */
  presenceColorFor(name: string): string;
  /**
   * The live collaboration replica, or null when this editor is not in a room.
   *
   * Presence chrome reads it from here rather than being handed it: the editor already holds
   * the session a `collaborationModule` contributed, so a host that threads it down to every
   * avatar and caret consumer is passing something the tree below it can already see.
   */
  collaborationSession(): EditorCollaborationSession | null;
  /**
   * The configured author used when a comment or reply omits an explicit author.
   *
   * @internal Review compose chrome uses this to draw an unfinished comment in the same
   * author colour it will receive after commit.
   */
  getConfiguredAuthor(): string | null;
  /**
   * Set the author for runtime editor state.
   *
   * Unlike the construction-time {@link DocxEditorConfig.author}, this value applies to every
   * later comment, reply, and tracked change. It does not rewrite existing revisions. The value
   * survives document reloads and font remounts. An empty or whitespace value clears the author,
   * after which suggesting refuses writes with its existing reason.
   *
   * Naming an author also completes a request for suggesting that was refused for want of
   * one — a `mode: 'suggesting'` or a document's `w:trackRevisions` that opened in editing —
   * unless the reader has chosen a mode since.
   *
   * @public
   */
  setAuthor(author: string | undefined): void;
  /**
   * Set the host editing mode without rebuilding the editor.
   *
   * This has the same meaning as {@link DocxEditorConfig.mode}. Passing `undefined` lets the
   * document's tracking settings select the mode again. A host change clears the reader's
   * toolbar choice, so a later document reload can adopt `w:trackRevisions` again.
   *
   * @public
   */
  setMode(mode: 'edit' | 'view' | 'suggesting' | undefined): void;
  /**
   * Set the drawing and form-control label resolver without rebuilding the editor.
   * Open dialogs preserve their controls and input; later surface mounts use the same resolver.
   *
   * @public
   */
  setTranslate(
    translate: ((key: string, params?: Record<string, string | number>) => string) | undefined
  ): void;
  /**
   * Set regional date input and generated labels without rebuilding the editor.
   * Stored dates are preserved; an in-progress field edit retains its starting locale.
   * Omitted, invalid, and unsupported locales use en-US. Translation catalogues fall back by language.
   *
   * @public
   */
  setLocale(locale: string | undefined): void;
  /**
   * The style declared for one author, whether or not the SURFACE has published them yet —
   * so review chrome can draw a card the rail is holding before the roster catches up.
   *
   * {@link DocxEditorInstance.getReviewAuthors} answers for every author of a tracked
   * change or a comment, so this is a narrow fallback rather than the way to reach a
   * commenter.
   *
   * @internal The seam `@docx-editor.dev/pro`'s review rail resolves those authors
   * through. A consumer reads `useReviewAuthor` (pro) or `useReviewAuthors` (react)
   * instead; nothing here answers a question those two do not.
   */
  getReviewAuthorStyle(author: string): RevisionAuthorStyle | undefined;
  /**
   * Replace how tracked changes are coloured, live. Paint-level: pages repaint without a
   * layout pass, and the caret, selection and undo history stay where they are. Pass
   * `'author'` to restore the default, or `'kind'` to opt out to the green/red
   * rendering. Survives a document reload.
   *
   * The imperative PRIMITIVE beneath React's declarative lane: `DocxEditor.ColorByChangeType`
   * and `DocxEditor.AuthorStyle` drive this seam, and React hosts declare those instead
   * of calling it. Call it directly from headless and non-React hosts.
   */
  setRevisionStyles(styles: RevisionStyles): void;
  /** Replace registrations while preserving document edits and undo history. */
  setUnsupportedElementRules(rules: readonly UnsupportedElementRule[]): void;
  /** Merge local preferences and emit revisionMarkupChange after a change.
   * Invalid settings throw TypeError without changing the previous settings.
   */
  setRevisionMarkup(options: RevisionMarkupOptions): void;
  /**
   * Change the review pane settings: every field of `ReviewPaneOptions`, such as when the
   * pane opens by itself and what it does when its card column does not fit. An omitted
   * field keeps its value. Read the settings in force
   * from `snapshot().reviewPane`. They stay in force across `load()` and are never saved into
   * the document. This sets how the pane behaves; to open or close the pane itself, use
   * `useReview().setPaneOpen` or the `toggleReviewPane` command.
   *
   * Returns `changed: false` on success, like every view-only call, because `changed` answers
   * for the document; to detect a settings change, compare the `snapshot().reviewPane`
   * reference, which changes only when a setting changes. Refused with `unsupported` when no review module is registered, and
   * with `invalidArgs` for an unknown field or value. A refusal changes nothing.
   *
   * @example
   * ```ts
   * const result = editor.setReviewPaneOptions({ opening: 'manual', overflow: 'shrinkPage' });
   * if (!result.ok) console.warn(result.reason);
   * ```
   */
  setReviewPaneOptions(options: ReviewPaneOptions): ExecResult;
  /**
   * Mount into `el`, which may belong to another document: a pop-out window opened with
   * `window.open`, or a same-origin iframe.
   *
   * A document that is already open MOVES into `el`, from another element or from a
   * previous `detach()`: the undo history, the selection, other editing state (such as an
   * armed format painter) and any collaboration session stay as they are. The reading
   * position is kept, and keyboard focus returns when the pages had it before (see
   * {@link AttachOptions.focus}). Focus, selection, pointer, scroll and resize listeners,
   * timers and registered font faces follow `el`'s window. Pending document bytes (an
   * instance created without a container, or a `load` while detached) mount now instead, as
   * a fresh session.
   *
   * The host copies the editor stylesheet and any web fonts it loads into `el`'s document.
   * Move the editor back, or `destroy()` it, before that window closes. An element whose
   * window has closed (or that has no window) is refused with an `invalidTarget` error and
   * the editor stays where it is. After `destroy()` this is a no-op that emits a typed
   * `error` event: a destroyed instance never remounts.
   *
   * @example
   * ```ts
   * // Pop the editor out into its own window and bring it back later.
   * const popup = window.open('', 'editor', 'width=900,height=1000')!;
   * copyStyles(document, popup.document); // host-owned: the editor CSS and fonts
   * const slot = popup.document.createElement('div');
   * popup.document.body.append(slot);
   * editor.attach(slot);
   * popup.addEventListener('pagehide', () => editor.attach(mainSlot), { once: true });
   * ```
   */
  attach(el: HTMLElement, options?: AttachOptions): void;
  /**
   * Take the editor out of its element and keep it, with its undo history, selection and
   * collaboration session, for a later `attach`. While detached the instance still saves,
   * runs commands and receives remote edits; it paints when attached again. A `load` while
   * detached replaces the kept document. `destroy()` releases everything. No-op when already
   * detached or destroyed.
   */
  detach(): void;
}
