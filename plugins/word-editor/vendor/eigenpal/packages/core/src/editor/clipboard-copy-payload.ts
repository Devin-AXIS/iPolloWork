// Copy flavour assembly (rich-clipboard-fidelity tasks 3.3 and 3.5).
//
// One builder feeds both clipboard lanes — the DOM `copy`/`cut` event and the command
// lane — so they can never drift. Degrade is tiered when the payload outgrows its budget:
// first the media leaves the fragment, then the fragment attribute drops entirely; the
// interop HTML and plain text always ship. A cell-rectangle selection copies as grid text
// plus a flattened HTML table, with no fragment (design D8).

import {
  extractFragmentPackage,
  type FragmentCoverage,
  type OoxmlPackage,
} from '@docx-editor.dev/core/store';
import { interopHtmlFromFragmentPackage } from './clipboard-html-write.ts';
import { wrapInteropHtml } from './clipboard-fragment-codec.ts';

/** Fragment zips above this stay off the clipboard attribute (base64 grows them 4/3). */
export const MAX_COPY_FRAGMENT_BYTES = 12 * 1024 * 1024;

export interface CopyFlavourInput {
  /** The plain-text flavour, exactly as `selectedText()` reports it. */
  readonly text: string;
  /** True when the selection is a table cell rectangle rather than a range. */
  readonly cellRectangle: boolean;
  /** The coverage description for a body-story range selection, or null. */
  readonly coverage: FragmentCoverage | null;
  readonly pkg: OoxmlPackage | null;
  /** Test hook: overrides {@link MAX_COPY_FRAGMENT_BYTES}. */
  readonly maxFragmentBytes?: number;
}

export interface CopyFlavours {
  readonly reason?: 'unsupported-content' | 'chart-content';
  readonly text: string;
  /** The `text/html` flavour, or null when only plain text should be written. */
  readonly html: string | null;
  /** The chart drawing these flavours copy, when the selection is one chart. A cut deletes it. */
  readonly chartDrawingNodeId?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A cell rectangle as a plain HTML table: tabs are columns, newlines are rows. */
function gridHtmlOf(text: string): string {
  const rows = text
    .split('\n')
    .map(
      (row) =>
        `<tr>${row
          .split('\t')
          .map((cell) => `<td>${escapeHtml(cell)}</td>`)
          .join('')}</tr>`
    )
    .join('');
  return `<div><table>${rows}</table></div>`;
}

/** Assemble the clipboard flavours for the current selection. */
export function buildCopyFlavours(input: CopyFlavourInput): CopyFlavours {
  if (input.cellRectangle) return { text: input.text, html: gridHtmlOf(input.text) };
  if (!input.coverage || !input.pkg) return { text: input.text, html: null };

  const full = extractFragmentPackage(input.pkg, input.coverage);
  if (!full.ok)
    return {
      text: input.text,
      html: null,
      ...(full.reason === 'unsupported-content' ? { reason: full.reason } : {}),
    };

  const budget = input.maxFragmentBytes ?? MAX_COPY_FRAGMENT_BYTES;
  let fragmentBytes: Uint8Array | null = full.bytes;
  if (full.bytes.byteLength > budget) {
    // Tier 1: media stays home. Tier 2: no fragment at all; the interop HTML still ships.
    const lean = extractFragmentPackage(input.pkg, input.coverage, { omitMedia: true });
    fragmentBytes = lean.ok && lean.bytes.byteLength <= budget ? lean.bytes : null;
  }

  // The HTML half renders from the extraction's own in-memory package — copy is
  // synchronous in the clipboard event, so it never re-inflates its own zip (the
  // twin is single-sourced with the zip inside extractFragmentPackage). A
  // renderer throw degrades to an empty HTML body WITH a diagnostic: re-reading
  // the bytes would just rethrow the same deterministic bug after paying a
  // synchronous inflate + parse inside the copy handler.
  let inner: string;
  try {
    inner = interopHtmlFromFragmentPackage(full.package);
  } catch (error) {
    console.error('docx-editor: copy HTML flavour failed to render', error);
    inner = '';
  }
  const html = wrapInteropHtml(
    inner,
    fragmentBytes ? { bytes: fragmentBytes, lastMarkCovered: full.lastMarkCovered } : null
  );
  return { text: input.text, html };
}
