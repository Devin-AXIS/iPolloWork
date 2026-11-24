// Writing text to the system clipboard, for the `copy` and `cut` commands.
//
// This is the one effect `execEditorCommand` performs outside the surface, and it is
// isolated here rather than inlined so that the switch stays a list of surface calls and
// this file carries the reasoning about why the effect is safe to fire and forget.
//
// WRITE, NOT READ. Clipboard write is gated on a user gesture but never prompts, so the
// engine can own it. Clipboard READ prompts in Chrome and is refused outright by Firefox
// and Safari, which is why `paste` takes its text as an argument instead — see the command
// docs in `contracts/editor.ts`.

/**
 * Put `text` on the system clipboard, if this environment has one.
 *
 * Returns nothing and never throws. The promise is deliberately not surfaced: by the time
 * it settles, `cut` has already deleted the selection, and failing the command on a late
 * clipboard rejection would report a document edit as not having happened when it did.
 *
 * A missing `navigator.clipboard` — an insecure origin, a non-browser host running the
 * engine headless — is a no-op rather than an error, for the same reason: the caller asked
 * the document a question, and the document answered.
 *
 * `view` is the window the editor is mounted in. Its clipboard is the one with focus when the
 * editor lives in a pop-out window; the opener's rejects the write there.
 */
export function writeClipboardText(text: string, view?: Window): void {
  if (text === '') return;
  const clipboard = (view ?? globalThis).navigator?.clipboard;
  if (!clipboard?.writeText) return;
  try {
    // `void` the promise explicitly: a rejected clipboard write must not surface as an
    // unhandled rejection in the host's console for something the user cannot act on.
    void clipboard.writeText(text).catch(() => {});
  } catch {
    // Some environments throw synchronously rather than rejecting. Same answer.
  }
}

/**
 * Put both clipboard flavours on the system clipboard, same never-throws contract.
 *
 * Both payloads are built by the caller BEFORE this runs — Safari requires `ClipboardItem`
 * payloads resolvable inside the user gesture. Where `ClipboardItem` or `write` is missing
 * (Firefox behind a flag, headless hosts), the plain text still lands via `writeText`;
 * the richer flavour is an enhancement, never the difference between copy working and not.
 */
export function writeClipboardRich(text: string, html: string | null, view?: Window): void {
  if (text === '' && (html === null || html === '')) return;
  // One window for all of it: a clipboard rejects a `ClipboardItem` or `Blob` from another.
  const realm = (view ?? globalThis) as Window & {
    ClipboardItem?: new (items: Record<string, Blob>) => ClipboardItem;
    Blob?: typeof Blob;
  };
  const clipboard = realm.navigator?.clipboard;
  if (!clipboard) return;
  const ClipboardItemCtor = realm.ClipboardItem;
  const BlobCtor = realm.Blob;
  if (html && clipboard.write && ClipboardItemCtor && BlobCtor) {
    try {
      const item = new ClipboardItemCtor({
        'text/plain': new BlobCtor([text], { type: 'text/plain' }),
        'text/html': new BlobCtor([html], { type: 'text/html' }),
      });
      void clipboard.write([item]).catch(() => {
        writeClipboardText(text, view);
      });
      return;
    } catch {
      // Fall through to the plain write below.
    }
  }
  writeClipboardText(text, view);
}
