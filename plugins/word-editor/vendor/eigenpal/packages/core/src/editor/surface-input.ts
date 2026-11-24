// DOM input wiring for the paginated surface (paginated-surface seam).
//
// This module owns how browser input becomes surface calls: the keymap, the `beforeinput`
// dispatch, clipboard handlers, and the composition readback that diffs what an IME wrote
// into the painted DOM. Everything is a factory over the `PaginatedSurface` interface plus
// the little state it cannot own — so React, Vue and a plain page get identical behaviour
// instead of three hand-written keymaps that drift.

import { chordLetter, isGoToChord } from './chord-letter.ts';
import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { NavigationCommand } from '@docx-editor.dev/core/layout';
import { paragraphTextOf } from '@docx-editor.dev/core/store';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { plainTextFromTransfer } from './clipboard-plain-text.ts';
import { selectionsEqual, spanSearchRoots } from './dom-selection.ts';
import { partOfNodeId } from './surface-scope.ts';
import { collapsedAt } from './surface-selection-ops.ts';
import { paintedTextIn, type CompositionSpanChanges } from './surface-composition-readback.ts';
import type { ImeDeletionPlan } from './surface-ime-deletion.ts';
import { historyShortcutOf } from './history-shortcut.ts';
import { surfaceCrossNoteRefusal } from './surface-note-story.ts';
import {
  moveByTabInTable,
  selectionHeadInTableCell,
  tabTypesTabInCell,
} from './surface-table-tab.ts';

const NAVIGATION: Record<string, NavigationCommand> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'lineStart',
  End: 'lineEnd',
};

/**
 * Whether the keymap answers this key on read-only pages: a selection extended with Shift, or
 * select-all. An unshifted caret key would walk a caret nobody sees, so the browser keeps it
 * and scrolls the document, as it does on any page that is not editable.
 */
function keySelectsReadOnly(event: KeyboardEvent): boolean {
  if (NAVIGATION[event.key] || event.key === 'PageUp' || event.key === 'PageDown') {
    return event.shiftKey;
  }
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a';
}

/** Paragraph alignment shortcuts (`w:jc`), matching Word. */
const ALIGNMENT: Record<string, string> = {
  l: 'left',
  e: 'center',
  r: 'right',
  j: 'both',
};

/**
 * Line-spacing shortcuts, in 240ths of a line — Word's Ctrl+1 / Ctrl+5 / Ctrl+2.
 *
 * `w:lineRule="auto"` is what makes these MULTIPLES rather than fixed heights.
 */
const LINE_SPACING: Record<string, string> = {
  '1': '240',
  '5': '360',
  '2': '480',
};

/** Run-property shortcuts, matching Word and every browser editor. */
const FORMATTING: Record<string, { localName: string; attributes?: Record<string, string> }> = {
  b: { localName: 'b' },
  i: { localName: 'i' },
  u: { localName: 'u', attributes: { val: 'single' } },
};

/**
 * Whether this keystroke is one of the Alt-held ACCELERATORS, rather than a character being
 * composed with AltGr.
 *
 * The two are the same bits on Windows and Linux: AltGr sets `ctrlKey` AND `altKey`, so every
 * `Ctrl+Alt+<letter>` binding also sits on top of a character somebody's layout types — AltGr+C
 * is `ć` on Polish, AltGr+D is `đ` on Croatian. Swallowing those typed nothing at all.
 *
 * `getModifierState('AltGraph')` is not the whole answer on its own. It reports the MODIFIER,
 * not whether this key composes anything with it, and it is true for every Ctrl+Alt press on a
 * layout that has an AltGr level — so refusing on it alone would have taken the long-shipped
 * `Ctrl+Alt+F` and `Ctrl+Alt+D` note chords down on Polish and Croatian, where those two keys
 * compose nothing. What settles it is whether a character WAS composed, which is exactly what
 * `chordLetter` answers: a composed character is not a Latin letter, so the letter it returns came
 * from the KEYCAP and differs from what was typed.
 *
 * The macOS half never reaches any of that: the chord there is Cmd+Option, and Command is not
 * a modifier a layout composes with — Option alone is, which is why `event.key` there is `ç`
 * for the very chord we want and cannot be compared.
 */
function isAltAccelerator(event: KeyboardEvent, letter: string): boolean {
  if (!event.altKey) return false;
  if (event.metaKey) return true;
  if (!event.ctrlKey) return false;
  // Optional call: a synthesised event in a test environment may not implement it, and
  // "no AltGraph" is the honest default for a keystroke that cannot say.
  if (!(event.getModifierState?.('AltGraph') ?? false)) return true;
  return event.key.toLowerCase() === letter;
}

export function createKeyDownHandler(
  surface: PaginatedSurface,
  hooks: {
    /**
     * Ctrl/Cmd+K — Word's Insert Hyperlink. The keymap does not know what a link dialog
     * looks like, so it reports the request and the host's chrome answers it; a host with
     * no hyperlink UI simply does not pass this, and the key falls through to the browser
     * rather than doing something surprising. Answering `false` (no link UI took it) lets
     * the key through too.
     */
    readonly onRequestHyperlink?: () => boolean | void;
    /**
     * Ctrl/Cmd+Shift+F5 opens the host's bookmark dialog. Answers whether chrome took the
     * request; when none did, the key is left to the browser.
     */
    readonly onRequestBookmark?: () => boolean;
    /**
     * Ctrl+G (Cmd+Option+G on macOS) opens the host's Go To UI. Answers whether chrome took
     * the request; when none did, the key is left to the browser.
     */
    readonly onRequestGoTo?: () => boolean;
    readonly onToggleParagraphMarks?: () => void;
    /** @internal */
    readonly onToggleFieldCodes?: () => void;
  } = {}
): (event: KeyboardEvent) => void {
  return (event: KeyboardEvent): void => {
    // FAIL SOFT on a chord someone else already claimed.
    //
    // This keymap is wired to the painted pages, which sit inside the host's own chrome, and
    // hosts bind accelerators of their own — React's live zoom takes Ctrl/Cmd+`=`/`-`/`0` in
    // the CAPTURE phase, and Word's subscript/superscript is bound to the same `=` chord
    // below. Both firing made one keystroke zoom AND rewrite the selection's run properties.
    // A prevented event has an owner, so there is nothing left here to do.
    if (event.defaultPrevented) return;
    // Viewing, or pages a refresh holds read-only for a moment.
    const readOnly =
      surface.editingMode() === 'view' ||
      (event.currentTarget as HTMLElement | null)?.contentEditable === 'false';
    if (
      event.key === 'F5' &&
      event.shiftKey &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.isComposing &&
      hooks.onRequestBookmark?.()
    ) {
      event.preventDefault();
      return;
    }
    if (isGoToChord(event) && hooks.onRequestGoTo?.()) {
      event.preventDefault();
      return;
    }
    // macOS delivers Fn+Option+F9 as Alt+F9; Fn is handled by the keyboard.
    if (
      event.key === 'F9' &&
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      !event.isComposing &&
      hooks.onToggleFieldCodes
    ) {
      event.preventDefault();
      hooks.onToggleFieldCodes();
      return;
    }
    if (
      !event.altKey &&
      !event.isComposing &&
      ((event.metaKey && !event.ctrlKey && !event.shiftKey && event.key === '8') ||
        (event.ctrlKey &&
          !event.metaKey &&
          event.shiftKey &&
          (event.code === 'Digit8' || event.key === '*'))) &&
      hooks.onToggleParagraphMarks
    ) {
      event.preventDefault();
      hooks.onToggleParagraphMarks();
      return;
    }
    // Past the view chords, read-only pages answer only the keys that select. Every other key
    // here would be a refused write, and Tab has to leave the pages, which stay focusable for
    // selection, rather than be swallowed. Ctrl/Cmd+C is the browser's, through `copy`.
    if (readOnly && !keySelectsReadOnly(event)) return;
    // Escape releases the transient modes, innermost first. The format painter is the
    // innermost of all: it is armed ON TOP of whatever scope is open, so a press that closed
    // a header instead would leave the painter armed with no way left to release it.
    if (event.key === 'Escape' && surface.formatPainter.state().mode !== 'off') {
      surface.formatPainter.disarm();
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape' && surface.activeScope().kind === 'headerFooter') {
      surface.exitHeaderFooter();
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape' && surface.activeScope().kind === 'note') {
      surface.exitNote();
      event.preventDefault();
      return;
    }
    // Word: Ctrl/Cmd+Alt+F footnote, Ctrl/Cmd+Alt+D endnote, and the Format Painter pair.
    const altLetter = chordLetter(event);
    if (isAltAccelerator(event, altLetter) && !event.shiftKey) {
      const key = altLetter;
      if (key === 'f') {
        event.preventDefault();
        surface.insertNote('footnote');
        return;
      }
      if (key === 'd') {
        event.preventDefault();
        surface.insertNote('endnote');
        return;
      }
      // The Format Painter, on Alt rather than on the desktop word processor's Shift pair.
      //
      // Ctrl+Shift+C / Ctrl+Shift+V is what a desktop application binds, and neither half is
      // available to a page: Ctrl+Shift+C opens the browser's element inspector, which
      // `preventDefault` does not cancel, and Ctrl/Cmd+Shift+V is already
      // paste-without-formatting below — a browser-native paste chord, and the only one the
      // engine ever gets a `paste` event for. That leaves the Alt pair, which is also where
      // the note chords above live, so one modifier covers every accelerator this keymap
      // adds beyond the platform's own.
      //
      // KNOWN LIMIT: on macOS the browsers bind Cmd+Option+C to the element inspector, and a
      // browser accelerator cannot be cancelled from a page. The capture below still runs,
      // and DevTools opens over it. Both halves stay reachable from the toolbar button and
      // the right-click menu, which is what the guide points a Mac reader at; the paste half
      // (Cmd+Option+V) is unclaimed and works.
      if (key === 'c') {
        event.preventDefault();
        surface.formatPainter.capture();
        return;
      }
      if (key === 'v') {
        event.preventDefault();
        surface.formatPainter.apply();
        return;
      }
    }
    const accel = event.metaKey || event.ctrlKey;
    // Engine-driven navigation owns caret motion in body AND open furniture. Furniture
    // stops come from story-scoped layout geometry (tab advances, projected fields), so
    // the browser never walks a painted `\t` width as if it were model offsets.
    const command = NAVIGATION[event.key];
    if (command) {
      let scoped: NavigationCommand = command;
      if (event.key === 'Home' || event.key === 'End') {
        // Ctrl/Cmd+Home and End address the document rather than the line.
        if (accel) scoped = event.key === 'Home' ? 'documentStart' : 'documentEnd';
      } else if (
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
        // Word-wise motion: Alt on macOS, Ctrl elsewhere. Both are accepted rather than
        // sniffing the platform, so a mac keyboard on Linux still behaves.
        (event.altKey || event.ctrlKey)
      ) {
        scoped = event.key === 'ArrowLeft' ? 'wordLeft' : 'wordRight';
      } else if (event.metaKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        // Cmd+Arrow is the LINE gesture on macOS, where most keyboards carry no Home/End
        // key — binding line motion to those alone left it unreachable, and this branch
        // fell through to character motion that then preventDefault'd the native one.
        // Keyed on Cmd specifically, not on `accel`: Ctrl+Arrow is word motion above.
        scoped = event.key === 'ArrowLeft' ? 'lineStart' : 'lineEnd';
      } else if (accel && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        scoped = event.key === 'ArrowUp' ? 'documentStart' : 'documentEnd';
      }
      surface.navigate(scoped, event.shiftKey);
      event.preventDefault();
      return;
    }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      // A page is a real unit here — every caret stop knows its sheet — so this moves ONE
      // page. Ctrl/Cmd is Word's jump to the document edge. Open furniture stays within the
      // story stops (single-sheet furniture → document edge of that story).
      surface.navigate(
        accel
          ? event.key === 'PageUp'
            ? 'documentStart'
            : 'documentEnd'
          : event.key === 'PageUp'
            ? 'pageUp'
            : 'pageDown',
        event.shiftKey
      );
      event.preventDefault();
      return;
    }
    if (event.key === 'Backspace') {
      // Ctrl/Alt+Backspace deletes the word before the caret — Word, and every native
      // text field on both platforms.
      if (accel || event.altKey) surface.deleteWordBackward();
      else surface.deleteBackward();
      event.preventDefault();
      return;
    }
    if (event.key === 'Delete') {
      if (accel || event.altKey) surface.deleteWordForward();
      else surface.deleteForward();
      event.preventDefault();
      return;
    }
    if (event.key === 'Tab') {
      // Form-fill mode: Tab / Shift+Tab move between editable content controls (tabIndex,
      // then document order), skipping locked / bound ones. Explicit mode only.
      if (surface.contentControls.formFill()) {
        if (surface.contentControls.navigate(event.shiftKey ? 'previous' : 'next')) {
          event.preventDefault();
          return;
        }
      }
      // In a table cell, Tab and Shift+Tab move between cells; Option+Tab (Ctrl+Tab) types a
      // tab character there.
      if (tabTypesTabInCell(event) && !event.isComposing) {
        if (selectionHeadInTableCell(surface)) {
          // Over several selected cells it does nothing: typing would clear them all.
          if ((surface.state().cellSelection?.cellIds.length ?? 0) <= 1) surface.insertTab();
          event.preventDefault();
          return;
        }
      } else if (
        !event.isComposing &&
        moveByTabInTable(surface, event.shiftKey ? 'previous' : 'next')
      ) {
        event.preventDefault();
        return;
      }
      // In a LIST, Tab demotes and Shift+Tab promotes — the list level, so the marker
      // changes with it. Outside one, Tab and Shift+Tab change the indent of a selection over
      // paragraphs, or from a paragraph start, and keep the text. Anywhere else Tab types a
      // tab character and Shift+Tab outdents.
      const direction = event.shiftKey ? 'decrease' : 'increase';
      if (surface.isListParagraph()) {
        surface.adjustIndent(direction);
      } else if (!surface.indentWithTab(direction)) {
        if (event.shiftKey) surface.adjustIndent('decrease');
        else surface.insertTab();
      }
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      // Three different breaks on one key, exactly as Word maps them:
      //   Enter        end the paragraph and start a new one
      //   Shift+Enter  a line break INSIDE the paragraph (`w:br`)
      //   Ctrl+Enter   a hard page break (`w:br w:type="page"`)
      if (accel) surface.insertPageBreak();
      else if (event.shiftKey) surface.insertLineBreak();
      // Enter on an empty list item ends the list rather than making another empty one.
      else if (!surface.exitListOnEmptyItem()) surface.splitParagraph();
      event.preventDefault();
      return;
    }
    if (accel && event.key.toLowerCase() === 'a') {
      surface.selectAll();
      event.preventDefault();
      return;
    }
    if (accel && event.shiftKey && event.key.toLowerCase() === 'v') {
      // Paste without formatting. The keydown handler cannot reach the clipboard — the
      // payload only exists on the `paste` event, and some engines deliver plain-only
      // payloads for this chord anyway — so the chord ARMS a force-plain flag the paste
      // handler consumes, and deliberately does not prevent default.
      surface.armForcePlainPaste();
      return;
    }
    if (accel && !event.shiftKey && event.key.toLowerCase() === 'k' && hooks.onRequestHyperlink) {
      // Word's Insert Hyperlink. On an existing link this opens EDIT mode seeded from it,
      // which is the host's job — the keymap only says the user asked.
      if (hooks.onRequestHyperlink() === false) return;
      event.preventDefault();
      return;
    }
    if (accel && !event.shiftKey && FORMATTING[event.key.toLowerCase()]) {
      const property = FORMATTING[event.key.toLowerCase()]!;
      surface.toggleRunProperty(property.localName, property.attributes);
      event.preventDefault();
      return;
    }
    // Word's Ctrl+= / Ctrl+Shift+=, kept for hosts that leave the chord to this keymap.
    //
    // The two controls' tooltips no longer advertise it: React's live zoom claims the same
    // chord in the capture phase (the `defaultPrevented` return at the top of this handler),
    // so the chrome registry names subscript and superscript plainly rather than promising a
    // keystroke that zooms there. The binding stays because it is still the only way to reach
    // these toggles from the keyboard in a host with no zoom handler.
    //
    // WHICH of the two is decided by Shift alone, never by the character: `event.key` is
    // the PRODUCED character, so shifting `=` reports `+` on a US layout, and reading the
    // character to choose sent Ctrl+`+` to superscript on the layouts where `+` is
    // unshifted (German) — the opposite of what was pressed. `event.code` is matched as
    // well so the US pair keeps working whatever the key happens to produce.
    if (accel && (event.key === '=' || event.key === '+' || event.code === 'Equal')) {
      surface.toggleRunProperty('vertAlign', {
        val: event.shiftKey ? 'superscript' : 'subscript',
      });
      event.preventDefault();
      return;
    }
    if (accel && event.shiftKey && event.key.toLowerCase() === 'm') {
      surface.adjustIndent('decrease');
      event.preventDefault();
      return;
    }
    if (accel && !event.shiftKey && event.key.toLowerCase() === 'm') {
      surface.adjustIndent('increase');
      event.preventDefault();
      return;
    }
    if (accel && !event.shiftKey && ALIGNMENT[event.key.toLowerCase()]) {
      // Cmd+R is the browser's reload and the browser RESERVES it — preventDefault does
      // not cancel the reload, so claiming the chord would right-align and then lose the
      // page anyway. Right alignment stays on Ctrl+R, which pages may claim and which is
      // an unused chord on macOS.
      if (event.metaKey && event.key.toLowerCase() === 'r') return;
      surface.setParagraphProperties([
        {
          localName: 'jc',
          attributes: { val: ALIGNMENT[event.key.toLowerCase()]! },
          physicalAlignment: true,
        },
      ]);
      event.preventDefault();
      return;
    }
    if (accel && !event.shiftKey && LINE_SPACING[event.key]) {
      // Merged, like the toolbar's `setLineSpacing`: `w:spacing` carries the line rule AND
      // the space before and after, so a replacing write made Ctrl+2 delete the paragraph's
      // paragraph spacing on its way to double-spacing it.
      surface.setParagraphProperty(
        'spacing',
        { line: LINE_SPACING[event.key]!, lineRule: 'auto' },
        { mergeAttributes: true }
      );
      event.preventDefault();
      return;
    }
    const history = historyShortcutOf(event);
    if (history) {
      // Undo and redo publish a model change like any other commit, so the scheduler
      // repaints. What the scheduler cannot supply is WHERE the caret belongs: offsets in
      // the reverted tree do not correspond to offsets in the one that replaced it, so the
      // entry's own selection is restored.
      if (history === 'redo') surface.redo();
      else surface.undo();
      event.preventDefault();
    }
  };
}

/**
 * Clipboard.
 *
 * Copy and cut write TWO flavours: `text/plain`, and `text/html` carrying the interop
 * markup with the fragment package embedded on its wrapper (rich-clipboard-fidelity).
 * Paste routes by fidelity — embedded fragment, external HTML, plain text — and every
 * rich payload goes through the SAME bounded parse the file path uses: the fragment
 * through `readOoxmlPackage`, external HTML through the inert `DOMParser` projection.
 * Nothing from the clipboard ever reaches an HTML sink; see clipboard-paste-router.ts.
 */
export function createClipboardHandlers(surface: PaginatedSurface): {
  onCopy: (event: ClipboardEvent) => void;
  onCut: (event: ClipboardEvent) => void;
  onPaste: (event: ClipboardEvent) => void;
} {
  const writeFlavours = (event: ClipboardEvent): boolean => {
    const flavours = surface.copyFlavours();
    if (flavours.reason) {
      event.preventDefault();
      return false;
    }
    // A chart's name can be empty; its HTML flavour still carries the copy.
    if ((!flavours.text && !flavours.chartDrawingNodeId) || !event.clipboardData) return false;
    event.clipboardData?.setData('text/plain', flavours.text);
    if (flavours.html) event.clipboardData?.setData('text/html', flavours.html);
    chartCut = flavours.chartDrawingNodeId ?? null;
    return true;
  };
  let chartCut: string | null = null;

  const onCopy = (event: ClipboardEvent): void => {
    if (!writeFlavours(event)) return;
    event.preventDefault();
  };

  const onCut = (event: ClipboardEvent): void => {
    // Viewing refuses the delete, so the cut copies nothing either. A cut is never a copy.
    if (surface.editingMode() === 'view') {
      event.preventDefault();
      return;
    }
    // Across notes the delete is refused, so the cut copies nothing either.
    if (surfaceCrossNoteRefusal(surface)) {
      event.preventDefault();
      surface.deleteSelection(); // Publishes the refusal reason.
      return;
    }
    if (!writeFlavours(event)) return;
    // A cut of one selected chart deletes that chart; there is no text range to delete.
    if (chartCut) surface.deleteImage(chartCut);
    else surface.deleteSelection();
    event.preventDefault();
  };

  const onPaste = (event: ClipboardEvent): void => {
    const text = plainTextFromTransfer(event.clipboardData);
    const html = event.clipboardData?.getData('text/html') ?? '';
    event.preventDefault();
    if (!text && !html) return;
    surface.pasteRich(text, html.length > 0 ? html : null);
  };

  return { onCopy, onCut, onPaste };
}

/** Plain text from an input event's data transfer, if it carries any. */
function dataTransferText(event: InputEvent): string | null {
  // TEXT ONLY, never structure. A drag carries markup from anywhere on the machine, so
  // the HTML flavour is read for the text inside it and nothing else — see
  // clipboard-plain-text.ts. Dropping a payload that omits `text/plain` outright is what
  // made a drop from those applications look like a dead gesture.
  const text = plainTextFromTransfer(event.dataTransfer);
  return text.length > 0 ? text : null;
}

export function createBeforeInputHandler(
  surface: PaginatedSurface,
  hooks: {
    readonly isComposing: () => boolean;
    readonly insertPlainText: (text: string) => void;
    /**
     * An applied `insertReplacementText` was prevented, but the browser still parks its own
     * selection over the text it meant to replace — before or after this dispatch, over a
     * paint that can be a commit behind the model. The selection mirror re-asserts the model
     * selection and treats the queued echo as the browser's, not the user's.
     */
    readonly onBrowserSelectionFixup?: () => void;
    /**
     * How a `deleteContentBackward` / `deleteContentForward` event deletes: the steps its
     * target range names at the caret, or a range the browser shows selected. Without it,
     * each event is one step. See surface-ime-deletion.ts.
     */
    readonly deletionPlan?: (
      event: InputEvent,
      direction: 'backward' | 'forward'
    ) => ImeDeletionPlan;
    /** Run that many steps, stopping at one that changes nothing. Without it, all run. */
    readonly runDeletionSteps?: (count: number, step: () => void) => void;
    /** A deletion arrived as `beforeinput`: from an input method, never from the keymap. */
    readonly onInputMethodDeletion?: () => void;
  }
): (event: InputEvent) => void {
  const deleteBy = (event: InputEvent, direction: 'backward' | 'forward'): void => {
    const step = direction === 'backward' ? surface.deleteBackward : surface.deleteForward;
    const plan = hooks.deletionPlan?.(event, direction) ?? { kind: 'steps', count: 1 };
    if (plan.kind === 'selection') {
      surface.setSelection(plan.selection);
      step.call(surface);
    } else {
      const run = () => step.call(surface);
      // Without the hook, one step: the planner that counts is the same lane that runs them.
      if (hooks.runDeletionSteps) hooks.runDeletionSteps(plan.count, run);
      else run();
    }
    hooks.onInputMethodDeletion?.();
  };
  return (event: InputEvent): void => {
    // PREVENTED FIRST, dispatched second.
    //
    // The pages are editable, so anything this handler does not recognise is a mutation the
    // browser performs on the painted DOM: Format-menu bold, emacs kill-line, transpose,
    // yank, insert-list, drop. The model never sees it, and worse, every span after it keeps
    // a `data-start` that no longer matches its text — so the NEXT keystroke commits at the
    // wrong offset. An unknown input type must be dropped, never passed through.
    event.preventDefault();

    if (hooks.isComposing()) {
      // The IME owns the DOM until it finishes; reconciliation happens at composition end.
      return;
    }

    if (event.inputType === 'insertText' && event.data != null) {
      // Queued, not committed: a keystroke burst aggregates into one transaction
      // and one layout flush instead of paying a full flush per character. Every
      // other input type below still commits synchronously, and each of those
      // paths flushes the queue first.
      surface.enqueueType(event.data);
      return;
    }
    if (event.inputType === 'insertFromPaste') {
      // The paste handler already ran and did the work.
      return;
    }
    if (event.inputType === 'insertReplacementText') {
      // Autocorrect, dictation and smart substitutions arrive this way — NOT from a paste.
      // The replacement text is on the event; applying it is how a correction survives
      // instead of being silently dropped.
      const replacement = event.data ?? dataTransferText(event);
      if (!replacement) return;
      applyReplacementText(surface, replacementTarget(event), replacement);
      hooks.onBrowserSelectionFixup?.();
      return;
    }
    if (event.inputType === 'deleteContentBackward') {
      deleteBy(event, 'backward');
      return;
    }
    if (event.inputType === 'deleteWordBackward') {
      surface.deleteWordBackward();
      hooks.onInputMethodDeletion?.();
      return;
    }
    if (event.inputType === 'deleteContentForward') {
      deleteBy(event, 'forward');
      return;
    }
    if (event.inputType === 'deleteWordForward') {
      surface.deleteWordForward();
      hooks.onInputMethodDeletion?.();
      return;
    }
    if (event.inputType === 'insertLineBreak') {
      surface.insertLineBreak();
      return;
    }
    if (event.inputType === 'insertFromDrop' || event.inputType === 'insertFromPasteAsQuotation') {
      // The DROP lane stays plain text by design (rich-clipboard-fidelity non-goal): only
      // the paste router carries rich payloads, and it does so through the bounded parse
      // lanes. A drop's `text/html` is read for its visible text and nothing else.
      const dropped = dataTransferText(event);
      if (dropped) hooks.insertPlainText(dropped);
      return;
    }
    if (event.inputType === 'insertParagraph') {
      surface.splitParagraph();
    }
  };
}

/** The text one static range covers, or null when it cannot be read. */
function staticRangeText(range: StaticRange): string | null {
  const { startContainer, endContainer } = range;
  if (startContainer === endContainer && startContainer.nodeType === Node.TEXT_NODE) {
    return (startContainer.textContent ?? '').slice(range.startOffset, range.endOffset);
  }
  const doc = startContainer.ownerDocument;
  if (!doc) return null;
  try {
    const live = doc.createRange();
    live.setStart(startContainer, range.startOffset);
    live.setEnd(endContainer, range.endOffset);
    return live.toString();
  } catch {
    return null;
  }
}

/** What one `insertReplacementText` event targeted: its text, and its paragraph if known. */
interface ReplacementTarget {
  readonly text: string;
  /** The `data-paragraph-id` a CONNECTED target sits in; null for a detached (stale) node. */
  readonly paragraphId: string | null;
}

/** The target of a replacement event, or null when it names none the model could act on. */
function replacementTarget(event: InputEvent): ReplacementTarget | null {
  if (typeof event.getTargetRanges !== 'function') return null;
  const ranges = event.getTargetRanges();
  // ONE range only. A real substitution targets one contiguous run of text, and
  // concatenating several would let 'ab' + 'cd' pass the model match as 'abcd'.
  if (ranges.length !== 1) return null;
  const range = ranges[0]!;
  const text = staticRangeText(range);
  if (!text) return null;
  return { text, paragraphId: targetParagraphId(range) };
}

/** The paragraph a connected target range sits in, or null when it cannot say. */
function targetParagraphId(range: StaticRange): string | null {
  const node = range.startContainer;
  if (!node.isConnected) return null;
  const element =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : (node.parentElement ?? null);
  return element?.closest('[data-paragraph-id]')?.getAttribute('data-paragraph-id') ?? null;
}

/**
 * Apply a browser text substitution — autocorrect, dictation, macOS double-space period.
 *
 * The event's target range says WHAT the browser replaced, but its coordinates address the
 * painted DOM, which sits a paint behind the model during a typing burst — mapping them would
 * edit characters the substitution never meant. Its TEXT is matched instead, against the model
 * characters before the caret once the buffered burst has landed: on agreement the substitution
 * replaces them (double space becomes "word. ", not "word . "); on anything else the
 * replacement inserts at the caret, which never edits text the browser did not target. A
 * connected target that names ANOTHER paragraph is never matched — same characters in the
 * caret's paragraph would be a coincidence, not the browser's target.
 */
function applyReplacementText(
  surface: PaginatedSurface,
  target: ReplacementTarget | null,
  replacement: string
): void {
  if (target !== null) {
    // The model text and caret are read below, so the buffered burst sits ABOVE this read.
    // The targetless path skips the flush: `type()` head-flushes on its own.
    surface.flushPendingInput();
    const state = surface.state();
    const caret = state.selection.head;
    const replaced = target.text;
    if (
      selectionsEqual(state.selection, collapsedAt(caret)) &&
      caret.offset >= replaced.length &&
      (target.paragraphId === null || target.paragraphId === caret.paragraphId) &&
      // An armed caret format must ride the `type()` below exactly as it rides a plain
      // keystroke, and the range selection would retire it. The armed case keeps the
      // caret-insert lane; arming a format and substituting in the SAME keystroke gap
      // is rare enough that the un-replaced space costs less than the lost format.
      state.pendingFormat === null
    ) {
      // A pure ancestry read: `partOfNodeId`, never the story-store opener.
      const part = partOfNodeId(surface.session, caret.paragraphId) ?? surface.session.part();
      const text = paragraphTextOf(part, caret.paragraphId);
      if (text !== null && text.slice(caret.offset - replaced.length, caret.offset) === replaced) {
        surface.setSelection({
          anchor: { paragraphId: caret.paragraphId, offset: caret.offset - replaced.length },
          head: caret,
        });
      }
    }
  }
  surface.type(replacement);
}

/**
 * The text the browser currently shows for a paragraph, IN THE MODEL'S OWN OFFSET SPACE.
 *
 * The reading itself lives in surface-composition-readback.ts, which is the mirror of layout's
 * `paragraphTextFromLayout`: same rules for repeated ranges, projected atoms and unpainted
 * offsets, differing only in reading the PAINTED text so an IME's edit is visible.
 *
 * This wrapper owns one thing — WHICH ROOT to read. A header or footer open for editing is
 * searched first, because a shared part paints the same paragraph ids on every page and the
 * active band is the copy the caret entered; that is the preference the selection reader
 * already applies. `anchor` settles the same question where no scope attribute can: a
 * repeating table header row is ordinary body content on every page it repeats on.
 *
 * `modelText` is the paragraph's current model text, which the caller already holds.
 */
export function paintedTextOf(
  pagesLayer: HTMLElement,
  paragraphId: string,
  modelText: string,
  anchor: Node | null = null,
  changes?: CompositionSpanChanges
): string | null {
  for (const root of spanSearchRoots(pagesLayer)) {
    const painted = paintedTextIn(root, paragraphId, modelText, anchor, changes);
    if (painted !== null) return painted;
  }
  return null;
}

/**
 * The ops that bring a paragraph's model text to what the browser shows, or null when
 * nothing differs.
 *
 * Deliberately narrow: one paragraph, expressed as a single replace of the differing
 * middle. Anything wider would be guessing at what changed. `caret` is where the caret
 * belongs after the replace — at the end of the inserted text.
 */
export function paragraphReplacePlan(
  paragraphId: string,
  modelText: string,
  painted: string
): { ops: Parameters<TreeDocxSessionView['applyTreeOps']>[0][number][]; caret: number } | null {
  if (painted === modelText) return null;

  let prefix = 0;
  while (
    prefix < painted.length &&
    prefix < modelText.length &&
    painted[prefix] === modelText[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < painted.length - prefix &&
    suffix < modelText.length - prefix &&
    painted[painted.length - 1 - suffix] === modelText[modelText.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const inserted = painted.slice(prefix, painted.length - suffix);
  const ops: Parameters<TreeDocxSessionView['applyTreeOps']>[0][number][] = [];
  if (modelText.length - suffix > prefix) {
    ops.push({ op: 'deleteText', paragraphId, start: prefix, end: modelText.length - suffix });
  }
  if (inserted.length > 0) {
    ops.push({ op: 'insertText', paragraphId, offset: prefix, text: inserted });
  }
  if (ops.length === 0) return null;
  return { ops, caret: prefix + inserted.length };
}
