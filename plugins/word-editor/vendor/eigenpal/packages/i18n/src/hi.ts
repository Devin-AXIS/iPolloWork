/**
 * @docx-editor.dev/i18n/hi
 *
 * Hindi (`hi`) — direct locale subpath for per-locale code-splitting.
 *
 * ```ts
 * // Static — bundler ships only this locale's strings
 * import hi from '@docx-editor.dev/i18n/hi';
 *
 * // Dynamic — splits into its own chunk, loaded on demand
 * const hi = (await import('@docx-editor.dev/i18n/hi')).default;
 * ```
 *
 * For multi-locale apps, prefer the per-locale subpaths over importing
 * `locales` from the package root — `locales` pulls every locale into
 * the bundle.
 *
 * @packageDocumentation
 * @public
 */
import data from '../hi.json';
import type { PartialLocaleStrings } from './index';

/**
 * Hindi (`hi`) locale strings. Community-maintained; null leaves fall back to English.
 *
 * Identical content to the named `hi` export from the package root;
 * this subpath just lets bundlers code-split it.
 *
 * @public
 */
export const hi: PartialLocaleStrings = data;

export default hi;
