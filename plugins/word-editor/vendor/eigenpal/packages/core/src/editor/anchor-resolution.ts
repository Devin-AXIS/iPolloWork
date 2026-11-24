// DocAnchor → surface-selection resolution (editor seam).
//
// A `DocAnchor` is the LLM- and JSON-facing paragraph address: a `w14:paraId` plus an
// optional `search` phrase that must match EXACTLY ONCE inside that paragraph. This
// module resolves anchors against the current tree — pure functions of (part, anchor
// index, anchor), no surface, no DOM — so `exec`/`can` and any later consumer share one
// semantics. Offsets are in `paragraphTextOf`'s vocabulary (tabs `\t`, hard breaks as
// their characters), the same UTF-16 offsets the tree ops and the surface selection use.

import type {
  DocAnchor,
  DocRange,
  DocTarget,
  ExecErrorCode,
} from '@docx-editor.dev/core/contracts/editor';
import type { SemanticSelection as SurfaceSelection } from '@docx-editor.dev/core/layout';
import { paragraphTextOf, type OoxmlPart } from '@docx-editor.dev/core/store';
import type { ParagraphAnchorIndex } from '../binding/paragraph-anchors.ts';

export interface ResolvedAnchorSpan {
  readonly nodeId: string;
  /** UTF-16 offsets into `paragraphTextOf`: the search-match span, or [0, length] with no search. */
  readonly start: number;
  readonly end: number;
}

export type AnchorResolution =
  | { readonly ok: true; readonly span: ResolvedAnchorSpan }
  | {
      readonly ok: false;
      readonly code: 'notFound' | 'ambiguous' | 'invalidArgs';
      readonly reason: string;
    };

/**
 * Shape guard, strict on statically-hopeless payloads: an empty `paraId`, an empty
 * `search` or a non-positive-integer `occurrence` can never resolve against ANY
 * document, so `can` refuses them the same way `exec` would — the can/exec split is
 * reserved for properties of the document (does the paraId exist, is the phrase
 * unique), not of the payload.
 */
export function isDocAnchor(value: unknown): value is DocAnchor {
  if (typeof value !== 'object' || value === null) return false;
  const anchor = value as { paraId?: unknown; search?: unknown; occurrence?: unknown };
  return (
    typeof anchor.paraId === 'string' &&
    anchor.paraId.length > 0 &&
    (anchor.search === undefined ||
      (typeof anchor.search === 'string' && anchor.search.length > 0)) &&
    (anchor.occurrence === undefined ||
      (typeof anchor.occurrence === 'number' &&
        Number.isInteger(anchor.occurrence) &&
        anchor.occurrence >= 1))
  );
}

export function isDocAnchorRange(value: unknown): value is DocRange {
  if (typeof value !== 'object' || value === null) return false;
  const range = value as { from?: unknown; to?: unknown };
  return isDocAnchor(range.from) && isDocAnchor(range.to);
}

/**
 * Match offsets of `search` in `text`, overlapping occurrences counted — the strict
 * reading of "must match exactly once". Bounded: the scan stops after `limit` matches,
 * since a caller needs at most `occurrence` spans (or the fact that a second exists),
 * never the full enumeration of a pathological input.
 */
function matchOffsets(text: string, search: string, limit: number): number[] {
  const offsets: number[] = [];
  let index = text.indexOf(search);
  while (index >= 0 && offsets.length < limit) {
    offsets.push(index);
    index = text.indexOf(search, index + 1);
  }
  return offsets;
}

/**
 * Resolve one anchor. `paraId` is matched case-insensitively; `search` is a
 * case-sensitive exact substring; `occurrence` is 1-based and opt-in — without it,
 * two matches are `'ambiguous'` rather than first-match.
 */
export function resolveDocAnchor(
  part: OoxmlPart,
  anchors: ParagraphAnchorIndex,
  anchor: DocAnchor
): AnchorResolution {
  if (typeof anchor.paraId !== 'string' || anchor.paraId.length === 0) {
    return { ok: false, code: 'invalidArgs', reason: 'paraId must be a non-empty string' };
  }
  const canonical = anchor.paraId.toUpperCase();
  if (anchors.ambiguousParaIds.has(canonical)) {
    // REFUSED, not resolved to whichever story came first.
    //
    // `w14:paraId` is minted unique per PART and the contract's uniqueness is per document, so
    // an authored file may repeat one across a header and the body. Preferring the caller's own
    // part looks like a way out, and is not: every caller here passes the MAIN part, so the
    // preference can only ever land on the body twin. An automation caller that read a header
    // paragraph's paraId out of `snapshot()` and passed it straight back would be told `ok`
    // with the caret in the body, and its next write would go to the wrong story.
    //
    // Refusing costs a hostile file's duplicates their addressability by paraId — node ids
    // still reach them — and that is the failure worth having: it is visible.
    return {
      ok: false,
      code: 'ambiguous',
      reason: `paraId '${anchor.paraId}' is claimed by more than one story`,
    };
  }
  const nodeId = anchors.nodeByParaId.get(canonical);
  if (nodeId === undefined) {
    return {
      ok: false,
      code: 'notFound',
      reason: `no paragraph with paraId '${anchor.paraId}'`,
    };
  }
  // The node's OWN part. The index spans every story, so reading a header node's text out of
  // the body part gave `''` — and an anchor with no `search` then returned `ok` with a
  // zero-length span, installing a caret on a paragraph the open scope has never heard of and
  // making every keystroke after it vanish with no refusal. An anchor WITH a search reported
  // that its phrase "does not occur", which is a claim about the document that was false.
  const text = paragraphTextOf(anchors.partByNode.get(nodeId) ?? part, nodeId) ?? '';
  if (anchor.search === undefined) {
    return { ok: true, span: { nodeId, start: 0, end: text.length } };
  }
  if (anchor.search.length === 0) {
    return { ok: false, code: 'invalidArgs', reason: 'search must be a non-empty phrase' };
  }
  if (anchor.occurrence !== undefined) {
    if (!Number.isInteger(anchor.occurrence) || anchor.occurrence < 1) {
      return {
        ok: false,
        code: 'invalidArgs',
        reason: 'occurrence must be a positive integer (1-based)',
      };
    }
    // Scan exactly as far as the requested occurrence; fewer matches means the count
    // is exact (the scan ended at the text, not the limit).
    const matches = matchOffsets(text, anchor.search, anchor.occurrence);
    const match = matches[anchor.occurrence - 1];
    if (match === undefined) {
      return {
        ok: false,
        code: 'notFound',
        reason: `'${anchor.search}' matches ${matches.length} time(s) in paragraph '${anchor.paraId}'; occurrence ${anchor.occurrence} does not exist`,
      };
    }
    return { ok: true, span: { nodeId, start: match, end: match + anchor.search.length } };
  }
  // Without `occurrence` only "zero, one, or more than one" matters — two matches
  // settle it, so the scan never enumerates a pathological input in full.
  const matches = matchOffsets(text, anchor.search, 2);
  if (matches.length === 0) {
    return {
      ok: false,
      code: 'notFound',
      reason: `'${anchor.search}' does not occur in paragraph '${anchor.paraId}'`,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      code: 'ambiguous',
      reason: `'${anchor.search}' matches more than once in paragraph '${anchor.paraId}'; pass occurrence to disambiguate`,
    };
  }
  return {
    ok: true,
    span: { nodeId, start: matches[0]!, end: matches[0]! + anchor.search.length },
  };
}

export type AnchorSelectionResolution =
  | { readonly ok: true; readonly selection: SurfaceSelection }
  | {
      readonly ok: false;
      readonly code: ExecErrorCode;
      readonly reason: string;
      readonly target?: DocTarget;
    };

/**
 * Resolve a DocAnchor-shaped `setSelection` payload into the surface's selection form.
 *
 * `{ anchor }` collapses the caret at the span start (the match start; paragraph start
 * with no search). `{ range }` selects from the from-span's start to the to-span's end,
 * so `{from: {paraId: X}, to: {paraId: X}}` selects the whole paragraph and matching
 * `search` endpoints select the phrase. `DocLocation` endpoints are refused as
 * unsupported rather than resolved approximately — positional addressing is a later
 * lane, and the refusal names it.
 */
export function resolveAnchorSelection(
  part: OoxmlPart,
  anchors: ParagraphAnchorIndex,
  command: { readonly anchor: DocAnchor } | { readonly range: DocRange }
): AnchorSelectionResolution {
  if ('anchor' in command) {
    const resolved = resolveDocAnchor(part, anchors, command.anchor);
    if (!resolved.ok) {
      return { ok: false, code: resolved.code, reason: resolved.reason, target: command.anchor };
    }
    const position = { paragraphId: resolved.span.nodeId, offset: resolved.span.start };
    return { ok: true, selection: { anchor: position, head: position } };
  }
  const { from, to } = command.range;
  if (!isDocAnchor(from) || !isDocAnchor(to)) {
    return {
      ok: false,
      code: 'unsupported',
      reason: 'DocLocation endpoints are not supported; address paragraphs by paraId',
      target: command.range,
    };
  }
  const fromResolved = resolveDocAnchor(part, anchors, from);
  if (!fromResolved.ok) {
    return { ok: false, code: fromResolved.code, reason: fromResolved.reason, target: from };
  }
  const toResolved = resolveDocAnchor(part, anchors, to);
  if (!toResolved.ok) {
    return { ok: false, code: toResolved.code, reason: toResolved.reason, target: to };
  }
  return {
    ok: true,
    selection: {
      anchor: { paragraphId: fromResolved.span.nodeId, offset: fromResolved.span.start },
      head: { paragraphId: toResolved.span.nodeId, offset: toResolved.span.end },
    },
  };
}
