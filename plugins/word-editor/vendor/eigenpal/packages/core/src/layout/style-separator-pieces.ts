import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import type { OoxmlParagraphNode } from '@docx-editor.dev/core/store';
import type { unmergedPiecesOfParagraphForDisplay } from './field-projection-walk.ts';
import type { FieldAwarePiece } from './field-pieces.ts';
import { styleSeparatorMembersOf } from './style-separator-group.ts';

type Arguments = Parameters<typeof unmergedPiecesOfParagraphForDisplay>;
/** Project members independently so styles and field state never cross an authored seam. */
export function styleSeparatorPieces(
  args: Arguments,
  collect: (...args: Arguments) => FieldAwarePiece[]
): FieldAwarePiece[] | undefined {
  const members = styleSeparatorMembersOf(args[0]);
  if (!members) return undefined;
  const result: FieldAwarePiece[] = [];
  for (const member of members) {
    const deleted: NonNullable<Arguments[7]> = [];
    const changes: NonNullable<Arguments[18]> = [];
    const local: Arguments = [...args];
    local[0] = member.paragraph;
    local[1] = member.runProperties;
    const end = member.base + paragraphOffsetIndex(member.paragraph as OoxmlParagraphNode).length;
    local[16] = args[16]
      ?.filter((range) => range.start >= member.base && range.end <= end)
      .map((range) => ({
        ...range,
        start: range.start - member.base,
        end: range.end - member.base,
      }));
    local[17] = args[17]
      ?.filter((range) => range.start >= member.base && range.end <= end)
      .map((range) => ({
        ...range,
        start: range.start - member.base,
        end: range.end - member.base,
      }));
    local[7] = deleted;
    local[18] = changes;
    for (const piece of collectDisplayPieces(local, collect)) {
      result.push({ ...piece, start: piece.start + member.base, end: piece.end + member.base });
    }
    for (const range of deleted)
      args[7]?.push({ ...range, start: range.start + member.base, end: range.end + member.base });
    for (const site of changes)
      args[18]?.push({ ...site, start: site.start + member.base, end: site.end + member.base });
  }
  return result;
}

/** Fixed arguments keep the call bounded independently of file-derived content. */
export function collectDisplayPieces(
  args: Arguments,
  collect: (...args: Arguments) => FieldAwarePiece[]
): FieldAwarePiece[] {
  return collect(
    args[0],
    args[1],
    args[2],
    args[3],
    args[4],
    args[5],
    args[6],
    args[7],
    args[8],
    args[9],
    args[10],
    args[11],
    args[12],
    args[13],
    args[14],
    args[15],
    args[16],
    args[17],
    args[18]
  );
}
