/**
 * @docx-editor.dev/i18n/ja
 *
 * Japanese (`ja`) — direct locale subpath for per-locale code-splitting.
 *
 * ```ts
 * // Static — bundler ships only this locale's strings
 * import ja from '@docx-editor.dev/i18n/ja';
 *
 * // Dynamic — splits into its own chunk, loaded on demand
 * const ja = (await import('@docx-editor.dev/i18n/ja')).default;
 * ```
 *
 * For multi-locale apps, prefer the per-locale subpaths over importing
 * `locales` from the package root — `locales` pulls every locale into
 * the bundle.
 *
 * @packageDocumentation
 * @public
 */
import data from '../ja.json';
import type { PartialLocaleStrings } from './index';

/**
 * Japanese (`ja`) locale strings. Community-maintained; null leaves fall back to English.
 *
 * Identical content to the named `ja` export from the package root;
 * this subpath just lets bundlers code-split it.
 *
 * @public
 */
export const ja: PartialLocaleStrings = data;

export default ja;
