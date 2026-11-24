// Paragraph spacing without the HTML rules: `w:doNotUseHTMLParagraphAutoSpacing` (§17.15.3).
//
// By default the larger of one paragraph's after-spacing and the next one's before-spacing
// separates them, and automatic spacing is the HTML `<p>` margin. With the setting on, the two
// gaps add up, and automatic spacing keeps the authored measurement (`paragraphSpacing`).
// The setting lives in `settings.xml`, outside every paragraph's property chain, so the style
// cascade reads it once (the `fixedParagraphSpacing` compatibility rule) and carries it; its
// cache token covers it.

/** The settings-derived part of the paragraph spacing rules. */
export interface AdjacentParagraphSpacingSettings {
  /**
   * Adjacent after- and before-spacing add up rather than collapse to the larger one, and
   * automatic spacing keeps the authored measurement.
   */
  readonly fixedParagraphSpacing?: true;
}

/**
 * The part of a paragraph's after-spacing that the next paragraph's before-spacing collapses
 * against. Flow cursors carry this value, so every placement site that collapses the two
 * gaps adds them instead when the document says so.
 */
export function collapsingSpaceAfter(
  after: number,
  settings: AdjacentParagraphSpacingSettings | undefined
): number {
  return settings?.fixedParagraphSpacing ? 0 : after;
}
