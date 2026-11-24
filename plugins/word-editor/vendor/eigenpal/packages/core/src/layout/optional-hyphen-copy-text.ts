// Paragraph text for the plain-text clipboard flavour.
//
// Layout text shows an optional hyphen element (`w:softHyphen`) and a literal U+00AD in
// `w:t` as the same character. Plain text drops only the element, so this marks each
// element with its model character, U+001F, one for one; `withoutOptionalHyphens` then
// removes the marks after the text is sliced by model offsets.

import { OPTIONAL_HYPHEN_TEXT } from '../store/package/hyphen-text.ts';
import { lineSegmentFor } from './line-segments.ts';
import { isOptionalHyphenSpan } from './optional-hyphen-break.ts';
import { paragraphLinesFor } from './paragraph-lines.ts';
import { paragraphTextFromLayout } from './semantic-interaction.ts';
import type { SemanticLayout } from './semantic-records.ts';

/** {@link paragraphTextFromLayout}, with each optional hyphen element as U+001F. */
export function paragraphTextMarkingOptionalHyphens(
  layout: SemanticLayout,
  paragraphId: string
): string {
  const text = paragraphTextFromLayout(layout, paragraphId);
  if (!text.includes('­')) return text;
  const units = text.split('');
  for (const { line } of paragraphLinesFor(layout, paragraphId) ?? []) {
    for (const span of lineSegmentFor(line, paragraphId)?.spans ?? []) {
      if (isOptionalHyphenSpan(span) && span.range.start < units.length) {
        units[span.range.start] = OPTIONAL_HYPHEN_TEXT;
      }
    }
  }
  return units.join('');
}

/** Text marked by {@link paragraphTextMarkingOptionalHyphens}, without the marks. */
export function withoutOptionalHyphens(text: string): string {
  return text.includes(OPTIONAL_HYPHEN_TEXT) ? text.replaceAll(OPTIONAL_HYPHEN_TEXT, '') : text;
}
