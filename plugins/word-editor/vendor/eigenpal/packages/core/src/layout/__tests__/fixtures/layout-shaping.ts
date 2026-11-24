import { readFileSync } from 'node:fs';
import {
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  sha256FontBytes,
  type LayoutOptions,
} from '../../index.ts';

await initializeHarfBuzz();

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`./fonts/${name}`, import.meta.url)));

const regularBytes = fixture('DejaVuSans.ttf');
const boldBytes = fixture('DejaVuSans-Bold.ttf');

export const createHarfBuzzLayoutOptions = (
  overrides: Partial<Pick<LayoutOptions, 'pageWidth' | 'pageHeight' | 'margin'>> = {}
): LayoutOptions => {
  const fonts = createFontResourceSnapshot({
    epoch: 1,
    maxFontBytes: 2_000_000,
    resources: [
      {
        request: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
        id: 'dejavu-sans-regular',
        bytes: regularBytes,
        hash: sha256FontBytes(regularBytes),
        faceIndex: 0,
      },
      {
        request: { family: 'DejaVu Sans', weight: 700, style: 'normal' },
        id: 'dejavu-sans-bold',
        bytes: boldBytes,
        hash: sha256FontBytes(boldBytes),
        faceIndex: 0,
      },
    ],
    substitutions: [
      {
        from: { family: 'Missing', weight: 400, style: 'normal' },
        to: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
      },
      {
        from: { family: 'DejaVu Sans', weight: 400, style: 'italic' },
        to: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
      },
      {
        from: { family: 'DejaVu Sans', weight: 700, style: 'italic' },
        to: { family: 'DejaVu Sans', weight: 700, style: 'normal' },
      },
      {
        from: { family: 'Cambria', weight: 700, style: 'normal' },
        to: { family: 'DejaVu Sans', weight: 700, style: 'normal' },
      },
      {
        from: { family: 'Calibri', weight: 400, style: 'normal' },
        to: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
      },
      {
        from: { family: 'Declared Missing', weight: 400, style: 'normal' },
        to: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
      },
    ],
    validateFont: harfBuzzFontValidator,
  });
  const resolved = fonts.resolve({ family: 'DejaVu Sans', weight: 400, style: 'normal' });
  if (resolved instanceof FontResolutionError) throw resolved;
  return {
    pageWidth: 12240,
    pageHeight: 15840,
    margin: 1440,
    ...overrides,
    shaping: {
      fonts,
      shaper: createHarfBuzzTextShaper(),
      defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 24 },
      environment: {
        variationAxes: {},
        shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
        unicodeDataVersion: '16.0.0',
        normalization: 'none',
        language: 'en',
        features: { kern: 1, liga: 1 },
        fixedPointScale: 20,
        roundingMode: 'halfAwayFromZero',
      },
      ligatureCaretPolicy: 'cluster-edges-only',
      operation: {
        resourceEpoch: fonts.epoch,
        configEpoch: 1,
        extensionFingerprint: 'test:none',
        shapingHash: `hb:${HARFBUZZ_SHAPING_LIBRARY.version}:kern+liga`,
        producerVersion: 1,
      },
    },
  };
};
