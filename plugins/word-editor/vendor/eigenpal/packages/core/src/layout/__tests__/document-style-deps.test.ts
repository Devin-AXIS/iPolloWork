import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  type HeadlessDocumentView,
  type HeadlessThemeFonts,
  type OoxmlElement,
} from '@docx-editor.dev/core/store';
import { collectThemeSchemeFaces } from '../../store/package/theme-font-scheme.ts';
import { createDocumentStyleDependencies } from '../document-style-deps.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function root(name: string, xml: string): OoxmlElement {
  const loaded = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.part.root;
}

describe('document style dependencies', () => {
  test('invalidates theme and settings inputs without replacing the live view', () => {
    const styles = root(
      '/word/styles.xml',
      `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
        `<w:rFonts w:asciiTheme="minorHAnsi"/>` +
        `</w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
    );
    let settings = root(
      '/word/settings.xml',
      `<w:settings xmlns:w="${W}"><w:defaultTabStop w:val="720"/></w:settings>`
    );
    let theme: HeadlessThemeFonts = {
      major: 'Heading One',
      minor: 'Body One',
      majorEastAsia: 'EA Heading One',
      minorEastAsia: 'EA Body One',
    };
    const view = {
      stylesRoot: () => styles,
      settingsRoot: () => settings,
      numberingRoot: () => null,
      documentThemeFonts: () => theme,
    } as unknown as HeadlessDocumentView;
    const dependencies = createDocumentStyleDependencies(view);

    const firstCascade = dependencies.styleCascade();
    expect(dependencies.styleCascade()).toBe(firstCascade);
    expect(dependencies.defaultTabStopPt()).toBe(36);

    theme = {
      major: 'Heading One',
      minor: 'Body One',
      majorEastAsia: 'EA Heading One',
      minorEastAsia: 'EA Body Two',
    };
    settings = root(
      '/word/settings.xml',
      `<w:settings xmlns:w="${W}"><w:defaultTabStop w:val="1134"/></w:settings>`
    );

    expect(dependencies.styleCascade()).not.toBe(firstCascade);
    expect(dependencies.defaultTabStopPt()).toBe(1134 / 20);
  });
});

test('supplemental theme changes invalidate the style cascade independently of a:ea', () => {
  let theme: HeadlessThemeFonts = {
    major: null,
    minor: null,
    minorSupplemental: { Hans: 'First' },
  };
  const dependencies = createDocumentStyleDependencies({
    stylesRoot: () => null,
    settingsRoot: () => null,
    numberingRoot: () => null,
    documentThemeFonts: () => theme,
  } as unknown as HeadlessDocumentView);
  const first = dependencies.styleCascade();
  theme = { ...theme, minorSupplemental: { Hans: 'Second' } };
  const second = dependencies.styleCascade();
  expect(second).not.toBe(first);
  expect(second?.themeFonts.minorSupplemental?.Hans).toBe('Second');
  expect(dependencies.styleCascade()).toBe(second);
});

test('recollecting the unchanged theme after a body edit retains the style cascade', () => {
  const themeRoot = root(
    '/word/theme/theme1.xml',
    '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme name="CJK"><a:minorFont><a:ea typeface=""/><a:font script="Hans" typeface="SimSun"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>'
  );
  const view = {
    stylesRoot: () => null,
    settingsRoot: () => null,
    numberingRoot: () => null,
    // Mirrors a package-scoped reader: body transactions can recollect the same root.
    documentThemeFonts: () => collectThemeSchemeFaces(themeRoot),
  } as unknown as HeadlessDocumentView;
  const dependencies = createDocumentStyleDependencies(view);
  const firstFonts = view.documentThemeFonts();
  const first = dependencies.styleCascade();
  expect(view.documentThemeFonts()).toBe(firstFonts);
  expect(dependencies.styleCascade()).toBe(first);
  expect(first?.themeFonts.minorSupplemental?.Hans).toBe('SimSun');
});

test('theme language changes select new supplemental faces and unchanged roots retain caches', () => {
  const themeRoot = root(
    '/word/theme/theme1.xml',
    '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme name="CJK"><a:minorFont><a:ea typeface="Generic EA"/><a:font script="Hans" typeface="Chinese Body"/><a:font script="Jpan" typeface="Japanese Body"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>'
  );
  const settingsFor = (language: string) =>
    root(
      '/word/settings.xml',
      `<w:settings xmlns:w="${W}"><w:themeFontLang w:eastAsia="${language}"/></w:settings>`
    );
  let settings = settingsFor('ja-JP');
  const view = {
    stylesRoot: () => null,
    settingsRoot: () => settings,
    numberingRoot: () => null,
    documentThemeFonts: () => collectThemeSchemeFaces(themeRoot, settings),
  } as unknown as HeadlessDocumentView;
  const dependencies = createDocumentStyleDependencies(view);
  const firstFonts = view.documentThemeFonts();
  const first = dependencies.styleCascade();
  expect(firstFonts.minorEastAsia).toBe('Japanese Body');
  expect(view.documentThemeFonts()).toBe(firstFonts);
  expect(dependencies.styleCascade()).toBe(first);
  settings = settingsFor('zh-CN');
  expect(view.documentThemeFonts().minorEastAsia).toBe('Chinese Body');
  expect(dependencies.styleCascade()).not.toBe(first);
  settings = settingsFor('en-US');
  expect(view.documentThemeFonts().minorEastAsia).toBe('Generic EA');
  expect(view.documentThemeFonts().minorSupplemental).toBeUndefined();
});

test('changing only a complex-script theme face invalidates layout styles', () => {
  let theme: HeadlessThemeFonts = { major: null, minor: null, majorBidi: 'First' };
  const dependencies = createDocumentStyleDependencies({
    stylesRoot: () => null,
    settingsRoot: () => null,
    numberingRoot: () => null,
    documentThemeFonts: () => theme,
  } as unknown as HeadlessDocumentView);
  const first = dependencies.styleCascade();
  theme = { ...theme, majorBidi: 'Second' };
  expect(dependencies.styleCascade()).not.toBe(first);
  expect(dependencies.styleCascade()?.themeFonts.majorBidi).toBe('Second');
});
