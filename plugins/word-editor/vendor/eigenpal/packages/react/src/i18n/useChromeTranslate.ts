import { useCallback } from 'react';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import { useTranslation } from './LocaleContext';

/**
 * A chrome-part label resolver: plain string keys, optional interpolation params.
 *
 * This is the shape every packaged part's `t` prop accepts. It takes `string` rather
 * than the `TranslationKey` union so a host can route its own extra keys through the
 * same resolver.
 *
 * @public
 */
export type ChromeTranslate = (key: string, params?: Record<string, string | number>) => string;

/**
 * The catalogue-backed resolver for composed chrome, ready to pass as any part's `t`.
 *
 * `useTranslation().t` is keyed by the strict `TranslationKey` union, which does not
 * assign to the parts' plain-`string` `t` props — so before this hook, every composing
 * host hand-wrote the same cast wrapper `<DocxEditor>` builds internally. This is that
 * wrapper, exported: it resolves through the active `LocaleContext` catalogue (bundled
 * English by default), with `overrides` consulted first for key-level renames.
 *
 * ```tsx
 * const MY_LABELS = new Map([['formattingBar.bold', 'Heavy']]); // module-level: stable identity
 *
 * const t = useChromeTranslate(MY_LABELS);
 * <DocxEditor.Toolbar t={t} />
 * ```
 *
 * Keep the `overrides` Map identity stable (module-level or memoized) — the returned
 * resolver is memoized on it, and an inline `new Map(...)` re-creates the resolver, and
 * with it every consuming part's props, on each render.
 *
 * `overrides` is a `Map` on purpose: the key is caller input, and an object literal
 * would answer `constructor` and `toString` off the prototype chain. Parts pass no
 * `params` today for overridden keys, so override values are literal strings.
 *
 * @public
 */
export function useChromeTranslate(overrides?: ReadonlyMap<string, string>): ChromeTranslate {
  const { t } = useTranslation();
  return useCallback(
    (key: string, params?: Record<string, string | number>) =>
      overrides?.get(key) ?? t(key as TranslationKey, params),
    [overrides, t]
  );
}
