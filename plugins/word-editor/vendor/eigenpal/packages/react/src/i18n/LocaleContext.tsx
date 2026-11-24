import { createContext, useContext, useMemo } from 'react';
import { catalogDirection, chromeDirection, createT, deepMerge, en } from '@docx-editor.dev/i18n';
import type { LocaleStrings, TFunction, Translations } from '@docx-editor.dev/i18n';
import type { DocxEditorChildren } from '../docx-editor-children';

const LocaleContext = createContext<LocaleStrings>(en);
const LangContext = createContext<string>('en');
const DirContext = createContext<'ltr' | 'rtl'>('ltr');
/** The direction a provider DECIDED for the chrome; `undefined` keeps the host page's. */
const ChromeDirContext = createContext<'ltr' | 'rtl' | undefined>(undefined);

export interface LocaleProviderProps {
  i18n?: Translations;
  /**
   * The writing direction of the editor chrome. Defaults to the catalog's `_dir`, then to a
   * right-to-left `_lang`, then to the direction of an outer provider. With `'rtl'`, the
   * toolbar, menu bar, dialogs, context menu, panes, and review column mirror without a
   * wrapper element. `'ltr'` keeps a left-to-right chrome on a right-to-left host page.
   * Without any of these, as with the shipped left-to-right catalogs, the chrome inherits
   * the host page direction.
   */
  dir?: 'ltr' | 'rtl';
  children: DocxEditorChildren;
}

export function LocaleProvider({ i18n, dir, children }: LocaleProviderProps) {
  // Merged onto the INHERITED catalogue, not onto bundled English: a provider nested in
  // another (a host wrapping its app, a subtree overriding a few strings) composes with
  // the one above instead of resetting it, and one with no `i18n` is a no-op rather than
  // a silent revert to English. At the top the inherited catalogue IS `en`.
  const inherited = useContext(LocaleContext);
  const inheritedLang = useContext(LangContext);
  const inheritedDir = useContext(DirContext);
  const inheritedChromeDir = useContext(ChromeDirContext);
  const lang = typeof i18n?._lang === 'string' ? i18n._lang : inheritedLang;
  const chromeDir = chromeDirection(dir, i18n, inheritedChromeDir);
  // The decided chrome direction first, so `useTranslation().dir` agrees with the chrome
  // whenever a provider decided one.
  const direction = chromeDir ?? catalogDirection(i18n) ?? inheritedDir;
  const merged = useMemo(
    () =>
      deepMerge(inherited as Record<string, unknown>, i18n as Record<string, unknown> | undefined),
    [inherited, i18n]
  );
  return (
    <LangContext.Provider value={lang}>
      <DirContext.Provider value={direction}>
        <ChromeDirContext.Provider value={chromeDir}>
          <LocaleContext.Provider value={merged as LocaleStrings}>
            {children}
          </LocaleContext.Provider>
        </ChromeDirContext.Provider>
      </DirContext.Provider>
    </LangContext.Provider>
  );
}

/**
 * The active catalogue's `t()`, the catalogue itself, its language tag (`_lang`, `en` by
 * default), which formats numbers the way the strings around them read, and the providers'
 * writing direction (`dir`). `dir` is `'ltr'` when the chrome inherits a right-to-left host
 * page; `useChromeDir()` returns the direction a provider decided, or `undefined` then.
 */
export function useTranslation(): {
  t: TFunction;
  catalogue: LocaleStrings;
  lang: string;
  dir: 'ltr' | 'rtl';
} {
  const strings = useContext(LocaleContext);
  const lang = useContext(LangContext);
  const dir = useContext(DirContext);
  const t = useMemo(() => createT(strings, lang), [strings, lang]);
  return { t, catalogue: strings, lang, dir };
}

/**
 * The `dir` attribute a chrome part sets on its root: the direction a provider decided
 * (its `dir` prop, the catalog's `_dir`, or a right-to-left `_lang`), otherwise nothing, so
 * the part keeps the host page direction.
 *
 * Read it in your own controls to follow the editor chrome: `undefined` means the chrome
 * inherits the host page direction, so set no `dir` then.
 * @public
 */
export function useChromeDir(): 'ltr' | 'rtl' | undefined {
  return useContext(ChromeDirContext);
}
