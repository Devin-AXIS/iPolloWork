import { expect, spyOn, test } from 'bun:test';
import { EditorFontError, type FontConfiguration } from '@docx-editor.dev/core/contracts/editor';
import {
  FontResolutionError,
  HarfBuzzShapingError,
  layoutFontConfigurationFingerprint,
  sha256FontBytes,
} from '@docx-editor.dev/core/layout';
import {
  createLayoutShaping,
  resetFontFailureWarningForTests,
  toEditorFontError,
  warnFontFailureOnce,
} from '../font-configuration.ts';

const fontUrl = new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url);
const boldFontUrl = new URL(
  '../../layout/__tests__/fixtures/fonts/DejaVuSans-Bold.ttf',
  import.meta.url
);

test('adapts the public byte-backed font configuration after async HarfBuzz initialization', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const configuration: FontConfiguration = Object.freeze({
    epoch: 3,
    maxFontBytes: 2_000_000,
    sources: Object.freeze([
      Object.freeze({
        request: Object.freeze({ family: 'DejaVu Sans', weight: 400, style: 'normal' }),
        id: 'dejavu',
        bytes,
        hash: sha256FontBytes(bytes),
        faceIndex: 0,
      }),
    ]),
    defaultFont: Object.freeze({ family: 'DejaVu Sans', sizeHalfPoints: 24 }),
  });

  const shaping = await createLayoutShaping(configuration);

  expect(shaping.fonts.epoch).toBe(3);
  expect(shaping.defaultFont).toEqual(configuration.defaultFont);
  expect(shaping.environment.fixedPointScale).toBe(1000);
  expect(shaping.environment.roundingMode).toBe('halfToEven');
  expect(shaping.environment.features).toEqual({});
  expect(shaping.fonts.resolve(configuration.sources[0]!.request)).not.toBeInstanceOf(Error);
  shaping.shaper.dispose();
});

test('substitution line metrics enter the operation fingerprint', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const source = {
    request: { family: 'DejaVu Sans', weight: 400, style: 'normal' } as const,
    id: 'fingerprint-source',
    bytes,
    hash: sha256FontBytes(bytes),
    faceIndex: 0,
  };
  const create = (heightEm: number) =>
    createLayoutShaping({
      epoch: 8,
      maxFontBytes: 2_000_000,
      sources: [source],
      substitutions: [
        {
          from: { family: 'Original Face', weight: 400, style: 'normal' },
          to: source.request,
          lineMetrics: { heightEm, baselineEm: 0.9 },
        },
      ],
      defaultFont: { family: 'Original Face', sizeHalfPoints: 20 },
    });
  const first = await create(1.1);
  const second = await create(1.2);
  expect(first.operation.extensionFingerprint).not.toBe(second.operation.extensionFingerprint);
  first.shaper.dispose();
  second.shaper.dispose();
});

test('every shaping configuration dimension enters the canonical fingerprint', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const source = {
    request: { family: 'DejaVu Sans', weight: 400, style: 'normal' as const },
    id: 'complete-fingerprint',
    bytes,
    hash: sha256FontBytes(bytes),
    faceIndex: 0,
  };
  const base = {
    epoch: 1,
    maxFontBytes: 2_000_000,
    sources: [source],
    defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 22 },
    language: 'en',
  } as const;
  const fingerprint = layoutFontConfigurationFingerprint(base);
  expect(fingerprint).toMatch(/^font-config:sha256:[0-9a-f]{64}$/);
  const variants = [
    { ...base, epoch: 2 },
    { ...base, defaultFont: { ...base.defaultFont, family: 'Fallback Face' } },
    { ...base, defaultFont: { ...base.defaultFont, sizeHalfPoints: 24 } },
    { ...base, language: 'pl' },
    { ...base, sources: [{ ...source, availability: 'forbidden' as const }] },
  ];
  for (const variant of variants) {
    expect(layoutFontConfigurationFingerprint(variant)).not.toBe(fingerprint);
  }
  expect(
    layoutFontConfigurationFingerprint({
      ...base,
      sources: [
        {
          ...source,
          request: { style: 'normal', weight: 400, family: 'DejaVu Sans' },
        },
      ],
      defaultFont: { sizeHalfPoints: 22, family: 'DejaVu Sans' },
    })
  ).toBe(fingerprint);
  expect(layoutFontConfigurationFingerprint({ ...base, language: '' })).toBe(fingerprint);

  const emptyLanguage = await createLayoutShaping({ ...base, language: '' });
  expect(emptyLanguage.environment.language).toBe('en');
  emptyLanguage.shaper.dispose();
});

test('the canonical fingerprint identifies actual bytes while admission isolates hash refusal', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const forged = bytes.slice();
  forged[forged.length - 1] ^= 1;
  const base = {
    epoch: 1,
    maxFontBytes: 2_000_000,
    sources: [
      {
        request: { family: 'DejaVu Sans', weight: 400, style: 'normal' as const },
        id: 'verified-fingerprint',
        bytes,
        hash: sha256FontBytes(bytes),
        faceIndex: 0,
      },
    ],
    defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 22 },
  } as const;

  const mismatched = {
    ...base,
    sources: [
      { ...base.sources[0], bytes: forged },
      {
        ...base.sources[0],
        request: { ...base.sources[0].request, weight: 700 },
        id: 'still-valid',
      },
    ],
  } as const;
  expect(layoutFontConfigurationFingerprint(base)).toMatch(/^font-config:sha256:[0-9a-f]{64}$/);
  expect(layoutFontConfigurationFingerprint(mismatched)).not.toBe(
    layoutFontConfigurationFingerprint(base)
  );

  const shaping = await createLayoutShaping(mismatched);
  expect(shaping.fonts.resolve(base.sources[0].request)).toMatchObject({ code: 'hashMismatch' });
  expect(shaping.fonts.resolve({ ...base.sources[0].request, weight: 700 })).not.toBeInstanceOf(
    FontResolutionError
  );
  shaping.shaper.dispose();
});

test('forbidden faces are neither copied nor hashed and do not block valid siblings', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const counters = { copies: 0, hashes: 0, admissions: 0 };
  const forbiddenSource = {
    request: { family: 'Forbidden', weight: 400, style: 'normal' as const },
    id: 'forbidden',
    hash: 'placeholder',
    faceIndex: 0,
    availability: 'forbidden' as const,
  } as unknown as FontConfiguration['sources'][number];
  Object.defineProperty(forbiddenSource, 'bytes', {
    get() {
      throw new Error('forbidden bytes must not be read');
    },
  });
  const shaping = await createLayoutShaping(
    {
      epoch: 1,
      maxFontBytes: 2_000_000,
      sources: [
        forbiddenSource,
        {
          request: { family: 'Valid', weight: 400, style: 'normal' },
          id: 'valid',
          bytes,
          hash: sha256FontBytes(bytes),
          faceIndex: 0,
        },
      ],
      defaultFont: { family: 'Valid', sizeHalfPoints: 22 },
    },
    {
      onFontByteCopy: () => (counters.copies += 1),
      onFontHash: () => (counters.hashes += 1),
      onFontAdmission: () => (counters.admissions += 1),
    }
  );

  expect(
    shaping.fonts.resolve({ family: 'Forbidden', weight: 400, style: 'normal' })
  ).toMatchObject({ code: 'forbidden' });
  expect(
    shaping.fonts.resolve({ family: 'Valid', weight: 400, style: 'normal' })
  ).not.toBeInstanceOf(FontResolutionError);
  expect(counters).toEqual({ copies: 1, hashes: 1, admissions: 1 });
  shaping.shaper.dispose();
});

test('two faces sharing a hash still fingerprint apart by request', async () => {
  // The fingerprint keys a layout cache. It used to carry only each source's hash, so the
  // SAME bytes registered under two family names produced one fingerprint — and a document
  // that swapped which name a run used reused a layout measured on the other face. Same
  // bytes on purpose: the hash half cannot tell these apart, only the request half can.
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const hash = sha256FontBytes(bytes);
  const create = (family: string, weight: number, style: 'normal' | 'italic') =>
    createLayoutShaping({
      epoch: 9,
      maxFontBytes: 2_000_000,
      sources: [
        { request: { family, weight, style }, id: `shared-${family}`, bytes, hash, faceIndex: 0 },
      ],
      defaultFont: { family, sizeHalfPoints: 20 },
    });
  const byFamily = [
    await create('Face One', 400, 'normal'),
    await create('Face Two', 400, 'normal'),
  ];
  const byWeight = [
    await create('Face One', 400, 'normal'),
    await create('Face One', 700, 'normal'),
  ];
  const byStyle = [
    await create('Face One', 400, 'normal'),
    await create('Face One', 400, 'italic'),
  ];
  for (const [left, right] of [byFamily, byWeight, byStyle]) {
    expect(left!.operation.extensionFingerprint).not.toBe(right!.operation.extensionFingerprint);
  }
  for (const shaping of [...byFamily, ...byWeight, ...byStyle]) shaping!.shaper.dispose();
});

test('the same request backed by different bytes fingerprints apart', async () => {
  // The request half cannot see this one: same family, weight, style and faceIndex, only
  // the BYTES differ. Swapping which file a family resolves to has to invalidate a layout
  // measured on the previous one.
  const create = async (url: URL) => {
    const bytes = new Uint8Array(await Bun.file(url).arrayBuffer());
    return createLayoutShaping({
      epoch: 11,
      maxFontBytes: 2_000_000,
      sources: [
        {
          request: { family: 'Swapped Face', weight: 400, style: 'normal' as const },
          id: 'swapped',
          bytes,
          hash: sha256FontBytes(bytes),
          faceIndex: 0,
        },
      ],
      defaultFont: { family: 'Swapped Face', sizeHalfPoints: 20 },
    });
  };
  const first = await create(fontUrl);
  const second = await create(boldFontUrl);
  expect(first.operation.extensionFingerprint).not.toBe(second.operation.extensionFingerprint);
  first.shaper.dispose();
  second.shaper.dispose();
});

test('two faces of one collection fingerprint apart by faceIndex', async () => {
  // A TrueType Collection is ONE file: same bytes, same hash, and the face is chosen by
  // index. Without that term in the fingerprint, face 0 and face 1 of the same .ttc are
  // indistinguishable, so a layout measured on one is reused for the other.
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const hash = sha256FontBytes(bytes);
  const create = (faceIndex: number) =>
    createLayoutShaping({
      epoch: 10,
      maxFontBytes: 2_000_000,
      sources: [
        {
          request: { family: 'Collection Face', weight: 400, style: 'normal' as const },
          id: `collection-${faceIndex}`,
          bytes,
          hash,
          faceIndex,
        },
      ],
      defaultFont: { family: 'Collection Face', sizeHalfPoints: 20 },
    });
  const first = await create(0);
  const second = await create(1);
  expect(first.operation.extensionFingerprint).not.toBe(second.operation.extensionFingerprint);
  first.shaper.dispose();
  second.shaper.dispose();
});

test('samples and owns font bytes before asynchronous initialization yields', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const hash = sha256FontBytes(bytes);
  const request = Object.freeze({ family: 'DejaVu Sans', weight: 400, style: 'normal' } as const);
  const pending = createLayoutShaping({
    epoch: 4,
    maxFontBytes: 2_000_000,
    sources: [{ request, id: 'owned-dejavu', bytes, hash, faceIndex: 0 }],
    defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 24 },
  });

  bytes.fill(0);
  const shaping = await pending;
  const resolved = shaping.fonts.resolve(request);

  expect(resolved).not.toBeInstanceOf(Error);
  if (!(resolved instanceof Error)) expect(sha256FontBytes(resolved.bytes)).toBe(hash);
  shaping.shaper.dispose();
});

test('deep-samples font metadata and substitutions before asynchronous initialization yields', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const request = { family: 'DejaVu Sans', weight: 400, style: 'normal' as const };
  const substitution = {
    from: { family: 'Original', weight: 400, style: 'normal' as const },
    to: { ...request },
    lineMetrics: { heightEm: 1.2, baselineEm: 0.9 },
  };
  const configuration = {
    epoch: 12,
    maxFontBytes: 2_000_000,
    sources: [
      {
        request,
        id: 'deep-sample',
        bytes,
        hash: sha256FontBytes(bytes),
        faceIndex: 0,
      },
    ],
    substitutions: [substitution],
    defaultFont: { family: 'Original', sizeHalfPoints: 22 },
  };
  const expectedFingerprint = layoutFontConfigurationFingerprint(configuration);
  const pending = createLayoutShaping(configuration);
  request.family = 'Mutated';
  substitution.from.family = 'Mutated Original';
  substitution.lineMetrics.heightEm = 9;

  const shaping = await pending;
  expect(shaping.operation.extensionFingerprint).toBe(expectedFingerprint);
  shaping.shaper.dispose();
});

test('rejects disabling the per-font hard ceiling before allocation or admission', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  for (const maxFontBytes of [Number.MAX_SAFE_INTEGER, bytes.byteLength - 1]) {
    const counters = { copies: 0, hashes: 0, admissions: 0 };
    await expect(
      createLayoutShaping(
        {
          epoch: 5,
          maxFontBytes,
          sources: [
            {
              request: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
              id: 'oversized-limit',
              bytes,
              hash: sha256FontBytes(bytes),
              faceIndex: 0,
            },
          ],
          defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 24 },
        },
        {
          onFontByteCopy: () => (counters.copies += 1),
          onFontHash: () => (counters.hashes += 1),
          onFontAdmission: () => (counters.admissions += 1),
        }
      )
    ).rejects.toMatchObject<EditorFontError>({ code: 'overLimit' });
    expect(counters).toEqual({ copies: 0, hashes: 0, admissions: 0 });
  }
});

test('rejects source count and aggregate bytes before touching any source', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const source = {
    request: { family: 'DejaVu Sans', weight: 400, style: 'normal' } as const,
    id: 'repeated',
    bytes,
    hash: sha256FontBytes(bytes),
    faceIndex: 0,
  };
  for (const sources of [
    Array.from({ length: 257 }, () => source),
    Array.from({ length: 180 }, () => source),
  ]) {
    const counters = { copies: 0, hashes: 0, admissions: 0 };
    await expect(
      createLayoutShaping(
        {
          epoch: 6,
          maxFontBytes: 2_000_000,
          sources,
          defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 24 },
        },
        {
          onFontByteCopy: () => (counters.copies += 1),
          onFontHash: () => (counters.hashes += 1),
          onFontAdmission: () => (counters.admissions += 1),
        }
      )
    ).rejects.toMatchObject<EditorFontError>({ code: 'overLimit' });
    expect(counters).toEqual({ copies: 0, hashes: 0, admissions: 0 });
  }
});

test('rejects over-limit source and substitution arrays without traversing entries', async () => {
  let sourceReads = 0;
  let substitutionReads = 0;
  const sources = new Array(257);
  const substitutions = new Array(257);
  Object.defineProperty(sources, 0, {
    get() {
      sourceReads += 1;
      throw new Error('source entry must not be visited');
    },
  });
  Object.defineProperty(substitutions, 0, {
    get() {
      substitutionReads += 1;
      throw new Error('substitution entry must not be visited');
    },
  });

  await expect(
    createLayoutShaping({
      epoch: 7,
      maxFontBytes: 2_000_000,
      sources,
      defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 24 },
    })
  ).rejects.toThrow('Font source count');
  await expect(
    createLayoutShaping({
      epoch: 7,
      maxFontBytes: 2_000_000,
      sources: [
        {
          request: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
          id: 'bounded',
          bytes: new Uint8Array(),
          hash: sha256FontBytes(new Uint8Array()),
          faceIndex: 0,
        },
      ],
      substitutions,
      defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 24 },
    })
  ).rejects.toThrow('Font substitution count');
  expect({ sourceReads, substitutionReads }).toEqual({ sourceReads: 0, substitutionReads: 0 });
});

test('samples bounded arrays by index instead of trusting caller-owned map methods', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const sources = [
    {
      request: { family: 'DejaVu Sans', weight: 400, style: 'normal' as const },
      id: 'indexed-source',
      bytes,
      hash: sha256FontBytes(bytes),
      faceIndex: 0,
    },
  ];
  const substitutions = [
    {
      from: { family: 'Document Sans', weight: 400, style: 'normal' as const },
      to: { family: 'DejaVu Sans', weight: 400, style: 'normal' as const },
    },
  ];
  let hostileMapCalls = 0;
  for (const input of [sources, substitutions]) {
    Object.defineProperty(input, 'map', {
      value() {
        hostileMapCalls += 1;
        throw new Error('caller-owned map must not execute');
      },
    });
  }

  const shaping = await createLayoutShaping({
    epoch: 8,
    maxFontBytes: 2_000_000,
    sources,
    substitutions,
    defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 24 },
  });
  expect(hostileMapCalls).toBe(0);
  expect(
    shaping.fonts.resolve({ family: 'Document Sans', weight: 400, style: 'normal' })
  ).not.toBeInstanceOf(FontResolutionError);
  shaping.shaper.dispose();
});

test('copies each valid source exactly once into snapshot ownership', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const counters = { copies: 0, hashes: 0, admissions: 0 };
  const shaping = await createLayoutShaping(
    {
      epoch: 7,
      maxFontBytes: 2_000_000,
      sources: [
        {
          request: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
          id: 'single-copy',
          bytes,
          hash: sha256FontBytes(bytes),
          faceIndex: 0,
        },
      ],
      defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 24 },
    },
    {
      onFontByteCopy: () => (counters.copies += 1),
      onFontHash: () => (counters.hashes += 1),
      onFontAdmission: () => (counters.admissions += 1),
    }
  );

  expect(counters).toEqual({ copies: 1, hashes: 1, admissions: 1 });
  shaping.shaper.dispose();
});

test('a shaper that never loaded keeps its code and its remedy out to the host', () => {
  // `onFontError` is the only surface a host sees. The CODE has to survive so a host can
  // branch on "your bundler is misconfigured" rather than matching English inside
  // `diagnostic`, and the diagnostic has to survive because it is where the remedy is
  // written (#282). `toEditorFontError` is public API, so it stays a pure mapper —
  // the console side of this lives in `reportFontError`, which knows who is listening.
  const failure = new HarfBuzzShapingError('wasmUnavailable', {
    diagnostic: 'serve `@docx-editor.dev/core/harfbuzz.wasm` and call `setHarfBuzzWasmUrl`',
  });

  const surfaced = toEditorFontError(failure);

  expect(surfaced).toBeInstanceOf(EditorFontError);
  expect(surfaced.code).toBe('wasmUnavailable');
  expect(surfaced.diagnostic).toContain('setHarfBuzzWasmUrl');
  expect(surfaced.cause).toBe(failure);
});

test('a stale self-hosted binary reports as the same host-deployment fault', () => {
  // The second step of the documented workflow: copy the wasm, then upgrade the package
  // and forget to re-copy it. Version mismatch is the same class of problem as a missing
  // binary — the shaper is not running — so it must not collapse into the generic code.
  const surfaced = toEditorFontError(
    new HarfBuzzShapingError('shapingLibraryMismatch', {
      diagnostic: 'expected HarfBuzz 14.3.0, loaded 14.2.1. Re-copy …',
    })
  );

  expect(surfaced.code).toBe('wasmUnavailable');
  expect(surfaced.diagnostic).toContain('Re-copy');
});

test('an unsupported Node runtime is NOT labeled wasmUnavailable', () => {
  // A host branching on `wasmUnavailable` shows the serve-the-binary remedy. On a Node
  // that predates `process.getBuiltinModule` no URL helps, so that failure keeps the
  // generic code and carries the upgrade advice in `diagnostic` instead.
  const surfaced = toEditorFontError(
    new HarfBuzzShapingError('unsupportedRuntime', {
      diagnostic: 'upgrade Node; `setHarfBuzzWasmUrl` does not apply here',
    })
  );

  expect(surfaced.code).toBe('initializationFailed');
  expect(surfaced.diagnostic).toContain('upgrade Node');
});

test('shaping failures that are not the shaper keep reporting as initializationFailed', () => {
  // The new branch must not relabel the resource-limit codes, which are document faults
  // and were already mapped this way.
  const surfaced = toEditorFontError(new HarfBuzzShapingError('glyphOverLimit', { limit: 10 }));

  expect(surfaced.code).toBe('initializationFailed');
});

test('the shaper-failure console warning fires once, and only for the whole-document fault', () => {
  // Every other font failure degrades quietly on purpose. This one disables shaping for the
  // entire document, and before #282 was fixed the same misconfiguration failed the BUILD —
  // so a green build with a silent console would be a strictly worse trade.
  resetFontFailureWarningForTests();
  const error = spyOn(console, 'error').mockImplementation(() => {});

  try {
    warnFontFailureOnce({ diagnostic: 'serve the binary' });
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('text shaping is disabled');

    // A document with many unshapeable runs must not turn the console into a log.
    warnFontFailureOnce({ diagnostic: 'serve the binary' });
    expect(error).toHaveBeenCalledTimes(1);
  } finally {
    error.mockRestore();
    resetFontFailureWarningForTests();
  }
});
