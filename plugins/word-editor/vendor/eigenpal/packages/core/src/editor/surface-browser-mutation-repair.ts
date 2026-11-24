// Undo what the browser wrote on the page after the surface applied an input itself
// (paginated-surface seam).
//
// Every `beforeinput` the surface handles is prevented, and its edit applied to the model.
// Prevention does not always hold: a deletion an input method makes through the platform's
// text service (on Android, `InputConnection.deleteSurroundingText`) is applied to the DOM by
// Chromium even so. (Typed text needs no repair: it commits on a later task, and that paint
// rebuilds the paragraph the browser wrote into.) The page then shows the model's edit AND the browser's: two
// characters gone for one Backspace, every later span's text out of step with its
// `data-start`, and the browser's caret where its own deletion left it.
//
// The browser says when this happens: an `input` event fires only for an edit it actually
// applied. Between the handled `beforeinput` and that `input`, a mutation observer records
// what changed; the pages holding those nodes are then repainted from records, and the model
// selection is written back. Nothing is read back into the model: the edit the event named has
// already been applied once, and the browser's copy of it is the duplicate.

import { discardRetainedPaintOf } from '../output/semantic-paint.ts';
import { hostWindowOf, type HostTimers } from './host-realm.ts';
import type { SurfaceSelectionSync } from './surface-selection-sync.ts';

export interface BrowserMutationRepairDeps {
  readonly pagesLayer: HTMLElement;
  /**
   * The surface's render, which paints whatever retained paint was forgotten and writes the
   * model selection back. Called with `false`: nothing about the document or selection moved.
   */
  render(notifyChange: boolean): void;
  /** The surface's timers, which follow it into whatever window it moves to. */
  readonly timers: HostTimers;
  readonly sync: Pick<SurfaceSelectionSync, 'noteInputMethodEdit'>;
}

export interface BrowserMutationRepair {
  /**
   * Call after a handled `beforeinput`: watch for the browser applying it anyway. Only a
   * deletion is watched: a deletion commits at once, so a repaint restores it, while typed
   * text is still queued and a repaint now would hide it until the queue lands.
   */
  watch(event: InputEvent): void;
  /** Stop watching: a composition starts. */
  stop(): void;
  /** Stop watching and remove the `input` listener. */
  destroy(): void;
}

export function createBrowserMutationRepair(
  deps: BrowserMutationRepairDeps
): BrowserMutationRepair {
  let observer: MutationObserver | null = null;
  let timer: number | null = null;
  /** Records the observer delivered before `input`, should a microtask checkpoint fall between. */
  let delivered: MutationRecord[] = [];

  function stop(): void {
    observer?.disconnect();
    observer = null;
    delivered = [];
    deps.timers.clearTimeout(timer);
    timer = null;
  }

  deps.pagesLayer.addEventListener('input', onInput);
  return {
    watch(event) {
      stop();
      if (!event.inputType.startsWith('delete')) return;
      const win = hostWindowOf(deps.pagesLayer);
      if (typeof win.MutationObserver !== 'function') return;
      // Started AFTER the handler's own commit and paint, so only the browser's edit is seen.
      observer = new win.MutationObserver((records) => {
        delivered.push(...records);
      });
      observer.observe(deps.pagesLayer, { subtree: true, childList: true, characterData: true });
      // A prevented edit fires no `input`. The browser applies an edit within the task that
      // dispatched `beforeinput`, so the next task ends the watch before any later paint of
      // the surface's own could be mistaken for the browser's.
      timer = deps.timers.setTimeout(stop, 0);
    },
    stop,
    destroy() {
      stop();
      deps.pagesLayer.removeEventListener('input', onInput);
    },
  };
  function onInput(event: Event): void {
    if (!observer) return;
    const records = [...delivered, ...observer.takeRecords()];
    stop();
    // A composition's text is the input method's to write; its readback reconciles it.
    if ((event as InputEvent).isComposing) return;
    if (records.length === 0) return;
    // Only the sheets the browser touched are rebuilt; the rest keep their paint.
    const touched = records.map((record) => record.target).filter((node) => node.isConnected);
    // Every target gone: the edit was at the browser's caret, so that sheet is the one.
    const caret = deps.pagesLayer.ownerDocument.getSelection()?.anchorNode;
    discardRetainedPaintOf(deps.pagesLayer, touched.length > 0 || !caret ? touched : [caret]);
    deps.render(false);
    // The browser's caret, and the input method's correction of it, are on their way.
    deps.sync.noteInputMethodEdit();
  }
}
