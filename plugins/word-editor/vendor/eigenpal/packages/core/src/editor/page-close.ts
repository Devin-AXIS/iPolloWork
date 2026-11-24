/**
 * One `pagehide` listener for every editor, registered when this module loads.
 *
 * A host usually flushes its telemetry on `pagehide` too. A browser runs `window` listeners in
 * the order they were added, and a telemetry SDK starts no second export while its first one
 * is in flight, which during unload never completes. An editor that ended its session from a
 * listener added at its own creation would end after the host's flush, and its last summaries
 * would be lost. Module evaluation runs before the host code that imports the editor, so this
 * listener runs first.
 */

const closing = new Set<() => void>();

const onPageHide = (event: Event): void => {
  // A page kept in the back-forward cache is not closing: its editors come back.
  if ((event as { persisted?: boolean }).persisted) return;
  for (const run of [...closing]) {
    try {
      run();
    } catch {
      /* one editor's report must not stop another's */
    }
  }
};

globalThis.addEventListener?.('pagehide', onPageHide);

/** Run `run` when the page closes. Returns the function that stops it. */
export function onPageClose(run: () => void): () => void {
  closing.add(run);
  return () => {
    closing.delete(run);
  };
}
