import {
  toolbarFormattingValue,
  type ToolbarValueSlot,
  type ToolbarValueMap,
} from './toolbar-values.ts';
// Toolbar command wiring (interactive-paginated-editing M4.0 / M5.1).
//
// Shared by both adapters: the can-before-exec rule is one implementation, so
// React and Vue toolbars cannot drift on when a control is enabled.
//
// The toolbar never calls `Editor.exec` blind. Every formatting and history
// control asks `Editor.can(command)` first: that single answer decides both
// whether the button is enabled and whether the click is allowed to run. A
// control the engine cannot honour is disabled with the engine's own reason,
// rather than looking live and failing silently when pressed.
//
// ONE COMMAND VOCABULARY. Controls are addressed by their `ChromeSlotId`
// (`text.bold`, `history.undo`) — the same public slot taxonomy the chrome
// registry defines — and `commandForSlot` is the single table mapping a slot to
// its engine command. This replaces the two overlapping vocabularies that used
// to live here and in chrome-controls.ts (`ToolbarCommandId` and
// `ChromeCommandId`), which had already drifted on whether underline existed.

import type {
  CanResult,
  DocumentEditingMode,
  Editor,
  EditorCommand,
  EditorExecOptions,
  ExecResult,
} from '@docx-editor.dev/core/contracts/editor';
import type { ChromeSlotId } from './chrome-controls.ts';
import { NOTHING_TO_COPY_FORMATTING } from './surface-format-painter-contract.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { tableCommandState } from './docx-editor-derive.ts';
import {
  applyTableChromePick,
  DEFAULT_TABLE_CHROME_DRAFT,
  isTableChromeSlot,
  probeTableChromeCommand,
  type TableChromeDraft,
  type TableChromeSlotId,
} from './table-chrome.ts';
import { IMAGE_WRAP_TARGETS, type ImageWrapTarget } from '../store/package/drawing-projection.ts';
import type { ReviewAuthorInfo } from '../output/revision-presentation.ts';

import {
  NO_COMMENT_DRAFT_VIEW,
  addCommentState,
  commentDraftRequestsOf,
  commentWordAtCaret,
} from './comment-draft-chrome.ts';
import { LINK_PROBE, NO_LINK_VIEW, linkControlState, linkRequestsOf } from './link-chrome.ts';
import { chartChromeState, chartInsertCommand, runChartControl } from './chart-chrome.ts';
import { runShapeControl, shapeChromeState } from './shape-chrome.ts';
import {
  chartSlotIsToggle,
  commandForObjectSlotValue,
  isObjectChromeSlot,
  objectChromeState,
  runObjectControl,
} from './object-chrome-slots.ts';

/** Instance-only surface on the concrete facade — not part of the public `Editor` contract. */
function surfaceOf(editor: Editor): PaginatedSurface | null {
  const candidate = editor as Editor & { readonly surface?: PaginatedSurface | null };
  return candidate.surface ?? null;
}

/**
 * The one slot → engine-command table.
 *
 * A slot absent here is NOT WIRED YET: `commandForSlot` answers `null`, and
 * `toolbarCommandState` reports it disabled with that reason. Wiring a control is
 * adding one row — both adapters light up together. Save is deliberately absent:
 * `Editor.save()` is not a command (see `runSave`), and the chrome registry marks
 * the save control `kind: 'save'`.
 */
const SLOT_COMMANDS: Partial<Record<ChromeSlotId, EditorCommand>> = {
  // A VIEW toggle, wired here like any other button so its pressed state comes from
  // `isActive` rather than from a flag each host keeps for itself.
  'review.revisionMarkup': { type: 'openRevisionMarkupDialog' },
  'review.compareDocuments': { type: 'openCompareDocumentsDialog' },
  'review.comments': { type: 'toggleReviewPane' },
  'review.paragraphMarks': { type: 'toggleParagraphMarks' },
  'review.bookmarks': { type: 'toggleBookmarks' },
  // Opens the host's Bookmark dialog, the `bookmark` popup; disabled while none is registered.
  'insert.bookmark': { type: 'openBookmarkDialog' },
  // Opens the host's Go To UI, the Go to tab of the navigation pane; disabled without one.
  'insert.goToBookmark': { type: 'openGoTo' },
  'review.protectDocument': { type: 'toggleDocumentProtection' },
  'review.simpleMarkup': { type: 'setReviewDisplayMode', mode: 'simple-markup' },
  'review.allMarkup': { type: 'setReviewDisplayMode', mode: 'all-markup' },
  'review.noMarkup': { type: 'setReviewDisplayMode', mode: 'proposed' },
  'review.original': { type: 'setReviewDisplayMode', mode: 'original' },
  'review.previousChange': { type: 'navigateReviewChange', direction: 'previous' },
  'review.nextChange': { type: 'navigateReviewChange', direction: 'next' },
  'review.acceptAllChanges': { type: 'resolveAllReviewChanges', action: 'accept' },
  'review.rejectAllChanges': { type: 'resolveAllReviewChanges', action: 'reject' },
  'history.undo': { type: 'undo' },
  'history.redo': { type: 'redo' },
  'text.bold': { type: 'toggleMark', mark: 'bold' },
  'text.italic': { type: 'toggleMark', mark: 'italic' },
  'text.underline': { type: 'toggleMark', mark: 'underline' },
  'text.strike': { type: 'toggleMark', mark: 'strike' },
  'script.super': { type: 'toggleMark', mark: 'superscript' },
  'script.sub': { type: 'toggleMark', mark: 'subscript' },
  'format.clear': { type: 'clearFormatting' },
  'alignment.left': { type: 'setAlignment', align: 'left' },
  'alignment.center': { type: 'setAlignment', align: 'center' },
  'alignment.right': { type: 'setAlignment', align: 'right' },
  'alignment.justify': { type: 'setAlignment', align: 'justify' },
  'direction.ltr': { type: 'setParagraphDirection', direction: 'ltr' },
  'direction.rtl': { type: 'setParagraphDirection', direction: 'rtl' },
  'list.bullet': { type: 'toggleList', kind: 'bullet' },
  'list.numbered': { type: 'toggleList', kind: 'ordered' },
  'list.indent': { type: 'adjustIndent', direction: 'increase' },
  'list.outdent': { type: 'adjustIndent', direction: 'decrease' },
  'insert.textBox': { type: 'insertTextBox' },
  'insert.footnote': { type: 'insertNote', noteKind: 'footnote' },
  'insert.endnote': { type: 'insertNote', noteKind: 'endnote' },
  'insert.pageNumber': { type: 'insertPageField', field: 'PAGE' },
  'insert.totalPages': { type: 'insertPageField', field: 'NUMPAGES' },
  'insert.sectionPages': { type: 'insertPageField', field: 'SECTIONPAGES' },
  'insert.pageXofY': { type: 'insertPageField', field: 'PAGE_X_OF_Y' },
  'insert.pageBreak': { type: 'insertBreak', kind: 'page' },
  'insert.sectionBreakNextPage': { type: 'insertBreak', kind: 'section' },
  'insert.sectionBreakContinuous': { type: 'insertBreak', kind: 'sectionContinuous' },
  'insert.toc': { type: 'insertToc' },
  // Content-control remove maps to the public edit shape; the Editor facade resolves the
  // caret control. Show-all / form-fill / inspector are surface chrome, not commands — see
  // the special cases in `toolbarCommandState` / `runToolbarCommand`.
  'contentControl.remove': { type: 'removeContentControl' },
  'table.mergeCells': { type: 'mergeCells' },
};

/**
 * The probe a slot uses to ask "would the engine honour this right now?" when its real
 * command needs an argument the slot itself cannot supply.
 *
 * `text.link` is the case: whether this selection could become a link is the engine's
 * question, but WHICH link is a URL field's. `toolbarCommandState` answers the slot from
 * this probe and from whether a link UI is registered, and `runToolbarCommand` opens that
 * UI, so chrome reads the slot like any other.
 *
 * @public
 */
export function chromeProbeForSlot(slotId: ChromeSlotId): EditorCommand | null {
  return CHROME_PROBES[slotId] ?? null;
}

const IMAGE_INSERT_PROBE_BYTES = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

/**
 * Why a dialog slot cannot run as a command, naming the public way to open the dialog. The
 * engine can judge the slot, but the values come from a dialog the host renders.
 */
const DIALOG_SLOT_REASONS: Partial<Record<ChromeSlotId, string>> = {
  'file.pageSetup':
    'page setup is not a command; render DocxEditor.PageSetupDialog with open and onClose',
  'paragraph.dialog':
    'the paragraph dialog is not a command; render DocxEditor.ParagraphDialog with open and onClose',
};

const CHROME_PROBES: Partial<Record<ChromeSlotId, EditorCommand>> = {
  'text.link': LINK_PROBE,
  // Both carry a real command whose ARGUMENTS come from chrome the registry does not own —
  // bytes from a file picker, a size from the insert grid. The probe asks the engine whether
  // a well-formed one would be honored AT THE CARET, which is exactly the enabled question;
  // the values below are the smallest well-formed pair and are never executed. Picking a real
  // size still runs its own `can` first, so a 6×6 refused where a 1×1 was not cannot slip
  // through.
  'image.insert': {
    type: 'insertImage',
    data: IMAGE_INSERT_PROBE_BYTES,
    mime: 'image/png',
    widthPoints: 72,
    heightPoints: 72,
  },
  'image.properties': { type: 'setImageProperties', description: 'probe' },
  'table.insert': { type: 'insertTable', rows: 1, cols: 1 },
  // Page setup is the same shape: whether this document's sections can be rewritten is the
  // engine's question, but WHICH size, orientation and margins is the dialog's. The probe
  // names one field so `classifyCommand`'s "requires at least one field" gate passes; it is
  // never executed, and the dialog sends the user's real values.
  'file.pageSetup': { type: 'setPageSetup', orientation: 'portrait' },
  // Same shape again: whether the selection's paragraphs can be reformatted is the engine's
  // question, which values is the dialog's. One field so `classifyCommand`'s "requires at
  // least one field" gate passes; never executed.
  'paragraph.dialog': { type: 'setParagraphFormat', alignment: 'left' },
  // The Watermark dialog: whether the document's headers can carry a watermark is the
  // engine's question, which text or picture is the dialog's. Never executed.
  'insert.watermark': { type: 'setWatermark', watermark: { text: 'DRAFT' } },
  // The Split Cells dialog: whether the cell splits is the engine's question, into how many
  // rows and columns is the dialog's. Never executed.
  'table.splitCell': { type: 'splitCell', rows: 1, cols: 2 },
};

/**
 * The public editor command behind one chrome slot, or `null` when the slot is
 * not wired to a command yet (parity-only chrome, or save — which is not a
 * command). The single source of command truth for both adapters.
 *
 * @public
 */
export function commandForSlot(slotId: ChromeSlotId): EditorCommand | null {
  return SLOT_COMMANDS[slotId] ?? null;
}

/** The `setMarkAttr` mark behind each value-typed slot. */
const VALUE_SLOT_MARKS: Partial<Record<ChromeSlotId, { mark: string; attr: string }>> = {
  'font.family': { mark: 'fontFamily', attr: 'family' },
  'font.size': { mark: 'fontSize', attr: 'val' },
  'text.color': { mark: 'color', attr: 'val' },
  'text.highlight': { mark: 'highlight', attr: 'val' },
};

/**
 * Known-valid probe values, so `toolbarCommandState` can ask `Editor.can` about a
 * value-typed slot without having a value yet. The probe never executes: it only
 * answers "would a well-formed value be honored right now" — which is the editable
 * gate, exactly what enables the picker. The style probe passes the SHAPE gate on any
 * document (existence is an exec-time check), which is exactly right: the picker's
 * options come from `getDocumentStyles`, so a real pick always exists.
 */
const VALUE_SLOT_PROBES: Partial<Record<ChromeSlotId, unknown>> = {
  'font.family': 'Arial',
  'font.size': 22,
  'text.color': '000000',
  'text.highlight': 'yellow',
  'styles.style': 'Normal',
  // Single spacing: the one pick every document can honour, so the probe answers the
  // editable gate and nothing narrower.
  'list.lineSpacing': 1,
  'image.wrap': 'square' satisfies ImageWrapTarget,
  'image.altText': 'probe alt text',
  'insert.chart': 'columnClustered',
};

/** Default draft for table chrome probes when the host has not supplied one yet. */
export { DEFAULT_TABLE_CHROME_DRAFT } from './table-chrome.ts';

/**
 * Build an engine command for one table chrome slot using the caller's draft state.
 *
 * @public
 */
export function commandForTableChromeSlotValue(
  slotId: TableChromeSlotId,
  value: unknown,
  draft: TableChromeDraft
): EditorCommand | null {
  return applyTableChromePick(draft, slotId, value)?.command ?? null;
}

/**
 * The engine command for a VALUE-TYPED slot carrying the picked value, or `null` for a
 * slot that does not take a value.
 *
 * Two families: the run-property pickers (`font.family`, `font.size`, `text.color`,
 * `text.highlight`) resolve to `setMarkAttr`, and `styles.style` resolves to
 * `setParagraphStyle` — a paragraph styleId, not a mark. Either way the value is
 * validated by the engine's own gate (`can` refuses a malformed one with `invalidArgs`;
 * a styleId the document does not define is refused at `exec`), so a host can pass user
 * input through unmodified.
 *
 * @public
 */
export function commandForSlotValue(slotId: ChromeSlotId, value: unknown): EditorCommand | null {
  // The style picker is value-typed but not a MARK: its value is a paragraph styleId.
  // Passed through unvalidated like the mark values — the engine's own gate refuses a
  // malformed one (`classifyCommand`) and an unknown one (`exec`), with typed reasons.
  // The editing-mode pill: its command carries the chosen mode, so it is value-typed even
  // though the value is not a mark.
  if (slotId === 'review.editingMode') {
    return { type: 'setEditingMode', mode: value as 'editing' | 'suggesting' | 'viewing' };
  }
  if (slotId === 'styles.style') {
    return { type: 'setParagraphStyle', styleId: value as string };
  }
  // The slot's one-number value is a MULTIPLE (the 1.0 / 1.15 / 1.5 / 2.0 menu). `exact`
  // and `atLeast` need a rule beside the number, so a host that sets them builds
  // `setLineSpacing` itself, as each `lineSpacingMenuRows` row's `spacing` already is.
  if (slotId === 'list.lineSpacing') {
    return { type: 'setLineSpacing', rule: 'multiple', value: value as number };
  }
  if (isTableChromeSlot(slotId)) {
    return commandForTableChromeSlotValue(slotId, value, DEFAULT_TABLE_CHROME_DRAFT);
  }
  if (slotId === 'image.wrap') {
    if (typeof value !== 'string' || !IMAGE_WRAP_TARGETS.includes(value as ImageWrapTarget)) {
      return null;
    }
    return { type: 'setImageWrapType', target: value as ImageWrapTarget };
  }
  if (slotId === 'image.altText') {
    if (typeof value !== 'string') return null;
    return { type: 'setImageProperties', description: value };
  }
  if (slotId === 'insert.chart') return chartInsertCommand(value);
  if (isObjectChromeSlot(slotId)) return commandForObjectSlotValue(slotId, value);
  const entry = VALUE_SLOT_MARKS[slotId];
  if (!entry) return null;
  return { type: 'setMarkAttr', mark: entry.mark, attr: entry.attr, value };
}

/**
 * Whether one control is enabled, and the engine's reason when it is not.
 *
 * @public
 */
export interface ToolbarCommandState {
  readonly id: ChromeSlotId;
  readonly enabled: boolean;
  /** The engine's reason when disabled — surfaced as a tooltip, never invented. */
  readonly disabledReason: string | null;
  /**
   * What the control currently SHOWS, for the slots whose answer is a value rather than a
   * pressed state — the editing-mode pill, and image wrap when it lands.
   *
   * `active` cannot express this: "the mode is Suggesting" is not a boolean about one
   * command, and a parallel channel for it would be a second place a control could read its
   * own state from. Absent for every slot whose state really is just pressed-or-not.
   */
  readonly value?: string;
  /** Whether the command is currently APPLIED at the selection, from `Editor.isActive` —
   *  derived in the engine for marks and alignment, honest-false elsewhere. */
  readonly active: boolean;
}

/**
 * Enabled state for one table chrome slot using explicit draft state.
 *
 * @public
 */
export function tableChromeToolbarState(
  editor: Editor | null,
  slot: TableChromeSlotId,
  draft: TableChromeDraft = DEFAULT_TABLE_CHROME_DRAFT
): ToolbarCommandState {
  if (!editor) {
    return { id: slot, enabled: false, disabledReason: 'editor is not ready', active: false };
  }
  const probe = probeTableChromeCommand(slot, draft);
  if (!probe) {
    return {
      id: slot,
      enabled: false,
      disabledReason: 'not wired to an editor command',
      active: false,
    };
  }
  const result = editor.can(probe);
  return result.ok
    ? { id: slot, enabled: true, disabledReason: null, active: false }
    : { id: slot, enabled: false, disabledReason: result.reason, active: false };
}

const EDITING_MODES: readonly DocumentEditingMode[] = ['editing', 'suggesting', 'viewing'];

/**
 * Ask the engine whether one control should be enabled.
 *
 * @public
 */
export function toolbarCommandState(editor: Editor | null, id: ChromeSlotId): ToolbarCommandState {
  if (!editor) return { id, enabled: false, disabledReason: 'editor is not ready', active: false };
  if (isTableChromeSlot(id)) {
    return tableChromeToolbarState(editor, id);
  }
  const chart =
    chartChromeState(editor, id) ?? shapeChromeState(editor, id) ?? objectChromeState(editor, id);
  if (chart) return chart;
  if (id === 'review.editingMode') {
    const mode = editor.getEditingMode?.() ?? 'editing';
    // Enabled state comes from the ENGINE, like every other control — but the pill is how a
    // reader LEAVES a mode as much as enters one, so it probes every other mode and is live
    // while any can be entered. Gating it on suggesting alone locked a reader with no
    // review module, or no author, out of Viewing; each menu item carries its own refusal.
    const probes = EDITING_MODES.filter((other) => other !== mode).map((other) =>
      editor.can(commandForSlotValue(id, other)!)
    );
    const reachable = probes.some((probe) => probe.ok);
    const refused = probes.find((probe) => !probe.ok);
    return {
      id,
      enabled: reachable,
      disabledReason: !reachable && refused && !refused.ok ? refused.reason : null,
      active: false,
      value: mode,
    };
  }
  // Word's Format Painter. Surface-owned like the content-control toggles below, and for
  // the same reason: the capture and the armed mode are chrome state, not document bytes.
  //
  // `value` carries the MODE, the way the editing-mode pill's does. A control that only knew
  // `active` could not tell "armed for one paint" from "locked on", which is the whole
  // difference a double-press makes and the only cue that Escape is what ends it.
  if (id === 'format.painter') {
    const surface = surfaceOf(editor);
    if (!surface) {
      return { id, enabled: false, disabledReason: 'editor is not ready', active: false };
    }
    const painter = surface.formatPainter.state();
    // An ARMED painter is always pressable, because the press that turns it off must not be
    // refused by the same rule that decides whether a fresh capture is possible.
    if (painter.mode !== 'off') {
      return { id, enabled: true, disabledReason: null, active: true, value: painter.mode };
    }
    // Probed with the SIBLING control's command, not with `copyFormatting`.
    //
    // Copying formatting really does write nothing, so it is not `mutating` and the engine
    // allows it on a document open for viewing — which is right for the command and wrong
    // for this control. Arming a painter the document will refuse to apply is the dead
    // button the enabled-state rule exists to prevent, so the question asked here is the one
    // that decides whether the PAINT can land: would this document take a formatting write?
    // `clearFormatting` is exactly that question, needs no selection to answer it, and is
    // the control sitting next to this one.
    const allowed = editor.can({ type: 'clearFormatting' });
    return allowed.ok
      ? { id, enabled: true, disabledReason: null, active: false, value: painter.mode }
      : {
          id,
          enabled: false,
          disabledReason: allowed.reason,
          active: false,
          value: painter.mode,
        };
  }
  // Surface-owned content-control chrome toggles. Enabled whenever the editor is mounted;
  // `active` reflects snapshot surface state when the facade publishes it, else false.
  // Adapters that drive the surface directly also read `surface.state().contentControls`.
  if (id === 'contentControl.showAll' || id === 'contentControl.formFill') {
    const surface = surfaceOf(editor);
    const cc = surface?.state().contentControls;
    const active =
      id === 'contentControl.showAll' ? (cc?.showAll ?? false) : (cc?.formFill ?? false);
    return {
      id,
      enabled: surface !== null,
      disabledReason: surface ? null : 'editor is not ready',
      active,
    };
  }
  if (id === 'contentControl.inspector') {
    const surface = surfaceOf(editor);
    if (!surface)
      return { id, enabled: false, disabledReason: 'editor is not ready', active: false };
    const activeId = surface.state().contentControls.activeControlId;
    return activeId
      ? { id, enabled: true, disabledReason: null, active: false }
      : {
          id,
          enabled: false,
          disabledReason: 'no content control at the selection',
          active: false,
        };
  }
  if (id === 'review.addComment') return addCommentState(editor);
  if (id === 'text.link') return linkControlState(editor);
  if (id === 'review.authors') {
    const capability = editor.can({ type: 'toggleReviewPane' });
    if (!capability.ok) {
      return {
        id,
        enabled: false,
        disabledReason: capability.reason,
        active: false,
      };
    }
    const reviewerEditor = editor as Editor & {
      readonly getReviewAuthors?: () => readonly ReviewAuthorInfo[];
    };
    return (reviewerEditor.getReviewAuthors?.().length ?? 0) > 0
      ? { id, enabled: true, disabledReason: null, active: false }
      : {
          id,
          enabled: false,
          disabledReason: 'the document has no review authors',
          active: false,
        };
  }
  const command = commandForSlot(id);
  if (!command) {
    // A value-typed slot has no fixed command, but it still has an honest enabled
    // state: whether a well-formed value would be honored right now. `active` stays
    // false — "the selection is Arial" is a VALUE for the picker to show, not a
    // pressed state.
    const probe = VALUE_SLOT_PROBES[id];
    if (probe !== undefined) {
      const valueCommand = commandForSlotValue(id, probe);
      if (!valueCommand) {
        return {
          id,
          enabled: false,
          disabledReason: 'not wired to an editor command',
          active: false,
        };
      }
      const canApply: CanResult = editor.can(valueCommand);
      const selected = editor.getSelectedImage?.() ?? null;
      const currentValue =
        id === 'image.wrap'
          ? selected?.wrap
          : id === 'image.altText'
            ? selected?.description
            : toolbarFormattingValue(editor, id);
      return canApply.ok
        ? {
            id,
            enabled: true,
            disabledReason: null,
            active: false,
            ...(currentValue !== undefined ? { value: currentValue } : {}),
          }
        : {
            id,
            enabled: false,
            disabledReason: canApply.reason,
            active: false,
            ...(currentValue !== undefined ? { value: currentValue } : {}),
          };
    }
    // A slot with a PROBE has a command shape the engine can judge, even though no fixed
    // command can be dispatched from a bare click. When the engine REFUSES the probe, that
    // refusal is the honest reason and it is the engine's own words — quote it rather than
    // inventing one. When the engine ALLOWS it, payload-aware image chrome is wired through
    // the probe rather than a fixed `SLOT_COMMANDS` row. `text.link` returned above.
    const shapeProbe = CHROME_PROBES[id];
    if (shapeProbe) {
      if (id === 'image.insert' && shapeProbe.type === 'insertImage') {
        const judged: CanResult =
          editor.canExecuteImageCommand?.({
            type: 'insertImage',
            data: IMAGE_INSERT_PROBE_BYTES,
            mime: 'image/png',
            widthPoints: 72,
            heightPoints: 72,
          }) ?? editor.can(shapeProbe);
        return judged.ok
          ? { id, enabled: true, disabledReason: null, active: false }
          : { id, enabled: false, disabledReason: judged.reason, active: false };
      }
      if (id === 'image.properties' && shapeProbe.type === 'setImageProperties') {
        const judged: CanResult = editor.can(shapeProbe);
        return judged.ok
          ? { id, enabled: true, disabledReason: null, active: false }
          : { id, enabled: false, disabledReason: judged.reason, active: false };
      }
      // Insert-table is the same shape as image insert: the SIZE comes from the grid the
      // chrome owns, so an allowed probe means the row can act, not that it is still
      // unwired. Without this branch the row falls through to "not wired to an editor
      // command" and stays grey the day the engine starts authoring tables.
      if (id === 'table.insert' && shapeProbe.type === 'insertTable') {
        const judged: CanResult = editor.can(shapeProbe);
        return judged.ok
          ? { id, enabled: true, disabledReason: null, active: false }
          : { id, enabled: false, disabledReason: judged.reason, active: false };
      }
      // The Split cells dialog supplies the counts. A cell too narrow for two columns may
      // still split into rows: two, or as many as a merged cell spans when two does not
      // divide them.
      if (id === 'table.splitCell' && shapeProbe.type === 'splitCell') {
        let judged: CanResult = editor.can(shapeProbe);
        const limits = judged.ok ? null : editor.query({ type: 'splitCellConfig' });
        for (const rows of limits ? [2, limits.maxRows] : []) {
          if (judged.ok || rows < 2) break;
          const byRows = editor.can({ type: 'splitCell', rows, cols: 1 });
          if (byRows.ok) judged = byRows;
        }
        return judged.ok
          ? { id, enabled: true, disabledReason: null, active: false }
          : { id, enabled: false, disabledReason: judged.reason, active: false };
      }
      // The Paragraph dialog is the same shape once more: the VALUES come from the form the
      // chrome owns, so an allowed probe means the row can act — not that it is unwired.
      // Without this branch the only route to the dialog reads "not connected to an editor
      // command" and stays grey.
      if (id === 'paragraph.dialog' && shapeProbe.type === 'setParagraphFormat') {
        const judged: CanResult = editor.can(shapeProbe);
        return judged.ok
          ? { id, enabled: true, disabledReason: null, active: false }
          : { id, enabled: false, disabledReason: judged.reason, active: false };
      }
      const judged: CanResult = editor.can(shapeProbe);
      if (!judged.ok) {
        return { id, enabled: false, disabledReason: judged.reason, active: false };
      }
      const dialogReason = DIALOG_SLOT_REASONS[id];
      if (dialogReason) return { id, enabled: false, disabledReason: dialogReason, active: false };
    }
    // Save is wired — just not as a command. Reporting it "not wired to an editor
    // command" told a host the capability is missing when what is actually missing is a
    // COMMAND for it: the control runs `runSave`, and both adapters reach it by branching
    // on the registry's `kind: 'save'`. Say which of the two it is.
    if (id === 'file.exportMarkdown' || id === 'file.exportPdf') {
      return {
        id,
        enabled: false,
        active: false,
        disabledReason:
          'export is not a command; run it with runChromeExport(editor, format, handlers)',
      };
    }
    if (id === 'file.print') {
      return {
        id,
        enabled: false,
        active: false,
        disabledReason: 'print is not a command; run it with runChromePrint(editor, handlers)',
      };
    }
    if (id === 'file.save') {
      return {
        id,
        enabled: false,
        disabledReason: 'save is not a command; run it with runSave(editor)',
        active: false,
      };
    }
    // Open is save's twin and gets the same distinction: the capability is there, a
    // COMMAND for it is not. Bytes come from a picker the host owns and go in through
    // `Editor.load`, so chrome that has one drives the control itself.
    if (id === 'file.open') {
      return {
        id,
        enabled: false,
        disabledReason: 'open is not a command; run it with editor.load(bytes)',
        active: false,
      };
    }
    return { id, enabled: false, disabledReason: 'not wired to an editor command', active: false };
  }
  const result: CanResult = editor.can(command);
  // Optional call: `isActive` is newer than this helper's callers, and a host or test
  // double built against the earlier contract must not crash the toolbar. Absent means
  // "not active", which is the same honest default an underived command returns.
  const active = editor.isActive?.(command) ?? false;
  return result.ok
    ? { id, enabled: true, disabledReason: null, active }
    : { id, enabled: false, disabledReason: result.reason, active };
}

/**
 * Whether a slot's control renders as a TOGGLE — pressed or not — so it carries
 * `aria-pressed`.
 *
 * Shared rather than derived per adapter, because it is not derivable from the command table
 * alone: the format painter has no fixed command (a press captures, arms, locks or stands
 * down, which no single `EditorCommand` describes), so a rule that only read `commandForSlot`
 * left it announcing nothing at all to a screen reader while it was armed.
 *
 * @public
 */
export function chromeSlotIsToggle(slotId: ChromeSlotId): boolean {
  if (slotId === 'format.painter' || chartSlotIsToggle(slotId)) return true;
  const command = commandForSlot(slotId);
  return (
    command?.type === 'toggleMark' ||
    command?.type === 'toggleParagraphMarks' ||
    command?.type === 'toggleBookmarks' ||
    command?.type === 'toggleDocumentProtection' ||
    command?.type === 'setReviewDisplayMode' ||
    command?.type === 'setAlignment' ||
    command?.type === 'setParagraphDirection'
  );
}

/**
 * Enabled state for several controls in one pass.
 *
 * @public
 */
export function toolbarCommandStates(
  editor: Editor | null,
  ids: readonly ChromeSlotId[]
): readonly ToolbarCommandState[] {
  return ids.map((id) => toolbarCommandState(editor, id));
}

/**
 * Result of {@link runTableChromeCommand}: engine outcome plus post-pick draft on success.
 *
 * @public
 */
export interface RunTableChromeCommandResult {
  readonly result: ExecResult;
  readonly nextDraft: TableChromeDraft | null;
}

/**
 * Run one table chrome pick with explicit draft state; returns the post-pick draft on success.
 *
 * @public
 */
export function runTableChromeCommand(
  editor: Editor | null,
  slot: TableChromeSlotId,
  value: unknown,
  draft: TableChromeDraft
): RunTableChromeCommandResult {
  if (!editor) {
    return {
      result: { ok: false, code: 'unsupported', reason: 'editor is not ready' },
      nextDraft: null,
    };
  }
  const pick = applyTableChromePick(draft, slot, value);
  if (!pick) {
    return {
      result: { ok: false, code: 'unsupported', reason: 'invalid table chrome value' },
      nextDraft: null,
    };
  }
  const allowed = editor.can(pick.command);
  if (!allowed.ok) {
    return { result: { ok: false, code: allowed.code, reason: allowed.reason }, nextDraft: null };
  }
  const result = editor.exec(pick.command);
  return result.ok ? { result, nextDraft: pick.nextDraft } : { result, nextDraft: null };
}

/** Whether a slot takes a value object, so a plain object there is never exec options. */
const isValueTakingSlot = (id: ChromeSlotId): boolean =>
  isTableChromeSlot(id) || isObjectChromeSlot(id);

/**
 * Slots `runToolbarCommand` runs on the surface or through host chrome directly, so `exec`
 * options do not apply.
 */
const SURFACE_RUN_SLOTS: ReadonlySet<ChromeSlotId> = new Set<ChromeSlotId>([
  'format.painter',
  'contentControl.showAll',
  'contentControl.formFill',
  'contentControl.inspector',
  'contentControl.remove',
  'review.addComment',
]);

/**
 * Run a toolbar control: `can` first, then `exec` only if it said yes. Returns
 * the engine's refusal untouched when it said no, so a caller cannot mistake a
 * declined command for a no-op.
 *
 * @public
 */
export function runToolbarCommand(editor: Editor | null, id: ChromeSlotId): ExecResult;
/** @public */
export function runToolbarCommand(
  editor: Editor | null,
  id: Exclude<ChromeSlotId, ToolbarValueSlot>,
  options: EditorExecOptions
): ExecResult;
/** @public */
export function runToolbarCommand<K extends keyof ToolbarValueMap>(
  editor: Editor | null,
  id: K,
  value: ToolbarValueMap[NoInfer<K>],
  options?: EditorExecOptions
): ExecResult;
/** @public */
export function runToolbarCommand(
  editor: Editor | null,
  id: TableChromeSlotId,
  value: unknown,
  options?: EditorExecOptions
): ExecResult;
/** @public */
export function runToolbarCommand(
  editor: Editor | null,
  id: ChromeSlotId,
  value: undefined,
  options: EditorExecOptions
): ExecResult;
export function runToolbarCommand(
  editor: Editor | null,
  id: ChromeSlotId,
  /** The chosen value, for a slot whose command carries one (the editing-mode pill). */
  value?: unknown,
  /** Forwarded to `exec` for a slot that resolves to a command; a live control names its gesture here. */
  options?: EditorExecOptions
): ExecResult {
  if (!editor) return { ok: false, code: 'unsupported', reason: 'editor is not ready' };
  if (
    value &&
    typeof value === 'object' &&
    ('historyGroup' in value || 'scope' in value || Object.keys(value).length === 0)
  ) {
    if (options || VALUE_SLOT_PROBES[id] !== undefined || isValueTakingSlot(id))
      return {
        ok: false,
        code: 'invalidArgs',
        reason: 'pass a toolbar value before command options',
      };
    options = value as EditorExecOptions;
    value = undefined;
  }
  // These slots run on the surface and never reach `exec`, so the option cannot be honored
  // there; refused rather than dropped, so a caller is never told a group it did not get.
  if (options?.historyGroup !== undefined && SURFACE_RUN_SLOTS.has(id)) {
    return { ok: false, code: 'unsupported', reason: `${id} does not take a history group` };
  }
  const chartRun =
    runChartControl(editor, id, value) ??
    runShapeControl(editor, id) ??
    runObjectControl(editor, id, value, options);
  if (chartRun) return chartRun;
  if (id === 'format.painter') {
    const surface = surfaceOf(editor);
    if (!surface) return { ok: false, code: 'unsupported', reason: 'editor is not ready' };
    // CAN BEFORE EXEC, the same probe the enabled state above uses. A caller that dispatches
    // by slot id without reading that state — a host's own keybinding, an automation — would
    // otherwise arm a painter on a document that refuses the write: the cursor changes, and
    // every following release builds ops the session then rejects.
    //
    // Only when it is OFF. Standing DOWN has to stay possible whatever the document allows,
    // or a painter armed before the mode changed could never be released.
    if (surface.formatPainter.state().mode === 'off') {
      const allowed = editor.can({ type: 'clearFormatting' });
      if (!allowed.ok) return { ok: false, code: allowed.code, reason: allowed.reason };
    }
    // The press captures, arms, locks or stands down — the engine decides which, from its own
    // clock. Nothing about the DOCUMENT moves, so a press that lands reports `changed:
    // false`; the painting itself happens on the selection the user makes next.
    //
    // A press that found nothing to capture is a REFUSAL, not a quiet success. Reporting it
    // as `ok` is how a control ends up looking as though it armed while the painter stayed
    // off, which the enabled state alone cannot prevent — the selection can move between the
    // render and the click.
    return surface.formatPainter.press()
      ? { ok: true, changed: false }
      : { ok: false, code: 'notFound', reason: NOTHING_TO_COPY_FORMATTING };
  }
  if (id === 'text.link') {
    // Can before exec, then the registered link UI opens insert-or-edit, as Ctrl/Cmd+K does.
    const state = linkControlState(editor);
    if (!state.enabled) {
      return { ok: false, code: 'unsupported', reason: state.disabledReason ?? NO_LINK_VIEW };
    }
    return linkRequestsOf(editor)?.open()
      ? { ok: true, changed: false }
      : { ok: false, code: 'unsupported', reason: NO_LINK_VIEW };
  }
  if (id === 'review.addComment') {
    // Can before exec, with the same answer the enabled state gives; then the registered
    // chrome opens the draft. Nothing about the document moves until the comment is posted.
    const state = addCommentState(editor);
    if (!state.enabled) {
      return {
        ok: false,
        code: 'unsupported',
        reason: state.disabledReason ?? NO_COMMENT_DRAFT_VIEW,
      };
    }
    // A caret inside a word comments on that word: select it, then open the draft on it.
    const word = editor.getSelectionPlacement() === null ? commentWordAtCaret(editor) : null;
    const surface = word ? surfaceOf(editor) : null;
    const caret = surface?.state().selection;
    if (word) surface?.setSelection({ anchor: word.from, head: word.to });
    if (commentDraftRequestsOf(editor)?.open()) return { ok: true, changed: false };
    if (caret) surface?.setSelection(caret); // No draft opened: the caret goes back.
    return { ok: false, code: 'unsupported', reason: NO_COMMENT_DRAFT_VIEW };
  }
  if (id === 'contentControl.showAll') {
    const surface = surfaceOf(editor);
    if (!surface) return { ok: false, code: 'unsupported', reason: 'editor is not ready' };
    surface.contentControls.setShowAll(!surface.contentControls.showAll());
    return { ok: true, changed: false };
  }
  if (id === 'contentControl.formFill') {
    const surface = surfaceOf(editor);
    if (!surface) return { ok: false, code: 'unsupported', reason: 'editor is not ready' };
    surface.contentControls.setFormFill(!surface.contentControls.formFill());
    return { ok: true, changed: false };
  }
  if (id === 'contentControl.inspector') {
    // Inspector is a host chrome surface: the slot enables when a control is at the caret.
    // Opening the panel is the adapter's job — there is nothing for the engine to execute.
    const surface = surfaceOf(editor);
    if (!surface) return { ok: false, code: 'unsupported', reason: 'editor is not ready' };
    if (!surface.state().contentControls.activeControlId) {
      return { ok: false, code: 'notFound', reason: 'no content control at the selection' };
    }
    return { ok: true, changed: false };
  }
  if (id === 'contentControl.remove') {
    const surface = surfaceOf(editor);
    if (!surface) return { ok: false, code: 'unsupported', reason: 'editor is not ready' };
    const activeId = surface.state().contentControls.activeControlId;
    if (!activeId) {
      return { ok: false, code: 'notFound', reason: 'no content control at the selection' };
    }
    const reason = surface.contentControls.disabledReason(activeId, 'remove');
    if (reason) return { ok: false, code: reason === 'bound' ? 'bound' : 'locked', reason };
    const removed = surface.contentControls.remove(activeId);
    return removed
      ? { ok: true, changed: true }
      : {
          ok: false,
          code:
            (surface.state().lastRejection as 'locked' | 'bound' | 'notFound' | undefined) ??
            'unsupported',
          reason: surface.state().lastRejection ?? 'removeContentControl was refused',
        };
  }
  const command = value === undefined ? commandForSlot(id) : commandForSlotValue(id, value);
  if (!command) {
    if (value !== undefined) {
      return { ok: false, code: 'unsupported', reason: 'invalid value for toolbar command' };
    }
    if (id === 'file.exportMarkdown' || id === 'file.exportPdf') {
      return {
        ok: false,
        code: 'unsupported',
        reason: 'export is not a command; run it with runChromeExport(editor, format, handlers)',
      };
    }
    if (id === 'file.print') {
      return {
        ok: false,
        code: 'unsupported',
        reason: 'print is not a command; run it with runChromePrint(editor, handlers)',
      };
    }
    if (id === 'file.save') {
      return {
        ok: false,
        code: 'unsupported',
        reason: 'save is not a command; run it with runSave(editor)',
      };
    }
    if (id === 'file.open') {
      return {
        ok: false,
        code: 'unsupported',
        reason: 'open is not a command; run it with editor.load(bytes)',
      };
    }
    const dialogReason = DIALOG_SLOT_REASONS[id];
    if (dialogReason) return { ok: false, code: 'unsupported', reason: dialogReason };
    return { ok: false, code: 'unsupported', reason: 'not wired to an editor command' };
  }
  const allowed = editor.can(command, options);
  if (!allowed.ok) return { ok: false, code: allowed.code, reason: allowed.reason };
  return editor.exec(command, options);
}

/**
 * Save goes straight to `Editor.save()` — it is not a command.
 *
 * @public
 */
export function runSave(editor: Editor | null): Promise<ArrayBuffer> {
  if (!editor) return Promise.reject(new Error('editor is not ready'));
  return editor.save();
}

/**
 * Enabled state for a table command when the caller holds the paginated surface.
 *
 * Uses the same planner-backed `tableCommandState` as `Editor.can`/`gateTableCommand`.
 * Chrome slot mapping for table controls is Task 9 — this helper is the shared
 * can-before-exec seam for arbitrary table commands.
 *
 * @public
 */
export function tableCommandToolbarState(
  surface: PaginatedSurface | null,
  command: EditorCommand
): Pick<ToolbarCommandState, 'enabled' | 'disabledReason'> {
  if (!surface) return { enabled: false, disabledReason: 'editor is not ready' };
  const state = tableCommandState(command, surface);
  return state.can.ok
    ? { enabled: true, disabledReason: null }
    : { enabled: false, disabledReason: state.can.reason };
}

/**
 * Run a table command: planner-backed `can` first, then `exec` only when allowed.
 *
 * @public
 */
export function runTableCommand(
  editor: Editor | null,
  command: EditorCommand,
  options?: EditorExecOptions
): ExecResult {
  if (!editor) return { ok: false, code: 'unsupported', reason: 'editor is not ready' };
  const allowed = editor.can(command, options);
  if (!allowed.ok) return { ok: false, code: allowed.code, reason: allowed.reason };
  return editor.exec(command, options);
}
