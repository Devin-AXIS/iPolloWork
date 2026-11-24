/**
 * @docx-editor.dev/i18n/ru
 *
 * Russian (`ru`) — direct locale subpath for per-locale code-splitting.
 *
 * ```ts
 * // Static — bundler ships only this locale's strings
 * import ru from '@docx-editor.dev/i18n/ru';
 *
 * // Dynamic — splits into its own chunk, loaded on demand
 * const ru = (await import('@docx-editor.dev/i18n/ru')).default;
 * ```
 *
 * For multi-locale apps, prefer the per-locale subpaths over importing
 * `locales` from the package root — `locales` pulls every locale into
 * the bundle.
 *
 * @packageDocumentation
 * @public
 */
import data from '../ru.json';
import type { PartialLocaleStrings } from './index';

/**
 * Russian (`ru`) locale strings. Community-maintained; null leaves fall back to English.
 *
 * Identical content to the named `ru` export from the package root;
 * this subpath just lets bundlers code-split it.
 *
 * @public
 */
export const ru: PartialLocaleStrings = data;

export default ru;
