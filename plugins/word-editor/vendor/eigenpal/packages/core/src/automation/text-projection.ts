// Text projections for automation reads and searches.
//
// Model offsets always include every addressable segment. A projection can show text that the
// model does not address one-for-one. Every visible match still maps to one editable model range.

import type { AutomationTextProjection } from './operations.ts';
import type { OoxmlNode, OoxmlParagraphNode } from '../store/package/ooxml-tree.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import { LINE_BREAK_TEXT } from '../store/store/tree-op-inline-elements.ts';
import { withBreakReadText } from '../store/store/paragraph-model-text.ts';
import {
  identityProjection,
  projectionFromPieces,
  visibleParagraphPieces,
  type ProjectedParagraphText,
  type VisiblePiece,
} from '../store/store/text-projection.ts';

export {
  identityProjection,
  projectionFromPieces,
  projectVisibleParagraphText,
  visibleParagraphPieces,
  type ProjectedParagraphText,
  type VisiblePiece,
} from '../store/store/text-projection.ts';

export interface RawSpan {
  readonly start: number;
  readonly end: number;
}

function clippedIdentityPiece(
  piece: VisiblePiece,
  start: number,
  end: number
): VisiblePiece | null {
  if (start >= end) return null;
  return {
    text: piece.text.slice(start - piece.rawStart, end - piece.rawStart),
    rawStart: start,
    rawEnd: end,
    // A clipped symbol is still a symbol, which search never matches.
    ...(piece.symbol ? { symbol: true as const } : {}),
    ...(piece.symbol && piece.symbolDisplays ? { symbolDisplays: piece.symbolDisplays } : {}),
  };
}

/** Remove sorted hidden spans from sorted visible pieces with one forward-only cursor. */
export function hideInsertionSpansFromPieces(
  pieces: readonly VisiblePiece[],
  hidden: readonly RawSpan[]
): VisiblePiece[] {
  const shown: VisiblePiece[] = [];
  let hiddenIndex = 0;
  for (const piece of pieces) {
    while (hiddenIndex < hidden.length && hidden[hiddenIndex]!.end <= piece.rawStart) {
      hiddenIndex += 1;
    }
    const rawLength = piece.rawEnd - piece.rawStart;
    // A field result is one atom even when its text happens to be one character long, and it
    // must keep its result runs and symbol offsets whole.
    if (piece.text.length !== rawLength || piece.resultRuns || piece.symbolOffsets) {
      // Whole-atom revision wrappers are hidden here. Insertions inside a field result are
      // removed while its cached result text is built.
      const span = hidden[hiddenIndex];
      if (!span || span.start >= piece.rawEnd) shown.push(piece);
      continue;
    }

    let rawCursor = piece.rawStart;
    while (hiddenIndex < hidden.length) {
      const span = hidden[hiddenIndex]!;
      if (span.end <= rawCursor) {
        hiddenIndex += 1;
        continue;
      }
      if (span.start >= piece.rawEnd) break;
      const visible = clippedIdentityPiece(piece, rawCursor, Math.min(span.start, piece.rawEnd));
      if (visible) shown.push(visible);
      rawCursor = Math.max(rawCursor, span.end);
      if (span.end <= piece.rawEnd) hiddenIndex += 1;
      if (rawCursor >= piece.rawEnd) break;
    }
    const tail = clippedIdentityPiece(piece, rawCursor, piece.rawEnd);
    if (tail) shown.push(tail);
  }
  return shown;
}

/**
 * A manual line break reads as `\v`, the character a write uses for one, so text read from a
 * paragraph can be written back. The store's model text spells it `\n`; both are one UTF-16
 * unit, so every offset in the projection stays the same.
 */
function withLineBreakText(
  readText: string,
  pieces: readonly VisiblePiece[]
): readonly VisiblePiece[] {
  return pieces.map((piece) => {
    if (!piece.text.includes('\n')) return piece;
    // A piece that shows its model text one-for-one takes each break's spelling from the
    // model. A field result shows text of its own, where every break is a line break.
    const identity = piece.text.length === piece.rawEnd - piece.rawStart && !piece.resultRuns;
    const text = identity
      ? piece.text.replaceAll('\n', (_char, index: number) => readText[piece.rawStart + index]!)
      : piece.text.replaceAll('\n', LINE_BREAK_TEXT);
    return { ...piece, text };
  });
}

/** Build the projection once for one immutable paragraph node. */
export function projectParagraphText(
  paragraph: OoxmlParagraphNode,
  rawText: string,
  projection: AutomationTextProjection
): ProjectedParagraphText {
  const readText = withBreakReadText(paragraph, rawText);
  if (projection === 'model') return identityProjection(readText);
  const base = visibleParagraphPieces(paragraph, rawText, projection);
  if (projection === 'allMarkup') return projectionFromPieces(withLineBreakText(readText, base));

  const hidden = hiddenRevisionSpans(paragraph, INSERTED_KINDS);
  if (hidden.length === 0) return projectionFromPieces(withLineBreakText(readText, base));
  const pieces = hideInsertionSpansFromPieces(base, hidden);
  return projectionFromPieces(withLineBreakText(readText, pieces));
}

/**
 * A paragraph as if every pending revision were accepted (`current`) or rejected (`original`).
 *
 * `current` drops pending deletions and move sources, including deleted text inside a field's
 * saved result; `original` is the `original` projection. A field, equation, or other atom that
 * a revision covers whole is hidden whole. Offsets still map back to the model.
 */
export function projectReviewedParagraphText(
  paragraph: OoxmlParagraphNode,
  rawText: string,
  version: 'original' | 'current'
): ProjectedParagraphText {
  if (version === 'original') return projectParagraphText(paragraph, rawText, 'original');
  const readText = withBreakReadText(paragraph, rawText);
  const base = visibleParagraphPieces(paragraph, rawText, 'current');
  const hidden = hiddenRevisionSpans(paragraph, REMOVED_KINDS);
  const pieces = hidden.length === 0 ? base : hideInsertionSpansFromPieces(base, hidden);
  return projectionFromPieces(withLineBreakText(readText, pieces));
}

/** Pending insertions and move destinations are absent from the original review view. */
const INSERTED_KINDS: ReadonlySet<string> = new Set(['revisionInsert', 'revisionMoveTo']);
/** Pending deletions and move sources are absent once every revision is accepted. */
const REMOVED_KINDS: ReadonlySet<string> = new Set(['revisionDelete', 'revisionMoveFrom']);

/** Sorted, merged model spans of the revision wrappers of the given kinds. */
function hiddenRevisionSpans(
  paragraph: OoxmlParagraphNode,
  kinds: ReadonlySet<string>
): readonly RawSpan[] {
  const index = paragraphOffsetIndex(paragraph);
  const found: RawSpan[] = [];
  const visit = (node: OoxmlNode, depth: number): void => {
    if (depth > 64 || node.kind === 'textValue') return;
    if (kinds.has(node.kind)) {
      const span = index.spanOf(node);
      if (span && span.end > span.start) found.push({ start: span.start, end: span.end });
      return;
    }
    for (const child of node.children) visit(child, depth + 1);
  };
  visit(paragraph, 0);
  found.sort((left, right) => left.start - right.start || right.end - left.end);

  const merged: { start: number; end: number }[] = [];
  for (const span of found) {
    const previous = merged[merged.length - 1];
    if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}
