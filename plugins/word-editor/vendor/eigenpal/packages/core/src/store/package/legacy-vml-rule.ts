// A horizontal rule: a legacy rectangle marked `o:hr`, which spans the text column.
//
// The rule writes no width of its own (`width:0`); layout gives it the width of the line it
// sits on. A standard rule is shaded as a groove: its fill colour above, a light band below.
// A rule with no shading is one solid bar.

import { color, named, OFFICE, off, attribute as a, points, styleOf } from './legacy-vml-values.ts';
import type { OoxmlElement } from './ooxml-tree.ts';

/** The rule a layout widens to its line. */
export interface HorizontalRuleProjection {
  /** `RRGGBB` of the bar, or of its upper band when shaded. */
  readonly fillHex: string;
  /** The lower band is light grey, as a groove. */
  readonly shaded: boolean;
  /** The bar's share of its line, in (0, 1]. */
  readonly widthFraction: number;
  /** A set width in points, which the line caps; absent for a share of the line. */
  readonly widthPt?: number;
  /** Where a bar shorter than its line sits on it. */
  readonly align: 'left' | 'center' | 'right';
}

/** The light lower band of a shaded rule. */
export const RULE_SHADE_HEX = 'E0E0E0';
const MAX_HEIGHT_POINTS = 100;

/**
 * The rule of a `v:rect` marked `o:hr`, with its height in points; undefined for any other
 * shape, null for a rule outside this subset (a floating one, or an unreadable size).
 */
export function legacyHorizontalRule(
  root: OoxmlElement
): { readonly rule: HorizontalRuleProjection; readonly heightPt: number } | null | undefined {
  if (!named(root, 'urn:schemas-microsoft-com:vml', 'rect')) return undefined;
  const marked = a(root, 'hr', OFFICE);
  if (marked === undefined || off(marked)) return undefined;
  const style = styleOf(root);
  if (!style || style.get('position') === 'absolute') return null;
  // A share of the line in tenths of a percent; 0 or none is the whole line, which writers
  // save with no width. A width saved beside a share is the share at save time.
  const percent = a(root, 'hrpct', OFFICE)?.trim();
  const share = percent === undefined || percent === '0' ? 1000 : Number(percent);
  if (!/^\d{1,4}$/.test(String(share)) || share <= 0 || share > 1000) return null;
  // With no share, a saved width is the bar's own width.
  const setWidth = percent === undefined ? points(style.get('width') ?? '0') : 0;
  if (!(setWidth >= 0 && setWidth <= 100_000)) return null;
  const align = (a(root, 'hralign', OFFICE) ?? 'left').trim();
  if (align !== 'left' && align !== 'center' && align !== 'right') return null;
  const heightPt = points(style.get('height') ?? '1.5pt');
  if (!(heightPt > 0 && heightPt <= MAX_HEIGHT_POINTS)) return null;
  const fill = color(a(root, 'fillcolor'), '#a0a0a0');
  if (!fill) return null;
  return Object.freeze({
    rule: Object.freeze({
      fillHex: fill.slice(1).toUpperCase(),
      shaded: off(a(root, 'hrnoshade', OFFICE) ?? 'f'),
      widthFraction: share / 1000,
      ...(setWidth > 0 ? { widthPt: setWidth } : {}),
      align,
    }),
    heightPt,
  });
}
