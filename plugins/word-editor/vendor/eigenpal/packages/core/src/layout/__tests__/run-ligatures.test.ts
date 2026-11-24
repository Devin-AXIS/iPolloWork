import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  createShapedMeasurer,
  createFixedMeasurer,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  sha256FontBytes,
  HARFBUZZ_SHAPING_LIBRARY,
  FontResolutionError,
} from '../index.ts';
import {
  buildStyleCascadeTable,
  cascadeParagraphFormatting,
  cascadeRunProperties,
} from '../style-cascade.ts';
import { DEFAULT_RUN_STYLE, resolveRunStyle, runStylesEqual } from '../run-style.ts';
import { resolveRunLigatures, runLigatureFeatures } from '../run-ligatures.ts';
import { propertiesOfRunContainer } from '../field-run-text.ts';
import { compatibilityProfileFromSettings } from '../compatibility/compatibility-profile.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
function part(xml: string, name = '/word/styles.xml') {
  const p = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!p.ok) throw new Error(p.reason);
  return p.part;
}
function settings(mode: number | undefined, enabled?: boolean) {
  const compat = (name: string, value: string) =>
    `<w:compatSetting w:name="${name}" w:uri="http://schemas.microsoft.com/office/word" w:val="${value}"/>`;
  return part(
    `<w:settings xmlns:w="${W}"><w:compat>${mode === undefined ? '' : compat('compatibilityMode', String(mode))}${enabled === undefined ? '' : compat('enableOpenTypeFeatures', enabled ? '1' : '0')}</w:compat></w:settings>`,
    '/word/settings.xml'
  ).root;
}

test('compatibility controls optional ligatures without suppressing required script features', () => {
  // Mode 15 and every newer mode default on.
  for (const mode of [undefined, 11, 12, 14, 15, 16, 17]) {
    expect(compatibilityProfileFromSettings(settings(mode)).has('optionalLigatures')).toBe(
      mode !== undefined && mode >= 15
    );
    expect(compatibilityProfileFromSettings(settings(mode, false)).has('optionalLigatures')).toBe(
      false
    );
    expect(compatibilityProfileFromSettings(settings(mode, true)).has('optionalLigatures')).toBe(
      true
    );
  }
  expect(runLigatureFeatures(DEFAULT_RUN_STYLE)).toEqual({ liga: 0, clig: 0, hlig: 0, dlig: 0 });
  expect(
    runLigatureFeatures({
      ...DEFAULT_RUN_STYLE,
      ligatures: resolveRunLigatures('standardContextual'),
    })
  ).toEqual({ liga: 1, clig: 1, hlig: 0, dlig: 0 });
  expect(
    runLigatureFeatures({ ...DEFAULT_RUN_STYLE, ligatures: resolveRunLigatures('all') })
  ).toEqual({ liga: 1, clig: 1, hlig: 1, dlig: 1 });
  expect(resolveRunLigatures('__proto__')).toBeUndefined();
  expect(resolveRunLigatures('Standard')).toBeUndefined();
});

test('application defaults, authored emptiness, style inheritance and direct none remain distinct', () => {
  const missing = part(`<w:styles xmlns:w="${W}"/>`);
  const empty = part(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault/></w:docDefaults></w:styles>`
  );
  for (const [source, expected] of [
    [missing, true],
    [empty, false],
  ] as const) {
    const table = buildStyleCascadeTable(source.root, undefined, settings(15));
    const inherited = cascadeParagraphFormatting(table, undefined).runProperties;
    expect(resolveRunStyle(inherited).ligatures?.standard ?? false).toBe(expected);
    const run = resolveRunStyle(
      cascadeRunProperties(
        inherited,
        [{ localName: 'ligatures', attributes: { val: 'none' } }],
        table
      )
    );
    expect(run.ligatures?.standard).toBe(false);
  }
  const xml = `<w:styles xmlns:w="${W}" xmlns:w14="${W14}"><w:docDefaults><w:rPrDefault><w:rPr><w14:ligatures w14:val="all"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="character" w:styleId="Plain"><w:rPr><w14:ligatures w14:val="none"/></w:rPr></w:style></w:styles>`;
  const source = part(xml);
  const before = serializeOoxmlPart(source);
  const modern = buildStyleCascadeTable(source.root, undefined, settings(15));
  const legacy = buildStyleCascadeTable(source.root, undefined, settings(14));
  expect(modern.cacheToken).not.toBe(legacy.cacheToken);
  for (const table of [modern, legacy]) {
    const inherited = cascadeParagraphFormatting(table, undefined).runProperties;
    expect(resolveRunStyle(inherited).ligatures?.standard).toBe(table === modern);
    const run = resolveRunStyle(
      cascadeRunProperties(
        inherited,
        [{ localName: 'rStyle', attributes: { val: 'Plain' } }],
        table
      )
    );
    expect(run.ligatures?.standard).toBe(false);
    const direct = resolveRunStyle(
      cascadeRunProperties(
        inherited,
        [{ localName: 'ligatures', attributes: { val: 'all' } }],
        table
      )
    );
    expect(direct.ligatures?.standard).toBe(table === modern);
  }
  expect(serializeOoxmlPart(source)).toBe(before);
});

test('the namespace-qualified extension survives projection and does not merge differently shaped spans', () => {
  const root = part(
    `<w:rPr xmlns:w="${W}" xmlns:w14="${W14}"><w14:ligatures w14:val="standard"/><w:ligatures w:val="none"/></w:rPr>`
  ).root;
  const run = resolveRunStyle(propertiesOfRunContainer(root));
  expect(run.ligatures?.standard).toBe(true);
  expect(runStylesEqual(run, { ...run, ligatures: resolveRunLigatures('none') })).toBe(false);
});

test('optional ligature choices invalidate shaped width caches and preserve Arabic required ligatures', async () => {
  await initializeHarfBuzz();
  const bytes = new Uint8Array(
    readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
  );
  const request = { family: 'DejaVu Sans', weight: 400, style: 'normal' } as const;
  const font = createFontResourceSnapshot({
    epoch: 1,
    maxFontBytes: 2_000_000,
    resources: [{ request, id: 'test', bytes, hash: sha256FontBytes(bytes), faceIndex: 0 }],
    validateFont: harfBuzzFontValidator,
  }).resolve(request);
  if (font instanceof FontResolutionError) throw font;
  const shaper = createHarfBuzzTextShaper();
  const measured = createShapedMeasurer({
    shaper,
    resolveFont: () => font,
    fallback: createFixedMeasurer(),
    environment: {
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '16.0.0',
      documentLigatures: true,
      script: 'Latn',
      language: 'en',
      variationAxes: {},
      features: {},
      normalization: 'none',
      fixedPointScale: 1000,
      roundingMode: 'halfToEven',
    },
  });
  const plain = { ...DEFAULT_RUN_STYLE, fontSizePt: 18 };
  const joined = { ...plain, ligatures: resolveRunLigatures('standard') };
  const separateWidth = measured.measure('office', plain);
  expect(measured.measure('office', joined)).not.toBe(separateWidth);
  expect(measured.measure('office', plain)).toBe(separateWidth);
  const arabic = {
    ...plain,
    shaping: { script: 'Arab', direction: 'rtl', level: 1, baseLevel: 1 },
  } as const;
  expect(measured.measure('لا', arabic)).toBeLessThan(
    measured.measure('ل', arabic) + measured.measure('ا', arabic)
  );
});
