// What an `insertCustomNode` request has to satisfy before anything is resolved.
//
// Split out of `plan.ts` because it needs none of the planner's state: these are judgments about
// the REQUEST — a caller's object arriving over a transport — not about the document. Keeping
// them here means the planner's own file stays about resolving handles and staging ops.

import type { AutomationOperation } from './operations.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationErrorCode } from './protocol.ts';
import type { AutomationPackageReads } from './reads.ts';
import { resolvePoint, resolveSpanRef, type ResolvedRange } from './spans.ts';
import {
  MAX_CUSTOM_NODE_LABEL_LENGTH,
  MAX_CUSTOM_NODE_PAYLOAD_LENGTH,
  type CustomNodePayloadWrite,
  type InsertCustomNodeWrite,
} from '../store/store/custom-node-writes.ts';

/** The `ST_Lock` values an insert may write, plus the one that means "none". */
const CONTENT_CONTROL_LOCKS: ReadonlySet<string> = new Set([
  'unlocked',
  'sdtLocked',
  'contentLocked',
  'sdtContentLocked',
]);

/** Longest tag/title/value a caller may author, so a script cannot ask for an unbounded write. */
const MAX_CONTROL_STRING = 4_096;

/** Word's own `w:tag` cap. A node needing more than this is what the payload store is for. */
const MAX_CONTROL_TAG = 64;

/**
 * A custom node's payload, or why it is not one.
 *
 * Checked HERE and not only in the store, because this arrives over a transport as untrusted
 * caller input: a `data` that is a number, or a `nodeId` that is an object, must be a named
 * refusal rather than something the store lane has to defend against. What is NOT checked is what
 * the payload MEANS — the schema belongs to the definition that declared it, and this lane has
 * never seen one.
 */
export function customNodePayloadOf(
  payload: unknown
):
  | { readonly ok: true; readonly value: CustomNodePayloadWrite | null }
  | { readonly ok: false; readonly field: string } {
  if (payload === undefined) return { ok: true, value: null };
  if (typeof payload !== 'object' || payload === null) return { ok: false, field: 'payload' };
  const fields = payload as Record<string, unknown>;
  for (const name of ['namespaceUri', 'rootLocalName', 'nodeId'] as const) {
    const value = fields[name];
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CONTROL_STRING) {
      return { ok: false, field: name };
    }
  }
  // An empty LABEL is allowed and an empty `data` is not: Word paints the control from the label,
  // so a blank one is a legitimate (if odd) empty chip, whereas a node carrying no payload is a
  // store entry with no reason to exist.
  if (typeof fields.label !== 'string' || fields.label.length > MAX_CUSTOM_NODE_LABEL_LENGTH) {
    return { ok: false, field: 'label' };
  }
  if (
    typeof fields.data !== 'string' ||
    fields.data.length === 0 ||
    fields.data.length > MAX_CUSTOM_NODE_PAYLOAD_LENGTH
  ) {
    return { ok: false, field: 'data' };
  }
  return {
    ok: true,
    value: {
      namespaceUri: fields.namespaceUri as string,
      rootLocalName: fields.rootLocalName as string,
      nodeId: fields.nodeId as string,
      label: fields.label,
      data: fields.data,
    },
  };
}

/**
 * Why this request cannot be planned, judged from the request alone.
 *
 * Null when it can. Everything here is decidable without touching the document, so it runs before
 * a handle is resolved — a caller with a malformed request learns what is wrong with it rather
 * than what is wrong with the span it happened to name.
 */
export function customNodeRequestRefusal(
  operation: Extract<AutomationOperation, { op: 'insertCustomNode' }>
): { readonly message: string; readonly detail?: string } | null {
  // EXACTLY ONE of the two. Both would be an insertion the caller believes is a wrap, and
  // neither has nowhere to go.
  const hasAt = operation.at !== undefined;
  const hasSpan = operation.span !== undefined;
  if (hasAt === hasSpan) {
    return {
      message: 'a custom node goes at a position or over a span, not both',
      detail: hasAt ? 'at+span' : 'no-place',
    };
  }
  if (typeof operation.tag !== 'string' || operation.tag.length === 0) {
    return { message: 'a custom node carries its identity in its tag', detail: 'tag' };
  }
  // Word's own cap, enforced here as well as in the op so a caller learns which of the two
  // limits it hit — the tag it built is too long, not "the insert was refused".
  if (operation.tag.length > MAX_CONTROL_TAG) {
    return {
      message: `w:tag caps at ${String(MAX_CONTROL_TAG)} characters; a longer payload belongs in the store`,
      detail: 'tag',
    };
  }
  if (typeof operation.text !== 'string' || operation.text.length === 0) {
    return { message: 'a custom node shows some text', detail: 'text' };
  }
  if (operation.lock !== undefined && !CONTENT_CONTROL_LOCKS.has(operation.lock)) {
    return { message: 'that is not a lock', detail: String(operation.lock) };
  }
  return null;
}

/** The store write one resolved request becomes. */
export function customNodeWriteOf(
  operation: Extract<AutomationOperation, { op: 'insertCustomNode' }>,
  start: { readonly paragraphId: string; readonly offset: number },
  end: { readonly offset: number },
  payload: CustomNodePayloadWrite | null
): InsertCustomNodeWrite {
  return {
    paragraphId: start.paragraphId,
    offset: start.offset,
    // A collapsed range is an insert; anything wider replaces the text it covered.
    ...(end.offset > start.offset ? { replaceUntil: end.offset } : {}),
    tag: operation.tag,
    text: operation.text,
    ...(operation.title === undefined ? {} : { alias: operation.title }),
    ...(operation.lock === undefined || operation.lock === 'unlocked'
      ? {}
      : { lock: operation.lock }),
    ...(payload === null ? {} : { payload }),
  };
}

/**
 * Where the node goes, resolved — or the refusal that says why it has nowhere.
 *
 * A span and a position both come back as a RANGE. A collapsed one is an insert; a wider one is
 * a wrap, and the write replaces the text it covered.
 */
export function customNodePlacement(
  operation: Extract<AutomationOperation, { op: 'insertCustomNode' }>,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads
):
  | { readonly range: ResolvedRange }
  | { readonly code: AutomationErrorCode; readonly message: string; readonly detail?: string } {
  if (operation.span) {
    const resolved = resolveSpanRef(operation.span, handles, reads);
    if (!resolved.ok) {
      return { code: resolved.code, message: 'that span is not a place', detail: resolved.detail };
    }
    if (!resolved.value) {
      return {
        code: 'invalid-offset',
        message: 'that story holds nothing to wrap',
        detail: 'empty-story',
      };
    }
    // ONE PARAGRAPH. An inline control that began in one paragraph and ended in another is a
    // block control over both, which is a different wrapper than this authors.
    if (resolved.value.start.paragraphId !== resolved.value.end.paragraphId) {
      return {
        code: 'unsupported-content',
        message: 'a custom node wraps text inside one paragraph',
        detail: 'multi-paragraph',
      };
    }
    return { range: resolved.value };
  }
  const resolved = resolvePoint(operation.at!, handles, reads);
  if (!resolved.ok) {
    return { code: resolved.code, message: 'that is not a place', detail: resolved.detail };
  }
  return { range: { start: resolved.value, end: resolved.value } };
}
