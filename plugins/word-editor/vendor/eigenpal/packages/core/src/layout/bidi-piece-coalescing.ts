import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { paragraphMergeGroupOf } from './story-roots.ts';
import { mergeBoundariesOf } from './merged-paragraph-ranges.ts';
import type { FieldAwarePiece } from './field-pieces.ts';
import { runStylesEqual } from './run-style.ts';

/** Merge equivalent source runs before shaping, preserving every semantic boundary. */
export function coalesceBidiPieces(
  pieces: readonly FieldAwarePiece[],
  sourceBoundaries?: ReadonlySet<number>
): readonly FieldAwarePiece[] {
  const keys = pieces.map((piece) => {
    if (
      piece.projected ||
      piece.inlineDrawing ||
      piece.anchoredAtom ||
      piece.equation ||
      piece.positionalTab ||
      piece.breakKind ||
      piece.measureText !== undefined ||
      piece.fieldAtom ||
      piece.end - piece.start !== piece.text.length ||
      /[\t\r\n]/u.test(piece.text)
    )
      return null;
    // Include unknown future metadata as well. Only the text and its extent can change.
    const { text: _text, start: _start, end: _end, style: _style, ...metadata } = piece;
    return JSON.stringify(metadata);
  });
  const result: FieldAwarePiece[] = [];
  for (let start = 0; start < pieces.length;) {
    let end = start + 1;
    while (
      end < pieces.length &&
      keys[start] !== null &&
      keys[end] === keys[start] &&
      pieces[end - 1]!.end === pieces[end]!.start &&
      !sourceBoundaries?.has(pieces[end]!.start) &&
      runStylesEqual(pieces[start]!.style, pieces[end]!.style)
    )
      end++;
    const first = pieces[start]!;
    result.push(
      end === start + 1
        ? first
        : {
            ...first,
            text: pieces
              .slice(start, end)
              .map((piece) => piece.text)
              .join(''),
            end: pieces[end - 1]!.end,
          }
    );
    start = end;
  }
  return result;
}

/** Publication remaps merged paragraphs independently, so their source ranges cannot coalesce. */
export function bidiSourceBoundaries(paragraph: OoxmlNode): ReadonlySet<number> | undefined {
  const group = 'children' in paragraph ? paragraphMergeGroupOf(paragraph) : null;
  return group ? new Set(mergeBoundariesOf(group).members.map((member) => member.base)) : undefined;
}
