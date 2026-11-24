/**
 * @docx-editor.dev/i18n/it
 *
 * Italian (`it`) — direct locale subpath for per-locale code-splitting.
 *
 * ```ts
 * // Static — bundler ships only this locale's strings
 * import it from '@docx-editor.dev/i18n/it';
 *
 * // Dynamic — splits into its own chunk, loaded on demand
 * const it = (await import('@docx-editor.dev/i18n/it')).default;
 * ```
 *
 * For multi-locale apps, prefer the per-locale subpaths over importing
 * `locales` from the package root — `locales` pulls every locale into
 * the bundle.
 *
 * @packageDocumentation
 * @public
 */
import data from '../it.json';
import type { PartialLocaleStrings } from './index';

/**
 * Italian (`it`) locale strings. Community-maintained; null leaves fall back to English.
 *
 * Identical content to the named `it` export from the package root;
 * this subpath just lets bundlers code-split it.
 *
 * @public
 */
export const it: PartialLocaleStrings = data;

export default it;
