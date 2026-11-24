// `a:lum` → CSS filter transfer, checked against Word's own rendering (issue #821).

import { describe, expect, test } from 'bun:test';
import { drawingFilterStyle, lumFilterFunctions, lumTransfer } from '../drawing-lum-filter.ts';

/** Grey ramp painted in the calibration fixture: 8-bit levels 0, 17, …, 255. */
const RAMP = Array.from({ length: 16 }, (_, index) => index * 17);
const NAVY = [28, 41, 58] as const;

/**
 * Word 16 renders of the ramp and the navy band, sampled from its PDF export at 96 dpi.
 * `bright`/`contrast` are the `a:lum` attribute values (1/1000 %).
 */
const WORD_SAMPLES: readonly {
  readonly name: string;
  readonly bright: number;
  readonly contrast: number;
  readonly ramp: readonly number[];
  readonly navy: readonly [number, number, number];
}[] = [
  {
    name: 'washout preset',
    bright: 70001,
    contrast: -70000,
    ramp: [205, 210, 215, 221, 226, 231, 236, 241, 246, 251, 255, 255, 255, 255, 255, 255],
    navy: [214, 218, 223],
  },
  {
    name: 'bright +40',
    bright: 40000,
    contrast: 0,
    ramp: [102, 119, 136, 153, 170, 187, 204, 221, 238, 255, 255, 255, 255, 255, 255, 255],
    navy: [130, 143, 160],
  },
  {
    name: 'bright -40',
    bright: -40000,
    contrast: 0,
    ramp: [0, 0, 0, 0, 0, 0, 0, 17, 34, 51, 68, 85, 102, 119, 136, 153],
    navy: [0, 0, 0],
  },
  {
    name: 'contrast +40',
    bright: 0,
    contrast: 40000,
    ramp: [0, 0, 0, 0, 28, 57, 85, 113, 142, 170, 198, 227, 255, 255, 255, 255],
    navy: [0, 0, 12],
  },
  {
    name: 'contrast -40',
    bright: 0,
    contrast: -40000,
    ramp: [51, 61, 71, 82, 92, 102, 112, 122, 133, 143, 153, 163, 173, 184, 194, 204],
    navy: [68, 76, 86],
  },
  {
    name: 'bright +20 contrast -50',
    bright: 20000,
    contrast: -50000,
    ramp: [102, 111, 119, 128, 136, 144, 153, 161, 170, 179, 187, 195, 204, 213, 221, 229],
    navy: [116, 123, 131],
  },
  {
    name: 'bright -20 contrast +50',
    bright: -20000,
    contrast: 50000,
    ramp: [0, 0, 0, 0, 0, 0, 0, 34, 68, 102, 136, 170, 204, 238, 255, 255],
    navy: [0, 0, 0],
  },
  {
    name: 'contrast +90',
    bright: 0,
    contrast: 90000,
    ramp: [0, 0, 0, 0, 0, 0, 0, 42, 213, 255, 255, 255, 255, 255, 255, 255],
    navy: [0, 0, 0],
  },
  {
    name: 'contrast +100 is a step at mid grey',
    bright: 0,
    contrast: 100000,
    ramp: [0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255],
    navy: [0, 0, 0],
  },
  {
    name: 'contrast -100 is flat mid grey',
    bright: 0,
    contrast: -100000,
    ramp: RAMP.map(() => 128),
    navy: [128, 128, 128],
  },
  {
    name: 'bright +100 is white',
    bright: 100000,
    contrast: 0,
    ramp: RAMP.map(() => 255),
    navy: [255, 255, 255],
  },
  {
    name: 'bright -100 is black',
    bright: -100000,
    contrast: 0,
    ramp: RAMP.map(() => 0),
    navy: [0, 0, 0],
  },
  {
    name: 'bright +50 contrast -100 is flat light grey',
    bright: 50000,
    contrast: -100000,
    ramp: RAMP.map(() => 191),
    navy: [191, 191, 191],
  },
  {
    name: 'bright -50 contrast +100 steps at three quarters',
    bright: -50000,
    contrast: 100000,
    ramp: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255],
    navy: [0, 0, 0],
  },
];

const FILTER_FUNCTION = /(contrast|brightness)\(([-\d.e]+)\)/g;

/** Apply a CSS `filter` list of `contrast()`/`brightness()` the way the spec defines them. */
function applyCssFilter(filter: string, level: number): number {
  let value = level / 255;
  for (const match of filter.matchAll(FILTER_FUNCTION)) {
    const amount = Number(match[2]);
    expect(Number.isFinite(amount)).toBe(true);
    expect(amount).toBeGreaterThanOrEqual(0);
    value = match[1] === 'contrast' ? amount * value + (1 - amount) / 2 : amount * value;
    value = Math.max(0, Math.min(1, value));
  }
  return Math.round(value * 255);
}

function filterFor(bright: number, contrast: number): string {
  const transfer = lumTransfer(bright / 1000, contrast / 1000);
  expect(transfer).not.toBeNull();
  return lumFilterFunctions(transfer!);
}

describe('lum transfer matches Word', () => {
  for (const sample of WORD_SAMPLES) {
    test(sample.name, () => {
      const filter = filterFor(sample.bright, sample.contrast);
      const ramp = RAMP.map((level) => applyCssFilter(filter, level));
      for (let index = 0; index < RAMP.length; index += 1) {
        expect(Math.abs(ramp[index]! - sample.ramp[index]!)).toBeLessThanOrEqual(1);
      }
      const navy = NAVY.map((level) => applyCssFilter(filter, level));
      for (let channel = 0; channel < 3; channel += 1) {
        expect(Math.abs(navy[channel]! - sample.navy[channel]!)).toBeLessThanOrEqual(1);
      }
    });
  }

  test('washout keeps paper white and never runs brightness() before contrast()', () => {
    const filter = filterFor(70001, -70000);
    expect(filter).toBe('contrast(0.157067) brightness(1.910013)');
    expect(applyCssFilter(filter, 255)).toBe(255);
  });

  test('negative intercept runs brightness() first so contrast() may exceed 1', () => {
    expect(filterFor(-20000, 50000)).toBe('brightness(0.769231) contrast(2.6)');
  });
});

describe('lumTransfer', () => {
  test('identity and non-finite input produce no transfer', () => {
    expect(lumTransfer(0, 0)).toBeNull();
    expect(lumTransfer(Number.NaN, 0)).toBeNull();
    expect(lumTransfer(0, Number.POSITIVE_INFINITY)).toBeNull();
  });

  test('clamps out-of-schema percentages to Word range', () => {
    expect(lumTransfer(250, 0)).toEqual(lumTransfer(100, 0));
    expect(lumTransfer(0, 100)).toEqual(lumTransfer(0, 100.5));
    expect(lumTransfer(0, -400)).toEqual({ slope: 0, intercept: 0.5 });
  });

  test('a full-contrast step keeps a finite slope', () => {
    const transfer = lumTransfer(0, 100)!;
    expect(Number.isFinite(transfer.slope)).toBe(true);
    expect(Number.isFinite(transfer.intercept)).toBe(true);
    expect(lumFilterFunctions(transfer)).toBe('brightness(1) contrast(1000)');
  });
});

describe('drawingFilterStyle', () => {
  test('is undefined without effects', () => {
    expect(drawingFilterStyle({ grayscale: false, brightness: 0, contrast: 0 })).toBeUndefined();
  });

  test('grayscale precedes the lum transfer', () => {
    expect(drawingFilterStyle({ grayscale: true, brightness: 40, contrast: 0 })).toBe(
      'grayscale(1) contrast(0.555556) brightness(1.8)'
    );
  });

  test('rounds float noise out of the paint fingerprint string', () => {
    // 1 + -70 / 100 is 0.30000000000000004; the string must not carry that.
    expect(drawingFilterStyle({ grayscale: false, brightness: 70.001, contrast: -70 })).toBe(
      'contrast(0.157067) brightness(1.910013)'
    );
  });
});

describe('picture opacity', () => {
  // `a:alphaModFix` is published as a fixed alpha and the PDF writer applies it; the browser
  // sink must paint the same picture at the same alpha, or one record means two pictures.
  test('a fixed alpha becomes an opacity() filter beside the colour functions', () => {
    expect(drawingFilterStyle({ opacity: 0.5, grayscale: false, brightness: 0, contrast: 0 })).toBe(
      'opacity(0.5)'
    );
    expect(drawingFilterStyle({ opacity: 0.25, grayscale: true, brightness: 0, contrast: 0 })).toBe(
      'grayscale(1) opacity(0.25)'
    );
  });

  test('an opaque or absent alpha adds nothing', () => {
    expect(drawingFilterStyle({ opacity: 1, grayscale: false, brightness: 0, contrast: 0 })).toBe(
      undefined
    );
    expect(drawingFilterStyle({ grayscale: false, brightness: 0, contrast: 0 })).toBe(undefined);
  });
});
