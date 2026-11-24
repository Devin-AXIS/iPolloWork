import type { UnsupportedElementRule } from '../layout/unsupported-content-types.ts';
import type { ResolvedRevisionMarkup } from '../contracts/revision-markup.ts';
// What `openPaginated` takes: the options record of the paginated surface.
//
// Split from `paginated-surface-contract.ts`, which is long enough to hold the surface
// interface alone; the record is only ever read at open time, and every consumer imports it
// from the contract, which re-exports it.

import type { ReviewDisplayMode } from '../layout/revision-projection.ts';
import type { FieldResultsMode } from '../store/package/field-result-mode.ts';
import type { RevisionStyles } from '../output/revision-presentation.ts';
import type { FieldShadingMode } from '../output/semantic-paint.ts';
import type {
  ReviewModuleContribution,
  CollaborationModuleContribution,
} from '../contracts/modules.ts';
import type { EquationActivation } from './surface-equations.ts';
import type { HyperlinkActivation } from './surface-navigation.ts';
import type { BookmarkMarkOptionsSource } from './bookmark-chrome.ts';
import type { TextMeasurer } from '@docx-editor.dev/core/layout';
import type { ContentLockPolicy } from '../store/package/ooxml-edit.ts';
import type { PaginatedSurfaceState, SurfaceEditingMode } from './paginated-surface-contract.ts';
import type { TableInteractionLabelKey } from '../contracts/editor.ts';

/**
 * How the caret moves through an inline content control whose effective lock is
 * `contentLocked` or `sdtContentLocked`.
 *
 * - `'characters'` (the default) — the caret walks through the control's characters, as in Word.
 * - `'atomic'` — the control is one caret unit, as a `w:showingPlcHdr` prompt already is. Arrows
 *   step over it, Shift+arrows select it whole, and a press or double click inside it selects it
 *   whole. A press on its edge still places a caret beside it.
 *
 * It applies in the body, headers and footers; notes and text boxes publish no control
 * boundaries, so they keep character navigation.
 *
 * Navigation only: what a lock refuses does not change. The rule covers keyboard motions and
 * the engine's own pointer gestures. A selection set in code (`setSelection`, find) is kept as
 * given, and `pointer: 'native'` leaves caret placement to the browser.
 *
 * @public
 */
export type LockedControlNavigation = 'characters' | 'atomic';

/**
 * How a paginated surface opens. Every field is optional.
 *
 * `measurer` is the injection seam that keeps layout DOM-free — supply one to lay a document out
 * on a server, or leave it off in a browser to get the canvas measurer.
 */
export interface PaginatedSurfaceOptions {
  /** Native drop notifications run before the default insertion. @internal */
  readonly onDragEvent?: (
    kind: 'dragOver' | 'drop',
    event: DragEvent,
    position: import('../layout/semantic-interaction.ts').SemanticPosition
  ) => void;
  /** UI labels for shared form controls; omitted keys fall back to English. */
  readonly translate?: (key: string, params?: Record<string, string | number>) => string;
  /** Regional conventions for new date input; defaults to en-US. */
  readonly locale?: string;
  /**
   * The collaboration module's replica for this surface's session. Absent,
   * the surface does not attach, and local store history remains the undo
   * authority.
   */
  readonly collaborationModel?: CollaborationModuleContribution;
  /**
   * How saved field results are edited. `atomic` (the default) keeps every field one unit.
   * `editable` lets the reader type, delete, and select inside the saved result of a DATE,
   * MERGEFIELD, HYPERLINK, or similar field. Results must be unnested; simple fields inside
   * complex field results are not supported. Refused with a {@link collaborationModel}.
   */
  readonly fieldResults?: FieldResultsMode;
  readonly measurer?: TextMeasurer;
  /** Ambient author for tracked edits. Required before suggesting can write anything. */
  readonly author?: string;
  /** Opening mode; changeable at runtime with `setEditingMode`. */
  readonly editingMode?: SurfaceEditingMode;
  /**
   * True while the active band covers both halves of a replacement: when the review UI lists
   * a replacement as one card, or while an activation of the whole replacement holds. Read
   * on each band paint. Set by the editor; a host changes `revisionsIn` instead.
   *
   * @internal
   */
  readonly pairsReplacements?: () => boolean;
  /**
   * Identifies the measurer for cache invalidation.
   *
   * Fonts resolve asynchronously, so a host that swaps its measurer must change this or the
   * cached pre-font layout is served for the rest of the session.
   */
  readonly producer?: string;
  /**
   * Maps a document-declared font family to the alias its registered bytes live under, so
   * painted runs can use embedded glyphs without the file's family name entering the
   * page-global CSS font namespace.
   */
  readonly fontAlias?: (family: string) => string | undefined;
  /** Points to CSS pixels. */
  readonly scale?: number;
  /**
   * How revisions project into layout and paint. Omitted keeps the layout default
   * (`all-markup`). The editor facade passes `proposed` when no review module is
   * registered — the free tier's final-state rendering; the machinery below this
   * option is shared either way.
   */
  readonly revisionDisplayMode?: ReviewDisplayMode;
  /** Authors whose changes open in their accepted view-time projection. */
  readonly hiddenRevisionAuthors?: readonly string[];
  /**
   * When a field's result wears Word's grey shading. Omitted keeps Word's own default,
   * `when-selected`.
   *
   * Applies to ORDINARY fields only. Legacy form fields follow the document's
   * `w:doNotShadeFormData`, because a form's blanks are the document's own statement about
   * itself rather than a reader's preference.
   *
   * A paint-level option, not a layout one: it changes no geometry, so switching it repaints
   * without remeasuring a single line.
   */
  readonly fieldShading?: FieldShadingMode;
  /** Show paragraph-end furniture without changing document content. */
  readonly showParagraphMarks?: boolean;
  readonly onToggleParagraphMarks?: () => void;
  /** Show bracket marks at bookmarks. Paint-level; the document does not change. */
  readonly showBookmarks?: boolean;
  /**
   * How tracked changes are coloured: by AUTHOR (the default), by kind, or by author with
   * host-pinned colours. A paint-level option like {@link fieldShading}: it changes no
   * geometry, so switching it repaints without remeasuring a line. Applies wherever
   * revision markup paints, whatever the {@link revisionDisplayMode} leaves visible.
   */
  readonly revisionStyles?: RevisionStyles;
  readonly unsupportedElementRules?: readonly UnsupportedElementRule[];
  readonly revisionMarkup?: ResolvedRevisionMarkup;
  /**
   * The review module's derivation hooks for this surface's session. Absent,
   * `session.reviewItems()` is the typed empty queue and every review affordance
   * built on it stays inert.
   */
  readonly reviewModel?: ReviewModuleContribution;
  /**
   * Opt-in relaxation of `w:lock` for run-property writes: `contentLocked` / `sdtContentLocked`
   * controls can be restyled (toolbar, shortcuts, automation `setFont`) but not retyped.
   * Absent, they refuse both, as ECMA-376 / Word do.
   */
  readonly contentLockPolicy?: ContentLockPolicy;
  /**
   * The family a run with no authored font is reported as by `formatting()` AND painted
   * in — the face the measurer falls back to. Absent, such a run reports
   * `fontFamily: null` and paints in whatever font the page inherits, which the measurer
   * did not measure: visible glyphs drift from wrap points and caret geometry.
   */
  readonly defaultFontFamily?: string;
  /**
   * Who resolves a pointer to a caret.
   *
   * `'engine'` (the default) answers from the layout records, which is what makes a click in
   * a margin, an indent or a cell's padding land where it was aimed. `'native'` binds no
   * pointer handlers and leaves the browser's own caret placement in charge.
   */
  readonly pointer?: 'engine' | 'native';
  /** How the caret moves through a content-locked inline control; see `LockedControlNavigation`. */
  readonly lockedControlNavigation?: LockedControlNavigation;
  readonly onChange?: (state: PaginatedSurfaceState) => void;
  /**
   * Told each time an edit is refused, with the raw reason: a store code such as `'locked'`,
   * or the surface's own refusal sentence. The raw reason can be a sentence, so a listener
   * maps it to a public code before it reports anything.
   */
  readonly onRejection?: (reason: string) => void;
  /**
   * The pages turned up in another document without a `moveTo`: a host moved the mount
   * element itself (a Vue `Teleport` retargeted, or a plain `appendChild`). The surface has
   * already re-bound its own listeners; the owner re-registers what is per document.
   */
  readonly onHostMoved?: (document: Document) => void;
  /**
   * Told the milliseconds of each layout pass and each paint. For `'input'`, told the browser
   * timestamp of each key press or pointer press on the pages, so a listener can time it to
   * the next frame. Numbers only.
   */
  readonly onTiming?: (phase: 'layout' | 'paint' | 'input', value: number) => void;
  /**
   * Told once for each local edit that changed the document, with `typing` true for buffered
   * typing, which can land inside a later command's commit. Remote edits are not local.
   */
  readonly onEdit?: (typing: boolean) => void;
  /**
   * A plain click on an external (or inert) hyperlink, for a host to open its popover with.
   *
   * Absent means such a click does nothing. That is deliberate: a host with no popover
   * mounted must not have clicks silently opening tabs, and the popover is the only path to
   * activation (see the navigation module's single `window.open` gate).
   */
  readonly onHyperlinkPopover?: (activation: HyperlinkActivation) => void;
  readonly onEquationPopover?: (activation: EquationActivation) => void;
  /**
   * Ctrl/Cmd+K — Word's Insert Hyperlink. The engine reports the request; the host's chrome
   * decides what a link dialog looks like. A host that passes nothing leaves the key alone
   * rather than doing something surprising with it. Answering `false` leaves it alone too.
   */
  readonly onRequestHyperlink?: () => boolean | void;
  /**
   * Ctrl/Cmd+Shift+F5: open the host's bookmark dialog. Answers whether chrome took the
   * request; when none did, or when this is absent, the key is left to the browser.
   */
  readonly onRequestBookmark?: () => boolean;
  /** Ctrl+G (Cmd+Option+G on macOS): open the host's Go To UI; answers whether chrome took it. */
  readonly onRequestGoTo?: () => boolean;
  /**
   * The host's Show bookmarks options, read on every paint. `onChange` names the repaint to
   * run when the host changes them.
   */
  readonly bookmarkMarks?: BookmarkMarkOptionsSource;
  /** Return true when host chrome handles this session. */
  readonly onRequestTextFormField?: (
    session: import('./text-form-field-session.ts').TextFormFieldDialogSession
  ) => boolean;
  readonly onRequestContentControlWidget?: (
    session: import('./popup-sessions.ts').ContentControlWidgetSession
  ) => boolean;
  readonly onRequestInvalidTextFormField?: (
    session: import('./popup-sessions.ts').InvalidTextFormFieldSession
  ) => boolean;
  /**
   * Localized accessible names for core-owned table insertion furniture.
   * Defaults to English from `@docx-editor.dev/i18n` when omitted.
   */
  readonly tableInteractionLabel?: (key: TableInteractionLabelKey) => string;
  /** Localized drawing refusal labels; defaults to English when omitted. */
  readonly drawingStrings?: import('../output/semantic-paint-drawings.ts').DrawingPaintStrings;
  /** Override raster decode for package image intents; defaults to browser/headless. */
  readonly imageDecodePort?: import('../store/package/image-resources.ts').ImageDecodePort;
  /**
   * Localized name for a generated TOC, written as the control's `w:alias` on insert.
   *
   * The update ACTIONS are not here: they are rows in the host's context menu, which owns
   * its own labels. The engine paints no menu of its own.
   */
  readonly tocLabels?: { readonly title: string };
}
