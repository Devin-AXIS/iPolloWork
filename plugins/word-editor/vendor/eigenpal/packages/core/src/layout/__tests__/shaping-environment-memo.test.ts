import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  createFontResourceSnapshot,
  harfBuzzFontValidator,
  sha256FontBytes,
} from '../index.ts';
import {
  createShapingEnvironment,
  shapingEnvironmentFingerprint,
  type ShapeInput,
  type ShapedRun,
  type ShapingEnvironmentInput,
  type TextShaper,
} from '../shaped-run.ts';
import { shapeLayoutStyleRun, type LayoutShapingEnvironment } from '../layout-run-shape.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';

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

const operation = (): LayoutShapingEnvironment => ({
  script: 'Latn',
  variationAxes: {},
  shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
  unicodeDataVersion: '16.0.0',
  normalization: 'none',
  language: 'en',
  features: { liga: 1 },
  fixedPointScale: 64,
  roundingMode: 'halfAwayFromZero',
});

/** Records each environment it is asked to shape in, and shapes nothing. */
function recordingShaper(): { shaper: TextShaper; seen: ShapeInput['environment'][] } {
  const seen: ShapeInput['environment'][] = [];
  const empty = {} as ShapedRun;
  return { seen, shaper: { shape: (input) => (seen.push(input.environment), empty) } };
}

const deepFreeze = (environment: LayoutShapingEnvironment): LayoutShapingEnvironment =>
  Object.freeze({
    ...environment,
    variationAxes: Object.freeze({ ...environment.variationAxes }),
    features: Object.freeze({ ...environment.features }),
    shapingLibrary: Object.freeze({ ...environment.shapingLibrary }),
  });

describe('shaping environment reuse', () => {
  test('a created environment passes through validation as itself', () => {
    const environment = createShapingEnvironment({
      ...operation(),
      font,
      direction: 'ltr',
      fallbackOrder: [],
    });
    expect(createShapingEnvironment(environment)).toBe(environment);
    expect(shapingEnvironmentFingerprint(environment)).toBe(
      shapingEnvironmentFingerprint(environment)
    );
  });

  test('a caller-owned input is fingerprinted afresh after it changes', () => {
    const input: { -readonly [K in keyof ShapingEnvironmentInput]: ShapingEnvironmentInput[K] } = {
      ...operation(),
      font,
      direction: 'ltr',
      fallbackOrder: [],
    };
    const before = shapingEnvironmentFingerprint(input);
    input.language = 'de';
    expect(shapingEnvironmentFingerprint(input)).not.toBe(before);
    expect(createShapingEnvironment(input).language).toBe('de');
  });

  test('a frozen operation environment shares one run environment per run style', () => {
    const { shaper, seen } = recordingShaper();
    const environment = deepFreeze(operation());
    shapeLayoutStyleRun(shaper, environment, font, DEFAULT_RUN_STYLE, 'a');
    shapeLayoutStyleRun(shaper, environment, font, { ...DEFAULT_RUN_STYLE }, 'b');
    shapeLayoutStyleRun(shaper, environment, font, { ...DEFAULT_RUN_STYLE, smallCaps: true }, 'c');
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).not.toBe(seen[0]);
    expect(seen[2]!.features.smcp).toBe(1);
    expect(seen[0]!.features.smcp).toBeUndefined();
  });

  test('every run-level shaping input selects its own environment', () => {
    const shaping = { script: 'Latn', direction: 'ltr' as const, level: 0, baseLevel: 0 };
    const { shaper, seen } = recordingShaper();
    const environment = deepFreeze({ ...operation(), documentLigatures: true });
    const styles = [
      DEFAULT_RUN_STYLE,
      { ...DEFAULT_RUN_STYLE, kerningEnabled: true, kerningMinPt: 1 },
      {
        ...DEFAULT_RUN_STYLE,
        ligatures: { standard: true, contextual: false, historical: false, discretionary: false },
      },
      { ...DEFAULT_RUN_STYLE, shaping },
      { ...DEFAULT_RUN_STYLE, shaping: { ...shaping, direction: 'rtl' as const } },
      { ...DEFAULT_RUN_STYLE, shaping: { ...shaping, script: 'Grek' } },
    ];
    for (const style of styles) shapeLayoutStyleRun(shaper, environment, font, style, 'a');
    expect(new Set(seen).size).toBe(styles.length);
    expect(seen[1]!.features.kern).toBe(1);
    expect(seen[2]!.features.liga).toBe(1);
    expect(seen[4]!.direction).toBe('rtl');
    expect(seen[5]!.script).toBe('Grek');
  });

  test('a frozen environment with mutable features is read on every call', () => {
    const { shaper, seen } = recordingShaper();
    const features: Record<string, number> = { liga: 1 };
    // Frozen everywhere but `features`, so only that check can refuse the cache.
    const environment = Object.freeze({
      ...deepFreeze(operation()),
      features,
    });
    shapeLayoutStyleRun(shaper, environment, font, DEFAULT_RUN_STYLE, 'a');
    features.liga = 0;
    shapeLayoutStyleRun(shaper, environment, font, DEFAULT_RUN_STYLE, 'a');
    expect(seen.map((entry) => entry.features.liga)).toEqual([1, 0]);
  });

  test('a mutable operation environment is read on every call', () => {
    const { shaper, seen } = recordingShaper();
    const environment = { ...operation() };
    shapeLayoutStyleRun(shaper, environment, font, DEFAULT_RUN_STYLE, 'a');
    (environment as { language: string }).language = 'fr';
    shapeLayoutStyleRun(shaper, environment, font, DEFAULT_RUN_STYLE, 'a');
    expect(seen.map((entry) => entry.language)).toEqual(['en', 'fr']);
  });
});
