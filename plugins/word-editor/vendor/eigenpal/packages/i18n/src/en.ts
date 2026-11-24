/**
 * @docx-editor.dev/i18n/en
 *
 * English (`en`) — direct locale subpath for per-locale code-splitting.
 *
 * ```ts
 * // Static — bundler ships only this locale's strings
 * import en from '@docx-editor.dev/i18n/en';
 *
 * // Dynamic — splits into its own chunk, loaded on demand
 * const en = (await import('@docx-editor.dev/i18n/en')).default;
 * ```
 *
 * For multi-locale apps, prefer the per-locale subpaths over importing
 * `locales` from the package root — `locales` pulls every locale into
 * the bundle.
 *
 * @packageDocumentation
 * @public
 */
import data from '../en.json';
import type { LocaleStrings } from './index';

/**
 * English (`en`) locale strings — the source of truth, 100% covered.
 *
 * Identical content to the named `en` export from the package root;
 * this subpath just lets bundlers code-split it.
 *
 * @public
 */
export const en: LocaleStrings = data;

export default en;
