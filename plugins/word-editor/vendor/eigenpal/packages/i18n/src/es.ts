/**
 * @docx-editor.dev/i18n/es
 *
 * Spanish (`es`) — direct locale subpath for per-locale code-splitting.
 *
 * ```ts
 * // Static — bundler ships only this locale's strings
 * import es from '@docx-editor.dev/i18n/es';
 *
 * // Dynamic — splits into its own chunk, loaded on demand
 * const es = (await import('@docx-editor.dev/i18n/es')).default;
 * ```
 *
 * For multi-locale apps, prefer the per-locale subpaths over importing
 * `locales` from the package root — `locales` pulls every locale into
 * the bundle.
 *
 * @packageDocumentation
 * @public
 */
import data from '../es.json';
import type { PartialLocaleStrings } from './index';

/**
 * Spanish (`es`) locale strings. Community-maintained; null leaves fall back to English.
 *
 * Identical content to the named `es` export from the package root;
 * this subpath just lets bundlers code-split it.
 *
 * @public
 */
export const es: PartialLocaleStrings = data;

export default es;
