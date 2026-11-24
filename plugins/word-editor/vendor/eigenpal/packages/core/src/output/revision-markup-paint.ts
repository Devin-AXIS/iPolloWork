import {
  revisionMarkupColor,
  revisionMarkupStyle,
  type ResolvedRevisionMarkup,
} from '../contracts/revision-markup.ts';
import type { RevisionKind } from '../layout/revision-projection.ts';

/** Apply view-only marks after authored run properties. */
export function paintRevisionMarkup(
  element: HTMLElement,
  settings: ResolvedRevisionMarkup,
  kind: RevisionKind,
  authorColor: string,
  legacyColor?: string,
  authorBackground?: string
): void {
  const option = revisionMarkupStyle(settings, kind);
  if (option.background === 'byAuthor' && !authorBackground) {
    element.style.setProperty(
      '--doc-revision-background',
      `color-mix(in srgb, ${authorColor} 15%, var(--doc-revision-color-white))`
    );
    element.style.backgroundColor = 'var(--doc-revision-background)';
  } else if (option.background !== 'none') {
    element.style.backgroundColor =
      option.background === 'byAuthor'
        ? authorBackground!
        : revisionMarkupColor(option.background, authorColor);
  }
  if (option.mark === 'none') {
    return;
  }
  const color = revisionMarkupColor(option.color, legacyColor ?? authorColor);
  if (option.color !== 'auto') element.style.color = color;
  if (option.mark === 'bold') element.style.fontWeight = 'bold';
  if (option.mark === 'italic') element.style.fontStyle = 'italic';
  const line =
    option.mark === 'underline' || option.mark === 'doubleUnderline'
      ? 'underline'
      : option.mark === 'strikethrough' || option.mark === 'doubleStrikethrough'
        ? 'line-through'
        : undefined;
  if (line) {
    element.style.textDecorationLine = line;
    element.style.textDecorationStyle = option.mark.startsWith('double') ? 'double' : 'solid';
    element.style.textDecorationColor = color;
    if (line === 'underline') {
      // The same thin rule, set below the descenders, as the unconfigured view draws.
      element.style.textDecorationThickness = 'var(--doc-revision-insertion-decoration-thickness)';
      element.style.textUnderlineOffset = 'var(--doc-revision-insertion-underline-offset)';
    }
  }
}
