/**
 * @docx-editor.dev/i18n/id
 *
 * Indonesian (`id`) — direct locale subpath for per-locale code-splitting.
 *
 * ```ts
 * // Static — bundler ships only this locale's strings
 * import id from '@docx-editor.dev/i18n/id';
 *
 * // Dynamic — splits into its own chunk, loaded on demand
 * const id = (await import('@docx-editor.dev/i18n/id')).default;
 * ```
 *
 * For multi-locale apps, prefer the per-locale subpaths over importing
 * `locales` from the package root — `locales` pulls every locale into
 * the bundle.
 *
 * @packageDocumentation
 * @public
 */
import data from '../id.json';
import type { PartialLocaleStrings } from './index';

/**
 * Indonesian (`id`) locale strings. Community-maintained; null leaves fall back to English.
 *
 * Identical content to the named `id` export from the package root;
 * this subpath just lets bundlers code-split it.
 *
 * @public
 */
export const id: PartialLocaleStrings = data;

export default id;
