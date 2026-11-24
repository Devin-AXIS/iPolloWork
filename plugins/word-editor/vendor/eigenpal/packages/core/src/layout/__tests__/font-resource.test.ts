import { describe, expect, test } from 'bun:test';
import {
  FontResolutionError,
  ResolvedCache,
  boundedStructuralFontValidator,
  createFontResourceSnapshot,
  fixedPoint,
  fontRequestKey,
  shapingEnvironmentFingerprint,
  sha256FontBytes,
  type CacheProvenance,
  type FontRequest,
  type OperationSnapshot,
  type ShapeInput,
  type ShapedRun,
  type ShapingEnvironment,
  type TextShaper,
} from '../index.ts';

const regular: FontRequest = { family: 'Document Sans', weight: 400, style: 'normal' };
const italic: FontRequest = { family: 'Document Sans', weight: 400, style: 'italic' };
const replacement: FontRequest = { family: 'Bundled Sans', weight: 400, style: 'normal' };
const sfntBytes = () => new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const ttcBytes = () =>
  new Uint8Array([
    0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0, 0, 0, 0, 2, 0, 0, 0, 20, 0, 0, 0, 32, 0, 1, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);

const source = (request: FontRequest = regular, bytes = sfntBytes()) => ({
  request,
  id: `${request.family}-${request.weight}-${request.style}`,
  bytes,
  hash: sha256FontBytes(bytes),
  faceIndex: 0,
});

const resolvedFont = (definition = source()) => {
  const snapshot = createFontResourceSnapshot({
    epoch: 1,
    maxFontBytes: 1024,
    resources: [definition],
    validateFont: boundedStructuralFontValidator,
  });
  const result = snapshot.resolve(definition.request);
  if (result instanceof FontResolutionError) throw result;
  return result;
};

describe('font resource contracts', () => {
  test('rejects requested font ceilings above the engine hard maximum', () => {
    expect(() =>
      createFontResourceSnapshot({
        epoch: 1,
        maxFontBytes: Number.MAX_SAFE_INTEGER,
        resources: [],
        validateFont: boundedStructuralFontValidator,
      })
    ).toThrow(RangeError);
  });

  test('authoritatively rejects hard source-count and aggregate ceilings before work', () => {
    const definition = source();
    const aggregateBytes = new Uint8Array(1024 * 1024);
    const aggregateDefinition = source(regular, aggregateBytes);
    for (const resources of [
      Array.from({ length: 257 }, () => definition),
      Array.from({ length: 129 }, () => aggregateDefinition),
    ]) {
      const counters = { copies: 0, hashes: 0, validations: 0 };
      expect(() =>
        createFontResourceSnapshot({
          epoch: 1,
          maxFontBytes: 2 * 1024 * 1024,
          resources,
          validateFont: () => {
            counters.validations += 1;
            return { valid: true };
          },
          instrumentation: {
            onOwnedByteCopy: () => (counters.copies += 1),
            onHash: () => (counters.hashes += 1),
          },
        })
      ).toThrow(RangeError);
      expect(counters).toEqual({ copies: 0, hashes: 0, validations: 0 });
    }
  });

  test('resolved identity includes the explicit byte hash and face index', () => {
    const first = resolvedFont();
    const collection = ttcBytes();
    const otherFace = resolvedFont({
      ...source(),
      bytes: collection,
      hash: sha256FontBytes(collection),
      faceIndex: 1,
    });
    const changed = sfntBytes();
    changed[11] = 1;
    const otherBytes = resolvedFont({
      ...source(),
      bytes: changed,
      hash: sha256FontBytes(changed),
    });

    expect(first.byteLength).toBe(12);
    expect(first.identity).toBe(`${first.hash}#0`);
    expect(otherFace.identity).not.toBe(first.identity);
    expect(otherBytes.identity).not.toBe(first.identity);
  });

  test('request matching includes family, numeric weight, and style', () => {
    const snapshot = createFontResourceSnapshot({
      epoch: 1,
      maxFontBytes: 64,
      resources: [source()],
      validateFont: boundedStructuralFontValidator,
    });

    expect(snapshot.resolve(regular)).not.toBeInstanceOf(FontResolutionError);
    expect(snapshot.resolve({ ...regular, family: 'document sans' })).not.toBeInstanceOf(
      FontResolutionError
    );
    for (const request of [{ ...regular, weight: 700 }, italic]) {
      const result = snapshot.resolve(request);
      expect(result).toBeInstanceOf(FontResolutionError);
      expect(result).toMatchObject({ code: 'missing', request });
    }
    expect(fontRequestKey(regular)).not.toBe(fontRequestKey(italic));
  });

  test('uses only an exact declared substitution and records its provenance', () => {
    const snapshot = createFontResourceSnapshot({
      epoch: 4,
      maxFontBytes: 64,
      resources: [source(replacement)],
      substitutions: [
        {
          from: regular,
          to: replacement,
          lineMetrics: { heightEm: 1.2, baselineEm: 0.9 },
        },
      ],
      validateFont: boundedStructuralFontValidator,
    });

    const result = snapshot.resolve(regular);
    expect(result).not.toBeInstanceOf(FontResolutionError);
    if (result instanceof FontResolutionError) throw result;
    expect(result.substitution).toEqual({
      requested: regular,
      resolved: replacement,
      lineMetrics: { heightEm: 1.2, baselineEm: 0.9 },
    });
    expect(result.family).toBe(replacement.family);
  });

  test('rejects every out-of-bounds substitution line metric', () => {
    // A substitution's line box comes from a host, and a host may compute it from a file.
    // Each branch is its own way to break layout: a zero or negative height collapses the
    // line, an enormous one pushes a page's worth of blank space per line, a baseline past
    // the height puts the text outside its own box, and a non-finite value poisons every
    // sum downstream. One `Infinity` case left the other five unasserted.
    const rejected: readonly {
      readonly why: string;
      readonly lineMetrics: { readonly heightEm: number; readonly baselineEm: number };
    }[] = [
      {
        why: 'non-finite height',
        lineMetrics: { heightEm: Number.POSITIVE_INFINITY, baselineEm: 0.9 },
      },
      { why: 'NaN height', lineMetrics: { heightEm: Number.NaN, baselineEm: 0.9 } },
      // NaN, not Infinity: an infinite baseline is already caught by the
      // baseline-past-height comparison, so it never reaches the finiteness guard.
      { why: 'NaN baseline', lineMetrics: { heightEm: 1.2, baselineEm: Number.NaN } },
      { why: 'zero height', lineMetrics: { heightEm: 0, baselineEm: 0 } },
      { why: 'negative height', lineMetrics: { heightEm: -1.2, baselineEm: -0.9 } },
      { why: 'height past the em-box cap', lineMetrics: { heightEm: 4.0001, baselineEm: 0.9 } },
      { why: 'negative baseline', lineMetrics: { heightEm: 1.2, baselineEm: -0.0001 } },
      { why: 'baseline past the height', lineMetrics: { heightEm: 1.2, baselineEm: 1.2001 } },
    ];
    // `why` is folded into the assertion rather than asserted beside it: a separate
    // `expect(why).toBe(why)` compares a value with itself and never runs anyway, because
    // the `toThrow` above it fails first. Mapping the whole list to an outcome names the
    // branch that stopped rejecting IN the diff.
    const outcomes = rejected.map(({ why, lineMetrics }) => {
      try {
        createFontResourceSnapshot({
          epoch: 4,
          maxFontBytes: 64,
          resources: [source(replacement)],
          substitutions: [{ from: regular, to: replacement, lineMetrics }],
          validateFont: boundedStructuralFontValidator,
        });
        return `${why}: ACCEPTED`;
      } catch (error) {
        return `${why}: ${error instanceof RangeError ? 'rejected' : `threw ${String(error)}`}`;
      }
    });
    expect(outcomes).toEqual(rejected.map(({ why }) => `${why}: rejected`));
  });

  test('accepts the boundary values the em box allows', () => {
    // The cap and the baseline-equals-height edge are inclusive; asserting only the
    // rejections would let a tightened bound pass unnoticed.
    for (const lineMetrics of [
      { heightEm: 4, baselineEm: 4 },
      { heightEm: 1.2, baselineEm: 0 },
    ]) {
      const snapshot = createFontResourceSnapshot({
        epoch: 4,
        maxFontBytes: 64,
        resources: [source(replacement)],
        substitutions: [{ from: regular, to: replacement, lineMetrics }],
        validateFont: boundedStructuralFontValidator,
      });
      const result = snapshot.resolve(regular);
      if (result instanceof FontResolutionError) throw result;
      expect(result.substitution?.lineMetrics).toEqual(lineMetrics);
    }
  });

  test('rejects over-limit resources before font validation', () => {
    let validationCalls = 0;
    const snapshot = createFontResourceSnapshot({
      epoch: 1,
      maxFontBytes: 3,
      resources: [source()],
      validateFont: () => {
        validationCalls += 1;
        return { valid: true };
      },
    });

    expect(snapshot.resolve(regular)).toMatchObject({
      code: 'overLimit',
      limit: 3,
      actual: 12,
    });
    expect(validationCalls).toBe(0);
  });

  test('keeps malformed-font parsing behind an injected validation boundary', () => {
    const snapshot = createFontResourceSnapshot({
      epoch: 1,
      maxFontBytes: 64,
      resources: [source()],
      validateFont: () => ({ valid: false, diagnostic: 'invalid sfnt directory' }),
    });

    expect(snapshot.resolve(regular)).toMatchObject({
      code: 'malformed',
      diagnostic: 'invalid sfnt directory',
    });
  });

  test('returns typed missing and forbidden errors without a fetch capability', () => {
    const snapshot = createFontResourceSnapshot({
      epoch: 1,
      maxFontBytes: 64,
      resources: [{ ...source(), availability: 'forbidden' }],
      validateFont: boundedStructuralFontValidator,
    });

    const forbidden = snapshot.resolve(regular);
    const missing = snapshot.resolve(italic);
    expect(forbidden).toBeInstanceOf(FontResolutionError);
    expect(forbidden).toMatchObject({ code: 'forbidden', request: regular });
    expect(missing).toBeInstanceOf(FontResolutionError);
    expect(missing).toMatchObject({ code: 'missing', request: italic });
    expect(Object.keys(snapshot).sort()).toEqual(['epoch', 'resolve']);
  });

  test('owns immutable byte copies on input and output', () => {
    const supplied = sfntBytes();
    const expected = supplied.slice();
    const snapshot = createFontResourceSnapshot({
      epoch: 1,
      maxFontBytes: 64,
      resources: [source(regular, supplied)],
      validateFont: boundedStructuralFontValidator,
    });
    supplied[0] = 99;

    const result = snapshot.resolve(regular);
    if (result instanceof FontResolutionError) throw result;
    const exposed = result.bytes;
    expect(exposed).toEqual(expected);
    exposed[1] = 88;
    expect(result.bytes).toEqual(expected);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.request)).toBe(true);
  });

  test('does not trust a proxy that spoofs internal preparation symbols', () => {
    const supplied = sfntBytes();
    const expected = supplied.slice();
    const definition = source(regular, supplied);
    const hostile = new Proxy(definition, {
      has: (target, key) => typeof key === 'symbol' || Reflect.has(target, key),
      get: (target, key, receiver) =>
        key === 'actualHash' ? definition.hash : Reflect.get(target, key, receiver),
    });
    const counters = { copies: 0, hashes: 0 };
    const snapshot = createFontResourceSnapshot({
      epoch: 1,
      maxFontBytes: 64,
      resources: [hostile],
      validateFont: boundedStructuralFontValidator,
      instrumentation: {
        onOwnedByteCopy: () => (counters.copies += 1),
        onHash: () => (counters.hashes += 1),
      },
    });

    supplied[0] = 99;
    const result = snapshot.resolve(regular);
    if (result instanceof FontResolutionError) throw result;
    expect(counters).toEqual({ copies: 1, hashes: 1 });
    expect(result.bytes).toEqual(expected);
  });

  test('authenticates byte views and never invokes caller-owned copy methods', () => {
    const supplied = sfntBytes();
    const definition = source(regular, supplied);
    Object.defineProperty(supplied, 'slice', {
      value() {
        throw new Error('caller-owned slice must not execute');
      },
    });
    const snapshot = createFontResourceSnapshot({
      epoch: 1,
      maxFontBytes: 64,
      resources: [definition],
      validateFont: boundedStructuralFontValidator,
    });
    const result = snapshot.resolve(regular);
    if (result instanceof FontResolutionError) throw result;
    expect(result.bytes).toEqual(sfntBytes());

    const fake = new Proxy(sfntBytes(), {
      get(target, key, receiver) {
        if (key === 'byteLength') return 1;
        if (key === 'slice') return () => new Uint8Array(1024 * 1024);
        return Reflect.get(target, key, receiver);
      },
    });
    expect(() =>
      createFontResourceSnapshot({
        epoch: 1,
        maxFontBytes: 64,
        resources: [{ ...source(regular, sfntBytes()), bytes: fake }],
        validateFont: boundedStructuralFontValidator,
      })
    ).toThrow('genuine byte array');
  });

  test('samples resource and substitution arrays by bounded index, never caller iteration', () => {
    const definition = source();
    const resources = [definition];
    const substitutions = [{ from: italic, to: regular }];
    let iteratorCalls = 0;
    for (const input of [resources, substitutions]) {
      Object.defineProperty(input, Symbol.iterator, {
        value() {
          iteratorCalls += 1;
          throw new Error('caller-owned iterator must not execute');
        },
      });
    }

    const snapshot = createFontResourceSnapshot({
      epoch: 1,
      maxFontBytes: 64,
      resources,
      substitutions,
      validateFont: boundedStructuralFontValidator,
    });
    expect(snapshot.resolve(regular)).not.toBeInstanceOf(FontResolutionError);
    expect(snapshot.resolve(italic)).not.toBeInstanceOf(FontResolutionError);
    expect(iteratorCalls).toBe(0);
  });

  test('copies and validates each admitted face once regardless of repeated resolution', () => {
    const events: string[] = [];
    const snapshot = createFontResourceSnapshot({
      epoch: 1,
      maxFontBytes: 64,
      resources: [source()],
      validateFont: (bytes, faceIndex) => {
        events.push(`validate:${bytes.byteLength}:${faceIndex}`);
        return boundedStructuralFontValidator(bytes, faceIndex);
      },
      instrumentation: {
        onOwnedByteCopy: () => events.push('copy'),
        onTableScan: () => events.push('scan'),
      },
    });
    const first = snapshot.resolve(regular);
    const second = snapshot.resolve(regular);
    expect(first).toBe(second);
    expect(events).toEqual(['copy', 'scan', 'validate:12:0']);
  });

  test('resource epochs preserve cache entries whose exact font dependency is unchanged', () => {
    const first = createFontResourceSnapshot({
      epoch: 7,
      maxFontBytes: 64,
      resources: [source()],
      validateFont: boundedStructuralFontValidator,
    });
    const next = createFontResourceSnapshot({
      epoch: 8,
      maxFontBytes: 64,
      resources: [source()],
      validateFont: boundedStructuralFontValidator,
    });
    const environment = (resourceEpoch: number): OperationSnapshot => ({
      resourceEpoch,
      configEpoch: 2,
      extensionFingerprint: 'extensions',
      shapingHash: 'shape',
      producerVersion: 1,
    });
    const provenance: CacheProvenance = {
      revision: 11,
      dependencyFingerprint: `font:Document Sans=${source().hash}`,
      inputFingerprint: 'text',
      resourceDependencies: [{ key: 'font:Document Sans', fingerprint: source().hash }],
      ...environment(first.epoch),
    };
    const cache = new ResolvedCache<string>();
    cache.set('run', 'shaped', provenance);

    const { resourceEpoch: _resourceEpoch, ...other } = provenance;
    expect(cache.get('run', { ...other, resourceEpoch: next.epoch }).hit).toBe(true);
  });
});

describe('shaping contracts', () => {
  const font = resolvedFont();
  const environment: ShapingEnvironment = {
    font,
    variationAxes: { wght: 400 },
    shapingLibrary: { name: 'contract-shaper', version: '1' },
    unicodeDataVersion: '15.1',
    normalization: 'none',
    script: 'Latn',
    language: 'en',
    direction: 'ltr',
    features: { kern: 1, liga: 1 },
    fallbackOrder: [font],
    fixedPointScale: 64,
    roundingMode: 'halfAwayFromZero',
  };

  test('fingerprint inputs are deterministic and include every shaping variable', () => {
    const reordered: ShapingEnvironment = {
      ...environment,
      variationAxes: { wght: 400 },
      features: { liga: 1, kern: 1 },
    };
    expect(shapingEnvironmentFingerprint(reordered)).toBe(
      shapingEnvironmentFingerprint(environment)
    );
    expect(shapingEnvironmentFingerprint({ ...environment, language: 'pl' })).not.toBe(
      shapingEnvironmentFingerprint(environment)
    );
    expect(shapingEnvironmentFingerprint({ ...environment, fixedPointScale: 1024 })).not.toBe(
      shapingEnvironmentFingerprint(environment)
    );
    const changed = sfntBytes();
    changed[11] = 1;
    const fallbackWithOtherBytes = resolvedFont({
      ...source(),
      bytes: changed,
      hash: sha256FontBytes(changed),
    });
    expect(
      shapingEnvironmentFingerprint({
        ...environment,
        fallbackOrder: [fallbackWithOtherBytes],
      })
    ).not.toBe(shapingEnvironmentFingerprint(environment));
  });

  test('shape input and output expose fixed-point cluster, glyph, and vertical metrics contracts', () => {
    const input: ShapeInput = { text: 'fi', fontSizeHalfPoints: 24, bidiLevel: 0, environment };
    const expected: ShapedRun = {
      text: 'fi',
      direction: 'ltr',
      bidiLevel: 0,
      glyphs: [
        {
          id: 42,
          cluster: 0,
          advanceX: fixedPoint(70),
          advanceY: fixedPoint(0),
          offsetX: fixedPoint(0),
          offsetY: fixedPoint(0),
        },
      ],
      clusters: [
        {
          textStart: 0,
          textEnd: 2,
          glyphStart: 0,
          glyphEnd: 1,
          advance: fixedPoint(70),
          caretEdges: [fixedPoint(0), fixedPoint(35), fixedPoint(70)],
          fontSpan: 0,
        },
      ],
      fontSpans: [{ glyphStart: 0, glyphEnd: 1, font, fallbackIndex: null }],
      metrics: { ascent: fixedPoint(48), descent: fixedPoint(12), lineGap: fixedPoint(4) },
    };
    const shaper: TextShaper = { shape: (received) => ({ ...expected, text: received.text }) };

    expect(shaper.shape(input)).toEqual(expected);
    for (const value of [
      expected.glyphs[0]!.advanceX,
      expected.clusters[0]!.advance,
      expected.metrics.ascent,
    ]) {
      expect(Number.isInteger(value)).toBe(true);
    }
    expect(() => fixedPoint(1.5)).toThrow(/safe integer/);
  });
});
