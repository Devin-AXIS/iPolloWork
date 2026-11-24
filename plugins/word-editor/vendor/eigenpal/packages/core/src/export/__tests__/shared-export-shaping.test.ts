import { expect, test } from 'bun:test';
import {
  DEFAULT_RUN_STYLE,
  FontResolutionError,
  createFixedMeasurer,
  createHarfBuzzTextShaper,
  createLayoutShapedMeasurer,
  createLayoutShaping,
  createShapedMeasurer,
  disposeLayoutShaping,
  prepareLayoutFontConfiguration,
  sha256FontBytes,
} from '../../layout/index.ts';
import {
  LAYOUT_HARFBUZZ_SHAPER_POLICY,
  layoutShaperExecutionPolicyFingerprint,
  type LayoutHarfBuzzShaperPolicy,
} from '../../layout/layout-shaper-policy.ts';
import { createLayoutShapingWithTextShaper } from '../../layout/layout-shaping.ts';
import {
  acquireProcessWideExportShaper,
  acquireSharedExportShaping,
} from '../shared-export-shaping.ts';

const fontUrl = new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url);

function permutations(values: readonly number[]): readonly (readonly number[])[] {
  if (values.length === 0) return [[]];
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((suffix) => [
      value,
      ...suffix,
    ])
  );
}

test('prepared handles expose no mutable bytes and retain their owned snapshot', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const expectedHash = sha256FontBytes(bytes);
  const request = { family: 'DejaVu Sans', weight: 400, style: 'normal' as const };
  const prepared = prepareLayoutFontConfiguration({
    epoch: 1,
    maxFontBytes: 2_000_000,
    sources: [{ request, id: 'opaque', bytes, hash: expectedHash, faceIndex: 0 }],
    defaultFont: { family: request.family, sizeHalfPoints: 22 },
  });
  expect('configuration' in prepared).toBe(false);
  bytes.fill(0);

  const shaping = await createLayoutShaping(prepared);
  // The neutral constructor carries the browser's previously executed low-level defaults into
  // every exporter. The old browser shaping metadata claimed a different pair but was not passed
  // to createShapedMeasurer, so pinning that metadata would silently migrate shipped pagination.
  expect(shaping.environment.fixedPointScale).toBe(1000);
  expect(shaping.environment.roundingMode).toBe('halfToEven');
  expect(shaping.environment.features).toEqual({});
  const resolved = shaping.fonts.resolve(request);
  expect(resolved).not.toBeInstanceOf(FontResolutionError);
  if (resolved instanceof FontResolutionError) throw resolved;
  expect(sha256FontBytes(resolved.bytes)).toBe(expectedHash);

  const fallback = createFixedMeasurer();
  const resolveFont = () => resolved;
  const neutralMeasurer = createLayoutShapedMeasurer(shaping, { resolveFont, fallback });
  // This is the exact option shape used by the shipped browser before the neutral adapter existed:
  // fixed-point scale, rounding, script, normalization, and features all came from low-level
  // createShapedMeasurer defaults. Keep the two paths equal so a future refactor cannot revive the
  // previously ignored metadata as a pagination change.
  const shippedBrowserMeasurer = createShapedMeasurer({
    shaper: shaping.shaper,
    resolveFont,
    fallback,
    shapingLibrary: shaping.environment.shapingLibrary,
    unicodeDataVersion: shaping.environment.unicodeDataVersion,
    language: shaping.environment.language,
  });
  for (const text of ['office', 'A rounded browser measurement', 'x y z']) {
    expect(neutralMeasurer.measure(text, DEFAULT_RUN_STYLE)).toBe(
      shippedBrowserMeasurer.measure(text, DEFAULT_RUN_STYLE)
    );
  }
  expect(neutralMeasurer.lineMetrics(DEFAULT_RUN_STYLE)).toEqual(
    shippedBrowserMeasurer.lineMetrics(DEFAULT_RUN_STYLE)
  );
  const independentlyOwned = await createLayoutShaping(prepared);
  expect(independentlyOwned.shaper).not.toBe(shaping.shaper);
  disposeLayoutShaping(shaping);
  disposeLayoutShaping(independentlyOwned);
});

test('shares font admission and HarfBuzz initialization across repeated concurrent exporters', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const counters = { copies: 0, hashes: 0, admissions: 0 };
  const instrumentation = {
    onFontByteCopy: () => (counters.copies += 1),
    onFontHash: () => (counters.hashes += 1),
    onFontAdmission: () => (counters.admissions += 1),
  };
  const prepared = prepareLayoutFontConfiguration(
    {
      epoch: 1,
      maxFontBytes: 2_000_000,
      sources: [
        {
          request: { family: 'DejaVu Sans', weight: 400, style: 'normal' as const },
          id: `shared-dejavu-${crypto.randomUUID()}`,
          bytes,
          hash: sha256FontBytes(bytes),
          faceIndex: 0,
        },
      ],
      defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 22 },
    },
    instrumentation
  );

  const [first, second, third] = await Promise.all([
    acquireSharedExportShaping(prepared, instrumentation),
    acquireSharedExportShaping(prepared, instrumentation),
    acquireSharedExportShaping(prepared, instrumentation),
  ]);

  expect(second).toBe(first);
  expect(third).toBe(first);
  expect(first.createMeasurer()).not.toBe(first.createMeasurer());
  expect(first.producer).toContain(first.extensionFingerprint);
  expect(first.producer).toMatch(/shaping:sha256:[0-9a-f]{64}/);
  expect(first.producer).toContain('fallback:fixed:char-width=6:line-height=14');
  expect(first.producer).toContain('producer:1');
  expect(counters.copies).toBe(1);
  expect(counters.hashes).toBe(1);
  // Byte-identical fonts may already be admitted by another exporter in this process.
  // Concurrent acquisition must perform at most one admission, and reuse adds none.
  expect(counters.admissions).toBeLessThanOrEqual(1);
  const admissions = counters.admissions;
  expect(await acquireSharedExportShaping(prepared, instrumentation)).toBe(first);
  expect(counters.admissions).toBe(admissions);
});

test('uses one aggregate-bounded shaper across process-wide exporter substrates', async () => {
  const [first, second, third] = await Promise.all([
    acquireProcessWideExportShaper(),
    acquireProcessWideExportShaper(),
    acquireProcessWideExportShaper(),
  ]);
  expect(second).toBe(first);
  expect(third).toBe(first);
});

test('binds browser and shared exporters to one fingerprinted execution policy', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const request = { family: 'Policy Parity DejaVu', weight: 400, style: 'normal' as const };
  const prepared = prepareLayoutFontConfiguration({
    epoch: 1,
    maxFontBytes: 2_000_000,
    sources: [
      {
        request,
        id: 'policy-parity-dejavu',
        bytes,
        hash: sha256FontBytes(bytes),
        faceIndex: 0,
      },
    ],
    defaultFont: { family: request.family, sizeHalfPoints: 22 },
  });
  const browser = await createLayoutShaping(prepared);
  const shared = await acquireSharedExportShaping(prepared);

  // The two production composition roots execute the same policy and publish one cache identity.
  expect(shared.producer).toContain(browser.operation.shapingHash);
  expect(shared.extensionFingerprint).toBe(browser.operation.extensionFingerprint);

  const cacheOnlyVariant = Object.freeze({
    ...LAYOUT_HARFBUZZ_SHAPER_POLICY,
    maxCachedShapes: 1,
    maxCachedFontBytes: 1,
  }) satisfies LayoutHarfBuzzShaperPolicy;
  const refusalVariant = Object.freeze({
    ...LAYOUT_HARFBUZZ_SHAPER_POLICY,
    maxShapedRunBytes: 1,
  }) satisfies LayoutHarfBuzzShaperPolicy;
  expect(layoutShaperExecutionPolicyFingerprint(cacheOnlyVariant)).toBe(
    layoutShaperExecutionPolicyFingerprint(LAYOUT_HARFBUZZ_SHAPER_POLICY)
  );
  expect(layoutShaperExecutionPolicyFingerprint(refusalVariant)).not.toBe(
    layoutShaperExecutionPolicyFingerprint(LAYOUT_HARFBUZZ_SHAPER_POLICY)
  );

  const cacheOnly = await createLayoutShapingWithTextShaper(
    prepared,
    createHarfBuzzTextShaper(cacheOnlyVariant),
    cacheOnlyVariant
  );
  const refused = await createLayoutShapingWithTextShaper(
    prepared,
    createHarfBuzzTextShaper(refusalVariant),
    refusalVariant
  );
  expect(cacheOnly.operation.shapingHash).toBe(browser.operation.shapingHash);
  expect(refused.operation.shapingHash).not.toBe(browser.operation.shapingHash);

  const resolved = refused.fonts.resolve(request);
  if (resolved instanceof FontResolutionError) throw resolved;
  const fallback = createFixedMeasurer();
  const refusedMeasurer = createLayoutShapedMeasurer(refused, {
    resolveFont: () => resolved,
    fallback,
  });
  const browserMeasurer = createLayoutShapedMeasurer(browser, {
    resolveFont: () => resolved,
    fallback,
  });
  const text = 'Policy refusal';
  expect(refusedMeasurer.measure(text, DEFAULT_RUN_STYLE)).toBe(
    fallback.measure(text, DEFAULT_RUN_STYLE)
  );
  expect(browserMeasurer.measure(text, DEFAULT_RUN_STYLE)).not.toBe(
    fallback.measure(text, DEFAULT_RUN_STYLE)
  );

  disposeLayoutShaping(browser);
  disposeLayoutShaping(cacheOnly);
  disposeLayoutShaping(refused);
});

test('shares byte-identical shaping content across more epochs than the process slot ceiling', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const hash = sha256FontBytes(bytes);
  const request = { family: 'DejaVu Epoch Stable', weight: 400, style: 'normal' as const };
  let admissions = 0;
  const prepare = (epoch: number) =>
    prepareLayoutFontConfiguration({
      epoch,
      maxFontBytes: 2_000_000,
      sources: [{ request, id: 'epoch-stable-dejavu', bytes, hash, faceIndex: 0 }],
      defaultFont: { family: request.family, sizeHalfPoints: 22 },
    });
  const firstPrepared = prepare(1);
  const firstShared = await acquireSharedExportShaping(firstPrepared, {
    onFontAdmission: () => (admissions += 1),
  });
  const producerFingerprints = new Set([firstShared.extensionFingerprint]);

  for (let epoch = 2; epoch <= 40; epoch += 1) {
    const prepared = prepare(epoch);
    const shared = await acquireSharedExportShaping(prepared, {
      onFontAdmission: () => (admissions += 1),
    });
    expect(prepared.fingerprint).not.toBe(firstPrepared.fingerprint);
    expect(shared.extensionFingerprint).toBe(prepared.fingerprint);
    producerFingerprints.add(shared.extensionFingerprint);
  }

  expect(producerFingerprints.size).toBe(40);
  expect(admissions).toBe(1);
});

test('shares post-admission content across more byte ceilings than the process slot ceiling', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const hash = sha256FontBytes(bytes);
  const request = { family: 'Ceiling Stable DejaVu', weight: 400, style: 'normal' as const };
  let admissions = 0;
  const prepare = (maxFontBytes: number) =>
    prepareLayoutFontConfiguration({
      epoch: 1,
      maxFontBytes,
      sources: [{ request, id: 'ceiling-stable-dejavu', bytes, hash, faceIndex: 0 }],
      defaultFont: { family: request.family, sizeHalfPoints: 22 },
    });
  const firstPrepared = prepare(bytes.byteLength);
  const firstShared = await acquireSharedExportShaping(firstPrepared, {
    onFontAdmission: () => (admissions += 1),
  });
  const producerFingerprints = new Set([firstShared.extensionFingerprint]);

  // Every ceiling has already admitted the exact same source bytes. None can change the native
  // shaping substrate, and more than the process slot count must therefore remain one admission.
  for (let offset = 1; offset < 40; offset += 1) {
    const prepared = prepare(bytes.byteLength + offset);
    const shared = await acquireSharedExportShaping(prepared, {
      onFontAdmission: () => (admissions += 1),
    });
    expect(prepared.fingerprint).not.toBe(firstPrepared.fingerprint);
    expect(shared.extensionFingerprint).toBe(prepared.fingerprint);
    producerFingerprints.add(shared.extensionFingerprint);
  }

  expect(producerFingerprints.size).toBe(40);
  expect(admissions).toBe(1);
  expect(() => prepare(bytes.byteLength - 1)).toThrow('per-font byte ceiling');
});

test('shares one substrate across more default sizes than the process slot ceiling', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const hash = sha256FontBytes(bytes);
  const request = { family: 'Size Stable DejaVu', weight: 400, style: 'normal' as const };
  let admissions = 0;
  const firstPrepared = prepareLayoutFontConfiguration({
    epoch: 1,
    maxFontBytes: 2_000_000,
    sources: [{ request, id: 'size-stable-dejavu', bytes, hash, faceIndex: 0 }],
    defaultFont: { family: request.family, sizeHalfPoints: 10 },
  });
  const producerFingerprints = new Set<string>();

  for (let sizeHalfPoints = 10; sizeHalfPoints < 50; sizeHalfPoints += 1) {
    const prepared =
      sizeHalfPoints === 10
        ? firstPrepared
        : prepareLayoutFontConfiguration({
            epoch: 1,
            maxFontBytes: 2_000_000,
            sources: [{ request, id: 'size-stable-dejavu', bytes, hash, faceIndex: 0 }],
            defaultFont: { family: request.family, sizeHalfPoints },
          });
    const shared = await acquireSharedExportShaping(prepared, {
      onFontAdmission: () => (admissions += 1),
    });
    expect(shared.extensionFingerprint).toBe(prepared.fingerprint);
    producerFingerprints.add(shared.extensionFingerprint);
  }

  expect(producerFingerprints.size).toBe(40);
  expect(admissions).toBe(1);
});

test('shares one substrate across geometry-irrelevant usable source ids', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const hash = sha256FontBytes(bytes);
  const request = { family: 'ID Stable DejaVu', weight: 400, style: 'normal' as const };
  let admissions = 0;
  const producerFingerprints = new Set<string>();

  for (let index = 0; index < 40; index += 1) {
    const prepared = prepareLayoutFontConfiguration({
      epoch: 1,
      maxFontBytes: 2_000_000,
      sources: [{ request, id: `id-stable-${index}`, bytes, hash, faceIndex: 0 }],
      defaultFont: { family: request.family, sizeHalfPoints: 22 },
    });
    const shared = await acquireSharedExportShaping(prepared, {
      onFontAdmission: () => (admissions += 1),
    });
    expect(shared.extensionFingerprint).toBe(prepared.fingerprint);
    producerFingerprints.add(shared.extensionFingerprint);
  }

  expect(producerFingerprints.size).toBe(40);
  expect(admissions).toBe(1);
  expect(() =>
    prepareLayoutFontConfiguration({
      epoch: 1,
      maxFontBytes: 2_000_000,
      sources: [{ request, id: '', bytes, hash, faceIndex: 0 }],
      defaultFont: { family: request.family, sizeHalfPoints: 22 },
    })
  ).toThrow('id must not be empty');
});

test('shares forbidden refusal semantics without reading irrelevant source metadata', async () => {
  const request = { family: 'Forbidden Stable DejaVu', weight: 400, style: 'normal' as const };
  const producerFingerprints = new Set<string>();
  let admissions = 0;

  for (let index = 0; index < 40; index += 1) {
    const prepared = prepareLayoutFontConfiguration({
      epoch: 1,
      maxFontBytes: 1,
      sources: [
        {
          request,
          id: `forbidden-id-${index}`,
          bytes: new Uint8Array(0),
          hash: `forbidden-hash-${index}`,
          faceIndex: index,
          availability: 'forbidden',
        },
      ],
      defaultFont: { family: request.family, sizeHalfPoints: 22 },
    });
    const shared = await acquireSharedExportShaping(prepared, {
      onFontAdmission: () => (admissions += 1),
    });
    producerFingerprints.add(shared.extensionFingerprint);
  }

  expect(producerFingerprints.size).toBe(40);
  expect(admissions).toBe(0);
});

test('shares safe source and substitution permutations without masking authored identity', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const hash = sha256FontBytes(bytes);
  const requests = Array.from({ length: 5 }, (_, index) => ({
    family: `Permutation DejaVu ${index}`,
    weight: 400,
    style: 'normal' as const,
  }));
  const sources = requests.map((request, index) => ({
    request,
    id: `permutation-dejavu-${index}`,
    bytes,
    hash,
    faceIndex: 0,
  }));
  const substitutions = requests.map((to, index) => ({
    from: { family: `Permutation Alias ${index}`, weight: 400, style: 'normal' as const },
    to,
  }));
  let admissions = 0;
  const producerFingerprints = new Set<string>();

  for (const order of permutations([0, 1, 2, 3, 4]).slice(0, 40)) {
    const prepared = prepareLayoutFontConfiguration({
      epoch: 1,
      maxFontBytes: 2_000_000,
      sources: order.map((index) => sources[index]!),
      substitutions: order.map((index) => substitutions[index]!),
      defaultFont: { family: requests[0]!.family, sizeHalfPoints: 22 },
    });
    const shared = await acquireSharedExportShaping(prepared, {
      onFontAdmission: () => (admissions += 1),
    });
    expect(shared.extensionFingerprint).toBe(prepared.fingerprint);
    producerFingerprints.add(shared.extensionFingerprint);
  }

  expect(producerFingerprints.size).toBe(40);
  expect(admissions).toBe(5);
});

test('duplicate resolution keys degrade first-wins instead of failing the snapshot', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const hash = sha256FontBytes(bytes);
  const request = { family: 'Duplicate Key DejaVu', weight: 400, style: 'normal' as const };
  const source = { request, id: 'duplicate-key-a', bytes, hash, faceIndex: 0 };
  // Case-variant families fold to one key by contract; a throw here would degrade the whole
  // document to fixed metrics, so the snapshot keeps the first definition and skips the rest.
  const duplicateSource = prepareLayoutFontConfiguration({
    epoch: 1,
    maxFontBytes: 2_000_000,
    sources: [
      source,
      { ...source, id: 'duplicate-key-b', request: { ...request, family: 'DUPLICATE KEY DEJAVU' } },
    ],
    defaultFont: { family: request.family, sizeHalfPoints: 22 },
  });
  const sharedSource = await acquireSharedExportShaping(duplicateSource);
  expect(sharedSource.extensionFingerprint).toBe(duplicateSource.fingerprint);

  const duplicateFrom = {
    family: 'Duplicate Substitution Alias',
    weight: 400,
    style: 'normal' as const,
  };
  const duplicateSubstitution = prepareLayoutFontConfiguration({
    epoch: 1,
    maxFontBytes: 2_000_000,
    sources: [source],
    substitutions: [
      { from: duplicateFrom, to: request },
      { from: duplicateFrom, to: request, lineMetrics: { heightEm: 1, baselineEm: 0.8 } },
    ],
    defaultFont: { family: request.family, sizeHalfPoints: 22 },
  });
  const sharedSubstitution = await acquireSharedExportShaping(duplicateSubstitution);
  expect(sharedSubstitution.extensionFingerprint).toBe(duplicateSubstitution.fingerprint);
});

test('keeps genuinely distinct shared shaping content separate', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const hash = sha256FontBytes(bytes);
  const requests = ['Distinct Default A', 'Distinct Default B'].map((family) => ({
    family,
    weight: 400,
    style: 'normal' as const,
  }));
  const sources = requests.map((request, index) => ({
    request,
    id: `distinct-default-${index}`,
    bytes,
    hash,
    faceIndex: 0,
  }));
  let admissions = 0;
  const acquire = async (defaultFamily: string) =>
    acquireSharedExportShaping(
      prepareLayoutFontConfiguration({
        epoch: 1,
        maxFontBytes: 2_000_000,
        sources,
        defaultFont: { family: defaultFamily, sizeHalfPoints: 22 },
      }),
      { onFontAdmission: () => (admissions += 1) }
    );

  const first = await acquire(requests[0]!.family);
  const second = await acquire(requests[1]!.family);

  expect(second.producer).not.toBe(first.producer);
  expect(admissions).toBe(4);
});

test('rejects forged prepared handles before they can author cache identity', async () => {
  const forged = Object.freeze({
    fingerprint: `font-config:forged:${crypto.randomUUID()}`,
  });
  await expect(
    acquireSharedExportShaping(forged as ReturnType<typeof prepareLayoutFontConfiguration>)
  ).rejects.toThrow('prepared font handle');
});
