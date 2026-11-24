import type { FieldAwarePiece } from './field-pieces.ts';
import type { RevisionAttribution } from './revision-projection.ts';
import { fitTextSpanMarker } from './fit-text-groups.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { StyleSpanRecord } from './semantic-records.ts';
import { isSplittableSpan, splitSpanParts } from './span-parts.ts';
import { syntheticBoldParts } from './synthetic-bold.ts';
import type { TextMeasurer } from './text-measurer.ts';

/** Preserve the projection and revision metadata of every published span. */
export const paragraphSpanMetadata = (
  piece: FieldAwarePiece
): {
  revisions?: readonly RevisionAttribution[];
  changeSites?: readonly RevisionAttribution[];
  fieldAtom?: FieldAwarePiece['fieldAtom'];
  noteSeparator?: FieldAwarePiece['noteSeparator'];
} => ({
  // A fitted group sets its own spacing; line adjustments read this marker to leave it alone.
  ...fitTextSpanMarker(piece),
  ...(piece.revisions === undefined ? {} : { revisions: piece.revisions }),
  ...(piece.changeSites === undefined ? {} : { changeSites: piece.changeSites }),
  // Rides the same carrier for the same reason: only the paragraph walk knows an atom was a
  // field, and by paint time its result is indistinguishable from ordinary text.
  ...(piece.fieldAtom === undefined ? {} : { fieldAtom: piece.fieldAtom }),
  ...(piece.noteSeparator ? { noteSeparator: piece.noteSeparator } : {}),
});

/**
 * Mark the spans of a finished line whose bold the measurer synthesizes. Only the measurer knows
 * the face, and paint, which adds the extra advance of that bold, has no measurer.
 *
 * Paint widens every character of a marked span and takes the extra back from U+0020 and U+00A0
 * only, so a marked span holds no other blank: synthesized bold leaves a blank's advance alone.
 * Such a blank, U+3000 for one, splits off into an unmarked span of its own. A span that cannot
 * split, such as a field result, stays whole.
 */
export function markSyntheticBoldSpans(
  line: { readonly spans: StyleSpanRecord[] },
  measurer: TextMeasurer
): void {
  let spans: StyleSpanRecord[] | undefined;
  for (let index = 0; index < line.spans.length; index++) {
    const span = line.spans[index]!;
    const parts =
      span.style.bold &&
      !span.syntheticBold &&
      measurer.syntheticBold?.(styleForFontSlot(span.style, span.fontSlot))
        ? syntheticBoldParts(span.text)
        : [];
    if (!parts.some((part) => part.widened)) {
      spans?.push(span);
      continue;
    }
    spans ??= line.spans.slice(0, index);
    if (parts.length === 1 || !isSplittableSpan(span)) {
      spans.push({ ...span, syntheticBold: true });
      continue;
    }
    const split = splitSpanParts(span, parts, measurer);
    for (let part = 0; part < split.length; part++)
      spans.push(parts[part]!.widened ? { ...split[part]!, syntheticBold: true } : split[part]!);
  }
  if (!spans) return;
  line.spans.length = 0;
  for (const span of spans) line.spans.push(span);
}
