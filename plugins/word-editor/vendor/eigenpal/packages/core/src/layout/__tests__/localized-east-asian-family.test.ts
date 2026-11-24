// A localized East Asian family name and its English name name one face. A run that names
// `メイリオ` and draws in the host's `Meiryo` face draws as the family it names, so the face's
// own CJK line applies, also to a bold run that the regular face answers.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  LOCALIZED_EAST_ASIAN_FAMILIES,
  sameFontFamily,
} from '../../store/package/default-font-faces.ts';
import {
  createFontResourceSnapshot,
  FontResolutionError,
  sha256FontBytes,
} from '../font-resource.ts';
import {
  createHarfBuzzTextShaper,
  HARFBUZZ_SHAPING_LIBRARY,
  initializeHarfBuzz,
  harfBuzzFontValidator,
} from '../harfbuzz-shaper.ts';
import { createShapedMeasurer } from '../shaped-measurer.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import { applyDocumentFontSubstitutions } from '../document-font-substitution.ts';
import { composeFontConfiguration } from '../font-composition.ts';
import type { FontSource } from '../../contracts/editor.ts';

await initializeHarfBuzz();

test('a localized name and its English name are one family', () => {
  expect(sameFontFamily('メイリオ', 'Meiryo')).toBe(true);
  expect(sameFontFamily('meiryo ', 'メイリオ')).toBe(true);
  expect(sameFontFamily('ＭＳ ゴシック', 'MS Gothic')).toBe(true);
  expect(sameFontFamily('游ゴシック', 'Yu Mincho')).toBe(false);
  expect(sameFontFamily('メイリオ', 'Meiryo UI')).toBe(false);
  expect(sameFontFamily('constructor', 'Object')).toBe(false);
  for (const [localized, english] of LOCALIZED_EAST_ASIAN_FAMILIES)
    expect(sameFontFamily(localized, english)).toBe(true);
});

const MEIRYO = { family: 'Meiryo', weight: 400, style: 'normal' as const };
// A face with a 1.5 em box that lists the Japanese code page: drawn as itself, its line is 1.3
// times the box.
function measurer() {
  const bytes = new Uint8Array(
    readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < view.getUint16(4); index++) {
    const record = 12 + index * 16;
    const offset = view.getUint32(record + 8);
    if (view.getUint32(record) === 0x68686561) {
      view.setInt16(offset + 4, 2048);
      view.setInt16(offset + 6, -1024);
      view.setInt16(offset + 8, 0);
    }
    if (view.getUint32(record) === 0x4f532f32) {
      view.setUint16(offset, 1);
      view.setUint16(offset + 62, 0);
      view.setUint32(offset + 78, 1 << 17);
    }
  }
  const snapshot = createFontResourceSnapshot({
    epoch: 0,
    maxFontBytes: 2_000_000,
    validateFont: harfBuzzFontValidator,
    resources: [
      { id: 'meiryo', request: MEIRYO, bytes, hash: sha256FontBytes(bytes), faceIndex: 0 },
    ],
    substitutions: [
      { from: { ...MEIRYO, family: 'メイリオ' }, to: MEIRYO },
      { from: { ...MEIRYO, family: 'メイリオ', weight: 700 }, to: MEIRYO },
      { from: { ...MEIRYO, family: 'Stand In' }, to: MEIRYO },
    ],
  });
  return createShapedMeasurer({
    shaper: createHarfBuzzTextShaper(),
    resolveFont: (style) => {
      const font = snapshot.resolve({
        family: style.fontFamily ?? 'Meiryo',
        weight: style.bold ? 700 : 400,
        style: 'normal',
      });
      return font instanceof FontResolutionError ? null : font;
    },
    fallback: createFixedMeasurer(),
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
    unicodeDataVersion: '15.1',
  });
}

test('a localized name takes the line of the English face it draws in', () => {
  const measure = measurer();
  const style = (family: string, bold = false) => ({
    ...DEFAULT_RUN_STYLE,
    fontFamily: family,
    fontSizePt: 10,
    bold,
  });
  const english = measure.lineMetrics(style('Meiryo'));
  expect(english.height).toBeCloseTo(10 * 1.5 * 1.3, 2);
  expect(measure.lineMetrics(style('メイリオ'))).toEqual(english);
  expect(measure.lineMetrics(style('メイリオ', true))).toEqual(english);
  // A stand-in of another family keeps the one-em CJK floor of the face's own box.
  expect(measure.lineMetrics(style('Stand In')).height).toBeLessThan(english.height);
});

test('a localized name takes its supplied English face before the script default', () => {
  const source = (family: string): FontSource => ({
    request: { family, weight: 400, style: 'normal' },
    id: family,
    bytes: new Uint8Array([1]),
    hash: '0'.repeat(64),
    faceIndex: 0,
  });
  const plan = {
    families: ['メイリオ'],
    alternates: new Map<string, string>(),
    // The Japanese script default a document plan gives an unresolved East Asian family.
    fallbacks: new Map([['メイリオ', 'MS Mincho']]),
    ambiguousFamilies: [],
  };
  const both = composeFontConfiguration({ sources: [source('Meiryo'), source('MS Mincho')] });
  expect(applyDocumentFontSubstitutions(both, plan).substitutions?.[0]).toEqual({
    from: { family: 'メイリオ', weight: 400, style: 'normal' },
    to: { family: 'Meiryo', weight: 400, style: 'normal' },
  });
  // Without the English face, the script default still applies.
  const mincho = composeFontConfiguration({ sources: [source('MS Mincho')] });
  expect(applyDocumentFontSubstitutions(mincho, plan).substitutions?.[0]?.to.family).toBe(
    'MS Mincho'
  );
});
