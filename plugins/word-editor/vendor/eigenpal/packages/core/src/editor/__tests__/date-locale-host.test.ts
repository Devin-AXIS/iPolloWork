import { expect, test } from 'bun:test';
import {
  createDocxEditorHostConfigState,
  liveHostConfigSetters,
} from '../docx-editor-host-config.ts';

for (const [locale, resolved] of [
  ['en-GB', 'en-GB'],
  ['pl-pl', 'pl-PL'],
  ['de-DE-u-nu-latn', 'de-DE-u-nu-latn'],
  [undefined, 'en-US'],
  ['not_a_locale', 'en-US'],
  ['zz-ZZ', 'en-US'],
  ['', 'en-US'],
] as const) {
  test(`host resolves ${locale} to ${resolved} independently of the translation catalogue`, () => {
    expect(createDocxEditorHostConfigState({ locale }).locale()).toBe(resolved);
  });
}

test('regional and extended tags fall back to the language catalogue without losing the region', () => {
  const german = createDocxEditorHostConfigState({ locale: 'de' });
  for (const locale of ['de-DE', 'de-AT', 'de-DE-u-nu-latn']) {
    const state = createDocxEditorHostConfigState({ locale });
    expect(state.locale()).toBe(locale);
    expect(state.tocLabels()).toEqual(german.tocLabels());
    expect(state.tocLabels().title).toBe('Inhaltsverzeichnis');
  }
});

test('live regional changes reach the surface even when the translation language stays English', () => {
  const state = createDocxEditorHostConfigState({ locale: 'en-US' });
  const applied: string[] = [];
  let mounted = true;
  const setters = liveHostConfigSetters(state, {
    surface: () =>
      mounted
        ? {
            setTranslate() {},
            setDrawingStrings() {},
            setTocLabels() {},
            setLocale(locale) {
              applied.push(locale);
            },
          }
        : null,
    bump() {},
    emitSelectionChange() {},
  });
  setters.setLocale('en-GB');
  expect(state.locale()).toBe('en-GB');
  expect(applied).toEqual(['en-GB']);
  setters.setLocale('en-gb');
  expect(applied).toEqual(['en-GB']);
  setters.setLocale(undefined);
  expect(applied).toEqual(['en-GB', 'en-US']);
  mounted = false;
  setters.setLocale('pl-PL');
  expect(state.locale()).toBe('pl-PL');
});

test('regional-only catalogues provide compatible language fallback', () => {
  for (const [locale, catalogue] of [
    ['pt', 'pt-BR'],
    ['pt-PT', 'pt-BR'],
    ['zh', 'zh-CN'],
    ['zh-Hans-CN', 'zh-CN'],
  ]) {
    const state = createDocxEditorHostConfigState({ locale });
    expect(state.locale()).toBe(locale!);
    expect(state.tocLabels()).toEqual(
      createDocxEditorHostConfigState({ locale: catalogue }).tocLabels()
    );
  }
  expect(createDocxEditorHostConfigState({ locale: 'zh-Hant' }).tocLabels()).toEqual(
    createDocxEditorHostConfigState({ locale: 'en' }).tocLabels()
  );
});
