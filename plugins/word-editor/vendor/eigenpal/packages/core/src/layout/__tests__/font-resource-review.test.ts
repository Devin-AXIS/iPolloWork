import { describe, expect, test } from 'bun:test';
import * as engineLayout from '../index.ts';
import {
  FontResolutionError,
  ResolvedCache,
  boundedStructuralFontValidator,
  captureOperationSnapshot,
  createFontResourceSnapshot,
  createShapedRun,
  createShapingEnvironment,
  fixedPoint,
  guardOperationSnapshot,
  sha256FontBytes,
  shapedRunComparatorInputs,
  shapingEnvironmentFingerprint,
  type CacheProvenance,
  type FontByteValidator,
  type FontRequest,
  type FontResourceDefinition,
  type OperationSnapshot,
  type ResolvedFont,
  type ShapedRun,
  type ShapingEnvironmentInput,
} from '../index.ts';

const REGULAR: FontRequest = { family: 'Document Sans', weight: 400, style: 'normal' };
const FALLBACK: FontRequest = { family: 'Bundled Sans', weight: 400, style: 'normal' };
const SFNT = new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const SFNT_HASH = 'sha256:028e2518bd2b8b19b650bf2ed80b5dbb7105936e582dd82fff99215313d09295';
const OTHER_SFNT = new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
const OTHER_HASH = 'sha256:cf52d67b1e65969436dbb7c632d74451d7daee3b80dbe1d8c9e6cee262142c34';
const TTC = new Uint8Array([
  0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0, 0, 0, 0, 2, 0, 0, 0, 20, 0, 0, 0, 32, 0, 1, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);

const definition = (
  request: FontRequest = REGULAR,
  bytes: Uint8Array = SFNT,
  hash: string = SFNT_HASH
): FontResourceDefinition => ({
  request,
  id: `${request.family}-${request.weight}-${request.style}`,
  bytes,
  hash,
  faceIndex: 0,
});

const snapshot = (
  resources: readonly FontResourceDefinition[] = [definition()],
  validateFont: FontByteValidator = boundedStructuralFontValidator
) =>
  createFontResourceSnapshot({
    epoch: 1,
    maxFontBytes: 1024,
    resources,
    validateFont,
  });

const resolved = (
  request: FontRequest = REGULAR,
  resources: readonly FontResourceDefinition[] = [definition()]
) => {
  const result = snapshot(resources).resolve(request);
  if (result instanceof FontResolutionError) throw result;
  return result;
};

const baseEnvironment = (font: ResolvedFont): ShapingEnvironmentInput => ({
  font,
  variationAxes: { wght: 400, wdth: 100 },
  shapingLibrary: { name: 'contract-shaper', version: '1.0.0' },
  unicodeDataVersion: '15.1.0',
  normalization: 'none',
  script: 'Latn',
  language: 'en',
  direction: 'ltr',
  features: { liga: 1, kern: 1 },
  fallbackOrder: [],
  fixedPointScale: 64,
  roundingMode: 'halfAwayFromZero',
});

describe('font byte integrity and validation review blockers', () => {
  test('uses the standard SHA-256 digest', () => {
    expect(sha256FontBytes(new TextEncoder().encode('abc'))).toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  test('verifies supplied SHA-256 against owned bytes and binds identity to digest plus face', () => {
    const font = resolved();
    expect(font.hash).toBe(SFNT_HASH);
    expect(font.identity).toBe(`${SFNT_HASH}#0`);

    const mismatch = snapshot([definition(REGULAR, OTHER_SFNT, SFNT_HASH)]).resolve(REGULAR);
    expect(mismatch).toBeInstanceOf(FontResolutionError);
    expect(mismatch).toMatchObject({
      code: 'hashMismatch',
      expectedHash: SFNT_HASH,
      actualHash: OTHER_HASH,
    });
  });

  test('requires total validation and converts validator exceptions to malformed outcomes', () => {
    expect(() =>
      createFontResourceSnapshot({
        epoch: 1,
        maxFontBytes: 1024,
        resources: [definition()],
      } as never)
    ).toThrow(/validator/i);

    const result = snapshot([definition()], () => {
      throw new Error('parser exploded');
    }).resolve(REGULAR);
    expect(result).toBeInstanceOf(FontResolutionError);
    expect(result).toMatchObject({ code: 'malformed', diagnostic: 'parser exploded' });
  });

  test('bounded structural validation rejects truncated and inconsistent sfnt directories', () => {
    expect(boundedStructuralFontValidator(new Uint8Array([0, 1, 0]), 0)).toMatchObject({
      valid: false,
    });
    const oneTableWithoutDirectory = new Uint8Array([0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
    expect(boundedStructuralFontValidator(oneTableWithoutDirectory, 0)).toMatchObject({
      valid: false,
    });
    expect(boundedStructuralFontValidator(SFNT, 0)).toEqual({ valid: true });
  });

  test('does not expose a construction helper that bypasses snapshot validation', () => {
    expect('createResolvedFont' in engineLayout).toBe(false);
    const forged = {
      id: 'forged',
      identity: `${SFNT_HASH}#0`,
      request: REGULAR,
      family: REGULAR.family,
      bytes: SFNT,
      hash: SFNT_HASH,
      faceIndex: 0,
    } as ResolvedFont;
    expect(() =>
      createShapingEnvironment({ ...baseEnvironment(forged), fallbackOrder: [] })
    ).toThrow(/validated resolved font/i);
  });

  test('captures byte ceiling and validator instead of retaining mutable options', () => {
    const options = {
      epoch: 1,
      maxFontBytes: 1024,
      resources: [definition()],
      validateFont: boundedStructuralFontValidator,
    };
    const captured = createFontResourceSnapshot(options);
    options.maxFontBytes = 1;
    options.validateFont = () => ({ valid: false, diagnostic: 'mutated' });
    expect(captured.resolve(REGULAR)).not.toBeInstanceOf(FontResolutionError);

    const limitedOptions = {
      ...options,
      maxFontBytes: 3,
      validateFont: boundedStructuralFontValidator,
    };
    const limited = createFontResourceSnapshot(limitedOptions);
    limitedOptions.maxFontBytes = 1024;
    expect(limited.resolve(REGULAR)).toMatchObject({ code: 'overLimit', limit: 3, actual: 12 });
  });
});

describe('canonical shaping environment review blockers', () => {
  const primary = resolved();
  const fallback = resolved(FALLBACK, [definition(FALLBACK, OTHER_SFNT, OTHER_HASH)]);
  const base = (): ShapingEnvironmentInput => ({
    ...baseEnvironment(primary),
    fallbackOrder: [fallback],
  });

  test('serializes shaping library as exactly name and version', () => {
    const ordinary = createShapingEnvironment(base());
    const reorderedWithExtra = createShapingEnvironment({
      ...base(),
      shapingLibrary: {
        version: '1.0.0',
        ignored: 'must-not-contribute',
        name: 'contract-shaper',
      } as ShapingEnvironmentInput['shapingLibrary'],
    });
    expect(Object.keys(reorderedWithExtra.shapingLibrary)).toEqual(['name', 'version']);
    expect(shapingEnvironmentFingerprint(reorderedWithExtra)).toBe(
      shapingEnvironmentFingerprint(ordinary)
    );
  });

  test('canonicalizes property order while preserving semantic fallback order', () => {
    const reordered = createShapingEnvironment({
      ...base(),
      variationAxes: { wdth: 100, wght: 400 },
      features: { kern: 1, liga: 1 },
    });
    const canonical = createShapingEnvironment(base());
    expect(shapingEnvironmentFingerprint(reordered)).toBe(shapingEnvironmentFingerprint(canonical));
    expect(Object.keys(canonical.variationAxes)).toEqual(['wdth', 'wght']);
    expect(Object.keys(canonical.features)).toEqual(['kern', 'liga']);
    expect(canonical.fallbackOrder.map((font) => font.identity)).toEqual([fallback.identity]);
  });

  test('every required environment field contributes to the fingerprint', () => {
    const original = shapingEnvironmentFingerprint(createShapingEnvironment(base()));
    const otherFace = resolved(REGULAR, [
      {
        ...definition(),
        bytes: TTC,
        hash: sha256FontBytes(TTC),
        faceIndex: 1,
      },
    ]);
    const variants: ShapingEnvironmentInput[] = [
      { ...base(), font: fallback },
      { ...base(), font: otherFace },
      { ...base(), variationAxes: { ...base().variationAxes, wght: 401 } },
      { ...base(), shapingLibrary: { name: 'other-shaper', version: '1.0.0' } },
      { ...base(), shapingLibrary: { name: 'contract-shaper', version: '1.0.1' } },
      { ...base(), unicodeDataVersion: '16.0.0' },
      { ...base(), normalization: 'NFC' },
      { ...base(), script: 'Arab' },
      { ...base(), language: 'pl' },
      { ...base(), direction: 'rtl' },
      { ...base(), features: { ...base().features, liga: 0 } },
      { ...base(), fallbackOrder: [primary] },
      { ...base(), fixedPointScale: 1024 },
      { ...base(), roundingMode: 'halfToEven' },
    ];
    for (const variant of variants) {
      expect(shapingEnvironmentFingerprint(createShapingEnvironment(variant))).not.toBe(original);
    }
  });

  test('fallback order remains ordered and contributes in that order', () => {
    const first = shapingEnvironmentFingerprint(
      createShapingEnvironment({ ...base(), fallbackOrder: [primary, fallback] })
    );
    const reversed = shapingEnvironmentFingerprint(
      createShapingEnvironment({ ...base(), fallbackOrder: [fallback, primary] })
    );
    expect(first).not.toBe(reversed);
  });

  test('rejects non-finite numbers, blank versions, invalid tags, and invalid fixed-point scale', () => {
    for (const invalid of [
      { ...base(), variationAxes: { wght: Number.NaN } },
      { ...base(), features: { kern: Number.POSITIVE_INFINITY } },
      { ...base(), shapingLibrary: { name: '', version: '1' } },
      { ...base(), shapingLibrary: { name: 'shape', version: ' ' } },
      { ...base(), shapingLibrary: { name: 'shape', version: 'version' } },
      { ...base(), unicodeDataVersion: '' },
      { ...base(), unicodeDataVersion: 'latest' },
      { ...base(), script: 'latin' },
      { ...base(), language: '' },
      { ...base(), language: 'not_a_language' },
      { ...base(), fixedPointScale: 0 },
      { ...base(), fixedPointScale: 1.5 },
    ] as ShapingEnvironmentInput[]) {
      expect(() => createShapingEnvironment(invalid)).toThrow();
    }
  });

  test('fingerprint includes substitution provenance, not only resolved bytes', () => {
    const substitutedSnapshot = createFontResourceSnapshot({
      epoch: 1,
      maxFontBytes: 1024,
      resources: [definition(FALLBACK, OTHER_SFNT, OTHER_HASH)],
      substitutions: [{ from: REGULAR, to: FALLBACK }],
      validateFont: boundedStructuralFontValidator,
    });
    const substituted = substitutedSnapshot.resolve(REGULAR);
    if (substituted instanceof FontResolutionError) throw substituted;
    const direct = resolved(FALLBACK, [definition(FALLBACK, OTHER_SFNT, OTHER_HASH)]);
    expect(substituted.identity).toBe(direct.identity);
    expect(
      shapingEnvironmentFingerprint(createShapingEnvironment({ ...base(), font: substituted }))
    ).not.toBe(
      shapingEnvironmentFingerprint(createShapingEnvironment({ ...base(), font: direct }))
    );
  });

  test('exact shaped-run comparator carries fallback font spans and validates fixed points', () => {
    const environment = createShapingEnvironment(base());
    const run: ShapedRun = {
      text: 'ab',
      direction: 'ltr',
      bidiLevel: 0,
      glyphs: [
        {
          id: 1,
          cluster: 0,
          originX: fixedPoint(0),
          originY: fixedPoint(0),
          advanceX: fixedPoint(10),
          advanceY: fixedPoint(0),
          offsetX: fixedPoint(0),
          offsetY: fixedPoint(0),
          outline: { path: 'M0,0Z', unitsPerEm: 1000 },
        },
        {
          id: 2,
          cluster: 1,
          originX: fixedPoint(10),
          originY: fixedPoint(0),
          advanceX: fixedPoint(11),
          advanceY: fixedPoint(0),
          offsetX: fixedPoint(0),
          offsetY: fixedPoint(0),
          outline: { path: 'M0,0Z', unitsPerEm: 1000 },
        },
      ],
      clusters: [
        {
          textStart: 0,
          textEnd: 1,
          glyphStart: 0,
          glyphEnd: 1,
          advance: fixedPoint(10),
          caretEdges: [fixedPoint(0), fixedPoint(10)],
          fontSpan: 0,
        },
        {
          textStart: 1,
          textEnd: 2,
          glyphStart: 1,
          glyphEnd: 2,
          advance: fixedPoint(11),
          caretEdges: [fixedPoint(0), fixedPoint(11)],
          fontSpan: 1,
        },
      ],
      fontSpans: [
        { glyphStart: 0, glyphEnd: 1, font: primary, fallbackIndex: null },
        { glyphStart: 1, glyphEnd: 2, font: fallback, fallbackIndex: 0 },
      ],
      metrics: { ascent: fixedPoint(48), descent: fixedPoint(12), lineGap: fixedPoint(4) },
    };
    const comparator = shapedRunComparatorInputs(createShapedRun(run, environment), environment);
    expect(comparator.fontSpans[1]).toMatchObject({
      glyphStart: 1,
      glyphEnd: 2,
      fallbackIndex: 0,
      font: { identity: fallback.identity, hash: fallback.hash },
    });

    const invalidRuns: ShapedRun[] = [
      ...(['advanceX', 'advanceY', 'offsetX', 'offsetY'] as const).map((field) => ({
        ...run,
        glyphs: [{ ...run.glyphs[0]!, [field]: 1.5 }, run.glyphs[1]!],
      })),
      {
        ...run,
        clusters: [{ ...run.clusters[0]!, advance: 1.5 }, run.clusters[1]!],
      },
      {
        ...run,
        clusters: [{ ...run.clusters[0]!, caretEdges: [fixedPoint(0), 1.5] }, run.clusters[1]!],
      },
      ...(['ascent', 'descent', 'lineGap'] as const).map((field) => ({
        ...run,
        metrics: { ...run.metrics, [field]: 1.5 },
      })),
    ] as ShapedRun[];
    for (const invalid of invalidRuns) {
      expect(() => createShapedRun(invalid, environment)).toThrow(/fixed-point/i);
    }
  });

  test('rejects fallback spans that do not exactly match the shaping environment', () => {
    const environment = createShapingEnvironment(base());
    const run: ShapedRun = {
      text: 'a',
      direction: 'ltr',
      bidiLevel: 0,
      glyphs: [
        {
          id: 1,
          cluster: 0,
          originX: fixedPoint(0),
          originY: fixedPoint(0),
          advanceX: fixedPoint(10),
          advanceY: fixedPoint(0),
          offsetX: fixedPoint(0),
          offsetY: fixedPoint(0),
          outline: { path: 'M0,0Z', unitsPerEm: 1000 },
        },
      ],
      clusters: [
        {
          textStart: 0,
          textEnd: 1,
          glyphStart: 0,
          glyphEnd: 1,
          advance: fixedPoint(10),
          caretEdges: [fixedPoint(0), fixedPoint(10)],
          fontSpan: 0,
        },
      ],
      fontSpans: [{ glyphStart: 0, glyphEnd: 1, font: fallback, fallbackIndex: 0 }],
      metrics: { ascent: fixedPoint(8), descent: fixedPoint(2), lineGap: fixedPoint(0) },
    };
    expect(() =>
      createShapedRun(
        {
          ...run,
          fontSpans: [{ ...run.fontSpans[0]!, fallbackIndex: 1 }],
        },
        environment
      )
    ).toThrow(/fallback index/i);
    expect(() =>
      createShapedRun(
        {
          ...run,
          fontSpans: [{ ...run.fontSpans[0]!, font: primary }],
        },
        environment
      )
    ).toThrow(/fallback font/i);

    const requestedFallback: FontRequest = {
      family: 'Requested Fallback',
      weight: 400,
      style: 'normal',
    };
    const substitutedSnapshot = createFontResourceSnapshot({
      epoch: 1,
      maxFontBytes: 1024,
      resources: [definition(FALLBACK, OTHER_SFNT, OTHER_HASH)],
      substitutions: [{ from: requestedFallback, to: FALLBACK }],
      validateFont: boundedStructuralFontValidator,
    });
    const substituted = substitutedSnapshot.resolve(requestedFallback);
    if (substituted instanceof FontResolutionError) throw substituted;
    expect(substituted.identity).toBe(fallback.identity);
    expect(() =>
      createShapedRun(
        {
          ...run,
          fontSpans: [{ ...run.fontSpans[0]!, font: substituted }],
        },
        environment
      )
    ).toThrow(/fallback font/i);
    expect(() =>
      createShapedRun(
        {
          ...run,
          fontSpans: [{ ...run.fontSpans[0]!, fallbackIndex: null }],
        },
        environment
      )
    ).toThrow(/primary font/i);
  });
});

describe('dependency-scoped cache and operation snapshot review blockers', () => {
  const environment = (resourceEpoch: number): OperationSnapshot =>
    captureOperationSnapshot({
      resourceEpoch,
      configEpoch: 2,
      extensionFingerprint: 'extensions',
      shapingHash: 'shape',
      producerVersion: 1,
    });
  const provenance = (
    resourceEpoch: number,
    resourceFingerprint: string,
    key = 'font:Document Sans'
  ): CacheProvenance => ({
    revision: 3,
    dependencyFingerprint: 'deps',
    inputFingerprint: 'input',
    resourceDependencies: [{ key, fingerprint: resourceFingerprint }],
    ...environment(resourceEpoch),
  });

  test('resource epoch drift reuses unrelated entries but rejects changed font hashes', () => {
    const cache = new ResolvedCache<string>();
    cache.set('document-font', 'run-a', provenance(1, SFNT_HASH));
    cache.set('other-font', 'run-b', provenance(1, OTHER_HASH, 'font:Bundled Sans'));

    const { revision: _revision, ...sameFontAtNewEpoch } = provenance(2, SFNT_HASH);
    expect(cache.get('document-font', sameFontAtNewEpoch).hit).toBe(true);

    const { revision: _revision2, ...changedFontAtNewEpoch } = provenance(2, OTHER_HASH);
    expect(cache.get('document-font', changedFontAtNewEpoch)).toMatchObject({
      hit: false,
      reason: 'resource-changed',
      resourceKey: 'font:Document Sans',
    });

    expect(
      cache.evictResources(
        environment(2),
        new Map([
          ['font:Document Sans', OTHER_HASH],
          ['font:Bundled Sans', OTHER_HASH],
        ])
      )
    ).toBe(1);
    expect(
      cache.get('other-font', {
        ...sameFontAtNewEpoch,
        resourceDependencies: [{ key: 'font:Bundled Sans', fingerprint: OTHER_HASH }],
      }).hit
    ).toBe(true);
  });

  test('copies operation and cache provenance instead of retaining mutable references', () => {
    const mutable = {
      resourceEpoch: 1,
      configEpoch: 2,
      extensionFingerprint: 'extensions',
      shapingHash: 'shape',
      producerVersion: 1,
    };
    const captured = captureOperationSnapshot(mutable);
    mutable.resourceEpoch = 9;
    expect(captured.resourceEpoch).toBe(1);
    expect(Object.isFrozen(captured)).toBe(true);

    const dependencies = [{ key: 'font:Document Sans', fingerprint: SFNT_HASH }];
    const cache = new ResolvedCache<string>();
    cache.set('run', 'value', { ...provenance(1, SFNT_HASH), resourceDependencies: dependencies });
    dependencies[0]!.fingerprint = OTHER_HASH;
    const { revision: _revision, ...wanted } = provenance(1, SFNT_HASH);
    const result = cache.get('run', wanted);
    expect(result.hit).toBe(true);
    if (result.hit) expect(Object.isFrozen(result.provenance.resourceDependencies)).toBe(true);
  });

  test('rejects invalid cache provenance instead of allowing ambiguous fingerprints', () => {
    const cache = new ResolvedCache<string>();
    expect(() =>
      cache.set('run', 'value', { ...provenance(1, SFNT_HASH), revision: Number.NaN })
    ).toThrow(/revision/);
    expect(() =>
      cache.set('run', 'value', {
        ...provenance(1, SFNT_HASH),
        resourceDependencies: [{ key: 'font:Document Sans', fingerprint: ' ' }],
      })
    ).toThrow(/fingerprint/);
  });

  test('detects every mid-operation environment drift as a typed restart outcome', () => {
    const captured = environment(1);
    for (const current of [
      { ...captured, resourceEpoch: 2 },
      { ...captured, configEpoch: 3 },
      { ...captured, extensionFingerprint: 'extensions-2' },
      { ...captured, shapingHash: 'shape-2' },
      { ...captured, producerVersion: 2 },
    ]) {
      expect(guardOperationSnapshot(captured, current)).toMatchObject({
        status: 'restart',
      });
    }
    expect(guardOperationSnapshot(captured, { ...captured })).toEqual({ status: 'current' });
  });
});
