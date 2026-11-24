/**
 * Where to place the label bar of an open header, footer, or note, in viewport pixels.
 *
 * The bar sits just above its story. A story with no room above it on its sheet, such as a
 * header that starts at the paper edge, takes the bar just below it instead, so the bar never
 * covers the gap between sheets or the ruler.
 *
 * @param storyRect - The painted story's viewport rectangle.
 * @param sheetTop - The viewport top of the sheet the story is on, or undefined when unknown.
 * @param barHeight - The bar's height in pixels.
 * @param clearance - The gap between the bar and the story, in pixels.
 * @returns The bar's viewport top.
 *
 * @example
 * ```ts
 * const top = storyLabelTop(band.getBoundingClientRect(), sheet.getBoundingClientRect().top, 28, 6);
 * ```
 *
 * @public
 */
export function storyLabelTop(
  storyRect: { readonly top: number; readonly bottom: number },
  sheetTop: number | undefined,
  barHeight: number,
  clearance: number
): number {
  const above = storyRect.top - barHeight - clearance;
  return sheetTop !== undefined && above < sheetTop ? storyRect.bottom + clearance : above;
}
