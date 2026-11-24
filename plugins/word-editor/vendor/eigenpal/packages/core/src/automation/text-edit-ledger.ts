import type { AutomationHandleTable } from './handles.ts';
import { modelTextOf } from './line-break-text.ts';
import type { PlannedOperation } from './plan-types.ts';
import { spanValue, type ResolvedRange } from './spans.ts';
import { applyTreeOp, paragraphTextOf, type TreeDocOp } from '../store/store/tree-ops.ts';
import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-tree.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { placeholderControlForInsertion } from '../store/store/tree-op-content-controls.ts';

interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly length: number;
  /** Final offsets change when later source-coordinate edits precede this result. */
  readonly result: { start: number; end: number };
}

/** Only direct text runs have an unconditional delete/insert length delta in every host. */
export function isPlainTextParagraph(node: OoxmlNode | null | undefined): boolean {
  if (node?.kind !== 'paragraph') return false;
  return node.children.every((child) => {
    if (child.namespaceUri !== WML_NAMESPACE_URI) return false;
    if (child.localName === 'pPr') return true;
    return (
      child.kind === 'run' &&
      child.children.every(
        (content) =>
          content.namespaceUri === WML_NAMESPACE_URI &&
          (content.localName === 'rPr' ||
            (content.localName === 't' &&
              content.children.every((value) => value.kind === 'textValue')))
      )
    );
  });
}

export function isPlainTextTarget(part: OoxmlPart, paragraphId: string, offset: number): boolean {
  return (
    isPlainTextParagraph(findNode(part, paragraphId)) &&
    placeholderControlForInsertion(part, paragraphId, offset) === null
  );
}

/** A prompt insertion may clear other text, but its returned range must still name the insertion. */
export function placeholderInsertionRefusal(
  part: OoxmlPart,
  paragraphId: string,
  offset: number,
  text: string
): PlannedOperation | null {
  const prompt = placeholderControlForInsertion(part, paragraphId, offset);
  if (!prompt) return null;
  const candidate =
    offset === prompt.offset
      ? applyTreeOp(part, { op: 'insertText', paragraphId, offset, text })
      : null;
  if (
    candidate?.ok &&
    paragraphTextOf(candidate.part, paragraphId)?.slice(offset, offset + text.length) ===
      modelTextOf(text)
  )
    return null;
  return {
    ok: false,
    error: {
      code: 'unsupported-capability',
      message: 'insert at the placeholder start or replace the complete prompt',
      detail: 'placeholder-insertion-offset',
    },
  };
}

function overlaps(a: TextEdit, start: number, end: number): boolean {
  if (a.start === a.end) return start < a.start && a.start < end;
  if (start === end) return a.start < start && start < a.end;
  return Math.max(a.start, start) < Math.min(a.end, end);
}

/** Rebase disjoint edits from the batch snapshot while retaining final result ranges. */
export class TextEditLedger {
  readonly #paragraphs = new Map<string, TextEdit[]>();

  has(paragraphId: string): boolean {
    return this.#paragraphs.has(paragraphId);
  }

  append(
    paragraphId: string,
    start: number,
    end: number,
    length: number,
    prepend = false
  ): {
    readonly start: number;
    readonly end: number;
    readonly result: { readonly start: number; readonly end: number };
  } | null {
    const edits = this.#paragraphs.get(paragraphId) ?? [];
    if (edits.some((edit) => overlaps(edit, start, end))) return null;
    let mappedStart = start;
    let mappedEnd = end;
    for (const edit of edits) {
      const delta = edit.length - (edit.end - edit.start);
      if (edit.end <= start && !(prepend && edit.start === start && edit.end === start))
        mappedStart += delta;
      if (edit.end < end || (edit.end === end && edit.start !== edit.end)) mappedEnd += delta;
    }
    if (start === end) mappedEnd = mappedStart;
    const delta = length - (end - start);
    for (const edit of edits) {
      // Inserts sharing one point retain call order. Other edits at an earlier
      // boundary precede the existing result and move both of its endpoints.
      if (
        end <= edit.start &&
        !(start === end && edit.start === edit.end && start === edit.start && !prepend)
      ) {
        edit.result.start += delta;
        edit.result.end += delta;
      }
    }
    const result = { start: mappedStart, end: mappedStart + length };
    edits.push({ start, end, length, result });
    this.#paragraphs.set(paragraphId, edits);
    return { start: mappedStart, end: mappedEnd, result };
  }
}

export function planPlainTextEdit(
  ledger: TextEditLedger,
  range: ResolvedRange,
  text: string,
  handles: AutomationHandleTable,
  prepend = false
): PlannedOperation {
  const paragraphId = range.start.paragraphId;
  const edit = ledger.append(
    paragraphId,
    range.start.offset,
    range.end.offset,
    text.length,
    prepend
  );
  if (!edit)
    return {
      ok: false,
      error: {
        code: 'conflicting-operations',
        message: 'text edits overlap in the batch snapshot',
        detail: paragraphId,
      },
    };
  const ops = replacementTextOps(paragraphId, edit.start, edit.end, text);
  return {
    ok: true,
    kind: 'command',
    ops,
    story: range.start.story,
    answer: () => ({
      kind: 'span',
      span: spanValue(
        {
          start: { ...range.start, offset: edit.result.start },
          end: { ...range.start, offset: edit.result.end },
        },
        handles
      ),
    }),
  };
}

/** A replacement inherits the first targeted run, including at a run boundary. */
function replacementTextOps(
  paragraphId: string,
  start: number,
  end: number,
  text: string
): TreeDocOp[] {
  const ops: TreeDocOp[] = [];
  if (text.length)
    ops.push({
      op: 'insertText',
      paragraphId,
      offset: start,
      text,
      ...(end > start ? { bias: 'right' as const } : {}),
    });
  if (end > start)
    ops.push({ op: 'deleteText', paragraphId, start: start + text.length, end: end + text.length });
  return ops;
}

/** Verify complex single replacements before using the ordinary source-coordinate delta. */
export function planSingleTextReplacement(
  part: OoxmlPart,
  range: ResolvedRange,
  text: string,
  handles: AutomationHandleTable
): PlannedOperation {
  const paragraphId = range.start.paragraphId;
  const original = paragraphTextOf(part, paragraphId);
  // Canonical insertion into a placeholder consumes its entire prompt itself.
  const prompt = placeholderControlForInsertion(part, paragraphId, range.start.offset);
  const ops: TreeDocOp[] =
    prompt && text.length
      ? [{ op: 'insertText', paragraphId, offset: range.start.offset, text, bias: 'right' }]
      : replacementTextOps(paragraphId, range.start.offset, range.end.offset, text);
  let candidate = part;
  for (const op of ops) {
    const result = applyTreeOp(candidate, op);
    if (!result.ok)
      return {
        ok: false,
        error: {
          code: 'unsupported-content',
          message: 'that replacement cannot preserve the targeted text safely',
          detail: result.reason,
        },
      };
    candidate = result.part;
  }
  const after = paragraphTextOf(candidate, paragraphId);
  if (
    original === null ||
    after !==
      original.slice(0, range.start.offset) + modelTextOf(text) + original.slice(range.end.offset)
  ) {
    return {
      ok: false,
      error: {
        code: prompt ? 'unsupported-capability' : 'unsupported-content',
        message: prompt
          ? 'replace the complete placeholder prompt to avoid consuming unrelated text'
          : 'that replacement changes the expected text positions',
        detail: paragraphId,
      },
    };
  }
  return {
    ok: true,
    kind: 'command',
    ops,
    story: range.start.story,
    answer: () => ({
      kind: 'span',
      span: spanValue(
        { start: range.start, end: { ...range.start, offset: range.start.offset + text.length } },
        handles
      ),
    }),
  };
}
