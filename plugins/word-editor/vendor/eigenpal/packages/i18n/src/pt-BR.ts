/**
 * @docx-editor.dev/i18n/pt-BR
 *
 * Portuguese (Brazil) (`pt-BR`) — direct locale subpath for per-locale code-splitting.
 *
 * ```ts
 * // Static — bundler ships only this locale's strings
 * import ptBR from '@docx-editor.dev/i18n/pt-BR';
 *
 * // Dynamic — splits into its own chunk, loaded on demand
 * const ptBR = (await import('@docx-editor.dev/i18n/pt-BR')).default;
 * ```
 *
 * For multi-locale apps, prefer the per-locale subpaths over importing
 * `locales` from the package root — `locales` pulls every locale into
 * the bundle.
 *
 * @packageDocumentation
 * @public
 */
import data from '../pt-BR.json';
import type { PartialLocaleStrings } from './index';

/**
 * Portuguese (Brazil) (`pt-BR`) locale strings. Community-maintained; null leaves fall back to English.
 *
 * Identical content to the named `ptBR` export from the package root;
 * this subpath just lets bundlers code-split it.
 *
 * @public
 */
export const ptBR: PartialLocaleStrings = data;

export default ptBR;
