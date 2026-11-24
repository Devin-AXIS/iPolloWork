// `replaceDocumentFromBase64`: replace the whole document with a DOCX file as one undoable
// edit. The automation form of the editor's `replaceDocument` command.
//
// INTERNAL. The planner decodes the base64 and pins the batch; the PORT opens the bytes and
// installs them, because only the owner knows its gates (viewing, protection, a collaboration
// session) and its undo history. Both ports report a refusal in the shape of the editor's
// `ReplaceDocumentRefusal`, and `replaceDocumentError` turns it into the protocol error, so a
// refusal means the same thing on every host.

import {
  contentControlPropertiesOf,
  contentControlsIn,
} from '../store/package/content-control-nodes.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { PackageUpdateRefusal } from '../store/store/tree-package-update.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation } from './operations.ts';
import { decodeBase64 } from './pictures.ts';
import type { PlannedOperation } from './plan-types.ts';
import type { AutomationError } from './protocol.ts';
import type { AutomationPackageReads } from './reads.ts';
import { resolveSpanRef, spanValue } from './spans.ts';
import { BODY_STORY } from './stories.ts';

/** Largest replacement document accepted, in decoded bytes. The compare limit. */
const MAX_REPLACEMENT_BYTES = 128 * 1024 * 1024;
/** The longest base64 text of a document within {@link MAX_REPLACEMENT_BYTES}. */
const MAX_REPLACEMENT_BASE64 = Math.ceil(MAX_REPLACEMENT_BYTES / 3) * 4;

/** The story parts a replacement overwrites: the body, headers, footers, notes, comments. */
const STORY_CONTENT_TYPES = [
  '.main+xml',
  '.header+xml',
  '.footer+xml',
  '.footnotes+xml',
  '.endnotes+xml',
  '.comments+xml',
];

/**
 * Whether a story holds a content control that editing API writes may not overwrite: one with
 * a `w:lock`, or one bound to custom XML. Every other editing API write refuses such content,
 * so a replacement that would delete or rewrite it refuses too.
 */
function holdsProtectedControl(pkg: OoxmlPackage): boolean {
  for (const part of pkg.parts.values()) {
    if (!STORY_CONTENT_TYPES.some((suffix) => part.contentType.endsWith(suffix))) continue;
    for (const { node } of contentControlsIn(part.root)) {
      const properties = contentControlPropertiesOf(node);
      if (properties.lock !== 'unlocked' || properties.dataBinding) return true;
    }
  }
  return false;
}

export interface ReplaceDocumentPlannerContext {
  readonly reads: AutomationPackageReads;
  readonly handles: AutomationHandleTable;
  /** Pins the write to the body story as a wholesale write, or answers why it cannot be. */
  readonly pin: () => PlannedOperation | null;
}

export function planReplaceDocument(
  operation: Extract<AutomationOperation, { op: 'replaceDocumentFromBase64' }>,
  context: ReplaceDocumentPlannerContext
): PlannedOperation {
  if (!context.reads.package || !context.reads.body)
    return { ok: false, error: { code: 'document-unavailable', message: 'document unavailable' } };
  if (typeof operation.base64 === 'string' && operation.base64.length > MAX_REPLACEMENT_BASE64)
    return {
      ok: false,
      error: {
        code: 'unsupported-capability',
        message: 'base64File is larger than the replacement size limit.',
        detail: 'edit.resource-limit',
      },
    };
  if (holdsProtectedControl(context.reads.package))
    return {
      ok: false,
      error: {
        code: 'unsupported-revision',
        message: 'The document holds locked or data-bound content controls.',
        detail: 'edit.protected-content',
      },
    };
  const docx = decodeBase64(operation.base64, MAX_REPLACEMENT_BYTES);
  if (!docx)
    return {
      ok: false,
      error: {
        code: 'unsupported-content',
        message: 'base64File is not valid base64.',
        detail: 'edit.invalid-argument',
      },
    };
  const conflict = context.pin();
  if (conflict) return conflict;
  const { handles } = context;
  return {
    ok: true,
    kind: 'documentReplace',
    docx,
    story: BODY_STORY,
    // The whole new body. Its node ids follow the open document where the content matches.
    answer: (post) => {
      const whole = resolveSpanRef({ body: handles.body(BODY_STORY) }, handles, post);
      if (!whole.ok || !whole.value) return { kind: 'applied' };
      return { kind: 'span', span: spanValue(whole.value, handles) };
    },
  };
}

/** Only a different main part is a cause a caller can act on; the rest are one cause. */
export const PACKAGE_UPDATE_REFUSALS: Readonly<
  Record<PackageUpdateRefusal, 'differentMainPart' | 'unsupportedDifference'>
> = {
  'missing-main-part': 'unsupportedDifference',
  'different-main-part': 'differentMainPart',
  unaligned: 'unsupportedDifference',
  failed: 'unsupportedDifference',
};

/**
 * A refused replacement, in the shape of the editor's `ReplaceDocumentRefusal`. Structural, so
 * this lane does not depend on the editor contracts.
 */
export interface ReplaceDocumentRefusalLike {
  readonly code: string;
  readonly reason?: string;
  readonly message: string;
}

/**
 * A refused replacement as a protocol error. `detail` is always a public diagnostic code, so
 * the object model can name the cause in `debugInfo.innerError`.
 *
 * | Refusal | Protocol code | Diagnostic |
 * | --- | --- | --- |
 * | `invalidDocument`, `invalidRequest` | `unsupported-content` | `edit.invalid-argument` |
 * | `staleDocument` | `stale-revision` | none |
 * | `unavailable` | `document-unavailable` | none |
 * | `unavailable` / `collaborationUnavailable` | `transaction-refused` | `edit.collaboration-not-ready` |
 * | `busy` | `transaction-refused` | `edit.refresh-in-progress` |
 * | `editNotPermitted` / `viewing` | `transaction-refused` | `edit.read-only` |
 * | `editNotPermitted` / `suggesting` | `unsupported-capability` | `edit.tracked-operation-unsupported` |
 * | `editNotPermitted` / `protected` | `unsupported-revision` | `edit.protected-content` |
 * | `editUnsupported` / `collaborationRefused` | `transaction-refused` | `edit.refused` |
 * | `editUnsupported` / other | `unsupported-capability` | `edit.unsupported-content` |
 */
export function replaceDocumentError(refusal: ReplaceDocumentRefusalLike): AutomationError {
  const error = (code: AutomationError['code'], detail?: string): AutomationError =>
    detail === undefined
      ? { code, message: refusal.message }
      : { code, message: refusal.message, detail };
  switch (refusal.code) {
    case 'invalidDocument':
    case 'invalidRequest':
      return error('unsupported-content', 'edit.invalid-argument');
    case 'staleDocument':
      return error('stale-revision');
    case 'unavailable':
      return refusal.reason === 'collaborationUnavailable'
        ? error('transaction-refused', 'edit.collaboration-not-ready')
        : error('document-unavailable');
    case 'busy':
      return error('transaction-refused', 'edit.refresh-in-progress');
    case 'editNotPermitted':
      if (refusal.reason === 'viewing') return error('transaction-refused', 'edit.read-only');
      if (refusal.reason === 'suggesting')
        return error('unsupported-capability', 'edit.tracked-operation-unsupported');
      return error('unsupported-revision', 'edit.protected-content');
    case 'editUnsupported':
      return refusal.reason === 'collaborationRefused'
        ? error('transaction-refused', 'edit.refused')
        : error('unsupported-capability', 'edit.unsupported-content');
    default:
      return error('transaction-refused', 'edit.refused');
  }
}
