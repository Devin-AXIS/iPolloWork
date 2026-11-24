/**
 * @docx-editor.dev/i18n/fr
 *
 * French (`fr`) — direct locale subpath for per-locale code-splitting.
 *
 * ```ts
 * // Static — bundler ships only this locale's strings
 * import fr from '@docx-editor.dev/i18n/fr';
 *
 * // Dynamic — splits into its own chunk, loaded on demand
 * const fr = (await import('@docx-editor.dev/i18n/fr')).default;
 * ```
 *
 * For multi-locale apps, prefer the per-locale subpaths over importing
 * `locales` from the package root — `locales` pulls every locale into
 * the bundle.
 *
 * @packageDocumentation
 * @public
 */
import data from '../fr.json';
import type { PartialLocaleStrings } from './index';

/**
 * French (`fr`) locale strings. Community-maintained; null leaves fall back to English.
 *
 * Identical content to the named `fr` export from the package root;
 * this subpath just lets bundlers code-split it.
 *
 * @public
 */
export const fr: PartialLocaleStrings = data;

export default fr;
