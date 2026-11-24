// Paragraph writes whose OOXML spelling depends on the paragraph's direction.
//
// Word reads `w:jc` `left`/`right` as the LEADING and TRAILING sides of a bidi paragraph, so
// a physical alignment request ("align right") needs a per-paragraph spelling, and a direction
// request needs to know what the paragraph inherits. Every writer that takes one goes through
// here, so the toolbar, the keyboard and the Paragraph dialog cannot disagree about one
// paragraph.

import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import { jcValueForAlignment } from '../layout/paragraph-alignment.ts';
import { paragraphIsRtl } from '../layout/rtl-paragraph.ts';
import type { ParagraphPropertyEdit } from './paragraph-format-contract.ts';

const isPhysicalAlignment = (
  value: string | null | undefined
): value is 'left' | 'center' | 'right' | 'both' =>
  value === 'left' || value === 'center' || value === 'right' || value === 'both';

/**
 * The cascade without the paragraph's own `w:bidi`. The layout flattens the cascade lowest
 * precedence first, so a direct statement is the LAST `bidi` entry in it.
 */
function inheritedOnly(
  cascaded: readonly OoxmlProperty[],
  direct: readonly OoxmlProperty[]
): readonly OoxmlProperty[] {
  if (!direct.some((property) => property.localName === 'bidi')) return cascaded;
  const last = cascaded.map((property) => property.localName).lastIndexOf('bidi');
  return last === -1 ? cascaded : cascaded.filter((_, index) => index !== last);
}

/**
 * `entry` spelled for one paragraph, or null when the paragraph needs no write for it.
 *
 * - A `physicalAlignment` `w:jc` entry becomes the value that reaches that physical edge.
 * - A `paragraphDirection` `w:bidi` entry becomes `<w:bidi/>` for right-to-left, and null
 *   when the paragraph already reads that way. For left-to-right it removes the paragraph's
 *   own `w:bidi` when that alone made it right-to-left, and writes `<w:bidi w:val="0"/>` only
 *   where a style would otherwise win.
 * - Every other entry is returned unchanged.
 *
 * The direction is `cascaded` with `direct` on top, where `direct` is the paragraph's own
 * properties AS FOLDED SO FAR in this batch, so a batch that also flips `w:bidi` aligns
 * against the new direction.
 */
export function directionalParagraphEntry(
  entry: ParagraphPropertyEdit,
  cascaded: readonly OoxmlProperty[],
  direct: readonly OoxmlProperty[],
  /** The paragraph's own properties BEFORE this batch, which is what `cascaded` holds. */
  original: readonly OoxmlProperty[] = direct
): ParagraphPropertyEdit | null {
  const rtl = (): boolean => paragraphIsRtl([...cascaded, ...direct]);
  if (entry.paragraphDirection !== undefined && entry.localName === 'bidi') {
    const wanted = entry.paragraphDirection === 'rtl';
    if (rtl() === wanted) return null;
    if (wanted) {
      return paragraphIsRtl(inheritedOnly(cascaded, original))
        ? { localName: 'bidi', remove: true }
        : { localName: 'bidi' };
    }
    // Left-to-right: drop a direct `w:bidi` when what the paragraph inherits is already
    // left-to-right, and state the explicit off value only where a style would win.
    return paragraphIsRtl(inheritedOnly(cascaded, original))
      ? { localName: 'bidi', attributes: { val: '0' } }
      : { localName: 'bidi', remove: true };
  }
  const value = entry.attributes?.val;
  if (!entry.physicalAlignment || entry.localName !== 'jc' || !isPhysicalAlignment(value)) {
    return entry;
  }
  return { localName: 'jc', attributes: { val: jcValueForAlignment(value, rtl()) } };
}
