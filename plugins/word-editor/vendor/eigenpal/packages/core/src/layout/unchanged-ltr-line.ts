import type { StyleSpanRecord } from './semantic-records.ts';

/** A contiguous level-zero line needs neither visual reordering nor expanded advances. */
export function unchangedLtrLine(spans: readonly StyleSpanRecord[]): boolean {
  for (let index = 0; index < spans.length; index++) {
    const span = spans[index]!;
    const shaping = span.style.shaping;
    if (
      shaping &&
      (shaping.level !== 0 || shaping.direction !== 'ltr' || shaping.runDirection === 'rtl')
    )
      return false;
    if (index > 0) {
      const previous = spans[index - 1]!;
      if (span.box.x !== previous.box.x + previous.box.width) return false;
    }
  }
  return true;
}
