import { hostDocumentOf, hostWindowOf } from '@docx-editor.dev/core/editor';
// Handing saved bytes to the browser, and naming the file.
//
// The name comes from a user-typed document title, and a host that populates `title` from
// the package's own `docProps/core.xml` `dc:title` is feeding it a DOCX-DERIVED string —
// attacker-controlled, per the repo's trust rule. It lands in a `download` attribute,
// which the browser treats as a plain name rather than a path, so this is not an injection
// sink; what it IS is a name the user reads in a download shelf and a file manager, and
// those render bidi overrides and zero-width characters faithfully.

/**
 * Windows reserves these device names WITH ANY EXTENSION — `CON.docx` and `NUL.tar.docx`
 * are still `CON` and `NUL`. Saving to one fails or behaves strangely, so a bare device
 * name falls back and a device stem before a dot gets a `_` prefix. The `0` and
 * superscript digits and the console aliases are reserved too.
 */
const RESERVED_DEVICE_NAME = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;

/**
 * Characters that must not survive into a filename, in one class:
 *
 * - U+0000-U+001F C0 controls, U+007F DEL and the U+0080-U+009F C1 block. A newline
 *   would split the name; the rest are invisible.
 * - U+200B-U+200F zero-width space/non-joiner/joiner and the LTR/RTL marks. A title of
 *   nothing but these is "truthy", so it would save as a file the user can neither
 *   find in a list nor type in a terminal.
 * - U+202A-U+202E and U+2066-U+2069, the bidi embedding and isolate overrides. This is
 *   the filename-spoofing class: a title ending in RIGHT-TO-LEFT OVERRIDE followed by
 *   "fdp.exe" renders in a download shelf and in Finder as "...exe.pdf", while the
 *   bytes are a .docx. Display-only deception rather than execution, which is why it
 *   is low severity and still not something to ship.
 * - U+FEFF, the BOM / zero-width no-break space.
 * - The Windows-reserved characters, which include both path separators.
 *
 * Ordinary punctuation and spaces are deliberately KEPT: a title is prose, and
 * "Q3 report - draft" should survive as itself.
 */
const UNSAFE_IN_FILENAME =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff<>:"/\\|?*]/g;

/**
 * A conservative byte cap. `NAME_MAX` is 255 BYTES on ext4 and APFS, not 255 characters —
 * 120 emoji is 480 bytes — and the `.docx` suffix has to fit too.
 */
const MAX_NAME_BYTES = 200;

const encoder = new TextEncoder();

/**
 * Truncate to a UTF-8 byte budget without splitting a character.
 *
 * Iterating with `for…of` walks CODE POINTS, so an astral character is kept or dropped
 * whole. Slicing by UTF-16 units instead could leave a lone surrogate, which the browser
 * renders as U+FFFD in the name it saves.
 */
function capBytes(value: string, maxBytes: number): string {
  if (encoder.encode(value).length <= maxBytes) return value;
  let bytes = 0;
  let out = '';
  for (const character of value) {
    const size = encoder.encode(character).length;
    if (bytes + size > maxBytes) break;
    bytes += size;
    out += character;
  }
  return out;
}

/**
 * Drop trailing dots and spaces, scanning back from the end.
 *
 * A loop, not `/[.\s]+$/`: a backtracking engine retries that pattern from every dot or
 * space in a run that is NOT at the end, so a title of many ". " pairs followed by a
 * letter costs quadratic time on a string the document supplies. Only U+0020 is checked
 * because `downloadName` has already collapsed every other whitespace character to it.
 */
function stripTrailingDotsAndSpaces(value: string): string {
  let end = value.length;
  while (end > 0) {
    const code = value.charCodeAt(end - 1);
    if (code !== 0x2e && code !== 0x20) break;
    end -= 1;
  }
  return value.slice(0, end);
}

/**
 * Drop a `.docx` suffix and the dots and spaces on both sides of it, so `report.docx `,
 * `report.docx.` and `report. .docx` all end as `report`.
 */
function withoutDocxSuffix(value: string): string {
  return stripTrailingDotsAndSpaces(stripTrailingDotsAndSpaces(value).replace(/\.docx$/i, ''));
}

/**
 * A download name from a user-typed title, always ending in `.docx`.
 *
 * Falls back to `document.docx` when nothing usable survives — including for a title that
 * is only separators, only dots, or a bare reserved device name. A title whose stem before
 * the first dot is a device name keeps its text behind a `_` prefix (`_NUL.tar.docx`).
 */
export function downloadName(title: string | undefined): string {
  const normalized = (title ?? '').replace(UNSAFE_IN_FILENAME, ' ').replace(/\s+/g, ' ').trim();
  // Windows silently drops trailing dots and spaces, and a LEADING dot makes a hidden
  // file with an empty stem on macOS and Linux (`.docx` from a title of "."). The suffix
  // goes before the leading strip, so a title of `.docx` alone falls back.
  const cleaned = withoutDocxSuffix(normalized).replace(/^[. ]+/, '');
  // Again after the byte cap, because truncation can end on a dot, a space, or a new
  // `.docx` suffix. Only then: a typed `notes.docx.docx` keeps its inner suffix.
  const capped = capBytes(cleaned, MAX_NAME_BYTES);
  const base = capped === cleaned ? cleaned : withoutDocxSuffix(capped);
  if (!base || RESERVED_DEVICE_NAME.test(base)) return 'document.docx';
  // Windows resolves a device from the part before the FIRST dot, so `NUL.tar` is `NUL`.
  // A prefix keeps prose such as "Con. Law outline" rather than discarding the title.
  if (RESERVED_DEVICE_NAME.test(base.split('.', 1)[0]!.trim())) return `_${base}.docx`;
  return `${base}.docx`;
}

/**
 * Hand DOCX bytes to the browser as a download.
 *
 * `owner` is a node of the editor's chrome: the link is clicked in ITS document, which is not
 * the script's own when the editor renders into a pop-out window or an iframe.
 */
export function download(
  buffer: ArrayBuffer,
  name: string,
  mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  owner?: Node | null
): void {
  const url = URL.createObjectURL(
    new Blob([buffer], {
      type: mimeType,
    })
  );
  const anchor = hostDocumentOf(owner).createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  // Revoked on the next task, not inline: some browsers have not finished reading the
  // blob when `click()` returns, and a revoked URL cancels the download.
  hostWindowOf(owner).setTimeout(() => URL.revokeObjectURL(url), 0);
}
