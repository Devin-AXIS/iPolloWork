// What `createDocxEditor` and `load` accept as a document, turned into bytes or a reason.

import type { DocumentSource } from '@docx-editor.dev/core/contracts/editor';
import { blankDocumentBytes } from './blank-document.ts';

export function normalizeSource(source: DocumentSource): Uint8Array | null {
  // `'blank'` is Word's blank template, minted here rather than by every host: omitting
  // the document is NOT a way to ask for an empty one, and the engine should not make
  // hosts discover that the hard way. Fresh bytes per call, so two editors opened blank
  // never alias one buffer.
  if (source === 'blank') return blankDocumentBytes();
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  // Any OTHER string is a mistake worth naming. Falling through to the handle branch below
  // would answer a `document="/report.docx"` or a `'Blank'` typo with "a DocumentHandle
  // cannot be re-loaded", which names a type the caller never mentioned.
  if (typeof source === 'string') return null;
  // The remaining form is a DocumentHandle: identity and revision, not content.
  return null;
}

/**
 * Why a source produced no bytes, in the caller's own terms.
 *
 * `normalizeSource` answers `null` for two unrelated reasons, and a host that passed a
 * string deserves to hear about the string rather than about handles.
 */
export function unloadableSourceReason(source: DocumentSource): string {
  if (typeof source === 'string') {
    return `'${source}' is not a document; pass DOCX bytes, or 'blank' for an empty one`;
  }
  return 'a DocumentHandle cannot be re-loaded; pass DOCX bytes';
}
