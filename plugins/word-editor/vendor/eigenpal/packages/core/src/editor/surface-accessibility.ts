import { en } from '@docx-editor.dev/i18n';
import type { PaginatedSurfaceOptions } from './paginated-surface-options.ts';

/** The header and footer hover hints, as CSS custom properties the stylesheet reads. */
const HINTS = [
  ['--docx-hf-add-header', 'headerFooter.addHeaderHint'],
  ['--docx-hf-add-footer', 'headerFooter.addFooterHint'],
  ['--docx-hf-edit-header', 'headerFooter.editHeaderHint'],
  ['--docx-hf-edit-footer', 'headerFooter.editFooterHint'],
] as const;

/** A CSS string literal for `text`: quotes and backslashes escaped, line breaks as spaces. */
function cssString(text: string): string {
  return `"${text.replace(/[\\"]/g, '\\$&').replace(/[\n\r\f]/g, ' ')}"`;
}

/**
 * The pages layer's own strings in the interface language: its accessible label, and the
 * header and footer hints the stylesheet shows on hover. A translate that answers nothing for
 * a hint leaves the stylesheet's English text.
 */
export function applySurfaceStrings(
  pages: HTMLElement,
  translate: PaginatedSurfaceOptions['translate']
): void {
  pages.setAttribute(
    'aria-label',
    translate?.('editor.documentContent') ?? en.editor.documentContent
  );
  for (const [property, key] of HINTS) {
    const text = translate?.(key);
    if (text && text !== key) pages.style.setProperty(property, cssString(text));
    else pages.style.removeProperty(property);
  }
}
