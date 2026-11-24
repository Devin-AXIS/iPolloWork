import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  createShapingEnvironment,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  sha256FontBytes,
  type ShapeInput,
} from '../index.ts';

await initializeHarfBuzz();

const bytes = new Uint8Array(
  readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
const request = { family: 'DejaVu Sans', weight: 400, style: 'normal' } as const;
const resolved = createFontResourceSnapshot({
  epoch: 1,
  maxFontBytes: 2_000_000,
  resources: [{ request, id: 'dejavu', bytes, hash: sha256FontBytes(bytes), faceIndex: 0 }],
  validateFont: harfBuzzFontValidator,
}).resolve(request);
if (resolved instanceof FontResolutionError) throw resolved;
const font = resolved;

const input = (text: string, language = 'en'): ShapeInput => ({
  text,
  fontSizeHalfPoints: 24,
  bidiLevel: 0,
  environment: createShapingEnvironment({
    font,
    variationAxes: {},
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
    unicodeDataVersion: '16.0.0',
    normalization: 'none',
    script: 'Latn',
    language,
    direction: 'ltr',
    features: { kern: 1 },
    fallbackOrder: [],
    fixedPointScale: 64,
    roundingMode: 'halfAwayFromZero',
  }),
});

describe('HarfBuzz shape cache', () => {
  test('a run hit between every new text stays cached', () => {
    let shapeCalls = 0;
    const shaper = createHarfBuzzTextShaper({
      maxCachedShapes: 4,
      instrumentation: { onShapeCall: () => (shapeCalls += 1) },
    });
    const hot = input('hot');
    const first = shaper.shape(hot);
    for (let index = 0; index < 32; index += 1) {
      shaper.shape(input(`text ${index}`));
      expect(shaper.shape(hot)).toBe(first);
    }
    // One call for the hot run and one for each new text: the hot run was never shaped again.
    expect(shapeCalls).toBe(33);
    shaper.dispose();
  });

  test('restarting environment ids never returns a run from an earlier environment', () => {
    let shapeCalls = 0;
    let cleared = 0;
    const shaper = createHarfBuzzTextShaper({
      // Room for every run, so English is still cached when its id is handed out again.
      maxCachedShapes: 4096,
      instrumentation: {
        onShapeCall: () => (shapeCalls += 1),
        onShapeCacheEvent: ({ kind, retainedBytes }) => {
          if (kind === 'cleared' && retainedBytes === 0) cleared += 1;
        },
      },
    });
    const english = shaper.shape(input('office'));
    // More distinct environments than the shaper interns, so the ids start over and some later
    // environment takes the id English had. It must be shaped, not handed English's run.
    const later = Array.from({ length: 4100 }, (_, index) =>
      shaper.shape(input('office', `en-x${index}`))
    );
    expect(later.some((run) => run === english)).toBe(false);
    expect(shapeCalls).toBe(4101);
    // The restart reports the dropped results, so byte accounting stays in step.
    expect(cleared).toBe(1);
    const callsBefore = shapeCalls;
    const again = shaper.shape(input('office'));
    expect(shapeCalls).toBe(callsBefore + 1);
    expect(again.glyphs.map(({ id, advanceX }) => [id, advanceX])).toEqual(
      english.glyphs.map(({ id, advanceX }) => [id, advanceX])
    );
    shaper.dispose();
  });

  test('a size or level of the wrong type is refused even when the number is cached', () => {
    const shaper = createHarfBuzzTextShaper();
    shaper.shape(input('typed'));
    const loose = (overrides: Record<string, unknown>) =>
      ({ ...input('typed'), ...overrides }) as unknown as ShapeInput;
    expect(() => shaper.shape(loose({ fontSizeHalfPoints: '24' }))).toThrow();
    expect(() => shaper.shape(loose({ bidiLevel: '0' }))).toThrow();
    shaper.dispose();
  });
});
