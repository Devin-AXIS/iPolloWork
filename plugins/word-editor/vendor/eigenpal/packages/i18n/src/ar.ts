/**
 * @docx-editor.dev/i18n/ar
 *
 * Arabic (`ar`) — direct locale subpath for per-locale code-splitting.
 *
 * ```ts
 * // Static — bundler ships only this locale's strings
 * import ar from '@docx-editor.dev/i18n/ar';
 *
 * // Dynamic — splits into its own chunk, loaded on demand
 * const ar = (await import('@docx-editor.dev/i18n/ar')).default;
 * ```
 *
 * For multi-locale apps, prefer the per-locale subpaths over importing
 * `locales` from the package root — `locales` pulls every locale into
 * the bundle.
 *
 * @packageDocumentation
 * @public
 */
import data from '../ar.json';
import type { PartialLocaleStrings } from './index';

/**
 * Arabic (`ar`) locale strings. Community-maintained; null leaves fall back to English.
 *
 * Identical content to the named `ar` export from the package root;
 * this subpath just lets bundlers code-split it.
 *
 * @public
 */
export const ar: PartialLocaleStrings = data;

export default ar;
