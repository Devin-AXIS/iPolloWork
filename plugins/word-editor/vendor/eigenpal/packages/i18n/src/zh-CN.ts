/**
 * @docx-editor.dev/i18n/zh-CN
 *
 * Simplified Chinese (`zh-CN`) — direct locale subpath for per-locale code-splitting.
 *
 * ```ts
 * // Static — bundler ships only this locale's strings
 * import zhCN from '@docx-editor.dev/i18n/zh-CN';
 *
 * // Dynamic — splits into its own chunk, loaded on demand
 * const zhCN = (await import('@docx-editor.dev/i18n/zh-CN')).default;
 * ```
 *
 * For multi-locale apps, prefer the per-locale subpaths over importing
 * `locales` from the package root — `locales` pulls every locale into
 * the bundle.
 *
 * @packageDocumentation
 * @public
 */
import data from '../zh-CN.json';
import type { PartialLocaleStrings } from './index';

/**
 * Simplified Chinese (`zh-CN`) locale strings. Community-maintained; null leaves fall back to English.
 *
 * Identical content to the named `zhCN` export from the package root;
 * this subpath just lets bundlers code-split it.
 *
 * @public
 */
export const zhCN: PartialLocaleStrings = data;

export default zhCN;
