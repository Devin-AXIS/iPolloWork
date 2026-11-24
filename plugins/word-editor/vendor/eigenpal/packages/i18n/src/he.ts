/**
 * @docx-editor.dev/i18n/he
 *
 * Hebrew (`he`) — direct locale subpath for per-locale code-splitting.
 *
 * ```ts
 * // Static — bundler ships only this locale's strings
 * import he from '@docx-editor.dev/i18n/he';
 *
 * // Dynamic — splits into its own chunk, loaded on demand
 * const he = (await import('@docx-editor.dev/i18n/he')).default;
 * ```
 *
 * For multi-locale apps, prefer the per-locale subpaths over importing
 * `locales` from the package root — `locales` pulls every locale into
 * the bundle.
 *
 * @packageDocumentation
 * @public
 */
import data from '../he.json';
import type { PartialLocaleStrings } from './index';

/**
 * Hebrew (`he`) locale strings. Community-maintained; null leaves fall back to English.
 *
 * Identical content to the named `he` export from the package root;
 * this subpath just lets bundlers code-split it.
 *
 * @public
 */
export const he: PartialLocaleStrings = data;

export default he;
