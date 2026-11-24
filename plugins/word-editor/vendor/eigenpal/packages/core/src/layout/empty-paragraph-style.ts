import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import type { LineRecord, ParagraphFragmentRecord } from './semantic-records.ts';
import {
  DEFAULT_RUN_STYLE,
  resolveRunStyle,
  type ResolvedRunStyle,
  type ThemeFonts,
} from './run-style.ts';

/**
 * The paragraph mark's resolved style, for the fragments that need it.
 *
 * A paragraph without text spans, including a picture-only paragraph, keeps it as
 * `emptyParagraphStyle`. The fragment that ends the paragraph keeps it as
 * the size in `paragraphMarkSizePt`, which sizes the painted pilcrow.
 */
export function emptyParagraphStyleFields(
  lines: readonly LineRecord[],
  properties: readonly OoxmlProperty[],
  themeFonts?: ThemeFonts,
  paragraphEnd = false
): Pick<ParagraphFragmentRecord, 'emptyParagraphStyle' | 'paragraphMarkSizePt'> {
  const empty = !lines.some((line) => line.spans.length > 0);
  if (!empty && !paragraphEnd) return {};
  const style = markStyleOf(properties, themeFonts);
  return {
    ...(empty ? { emptyParagraphStyle: style } : {}),
    ...(paragraphEnd ? { paragraphMarkSizePt: style.fontSizePt } : {}),
  };
}

/**
 * One resolved mark style per paragraph's mark properties and theme fonts. A relayout reaches
 * every paragraph again with the same arrays, so it reuses the style instead of resolving it.
 */
const markStyles = new WeakMap<
  readonly OoxmlProperty[],
  { readonly themeFonts: ThemeFonts | undefined; readonly style: ResolvedRunStyle }
>();

export function markStyleOf(
  properties: readonly OoxmlProperty[],
  themeFonts: ThemeFonts | undefined
): ResolvedRunStyle {
  if (properties.length === 0) return DEFAULT_RUN_STYLE;
  const known = markStyles.get(properties);
  if (known && known.themeFonts === themeFonts) return known.style;
  const style = resolveRunStyle(properties, themeFonts);
  markStyles.set(properties, { themeFonts, style });
  return style;
}
