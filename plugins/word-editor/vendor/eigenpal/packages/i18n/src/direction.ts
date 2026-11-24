/**
 * Primary language subtags written right to left: Arabic, Hebrew, Persian, Urdu, Pashto,
 * Sindhi, Uyghur, Yiddish, Dhivehi, Central Kurdish, and the legacy `iw` tag for Hebrew.
 */
const RTL_LANGUAGES = new Set(['ar', 'he', 'iw', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'ckb']);

/** Script subtags written right to left, which override the language default. */
const RTL_SCRIPTS = new Set(['arab', 'hebr', 'thaa', 'syrc', 'nkoo', 'adlm', 'rohg']);

/** Script subtags that move a right-to-left language to a left-to-right script. */
const LTR_SCRIPTS = new Set(['latn', 'cyrl']);

/**
 * The writing direction of a BCP-47 language tag: `'rtl'` for Arabic, Hebrew, Persian,
 * Urdu, and other right-to-left languages, `'ltr'` otherwise. A script subtag decides
 * when present, so `az-Arab` is right to left and `ku-Latn` is left to right. An absent
 * or malformed tag is left to right.
 *
 * The editor adapters read the active catalog's `_lang` with this function and mirror
 * their controls for a right-to-left catalog. Composed hosts that render their own
 * wrapper can call it to set `dir` on that wrapper:
 *
 * ```tsx
 * <div dir={localeDirection(ar._lang)}>...</div>
 * ```
 *
 * @public
 */
export function localeDirection(tag: string | null | undefined): 'ltr' | 'rtl' {
  if (typeof tag !== 'string') return 'ltr';
  const parts = tag.toLowerCase().split(/[-_]/);
  const language = parts[0] ?? '';
  for (let index = 1; index < parts.length; index++) {
    const part = parts[index] ?? '';
    if (part.length !== 4) continue;
    if (RTL_SCRIPTS.has(part)) return 'rtl';
    if (LTR_SCRIPTS.has(part)) return 'ltr';
  }
  return RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr';
}

/**
 * The writing direction of a locale catalog: its `_dir` when that is `'ltr'` or `'rtl'`,
 * otherwise the direction of its `_lang` tag. A catalog that declares neither returns
 * `undefined`, so a provider can keep the direction it inherits.
 *
 * The shipped Arabic and Hebrew catalogs declare `_dir: 'rtl'`. Declare it in your own
 * catalog to mirror the editor chrome for another right-to-left language.
 *
 * @public
 */
export function catalogDirection(
  catalog: { readonly _lang?: unknown; readonly _dir?: unknown } | null | undefined
): 'ltr' | 'rtl' | undefined {
  if (!catalog) return undefined;
  if (catalog._dir === 'rtl' || catalog._dir === 'ltr') return catalog._dir;
  return typeof catalog._lang === 'string' ? localeDirection(catalog._lang) : undefined;
}

/**
 * The direction a locale provider decides for the editor chrome: its `dir` prop, then the
 * catalog's `_dir`, then a right-to-left `_lang`, then the direction an outer provider
 * decided. A left-to-right `_lang` alone decides nothing, so the shipped left-to-right
 * catalogs keep the host page direction. `undefined` means the chrome inherits the host page.
 *
 * Both editor adapters use this rule, so a custom provider of your own can match them.
 *
 * @public
 */
export function chromeDirection(
  dir: 'ltr' | 'rtl' | undefined,
  catalog: { readonly _lang?: unknown; readonly _dir?: unknown } | null | undefined,
  inherited: 'ltr' | 'rtl' | undefined
): 'ltr' | 'rtl' | undefined {
  if (dir) return dir;
  if (catalog?._dir === 'ltr') return 'ltr';
  return catalogDirection(catalog) === 'rtl' ? 'rtl' : inherited;
}
