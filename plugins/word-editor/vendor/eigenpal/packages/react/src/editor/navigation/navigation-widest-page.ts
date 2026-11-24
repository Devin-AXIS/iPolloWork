import { hostTimers } from '@docx-editor.dev/core/editor';
// The widest laid-out page, which is the width of the page stack the navigation pane must
// clear. Both adapters carry an identical copy of this file.
//
// WHY NOT THE CARET'S PAGE SETUP. Every page starts at the stack's left edge and the stack is
// as wide as its widest page, so a portrait caret in a document with a landscape section
// measured the stack too narrow and let the pane cover the wider pages.
//
// WHEN IT IS READ. `getPageGeometry()` flushes any pending layout commit, so it is not read
// on every tick, and never on a plain text edit. It is read once when the pane opens, then
// once per settled burst of triggers: page-count steps and caret page-width changes (the
// caller nudges on those), and document changes that add or remove blocks or replace the
// document, which is how a section break with another page size arrives. A burst settles
// after `WIDEST_PAGE_SETTLE_MS` without a new trigger.

/** Quiet time, in ms, after the last trigger before the widest page is re-read. */
export const WIDEST_PAGE_SETTLE_MS = 150;

/** What the tracker needs from the editor. */
export interface WidestPageSource {
  getPageGeometry(): readonly { readonly box: { readonly width: number } }[];
  on(event: 'change', handler: (change: WidestPageChange) => void): () => void;
}

/** The part of a document change the tracker reads. */
export interface WidestPageChange {
  readonly source?: string;
  readonly created?: readonly string[];
  readonly deleted?: readonly string[];
}

/**
 * Whether a document change can change the page sizes: a replaced document, or blocks added
 * or removed (a section break). Edits inside existing blocks, such as typing, cannot.
 */
export function changesPageSizes(change: WidestPageChange): boolean {
  if (change.source !== undefined) return true;
  return (change.created?.length ?? 0) > 0 || (change.deleted?.length ?? 0) > 0;
}

/** The widest page box, in content px at 100%, or null before the first layout. */
export function widestPagePx(pages: readonly { readonly box: { readonly width: number } }[]) {
  let widest = 0;
  for (const page of pages) widest = Math.max(widest, page.box.width);
  return widest > 0 ? widest : null;
}

/** A running tracker. `nudge` schedules a settled re-read; `dispose` stops it. */
export interface WidestPageTracker {
  nudge(): void;
  dispose(): void;
}

/**
 * Read the widest page now, then again after each settled burst of changes.
 *
 * `owner` names a node of the editor's chrome. The settle timer runs on ITS window, which a
 * pop-out editor does not share with the script: a hidden opener throttles its timers.
 */
export function trackWidestPage(
  source: WidestPageSource,
  publish: (widest: number | null) => void,
  owner: () => Node | null = () => null
): WidestPageTracker {
  // The owner's window, resolved per call; pending work moves home if a pop-out closes.
  const timers = hostTimers(owner);
  let timer: number | null = null;
  let disposed = false;
  const read = () => {
    timer = null;
    if (!disposed) publish(widestPagePx(source.getPageGeometry()));
  };
  const nudge = () => {
    if (disposed) return;
    timers.clearTimeout(timer);
    timer = timers.setTimeout(read, WIDEST_PAGE_SETTLE_MS);
  };
  const offChange = source.on('change', (change) => {
    if (changesPageSizes(change)) nudge();
  });
  read();
  return {
    nudge,
    dispose() {
      disposed = true;
      timers.clearTimeout(timer);
      timer = null;
      offChange();
    },
  };
}
