import {
  HARFBUZZ_SHAPING_LIBRARY,
  createHarfBuzzTextShaper,
  createShapingEnvironment,
  initializeHarfBuzz,
  shapedRunComparatorInputs,
  shapingEnvironmentFingerprint,
  type ResolvedFont,
  type ShapedRunComparatorInputs,
  type ShapingEnvironment,
  type VersionedShapingLibrary,
} from '../../index.ts';

await initializeHarfBuzz();

export interface HarfBuzzParityCase {
  readonly environmentFingerprint: string;
  readonly comparator: ShapedRunComparatorInputs;
}

export interface HarfBuzzParityValue {
  readonly schemaVersion: 1;
  readonly shapingLibrary: VersionedShapingLibrary;
  readonly cases: {
    readonly ltr: HarfBuzzParityCase;
    readonly rtl: HarfBuzzParityCase;
  };
}

const environment = (
  font: ResolvedFont,
  direction: 'ltr' | 'rtl',
  script: string,
  language: string
): ShapingEnvironment =>
  createShapingEnvironment({
    font,
    variationAxes: {},
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
    unicodeDataVersion: '16.0.0',
    normalization: 'none',
    script,
    language,
    direction,
    features: { kern: 1, liga: 1 },
    fallbackOrder: [],
    fixedPointScale: 64,
    roundingMode: 'halfAwayFromZero',
  });

export const createHarfBuzzParityValue = (font: ResolvedFont): HarfBuzzParityValue => {
  const shaper = createHarfBuzzTextShaper();
  try {
    const ltrEnvironment = environment(font, 'ltr', 'Latn', 'en');
    const rtlEnvironment = environment(font, 'rtl', 'Arab', 'ar');
    return Object.freeze({
      schemaVersion: 1,
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      cases: Object.freeze({
        ltr: Object.freeze({
          environmentFingerprint: shapingEnvironmentFingerprint(ltrEnvironment),
          comparator: shapedRunComparatorInputs(
            shaper.shape({
              text: 'office x\u0301',
              fontSizeHalfPoints: 24,
              bidiLevel: 0,
              environment: ltrEnvironment,
            }),
            ltrEnvironment
          ),
        }),
        rtl: Object.freeze({
          environmentFingerprint: shapingEnvironmentFingerprint(rtlEnvironment),
          comparator: shapedRunComparatorInputs(
            shaper.shape({
              text: 'سلام',
              fontSizeHalfPoints: 24,
              bidiLevel: 1,
              environment: rtlEnvironment,
            }),
            rtlEnvironment
          ),
        }),
      }),
    });
  } finally {
    shaper.dispose();
  }
};
