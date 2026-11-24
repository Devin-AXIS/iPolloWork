// `insertContentControl` for the mounted editor.
//
// Its two neighbours (`setContentControlValue`, `removeContentControl`) address a control
// that already exists and resolve their target to a control id. An insertion addresses the
// span that is ABOUT to become one, so it resolves a RANGE instead: the caller's target when
// there is one, the live selection when there is not.
//
// A collapsed range is a caret, and a caret is Word's own gesture — the control arrives empty,
// showing its type's prompt, and the first character typed replaces the prompt whole. Refusing
// it would leave a host inserting a field at the caret with nothing to call.

import type { DocRange, DocTarget, ExecErrorCode } from '@docx-editor.dev/core/contracts/editor';
import type { InsertableContentControlType } from '../contracts/types.ts';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import { isDocAnchor, resolveDocAnchor } from './anchor-resolution.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { selectionMarkOf } from './surface-selection-ops.ts';

/** The editor-facing command. `target` defaults to the selection, like every editor command. */
export interface InsertContentControlCommand {
  type: 'insertContentControl';
  target?: DocTarget;
  subtype: InsertableContentControlType;
  tag?: string;
  title?: string;
}

/** A paragraph-local span, from the caller's target or from the live selection. */
export type Span = { paragraphId: string; start: number; end: number };

export type InsertResolution =
  | { ok: true; op: TreeDocOp; span: Span }
  | { ok: false; code: ExecErrorCode; reason: string; target?: DocTarget };

/**
 * The OOXML spelling of each insertable kind, keyed by every spelling a caller may hold.
 *
 * `ContentControlType` — what a READ answers — spells the list control `dropdown`, while the
 * tree op spells it `dropDownList`. Both are accepted here rather than making a caller
 * translate between two vocabularies this package already ships: reading a control's type and
 * handing it straight back is the commonest way to author a second field like the first, and it
 * must not be the one call that fails.
 *
 * A MAP, not an object literal: the lookup key comes from the caller, and an object would
 * answer `constructor` and `__proto__` with something inherited and truthy, which would walk
 * straight past the refusal below.
 */
const OOXML_SUBTYPE: ReadonlyMap<
  string,
  'richText' | 'plainText' | 'dropDownList' | 'comboBox' | 'date'
> = new Map([
  ['richText', 'richText'],
  ['plainText', 'plainText'],
  ['dropdown', 'dropDownList'],
  ['dropDownList', 'dropDownList'],
  ['comboBox', 'comboBox'],
  ['date', 'date'],
]);

/** `DocRange` by shape, whatever its endpoints are addressed with. */
function isDocRange(target: DocTarget): target is DocRange {
  return typeof target === 'object' && target !== null && 'from' in target && 'to' in target;
}

type SpanResolution =
  { ok: true; span: Span } | { ok: false; code: ExecErrorCode; reason: string; target?: DocTarget };

function spanOfTarget(surface: PaginatedSurface, target: DocTarget): SpanResolution {
  const part = surface.session.part();
  const anchors = surface.session.paragraphAnchors();
  if (isDocAnchor(target)) {
    const resolved = resolveDocAnchor(part, anchors, target);
    if (!resolved.ok) {
      return { ok: false, code: resolved.code, reason: resolved.reason, target };
    }
    return {
      ok: true,
      span: {
        paragraphId: resolved.span.nodeId,
        start: resolved.span.start,
        end: resolved.span.end,
      },
    };
  }
  if (isDocRange(target)) {
    // Endpoints are re-checked rather than assumed: `DocRange` allows a `DocLocation` on
    // either side, and positional addressing is refused here the way `setSelection` refuses it.
    if (!isDocAnchor(target.from) || !isDocAnchor(target.to)) {
      return {
        ok: false,
        code: 'unsupported',
        reason: 'address the span with paraId anchors; DocLocation endpoints are not supported',
        target,
      };
    }
    const from = resolveDocAnchor(part, anchors, target.from);
    if (!from.ok) return { ok: false, code: from.code, reason: from.reason, target };
    const to = resolveDocAnchor(part, anchors, target.to);
    if (!to.ok) return { ok: false, code: to.code, reason: to.reason, target };
    // One paragraph only, for the same reason the selection path says so: a control that
    // starts in one paragraph and ends in another is a BLOCK wrapper over both, which is a
    // different element than the inline one this authors.
    if (from.span.nodeId !== to.span.nodeId) {
      return {
        ok: false,
        code: 'unsupported',
        reason: 'wrapping several paragraphs in one content control is not supported',
        target,
      };
    }
    // The span COVERS both endpoints, whichever order they were named in. Pairing one
    // endpoint's start with the other's end is what a selection does, and for a selection it is
    // right; for a WRAPPER it would quietly wrap the gap between two reversed matches and
    // neither of the phrases the caller named.
    const start = Math.min(from.span.start, to.span.start);
    const end = Math.max(from.span.end, to.span.end);
    return { ok: true, span: { paragraphId: from.span.nodeId, start, end } };
  }
  return {
    ok: false,
    code: 'unsupported',
    reason: 'address the span with a paraId anchor; DocLocation targeting is not supported',
    target,
  };
}

/**
 * The tree op an insertion would commit, or the refusal explaining why there is none.
 *
 * Shared by `can` and `exec` so the probe cannot disagree with the write.
 */
export function resolveContentControlInsertion(
  surface: PaginatedSurface,
  command: InsertContentControlCommand
): InsertResolution {
  const type = OOXML_SUBTYPE.get(command.subtype as string);
  // The contract type narrows this at compile time; the runtime check is what answers an
  // untyped caller — the same reason the gate re-checks `value` for `setContentControlValue`.
  if (!type) {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: `that control type cannot be inserted (${String(command.subtype)})`,
      ...(command.target === undefined ? {} : { target: command.target }),
    };
  }

  let span: Span;
  if (command.target === undefined) {
    const mark = selectionMarkOf(surface.state().selection);
    // `selectionMarkOf` answers null exactly when the selection crosses paragraphs.
    if (!mark) {
      return {
        ok: false,
        code: 'unsupported',
        reason: 'wrapping several paragraphs in one content control is not supported',
      };
    }
    span = mark;
  } else {
    const resolved = spanOfTarget(surface, command.target);
    if (!resolved.ok) return resolved;
    span = resolved.span;
  }

  return {
    ok: true,
    span,
    op: {
      op: 'insertContentControl',
      paragraphId: span.paragraphId,
      start: span.start,
      end: span.end,
      type,
      ...(command.tag === undefined ? {} : { tag: command.tag }),
      ...(command.title === undefined ? {} : { alias: command.title }),
    },
  };
}
