import { flattenChromeMenuSlots } from './chrome-menu-slots.ts';
import { FILE_CHROME_GROUP } from './file-chrome-controls.ts';
import { REVIEW_CHROME_GROUP } from './review-chrome-controls.ts';
import { INSERT_CHROME_GROUP } from './insert-chrome-controls.ts';
import { CHART_CHROME_GROUP, SHAPE_CHROME_GROUP } from './object-chrome-controls.ts';
import type { ChromeMenu } from './chrome-menu-entries.ts';
// Legacy editor chrome, expressed as data (interactive-paginated-editing M6V.1).
//
// M6V.1 reproduces the complete user-visible legacy chrome from archaeology ref
// 9bb06c38f43c0dc297e3de8b5b488b241e134be1 on the greenfield demos. Everything
// here is PRESENTATION ONLY: icon geometry, grouping, ordering, and i18n keys.
// There is no ProseMirror, no legacy painter, no DOM-selection authority, and no
// adapter-owned geometry — a control's enabled state comes from `Editor.can` and
// nothing else.
//
// It lives in engine-editor rather than in either adapter because React and Vue
// MUST render the same chrome. The repo rule is that platform-agnostic logic
// belongs in the shared layer and is called by both adapters, not duplicated; a
// previous round of this change grew 24 React-only exports precisely by ignoring
// that, and no test caught it until a full-repo export-parity sweep.
//
// Icon paths are the Material Symbols set (viewBox "0 -960 960 960"), extracted
// programmatically rather than retyped, because a hand-copied path is a silent
// visual regression that no assertion would catch.
//
// SLOT IDS ARE THE STABLE PUBLIC CONTRACT.
//
// Every control is addressed as `${groupId}.${controlId}` — `text.bold`,
// `font.family`, `alignment.left`. These slot ids are the vocabulary a host uses
// to place, replace, or hide chrome (Radix-style composition), and the key
// `commandForSlot` resolves to an engine command. They are literal-typed
// (`ChromeSlotId`) so a typo is a compile error, and they are PUBLIC API FOREVER:
// renaming a group or control id is a breaking change. Control ids are unique
// within their group, not globally — `image.insert` and `table.insert` coexist —
// so anything keyed on a control (test ids, icon registries) must key on the
// SLOT id, never the bare control id.

import { GENERATED_ICON_PATHS } from './generated-icon-paths.ts';
import type { ImageContext } from '@docx-editor.dev/core/contracts/editor';

/**
 * HOW a control reaches the engine — never WHETHER it is enabled.
 *
 * Enabled state has exactly one source: `toolbarCommandState(editor, slot)`, which
 * asks `Editor.can`. The registry is static data and cannot know what the engine
 * will honour at this selection, in this document, at this moment.
 *
 * There used to be a fourth member, `parityOnly`, meaning "visible but permanently
 * disabled". It was a second, static answer to the question `Editor.can` already
 * answers, and it went stale the moment the engine wired underline, strike, the four
 * alignments, the list commands and the four value slots: the registry still said
 * parity-only, React ignored it and ran them, and Vue believed it and rendered twelve
 * WORKING commands permanently disabled. A slot the engine has not wired needs no
 * registry flag — `commandForSlot` answers null and `toolbarCommandState` disables the
 * control with the engine's own words ("not wired to an editor command").
 */
export type ChromeControlState =
  /**
   * Dispatched as one fixed engine command: enabled when
   * `Editor.can(commandForSlot(slot))` succeeds, a click runs
   * `runToolbarCommand(editor, slot)`. The command is resolved from the SLOT id
   * through `commandForSlot` in toolbar-commands.ts — the one command table both
   * adapters share. A slot with no row there is simply not wired YET, and says so
   * through the engine rather than through this descriptor.
   */
  | { readonly kind: 'command' }
  /**
   * Dispatched with a PICKED value: `commandForSlotValue(slot, value)`. Enabled when
   * the engine would honour a well-formed value right now (`toolbarCommandState`
   * probes for exactly that), so the control needs chrome that produces a value — a
   * font list, a size, a colour — before a click means anything.
   *
   * A distinct kind because 'command' cannot describe it: there is no fixed command
   * to hand `Editor.can`, and a bare click has nothing to send.
   */
  | { readonly kind: 'value' }
  /** `Editor.save()` — not a command (see `runSave`). */
  | { readonly kind: 'save' }
  /**
   * `Editor.load()` — not a command either, and the exact twin of `save`: bytes cross the
   * boundary between the host and the engine, and only the host can produce them. The
   * control needs chrome that reads a file (a picker, a drop target) before a click means
   * anything, so a bare click has nothing to send — the same reason `save` is not `command`.
   *
   * A fourth kind rather than reusing `save` because the two dispatch in opposite
   * directions, and an adapter branching on `kind` must be able to tell them apart. Unlike
   * the deleted `parityOnly`, this one IS named by a control (`file.open`).
   */
  | { readonly kind: 'load' }
  /** Host conversion through `runChromeExport` or `runChromePrint`; not an editing command. */
  | { readonly kind: 'export' };

/**
 * The SHAPE a control renders as (task M6V.1).
 *
 * The legacy toolbar is not a row of uniform icon buttons: it mixes labelled dropdowns
 * (`Normal`, `Arial`, alignment, line spacing), numeric steppers with visible values
 * (zoom `- 100% +`, size `- 26 +`), split colour controls (a glyph over a colour swatch
 * with its own caret), and a mode pill (`Editing`). Rendering all of them as icon
 * buttons is the difference an owner review called out as "not visual parity" — the
 * regions were all present and it still did not look like the product.
 */
/** `modePill` is deliberately absent. It was declared, never used by any control, and
 *  rendered nothing — the editing-mode control below is a `dropdown`, which is what the
 *  legacy product shows. A shape no descriptor names is a branch adapters must implement
 *  and can never exercise. */
export type ChromeControlShape = 'icon' | 'stepper' | 'dropdown' | 'colorSplit';

/**
 * One toolbar control as the registry describes it — what it renders as, never whether it is
 * enabled.
 *
 * Enabled state has exactly ONE source, `toolbarCommandState`, which asks the engine. A
 * descriptor carrying its own disabled flag would be a second answer that goes stale the moment
 * the engine wires the slot.
 *
 * @public
 */
export interface ChromeControl<Id extends string = string> {
  /** Stable control id, unique WITHIN its group. Public API; renames are breaking. */
  readonly id: Id;
  /** How it renders. Defaults to `icon`. */
  readonly shape?: ChromeControlShape;
  /** Displayed value for a stepper or dropdown (an i18n key, or a literal for numbers). */
  readonly valueText?: string;
  /** Swatch colour for a `colorSplit` control. */
  readonly swatch?: string;
  /** i18n key for the accessible name and tooltip. Never hardcoded English. */
  readonly labelKey: string;
  /** Material Symbols path data, or null for a non-icon control (a picker). */
  readonly paths: readonly string[] | null;
  /** For pickers: the i18n key of the placeholder value shown. */
  readonly valueKey?: string;
  /** `false` keeps this public slot composable but omits it from the default toolbar. */
  readonly defaultToolbar?: false;
  readonly state: ChromeControlState;
}

/**
 * One toolbar group: the taxonomy both adapters derive their default arrangement FROM.
 *
 * Never hand-list controls in an adapter — a default toolbar is built by walking `CHROME_GROUPS`,
 * so a slot added here appears in React and Vue without either being edited.
 *
 * @public
 */
export interface ChromeGroup<Id extends string = string, ControlId extends string = string> {
  /** Stable group id. Public API; renames are breaking. */
  readonly id: Id;
  readonly labelKey: string;
  /**
   * Not part of the DEFAULT toolbar arrangement. The chrome spec shows these
   * controls only in a context the engine does not model yet (an image or table
   * selection), or not at all (save belongs in the host's File menu, never in the
   * bar). Their slots stay public for composition — a host can still place
   * `image.insert` or `file.save` explicitly — but the default chrome is the
   * registry's default bar, which ends at the editing-mode picker.
   */
  readonly contextual?: true;
  readonly controls: readonly ChromeControl<ControlId>[];
}

/**
 * The complete chrome, in bar order. Literal-typed (`as const`) so the slot-id
 * vocabulary below is derived from the data and cannot drift from it.
 *
 * Taxonomy taste: ids are short, lowercaseCamel, and never repeat their group's name
 * (`alignment.left`, not `alignment.alignLeft`; `font.family`, not `font.fontFamily`).
 */
export const CHROME_GROUPS = [
  {
    id: 'history',
    labelKey: 'formattingBar.groups.history',
    controls: [
      {
        id: 'undo',
        labelKey: 'formattingBar.undoShortcut',
        paths: GENERATED_ICON_PATHS['undo'],
        state: { kind: 'command' },
      },
      {
        id: 'redo',
        labelKey: 'formattingBar.redoShortcut',
        paths: GENERATED_ICON_PATHS['redo'],
        state: { kind: 'command' },
      },
    ],
  },
  {
    id: 'zoom',
    labelKey: 'formattingBar.groups.zoom',
    controls: [
      {
        // Zoom is facade state, not a command and not a mark value: the chrome that
        // drives it calls `Editor.setZoom` and reads `snapshot().zoom` (React's zoom
        // stepper does exactly that). No kind describes that dispatch, and inventing
        // one for a single control would add a branch adapters must implement and only
        // one slot could ever exercise — so this stays 'command', where the shared
        // helper reports the honest "not wired to an editor command" for chrome that
        // has no zoom wiring of its own.
        id: 'level',
        shape: 'stepper',
        valueText: '100%',
        labelKey: 'formattingBar.groups.zoom',
        paths: null,
        valueKey: 'zoom.zoomLevel',
        state: { kind: 'command' },
      },
    ],
  },
  {
    id: 'styles',
    labelKey: 'formattingBar.groups.styles',
    controls: [
      {
        id: 'style',
        shape: 'dropdown',
        labelKey: 'styles.selectAriaLabel',
        paths: null,
        valueKey: 'styles.normalText',
        state: { kind: 'value' },
      },
    ],
  },
  {
    id: 'font',
    labelKey: 'formattingBar.groups.font',
    controls: [
      {
        id: 'family',
        shape: 'dropdown',
        labelKey: 'font.selectAriaLabel',
        paths: null,
        valueKey: 'font.sansSerif',
        state: { kind: 'value' },
      },
      {
        id: 'size',
        shape: 'stepper',
        valueText: '11',
        labelKey: 'fontSize.listLabel',
        paths: null,
        valueKey: 'fontSize.label',
        state: { kind: 'value' },
      },
    ],
  },
  {
    id: 'text',
    labelKey: 'formattingBar.groups.textFormatting',
    controls: [
      {
        id: 'bold',
        labelKey: 'formattingBar.boldShortcut',
        paths: GENERATED_ICON_PATHS['format_bold'],
        state: { kind: 'command' },
      },
      {
        id: 'italic',
        labelKey: 'formattingBar.italicShortcut',
        paths: GENERATED_ICON_PATHS['format_italic'],
        state: { kind: 'command' },
      },
      {
        id: 'underline',
        labelKey: 'formattingBar.underlineShortcut',
        paths: GENERATED_ICON_PATHS['format_underlined'],
        state: { kind: 'command' },
      },
      {
        id: 'strike',
        labelKey: 'formattingBar.strikethrough',
        paths: GENERATED_ICON_PATHS['strikethrough_s'],
        state: { kind: 'command' },
      },
      {
        // The chrome spec renders font colour INSIDE the text-formatting group,
        // right after strikethrough (B I U S, then text colour, highlight, link).
        // The swatch is the default red the apply half is seeded with before any
        // pick ({ rgb: 'FF0000' }).
        id: 'color',
        shape: 'colorSplit',
        swatch: '#ff0000',
        labelKey: 'formattingBar.fontColor',
        paths: GENERATED_ICON_PATHS['format_color_text'],
        state: { kind: 'value' },
      },
      {
        id: 'highlight',
        shape: 'colorSplit',
        swatch: '#ffff00',
        labelKey: 'formattingBar.highlightColor',
        paths: GENERATED_ICON_PATHS['ink_highlighter'],
        state: { kind: 'value' },
      },
      {
        id: 'link',
        labelKey: 'formattingBar.insertLinkShortcut',
        paths: GENERATED_ICON_PATHS['link'],
        state: { kind: 'command' },
      },
    ],
  },
  {
    id: 'script',
    labelKey: 'formattingBar.groups.script',
    // The PLAIN labels, not the `...Shortcut` ones that spell out "(Ctrl+=)" and
    // "(Ctrl+Shift+=)". React's live zoom owns Ctrl/Cmd `=` and its shifted spelling, so a
    // tooltip naming that chord here would send a React user to a keystroke that zooms. Both
    // toggles stay reachable from the button the label is on, and the engine keymap still
    // binds the chord for a host that mounts no zoom handler — under-advertising a shortcut
    // some hosts keep is the truthful trade against advertising one that no longer applies.
    controls: [
      {
        id: 'super',
        labelKey: 'formattingBar.superscript',
        paths: GENERATED_ICON_PATHS['superscript'],
        state: { kind: 'command' },
      },
      {
        id: 'sub',
        labelKey: 'formattingBar.subscript',
        paths: GENERATED_ICON_PATHS['subscript'],
        state: { kind: 'command' },
      },
    ],
  },
  {
    // The chrome spec renders this whole group as ONE dropdown (icon + caret
    // opening a four-option panel), not four buttons. The four slots stay — a host
    // composes `alignment.left` etc. individually — only the DEFAULT rendering
    // merges them; adapters key the merge on this group's id.
    id: 'alignment',
    labelKey: 'formattingBar.groups.alignment',
    controls: [
      {
        id: 'left',
        labelKey: 'alignment.alignLeft',
        paths: GENERATED_ICON_PATHS['format_align_left'],
        state: { kind: 'command' },
      },
      {
        id: 'center',
        labelKey: 'alignment.center',
        paths: GENERATED_ICON_PATHS['format_align_center'],
        state: { kind: 'command' },
      },
      {
        id: 'right',
        labelKey: 'alignment.alignRight',
        paths: GENERATED_ICON_PATHS['format_align_right'],
        state: { kind: 'command' },
      },
      {
        id: 'justify',
        labelKey: 'alignment.justify',
        paths: GENERATED_ICON_PATHS['format_align_justify'],
        state: { kind: 'command' },
      },
    ],
  },
  {
    id: 'direction',
    labelKey: 'formattingBar.groups.direction',
    contextual: true,
    controls: [
      {
        id: 'ltr',
        labelKey: 'toolbar.leftToRight',
        paths: GENERATED_ICON_PATHS['format_textdirection_l_to_r'],
        state: { kind: 'command' },
      },
      {
        id: 'rtl',
        labelKey: 'toolbar.rightToLeft',
        paths: GENERATED_ICON_PATHS['format_textdirection_r_to_l'],
        state: { kind: 'command' },
      },
    ],
  },
  {
    id: 'list',
    labelKey: 'formattingBar.groups.listFormatting',
    controls: [
      {
        id: 'bullet',
        labelKey: 'lists.bulletList',
        paths: GENERATED_ICON_PATHS['format_list_bulleted'],
        state: { kind: 'command' },
      },
      {
        id: 'numbered',
        labelKey: 'lists.numberedList',
        paths: GENERATED_ICON_PATHS['format_list_numbered'],
        state: { kind: 'command' },
      },
      {
        id: 'outdent',
        labelKey: 'lists.decreaseIndent',
        paths: GENERATED_ICON_PATHS['format_indent_decrease'],
        state: { kind: 'command' },
      },
      {
        id: 'indent',
        labelKey: 'lists.increaseIndent',
        paths: GENERATED_ICON_PATHS['format_indent_increase'],
        state: { kind: 'command' },
      },
      {
        // The chrome spec groups line spacing WITH the list buttons, after
        // indent — not with alignment.
        id: 'lineSpacing',
        shape: 'dropdown',
        labelKey: 'lineSpacing.label',
        paths: GENERATED_ICON_PATHS['format_line_spacing'],
        state: { kind: 'command' },
      },
    ],
  },
  {
    // The chrome spec puts the formatting pair between the list group and the trailing
    // review controls, flanked by separators.
    id: 'format',
    labelKey: 'formattingBar.groups.format',
    controls: [
      {
        // Word's Format Painter, and a toggle with THREE resting states rather than two:
        // off, armed for one application, and locked on until Escape. The extra state is
        // not in this descriptor — `toolbarCommandState` reports it as the control's
        // `value`, the way the editing-mode pill reports which mode is live, because a
        // descriptor cannot know what the engine is holding at this moment.
        //
        // A press means "capture and arm", and a press that lands inside the engine's
        // double-press window means "lock". Both are one `runToolbarCommand` call: a host
        // that bound its own `dblclick` beside its own `click` would be a second place the
        // meaning of a double-click lives, and the two would drift.
        id: 'painter',
        labelKey: 'formattingBar.formatPainterShortcut',
        paths: GENERATED_ICON_PATHS['format_paint'],
        state: { kind: 'command' },
      },
      {
        id: 'clear',
        labelKey: 'formattingBar.clearFormatting',
        paths: GENERATED_ICON_PATHS['format_clear'],
        state: { kind: 'command' },
      },
    ],
  },
  REVIEW_CHROME_GROUP,
  {
    // Content-control authoring chrome (typed-content-controls). Show-all and form-fill are
    // surface toggles; inspector and remove are contextual to the caret control. Slot ids are
    // public forever — renaming any is a breaking change.
    id: 'contentControl',
    labelKey: 'contentControl.group',
    contextual: true,
    controls: [
      {
        id: 'showAll',
        labelKey: 'contentControl.showAll',
        paths: GENERATED_ICON_PATHS['visibility'],
        state: { kind: 'command' },
      },
      {
        id: 'formFill',
        labelKey: 'contentControl.formFill',
        paths: GENERATED_ICON_PATHS['edit_note'],
        state: { kind: 'command' },
      },
      {
        id: 'inspector',
        labelKey: 'contentControl.inspector',
        paths: GENERATED_ICON_PATHS['tune'],
        state: { kind: 'command' },
      },
      {
        id: 'remove',
        labelKey: 'contentControl.remove',
        paths: GENERATED_ICON_PATHS['delete'],
        state: { kind: 'command' },
      },
    ],
  },
  {
    id: 'image',
    labelKey: 'formattingBar.groups.image',
    contextual: true,
    controls: [
      {
        id: 'insert',
        labelKey: 'toolbar.image',
        paths: GENERATED_ICON_PATHS['image'],
        state: { kind: 'command' },
      },
      {
        id: 'properties',
        labelKey: 'formattingBar.imagePropertiesShortcut',
        paths: GENERATED_ICON_PATHS['tune'],
        state: { kind: 'command' },
      },
      {
        // Opens the Chart pane for the selected chart (`requestPane`).
        id: 'editChart',
        labelKey: 'chart.edit',
        paths: GENERATED_ICON_PATHS['insert_chart'],
        state: { kind: 'command' },
      },
      {
        // Opens the Format shape pane for the selected shape (`requestPane`).
        id: 'formatShape',
        labelKey: 'shape.formatShape',
        paths: GENERATED_ICON_PATHS['format_color_fill'],
        state: { kind: 'command' },
      },
      {
        id: 'wrap',
        shape: 'dropdown',
        labelKey: 'formattingBar.imageWrap',
        paths: GENERATED_ICON_PATHS['wrap_text'],
        valueKey: 'imageWrap.inline',
        state: { kind: 'value' },
      },
      {
        id: 'altText',
        shape: 'dropdown',
        labelKey: 'formattingBar.altText',
        paths: null,
        valueKey: 'imageProperties.altText',
        state: { kind: 'value' },
      },
    ],
  },
  SHAPE_CHROME_GROUP,
  CHART_CHROME_GROUP,
  {
    id: 'table',
    labelKey: 'formattingBar.groups.table',
    contextual: true,
    controls: [
      {
        id: 'insert',
        labelKey: 'toolbar.table',
        paths: GENERATED_ICON_PATHS['table'],
        state: { kind: 'command' },
      },
      {
        id: 'borderTarget',
        shape: 'dropdown',
        labelKey: 'table.borders.tooltip',
        paths: GENERATED_ICON_PATHS['border_all'],
        state: { kind: 'value' },
      },
      {
        id: 'borderColor',
        shape: 'colorSplit',
        swatch: '#000000',
        labelKey: 'table.borderColor',
        paths: GENERATED_ICON_PATHS['border_color'],
        state: { kind: 'value' },
      },
      {
        id: 'borderStyle',
        shape: 'dropdown',
        labelKey: 'table.borders.styleAriaLabel',
        paths: GENERATED_ICON_PATHS['border_horizontal'],
        state: { kind: 'value' },
      },
      {
        id: 'borderWidth',
        shape: 'dropdown',
        labelKey: 'table.borderWidth',
        paths: GENERATED_ICON_PATHS['line_weight'],
        state: { kind: 'value' },
      },
      {
        id: 'cellFill',
        shape: 'colorSplit',
        swatch: '#ffffff',
        labelKey: 'table.cellFillColor',
        paths: GENERATED_ICON_PATHS['format_color_fill'],
        state: { kind: 'value' },
      },
      {
        id: 'mergeCells',
        labelKey: 'table.mergeCells',
        paths: GENERATED_ICON_PATHS['call_merge'],
        state: { kind: 'command' },
      },
      // Opens the Split Cells dialog, which supplies the counts; see `chromeProbeForSlot`.
      {
        id: 'splitCell',
        labelKey: 'table.splitCell',
        paths: GENERATED_ICON_PATHS['call_split'],
        state: { kind: 'command' },
      },
    ],
  },
  {
    // The Paragraph dialog, and anything else that edits a paragraph by VALUE rather than
    // by step. Contextual for the same reason the File group is: the dialog belongs behind
    // a menu row, not in the formatting bar, and `formattingBarChromeGroups()` filters
    // contextual groups out so no button is rendered for it.
    //
    // A slot rather than a hand-rolled menu item so the row is addressable: hosts can hide,
    // reorder or override it like any other control, and its enabled state comes from
    // `toolbarCommandState` — the single source CLAUDE.md names — instead of a second
    // implementation beside it.
    id: 'paragraph',
    labelKey: 'dialogs.paragraph.title',
    contextual: true,
    controls: [
      {
        // Command-shaped without a fixed command, like `file.pageSetup`: whether this
        // selection's paragraphs can be reformatted is the engine's question, WHICH values
        // is the dialog's. Deliberately absent from `SLOT_COMMANDS` for the reason recorded
        // there — a row there would enable it in an adapter that has grown no dialog.
        id: 'dialog',
        labelKey: 'lineSpacing.options',
        // Carries an icon like `file.pageSetup` does, even though the packaged chrome
        // renders it as a labelled menu row: the registry models a control as icon-bearing
        // or as a picker, and a host arranging this slot itself needs a picture for it.
        paths: GENERATED_ICON_PATHS['format_line_spacing'],
        state: { kind: 'command' },
      },
    ],
  },
  FILE_CHROME_GROUP,
  INSERT_CHROME_GROUP,
] as const;

// `satisfies`-style conformance check, phrased as a plain annotated alias because the
// combined `as const satisfies readonly ChromeGroup[]` crashes API Extractor 7.x
// ("Unable to follow symbol for 'const'", rushstack#4614) when an adapter re-exports
// types derived from `typeof CHROME_GROUPS`. Same guarantee: every literal above must be
// a valid `ChromeGroup`, and the literals stay literal.
const CHROME_GROUPS_CONFORMANCE: readonly ChromeGroup[] = CHROME_GROUPS;
void CHROME_GROUPS_CONFORMANCE;

// The public unions are SPELLED OUT rather than written as `typeof CHROME_GROUPS`
// projections, because API Extractor 7.x crashes following a type that reaches an
// `as const` variable declaration ("Unable to follow symbol for 'const'",
// rushstack#4754) — and the adapters re-export `ChromeSlotId`. The derived forms are
// still computed below as private aliases, with mutual-assignability tripwires, so the
// spelled-out unions CANNOT drift from the data without `typecheck` failing.

/**
 * Every group id in the chrome, as a literal union. Stable public API; renaming a group
 * id is a breaking change.
 *
 * @public
 */
export type ChromeGroupId =
  | 'history'
  | 'zoom'
  | 'styles'
  | 'font'
  | 'text'
  | 'script'
  | 'alignment'
  | 'direction'
  | 'list'
  | 'format'
  | 'review'
  | 'contentControl'
  | 'image'
  | 'shape'
  | 'chart'
  | 'table'
  | 'paragraph'
  | 'file'
  | 'insert';

/**
 * The public slot vocabulary: `${groupId}.${controlId}` for every control that actually
 * exists — `text.bold`, `font.family`, `alignment.left`. THE stable contract a host
 * composes against and `commandForSlot` resolves; renaming a slot is a breaking change.
 *
 * @public
 */
export type ChromeSlotId =
  | 'history.undo'
  | 'history.redo'
  | 'zoom.level'
  | 'styles.style'
  | 'font.family'
  | 'font.size'
  | 'text.bold'
  | 'text.italic'
  | 'text.underline'
  | 'text.strike'
  | 'text.color'
  | 'text.highlight'
  | 'text.link'
  | 'script.super'
  | 'script.sub'
  | 'alignment.left'
  | 'alignment.center'
  | 'alignment.right'
  | 'alignment.justify'
  | 'direction.ltr'
  | 'direction.rtl'
  | 'list.bullet'
  | 'list.numbered'
  | 'list.outdent'
  | 'list.indent'
  | 'list.lineSpacing'
  | 'format.painter'
  | 'format.clear'
  | 'review.revisionMarkup'
  | 'review.comments'
  | 'review.addComment'
  | 'review.paragraphMarks'
  | 'review.bookmarks'
  | 'review.protectDocument'
  | 'review.compareDocuments'
  | 'review.simpleMarkup'
  | 'review.allMarkup'
  | 'review.noMarkup'
  | 'review.original'
  | 'review.previousChange'
  | 'review.nextChange'
  | 'review.acceptAllChanges'
  | 'review.rejectAllChanges'
  | 'review.authors'
  | 'review.editingMode'
  | 'contentControl.showAll'
  | 'contentControl.formFill'
  | 'contentControl.inspector'
  | 'contentControl.remove'
  | 'image.insert'
  | 'image.properties'
  | 'image.editChart'
  | 'image.formatShape'
  | 'image.wrap'
  | 'image.altText'
  | 'shape.fill'
  | 'shape.fillTransparency'
  | 'shape.outlineColor'
  | 'shape.outlineWidth'
  | 'shape.outlineDash'
  | 'chart.type'
  | 'chart.title'
  | 'chart.legend'
  | 'chart.dataLabels'
  | 'chart.axes'
  | 'chart.gridlines'
  | 'chart.categoryAxisTitle'
  | 'chart.valueAxisTitle'
  | 'chart.seriesColor'
  | 'chart.data'
  | 'table.insert'
  | 'table.borderTarget'
  | 'table.borderColor'
  | 'table.borderStyle'
  | 'table.borderWidth'
  | 'table.cellFill'
  | 'table.mergeCells'
  | 'table.splitCell'
  | 'file.open'
  | 'file.save'
  | 'file.exportMarkdown'
  | 'file.exportPdf'
  | 'file.print'
  | 'paragraph.dialog'
  | 'file.pageSetup'
  | 'insert.textBox'
  | 'insert.chart'
  | 'insert.footnote'
  | 'insert.endnote'
  | 'insert.pageNumber'
  | 'insert.totalPages'
  | 'insert.sectionPages'
  | 'insert.pageXofY'
  | 'insert.pageBreak'
  | 'insert.sectionBreakNextPage'
  | 'insert.sectionBreakContinuous'
  | 'insert.toc'
  | 'insert.bookmark'
  | 'insert.goToBookmark'
  | 'insert.watermark';

/**
 * Every control id in the chrome, as a literal union. Unique WITHIN a group, not
 * globally (`image.insert` / `table.insert`) — key consumers on {@link ChromeSlotId}.
 *
 * @public
 */
export type ChromeControlId = ChromeSlotId extends `${string}.${infer C}` ? C : never;

// ── Drift tripwires (private; never followed by API Extractor) ────────────────────────
// Both directions of assignability, so an id added, removed, or renamed in the data
// without updating the public unions (or vice versa) is a compile error right here.
type DerivedGroupId = (typeof CHROME_GROUPS)[number]['id'];
type DerivedSlotId = {
  [G in (typeof CHROME_GROUPS)[number] as G['id']]: `${G['id']}.${G['controls'][number]['id']}`;
}[DerivedGroupId];
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const GROUP_IDS_MATCH_DATA: MutuallyAssignable<ChromeGroupId, DerivedGroupId> = true;
const SLOT_IDS_MATCH_DATA: MutuallyAssignable<ChromeSlotId, DerivedSlotId> = true;
void GROUP_IDS_MATCH_DATA;
void SLOT_IDS_MATCH_DATA;

/**
 * The slot id of one control within its group. Only meaningful for entries of
 * `CHROME_GROUPS` — the cast is sound because every group/control pair in the registry
 * is, by construction, a member of the `ChromeSlotId` union.
 *
 * @public
 */
export function chromeSlotId(
  group: { readonly id: string },
  control: { readonly id: string }
): ChromeSlotId {
  return `${group.id}.${control.id}` as ChromeSlotId;
}

/**
 * The groups of the DEFAULT toolbar arrangement, in bar order: every group that is
 * not `contextual`. This is the registry's default bar — undo/redo through the
 * editing-mode picker — and what both adapters render when the host composes
 * nothing. Contextual slots (`image.*`, `table.insert`, `file.save`) remain
 * available for explicit composition.
 *
 * @public
 */
export function defaultChromeGroups(): readonly ChromeGroup[] {
  // Filtered through the ChromeGroup-typed view: the literal union's members omit
  // the optional `contextual` key entirely, which TS treats as an unknown property.
  return CHROME_GROUPS_CONFORMANCE.filter((group) => !group.contextual).map((group) => ({
    ...group,
    controls: group.controls.filter((control) => control.defaultToolbar !== false),
  }));
}

/** Options for {@link formattingBarChromeGroups}. @public */
export interface FormattingBarOptions {
  /** Show `direction.ltr` and `direction.rtl` after alignment, as for a right-to-left UI. */
  readonly direction?: boolean;
  /** Whether the selected drawing is a chart, which shows `image.editChart`. */
  readonly chart?: boolean;
  /** Whether the selected drawing has a fill or outline to set, which shows `image.formatShape`. */
  readonly shape?: boolean;
  /**
   * Whether a shape with a fill or outline is selected, which appends the toolbar controls of
   * the contextual `shape` group (fill, outline colour, width, and dash).
   */
  readonly shapeControls?: boolean;
  /**
   * Whether a chart is selected, which appends the toolbar controls of the contextual `chart`
   * group (type, title, legend, and data labels).
   */
  readonly chartControls?: boolean;
}

/**
 * The formatting-bar groups for one editor snapshot: the default bar, the contextual `image`
 * group when a drawing is selected (with Edit chart for a chart and Format shape for a shape), and
 * the direction group when `options.direction` asks.
 * Insertion without a selection lives in the packaged Insert menu (`CHROME_MENUS`), not in
 * the bar — a host that wants a bar button places `DocxEditor.Toolbar.ImageInsert` itself.
 *
 * @public
 */
export function formattingBarChromeGroups(
  image: ImageContext | null,
  options?: FormattingBarOptions
): readonly ChromeGroup[] {
  let groups = defaultChromeGroups();
  const direction = options?.direction
    ? CHROME_GROUPS_CONFORMANCE.find((g) => g.id === 'direction')
    : undefined;
  const at = groups.findIndex((group) => group.id === 'alignment') + 1;
  if (direction && at > 0) groups = [...groups.slice(0, at), direction, ...groups.slice(at)];
  if (!image) return groups;
  const imageGroup = CHROME_GROUPS_CONFORMANCE.find((group) => group.id === 'image');
  if (!imageGroup) return groups;
  const controls = imageGroup.controls.filter(
    (control) =>
      (control.id !== 'editChart' || options?.chart) &&
      (control.id !== 'formatShape' || options?.shape)
  );
  // The object's own controls follow the image group, as a contextual tab would.
  const objectGroups = CHROME_GROUPS_CONFORMANCE.filter(
    (group) =>
      (group.id === 'shape' && options?.shapeControls) ||
      (group.id === 'chart' && options?.chartControls)
  ).map((group) => ({
    ...group,
    controls: group.controls.filter((control) => control.defaultToolbar !== false),
  }));
  return [...groups, { ...imageGroup, controls }, ...objectGroups];
}

// ── The menu region above the toolbar ─────────────────────────────────────────────────
//
// ARRANGEMENT OVER SLOTS, not a second registry. Every actionable row is a `ChromeSlotId`
// from `CHROME_GROUPS` above, so a menu item and a toolbar button for the same capability
// share one label, one icon, one command, and one enabled state — the drift that comes
// from describing "Bold" twice cannot happen. That is also why the Insert menu names
// `image.insert` and `table.insert`, which live in their own groups: a slot is one
// control, wherever chrome chooses to place it.
//
// The menu is where the non-formatting chrome lives — opening and saving a file, page
// setup, breaks — because the formatting bar is derived from `defaultChromeGroups()` and
// those groups are all `contextual`. Both structures read the SAME registry.

export type {
  ChromeMenu,
  ChromeMenuEntry,
  ChromeMenuId,
  ChromeMenuItemEntry,
  ChromeMenuSeparatorEntry,
  ChromeMenuSubmenuEntry,
} from './chrome-menu-entries.ts';

/**
 * The menu bar the chrome shows above the toolbar, in bar order: File, Format, Insert, Review,
 * Help.
 *
 * @public
 */
export const CHROME_MENUS: readonly ChromeMenu[] = [
  {
    id: 'file',
    labelKey: 'toolbar.file',
    entries: [
      { kind: 'item', slot: 'file.open', shortcutKey: 'toolbar.openShortcut' },
      {
        kind: 'item',
        slot: 'file.save',
        labelKey: 'toolbar.save',
        shortcutKey: 'toolbar.saveShortcut',
      },
      { kind: 'separator' },
      {
        kind: 'submenu',
        labelKey: 'toolbar.export',
        paths: GENERATED_ICON_PATHS['file_download'],
        items: [
          { kind: 'item', slot: 'file.exportMarkdown' },
          { kind: 'item', slot: 'file.exportPdf' },
        ],
      },
      { kind: 'item', slot: 'file.print', shortcutKey: 'toolbar.printShortcut' },
      { kind: 'item', slot: 'file.pageSetup' },
    ],
  },
  {
    id: 'format',
    labelKey: 'toolbar.format',
    entries: [
      { kind: 'item', slot: 'text.bold', labelKey: 'formattingBar.bold' },
      { kind: 'item', slot: 'text.italic', labelKey: 'formattingBar.italic' },
      { kind: 'item', slot: 'text.underline', labelKey: 'formattingBar.underline' },
      { kind: 'item', slot: 'text.strike' },
      { kind: 'separator' },
      { kind: 'item', slot: 'alignment.left' },
      { kind: 'item', slot: 'alignment.center' },
      { kind: 'item', slot: 'alignment.right' },
      { kind: 'item', slot: 'alignment.justify' },
      { kind: 'separator' },
      { kind: 'item', slot: 'direction.ltr' },
      { kind: 'item', slot: 'direction.rtl' },
      { kind: 'separator' },
      // A SECOND route to the Paragraph dialog, the way `file.pageSetup` sits in the File
      // menu. The line-spacing menu is its natural home, but that control collapses into
      // the toolbar's overflow panel on a narrow window and its submenu opens clipped — so
      // a feature with only that route disappears entirely at around 1100px. The menu bar
      // does not collapse.
      { kind: 'item', slot: 'paragraph.dialog' },
      { kind: 'separator' },
      // PLAIN-LABEL key, stated rather than inherited: the registry's label is
      // tooltip-shaped and names both chords, which is wrong on a row whose ACTION is
      // neither of them — a press here arms the painter, and the two chords copy and paint.
      // That is also why the row carries no `shortcutKey`: there is no one chord to print.
      { kind: 'item', slot: 'format.painter', labelKey: 'formattingBar.formatPainter' },
      { kind: 'item', slot: 'format.clear' },
    ],
  },
  {
    id: 'insert',
    labelKey: 'toolbar.insert',
    // `image.insert` opens the adapters' shared file picker; the row dispatches through the
    // same slot as `DocxEditor.Toolbar.ImageInsert`, so a host that wants a different picker
    // still replaces one part, not a second registry.
    entries: [
      { kind: 'item', slot: 'image.insert' },
      { kind: 'item', slot: 'insert.textBox' },
      { kind: 'item', slot: 'insert.chart', picker: 'chartType' },
      { kind: 'item', slot: 'table.insert', picker: 'tableGrid' },
      { kind: 'separator' },
      { kind: 'item', slot: 'insert.footnote' },
      { kind: 'item', slot: 'insert.endnote' },
      { kind: 'separator' },
      {
        kind: 'submenu',
        labelKey: 'toolbar.break',
        paths: GENERATED_ICON_PATHS['page_break'],
        items: [
          { kind: 'item', slot: 'insert.pageBreak' },
          { kind: 'item', slot: 'insert.sectionBreakNextPage' },
          { kind: 'item', slot: 'insert.sectionBreakContinuous' },
        ],
      },
      { kind: 'item', slot: 'insert.toc' },
      { kind: 'item', slot: 'insert.bookmark', shortcutKey: 'toolbar.bookmarkShortcut' },
      { kind: 'item', slot: 'insert.goToBookmark' },
      { kind: 'item', slot: 'insert.watermark' },
    ],
  },
  {
    // The adapters supply the document-dependent reviewer rows beneath Markup Options.
    id: 'review',
    labelKey: 'toolbar.review',
    entries: [
      {
        kind: 'submenu',
        labelKey: 'review.displayForReview',
        paths: GENERATED_ICON_PATHS['visibility'],
        items: [
          { kind: 'item', slot: 'review.simpleMarkup' },
          { kind: 'item', slot: 'review.allMarkup' },
          { kind: 'item', slot: 'review.noMarkup' },
          { kind: 'item', slot: 'review.original' },
        ],
      },
      { kind: 'separator' },
      { kind: 'item', slot: 'review.revisionMarkup' },
      { kind: 'item', slot: 'review.previousChange' },
      { kind: 'item', slot: 'review.nextChange' },
      { kind: 'separator' },
      { kind: 'item', slot: 'review.acceptAllChanges' },
      { kind: 'item', slot: 'review.rejectAllChanges' },
      { kind: 'separator' },
      { kind: 'item', slot: 'review.paragraphMarks' },
      { kind: 'item', slot: 'review.bookmarks' },
      { kind: 'separator' },
      { kind: 'item', slot: 'review.protectDocument' },
      { kind: 'separator' },
      { kind: 'item', slot: 'review.compareDocuments' },
    ],
  },
  {
    // Help is host territory — a product's own docs, its own support channel. The one row
    // the library can honestly own is a link to THIS project's issue tracker, which is
    // what `openReportIssue` builds. A host replaces the menu by name like any other part.
    id: 'help',
    labelKey: 'toolbar.help',
    entries: [],
  },
];

/**
 * Every slot a menu places, in menu order, submenus flattened. What a parity test asserts
 * against, and what a host enumerates to know which capabilities the menu bar reaches.
 *
 * @public
 */
export function chromeMenuSlots(): readonly ChromeSlotId[] {
  return flattenChromeMenuSlots(CHROME_MENUS);
}

/** Total controls, so a parity test can assert none were dropped. */
export function chromeControlCount(): number {
  return CHROME_GROUPS.reduce((n, g) => n + g.controls.length, 0);
}

/** Tooltip for adapter controls without a picker; command refusals use engine reasons. */
export const CHROME_UNAVAILABLE_KEY = 'formattingBar.unavailableInPreview';
