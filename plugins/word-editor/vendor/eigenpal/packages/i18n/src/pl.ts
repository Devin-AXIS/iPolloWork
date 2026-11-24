/**
 * @docx-editor.dev/i18n/pl
 *
 * Polish (`pl`) — direct locale subpath for per-locale code-splitting.
 *
 * ```ts
 * // Static — bundler ships only this locale's strings
 * import pl from '@docx-editor.dev/i18n/pl';
 *
 * // Dynamic — splits into its own chunk, loaded on demand
 * const pl = (await import('@docx-editor.dev/i18n/pl')).default;
 * ```
 *
 * For multi-locale apps, prefer the per-locale subpaths over importing
 * `locales` from the package root — `locales` pulls every locale into
 * the bundle.
 *
 * @packageDocumentation
 * @public
 */
import data from '../pl.json';
import type { PartialLocaleStrings } from './index';

/**
 * Polish (`pl`) locale strings. Community-maintained; null leaves fall back to English.
 *
 * Identical content to the named `pl` export from the package root;
 * this subpath just lets bundlers code-split it.
 *
 * @public
 */
export const pl: PartialLocaleStrings = data;

export default pl;
