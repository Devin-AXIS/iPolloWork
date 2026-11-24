// How each field of the Paragraph dialog becomes `w:pPr` attributes.
//
// Shared by the single-purpose commands (`setParagraphSpacing`, `setLineSpacing`) and by
// `setParagraphFormat`, which writes the whole dialog in one transaction. One rule per
// setting, in one place: a dialog that spelled `w:spacing` differently from the menu row
// beside it would make the same gesture mean two things.

/** The three line-spacing rules, as the contract and the dialog both name them. */
export type LineSpacingRuleName = 'multiple' | 'exact' | 'atLeast';

/**
 * One side of `w:spacing`, as the attributes a space-before/after write states.
 *
 * `undefined` states nothing: the side a call does not name keeps whatever the paragraph
 * authored. `null` REMOVES the attribute, so the value inherits from the style again —
 * which is not the same as a zero, and a zero is what Word's "Remove space before" writes.
 *
 * The two attributes beside the measurement go with it, because each SUPERSEDES it
 * (§17.3.1.33): `w:beforeAutospacing` substitutes Word's own gap, and `w:beforeLines`
 * measures in hundredths of a line instead of twips. A merging write that left either in
 * place wrote a number the file then ignored.
 *
 * They are cleared differently, because their off values differ. `w:beforeAutospacing="0"`
 * is a real off, so it is written explicitly and blocks an inherited flag. `w:beforeLines`
 * has no off value — `"0"` there means zero lines of space, which would supersede the twips
 * beside it — so the attribute is dropped instead.
 */
export function spacingSideAttributes(
  side: 'before' | 'after',
  points: number | null | undefined
): Record<string, string | null> {
  if (points === undefined) return {};
  const autospacing = `${side}Autospacing`;
  const lines = `${side}Lines`;
  if (points === null) return { [side]: null, [autospacing]: null, [lines]: null };
  return { [side]: String(Math.round(points * 20)), [autospacing]: '0', [lines]: null };
}

/**
 * `w:line` + `w:lineRule` for one line-spacing pick, or the removal of both.
 *
 * `w:line` is 240ths of a line under `auto` and twentieths of a point otherwise — one
 * attribute, two units, which is why the rule travels with the value everywhere.
 */
export function lineSpacingAttributes(
  spacing: { readonly rule: LineSpacingRuleName; readonly value: number } | null | undefined
): Record<string, string | null> {
  if (spacing === undefined) return {};
  if (spacing === null) return { line: null, lineRule: null };
  if (spacing.rule === 'multiple') {
    return { line: String(Math.round(spacing.value * 240)), lineRule: 'auto' };
  }
  return {
    line: String(Math.round(spacing.value * 20)),
    lineRule: spacing.rule === 'exact' ? 'exact' : 'atLeast',
  };
}

/**
 * A paragraph toggle (`w:keepNext`, `w:contextualSpacing`, …) as an explicit on or off.
 *
 * Off is written as `w:val="0"`, never as a removed element: the flag may come from the
 * style, and dropping the local one would let the style's back in — the same distinction
 * `spacingSideAttributes` draws between a zero and a removal.
 */
export function paragraphFlagAttributes(on: boolean): Record<string, string> {
  return { val: on ? '1' : '0' };
}
