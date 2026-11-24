// Fragment ↔ HTML attribute codec (rich-clipboard-fidelity task 3.1).
//
// The fragment package rides base64-encoded on ONE wrapper element inside the `text/html`
// clipboard flavour (design D1), so it survives cross-tab and cross-window paste while
// every external receiver just reads the visible markup. Reading back is a BOUNDED string
// scan — no DOM, no regex over attacker-sized input — and the decoded bytes then face
// `readOoxmlPackage`'s own zip/XML caps.

import { WORD_HTML_MATH_NAMESPACE, hasEquationHtml } from './clipboard-html-write-equations.ts';
import { clipboardBase64Of, clipboardDecodeBase64 } from './clipboard-html-base64.ts';

/** Decoded fragment payloads above this cap never reach the package reader. */
export const MAX_FRAGMENT_ATTRIBUTE_DECODED_BYTES = 16 * 1024 * 1024;
/** The attribute scan gives up beyond this many characters of HTML. */
const MAX_ATTRIBUTE_SCAN_CHARS = 64 * 1024 * 1024;

const FRAGMENT_ATTRIBUTE = 'data-docx-fragment';
const END_ATTRIBUTE = 'data-docx-fragment-end';

// One encoder for the whole clipboard lane — the chunked implementation in
// clipboard-html-base64.ts.
const encodeBase64 = clipboardBase64Of;

/** The clipboard-facing wrapper: interop HTML plus the embedded fragment. */
export function wrapInteropHtml(
  innerHtml: string,
  fragment: { readonly bytes: Uint8Array; readonly lastMarkCovered: boolean } | null
): string {
  const end = fragment?.lastMarkCovered ? 'covered' : 'open';
  const div = fragment
    ? `<div ${FRAGMENT_ATTRIBUTE}="${encodeBase64(fragment.bytes)}" ` +
      `${END_ATTRIBUTE}="${end}">${innerHtml}</div>`
    : `<div>${innerHtml}</div>`;
  // Word reads equation OMML only when the document root declares the `m` prefix.
  return hasEquationHtml(innerHtml)
    ? `<html xmlns:m="${WORD_HTML_MATH_NAMESPACE}"><body>${div}</body></html>`
    : div;
}

export interface DecodedFragmentPayload {
  readonly bytes: Uint8Array;
  readonly lastMarkCovered: boolean;
}

/** One attribute's value from raw HTML, found by bounded string scan. */
function attributeValueIn(html: string, attribute: string): string | null {
  const needle = `${attribute}="`;
  const at = html.indexOf(needle);
  if (at === -1 || at > MAX_ATTRIBUTE_SCAN_CHARS) return null;
  const start = at + needle.length;
  const end = html.indexOf('"', start);
  if (end === -1) return null;
  return html.slice(start, end);
}

/**
 * The embedded fragment payload, when the pasted HTML carries one. Malformed or oversized
 * payloads answer null and the caller degrades to the next flavour.
 */
export function fragmentFromHtml(
  html: string,
  maxDecodedBytes: number = MAX_FRAGMENT_ATTRIBUTE_DECODED_BYTES
): DecodedFragmentPayload | null {
  if (html.length > MAX_ATTRIBUTE_SCAN_CHARS) return null;
  const encoded = attributeValueIn(html, FRAGMENT_ATTRIBUTE);
  if (encoded === null || encoded.length === 0) return null;
  const bytes = clipboardDecodeBase64(encoded, maxDecodedBytes);
  if (bytes === null || bytes.byteLength === 0) return null;
  const end = attributeValueIn(html, END_ATTRIBUTE);
  return { bytes, lastMarkCovered: end === 'covered' };
}
