import type { ResolvedRunStyle } from '../layout/run-style.ts';

/** CSS glyph stroke keeps the existing text node, advance, selection and fill colour. */
export function applyTextOutline(
  css: CSSStyleDeclaration,
  style: ResolvedRunStyle,
  scale: number
): void {
  const outline = style.textOutline;
  if (
    !outline ||
    !Number.isFinite(scale) ||
    scale <= 0 ||
    !Number.isFinite(outline.widthPt) ||
    outline.widthPt <= 0 ||
    outline.widthPt > 1584 ||
    !/^[0-9a-f]{6}$/i.test(outline.color)
  )
    return;
  const width = outline.widthPt * scale;
  if (!Number.isFinite(width)) return;
  css.setProperty('-webkit-text-stroke-width', `${width}px`);
  css.setProperty('-webkit-text-stroke-color', `#${outline.color}`);
}
