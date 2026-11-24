// Environment-neutral construction of the HarfBuzz shaping substrate.

import {
  HARD_MAX_AGGREGATE_FONT_BYTES,
  HARD_MAX_FONT_BYTES,
  HARD_MAX_FONT_SOURCES,
  createFontResourceSnapshot,
  fontByteLength,
  fontRequestKey,
  prepareFontResourceDefinition,
  prepareFontResourceDefinitionAsync,
  preparedFontResourceActualHash,
  sha256FontBytes,
  type FontRequest,
} from './font-resource.ts';
import {
  HARFBUZZ_SHAPING_LIBRARY,
  createHarfBuzzTextShaper,
  harfBuzzFontValidator,
  initializeHarfBuzz,
} from './harfbuzz-shaper.ts';
import { FIXED_MEASURER_FINGERPRINT } from './fixed-measurer.ts';
import {
  layoutShaperExecutionPolicyFingerprint,
  type LayoutHarfBuzzShaperPolicy,
} from './layout-shaper-policy.ts';
import {
  fontShapingPolicy,
  withFontShapingPolicy,
  type FontShapingOptions,
} from './font-shaping-policy.ts';
import type { LayoutShapingOptions } from './shaped-measurer.ts';

// The shipped browser adapter called createShapedMeasurer without explicit OpenType features.
// HarfBuzz still applies its standard defaults; the empty record is the executed API contract.
const FEATURES = Object.freeze({});
const HARD_MAX_FONT_SUBSTITUTIONS = HARD_MAX_FONT_SOURCES;
const UNICODE_DATA_VERSION = '16.0.0';
const NORMALIZATION_POLICY = 'none' as const;
// Released browser geometry contract, now owned by the neutral composition root so browser,
// exporters, and future hosts shape the same document identically. Before this composition moved
// into layout, the browser called createShapedMeasurer without either option and therefore executed
// these defaults. Changing them is a pagination migration even though the old, ignored shaping
// metadata happened to claim a different pair.
const FIXED_POINT_SCALE = 1000;
const ROUNDING_MODE = 'halfToEven' as const;
const LIGATURE_CARET_POLICY = 'cluster-edges-only' as const;
const DEFAULT_SHAPING_SCRIPT = 'Latn';
const EMPTY_FORBIDDEN_FONT_BYTES = new Uint8Array(0);

/** Byte-backed face accepted by neutral shaping. @public */
export interface LayoutFontSource {
  readonly request: FontRequest;
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly hash: string;
  readonly faceIndex: number;
  readonly availability?: 'available' | 'forbidden';
}

/** Explicit face substitution accepted by neutral shaping. @public */
export interface LayoutFontSubstitution {
  readonly from: FontRequest;
  readonly to: FontRequest;
  readonly lineMetrics?: { readonly heightEm: number; readonly baselineEm: number };
}

/** Structural font configuration shared by browser and server hosts. @public */
export interface LayoutFontConfiguration {
  readonly epoch: number;
  readonly maxFontBytes: number;
  readonly sources: readonly LayoutFontSource[];
  readonly substitutions?: readonly LayoutFontSubstitution[];
  readonly defaultFont: { readonly family: string; readonly sizeHalfPoints: number };
  readonly language?: string;
}

type LayoutFontConfigurationRole = 'host-invalidation' | 'preparation-budget' | 'shaping-content';

/**
 * Compile-time evolution gate for both identities: adding configuration must classify whether it
 * affects post-admission native shaping, only invalidates one host operation, or only constrains
 * preparation. The full operation fingerprint includes every role; the shared substrate includes
 * only `shaping-content`; composite fields must further classify their nested keys below.
 * @internal
 */
const LAYOUT_FONT_CONFIGURATION_ROLES = {
  epoch: 'host-invalidation',
  maxFontBytes: 'preparation-budget',
  sources: 'shaping-content',
  substitutions: 'shaping-content',
  defaultFont: 'shaping-content',
  language: 'shaping-content',
} as const satisfies Record<keyof LayoutFontConfiguration, LayoutFontConfigurationRole>;

void LAYOUT_FONT_CONFIGURATION_ROLES;

type LayoutFontConfigurationKeysWithRole<Role extends LayoutFontConfigurationRole> = {
  [
    Key in keyof typeof LAYOUT_FONT_CONFIGURATION_ROLES
  ]: (typeof LAYOUT_FONT_CONFIGURATION_ROLES)[Key] extends Role ? Key : never;
}[keyof typeof LAYOUT_FONT_CONFIGURATION_ROLES];

type SharedShapingConfigurationKey = LayoutFontConfigurationKeysWithRole<'shaping-content'>;

type FontSourceConfigurationRole =
  'shared-shaping-content' | 'operation-context' | 'verified-byte-content';

/** Nested evolution gate for source metadata and its owned-byte representation. @internal */
const FONT_SOURCE_CONFIGURATION_ROLES = {
  request: 'shared-shaping-content',
  id: 'operation-context',
  bytes: 'verified-byte-content',
  hash: 'shared-shaping-content',
  faceIndex: 'shared-shaping-content',
  availability: 'shared-shaping-content',
} as const satisfies Record<keyof LayoutFontSource, FontSourceConfigurationRole>;

void FONT_SOURCE_CONFIGURATION_ROLES;

type DefaultFontConfigurationRole = 'shared-shaping-content' | 'operation-context';

/**
 * Nested evolution gate for the composite default-font field.
 *
 * The family selects the face used by the shared measurer. The default size remains part of the
 * host operation/cache identity, but resolved run styles already carry their own size, so it does
 * not change the process-wide native substrate.
 * @internal
 */
const DEFAULT_FONT_CONFIGURATION_ROLES = {
  family: 'shared-shaping-content',
  sizeHalfPoints: 'operation-context',
} as const satisfies Record<
  keyof LayoutFontConfiguration['defaultFont'],
  DefaultFontConfigurationRole
>;

void DEFAULT_FONT_CONFIGURATION_ROLES;

type DefaultFontKeysWithRole<Role extends DefaultFontConfigurationRole> = {
  [
    Key in keyof typeof DEFAULT_FONT_CONFIGURATION_ROLES
  ]: (typeof DEFAULT_FONT_CONFIGURATION_ROLES)[Key] extends Role ? Key : never;
}[keyof typeof DEFAULT_FONT_CONFIGURATION_ROLES];

/** Optional measurements for resource-budget tests and host diagnostics. @public */
export interface LayoutShapingInstrumentation {
  readonly onFontByteCopy?: () => void;
  readonly onFontHash?: () => void;
  readonly onFontAdmission?: () => void;
}

/** Invalid host configuration caught before any bytes reach HarfBuzz. @public */
export class LayoutShapingConfigurationError extends Error {
  readonly code = 'overLimit' as const;
  constructor(message: string) {
    super(message);
    this.name = 'LayoutShapingConfigurationError';
  }
}

/**
 * Take a bounded, immutable sample of host-owned shaping configuration.
 *
 * Kept outside the async initializer so shared exporter hosts can reserve the exact byte set that
 * HarfBuzz will receive. Count ceilings are checked before visiting any caller-owned entry.
 * @internal
 */
function snapshotLayoutFontConfigurationInternal(
  configuration: LayoutFontConfiguration,
  preservePreparedSources: boolean
): LayoutFontConfiguration {
  const epoch = configuration.epoch;
  const maxFontBytes = configuration.maxFontBytes;
  const sourceInput = configuration.sources;
  const substitutionInput = configuration.substitutions;
  const defaultFontInput = configuration.defaultFont;
  const language = configuration.language;
  if (
    !Number.isSafeInteger(maxFontBytes) ||
    maxFontBytes <= 0 ||
    maxFontBytes > HARD_MAX_FONT_BYTES
  ) {
    throw new LayoutShapingConfigurationError(
      `Font byte ceiling must not exceed the engine hard maximum of ${HARD_MAX_FONT_BYTES}`
    );
  }
  const sourceCount = sourceInput.length;
  const substitutionCount = substitutionInput?.length ?? 0;
  if (sourceCount === 0 || sourceCount > HARD_MAX_FONT_SOURCES) {
    throw new LayoutShapingConfigurationError(
      `Font source count must be between 1 and ${HARD_MAX_FONT_SOURCES}`
    );
  }
  if (substitutionCount > HARD_MAX_FONT_SUBSTITUTIONS) {
    throw new LayoutShapingConfigurationError(
      `Font substitution count must not exceed ${HARD_MAX_FONT_SUBSTITUTIONS}`
    );
  }

  let aggregateBytes = 0;
  const sources: LayoutFontSource[] = [];
  for (let index = 0; index < sourceCount; index += 1) {
    const source = sourceInput[index]!;
    const request = source.request;
    const availability = source.availability;
    const id = source.id;
    const hash = source.hash;
    const faceIndex = source.faceIndex;
    const forbidden = availability === 'forbidden';
    const bytes = forbidden ? EMPTY_FORBIDDEN_FONT_BYTES : source.bytes;
    // Forbidden sources are refusal metadata. Admission never reads their bytes, so neither
    // per-operation nor process-wide usable-font budgets may be consumed by them.
    if (!forbidden) {
      // `id` is diagnostic metadata rather than shaping content, but successful admission still
      // requires it. Validate before shared identity can omit it, so an invalid handle can never
      // piggyback on a valid substrate with the same geometry inputs.
      if (typeof id !== 'string' || id.length === 0) {
        throw new TypeError('Resolved font id must not be empty');
      }
      let byteLength: number;
      try {
        byteLength = fontByteLength(bytes);
      } catch {
        throw new LayoutShapingConfigurationError(`Font source ${id} must provide genuine bytes`);
      }
      if (byteLength > maxFontBytes) {
        throw new LayoutShapingConfigurationError(
          `Font source ${id} exceeds the per-font byte ceiling`
        );
      }
      aggregateBytes += byteLength;
      if (aggregateBytes > HARD_MAX_AGGREGATE_FONT_BYTES) {
        throw new LayoutShapingConfigurationError(
          `Font sources exceed the aggregate byte ceiling of ${HARD_MAX_AGGREGATE_FONT_BYTES}`
        );
      }
    }
    sources.push(
      preservePreparedSources && preparedFontResourceActualHash(source) !== undefined
        ? source
        : Object.freeze({
            request: Object.freeze({
              family: request.family,
              weight: request.weight,
              style: request.style,
            }),
            id,
            bytes,
            hash,
            faceIndex,
            ...(availability ? { availability } : {}),
          })
    );
  }
  let substitutions: LayoutFontSubstitution[] | undefined;
  if (substitutionInput) {
    substitutions = [];
    for (let index = 0; index < substitutionCount; index += 1) {
      const substitution = substitutionInput[index]!;
      const from = substitution.from;
      const to = substitution.to;
      const lineMetrics = substitution.lineMetrics;
      substitutions.push(
        Object.freeze({
          from: Object.freeze({ family: from.family, weight: from.weight, style: from.style }),
          to: Object.freeze({ family: to.family, weight: to.weight, style: to.style }),
          ...(lineMetrics
            ? {
                lineMetrics: Object.freeze({
                  heightEm: lineMetrics.heightEm,
                  baselineEm: lineMetrics.baselineEm,
                }),
              }
            : {}),
        })
      );
    }
  }

  // Required-key record: adding any configuration key forces this immutable operation sample to
  // capture it. Optional public fields may be present with `undefined` inside the private sample;
  // consumers observe the same values through ordinary property reads.
  const snapshot = {
    epoch,
    maxFontBytes,
    sources: Object.freeze(sources),
    substitutions: substitutions ? Object.freeze(substitutions) : undefined,
    defaultFont: Object.freeze({
      family: defaultFontInput.family,
      sizeHalfPoints: defaultFontInput.sizeHalfPoints,
    }),
    language,
  } satisfies Readonly<Record<keyof LayoutFontConfiguration, unknown>>;
  return Object.freeze(snapshot) as LayoutFontConfiguration;
}

export function snapshotLayoutFontConfiguration(
  configuration: LayoutFontConfiguration
): LayoutFontConfiguration {
  return snapshotLayoutFontConfigurationInternal(configuration, false);
}

function orderedByResolutionKey<Value>(
  values: readonly Value[],
  requestOf: (value: Value) => FontRequest
): readonly Value[] {
  const keyed = values.map((value, index) => ({
    value,
    index,
    key: fontRequestKey(requestOf(value)),
  }));
  const seen = new Set<string>();
  for (const entry of keyed) {
    // Duplicate resolution keys fail in authored order during admission. Preserve the complete
    // order so differently failing configurations cannot share one cached rejection.
    if (seen.has(entry.key)) return values;
    seen.add(entry.key);
  }
  return keyed
    .sort((left, right) => {
      if (left.key < right.key) return -1;
      if (left.key > right.key) return 1;
      return left.index - right.index;
    })
    .map(({ value }) => value);
}

function canonicalDefaultFont(
  defaultFont: LayoutFontConfiguration['defaultFont'],
  includeOperationContext: boolean
) {
  const shared = {
    family: defaultFont.family,
  } satisfies Readonly<Record<DefaultFontKeysWithRole<'shared-shaping-content'>, unknown>>;
  const operationContext = {
    sizeHalfPoints: defaultFont.sizeHalfPoints,
  } satisfies Readonly<Record<DefaultFontKeysWithRole<'operation-context'>, unknown>>;
  return {
    ...shared,
    ...(includeOperationContext ? operationContext : {}),
  };
}

function canonicalFontConfiguration(
  configuration: LayoutFontConfiguration,
  includeOperationContext: boolean
) {
  const request = (value: FontRequest) =>
    ({
      family: value.family,
      weight: value.weight,
      style: value.style,
    }) satisfies Readonly<Record<keyof FontRequest, unknown>>;
  const sources = includeOperationContext
    ? configuration.sources
    : orderedByResolutionKey(configuration.sources, (source) => source.request);
  const substitutions = configuration.substitutions ?? [];
  const orderedSubstitutions = includeOperationContext
    ? substitutions
    : orderedByResolutionKey(substitutions, (substitution) => substitution.from);
  const fields = {
    sources: sources.map((source) => {
      const availability = source.availability ?? 'available';
      const resolution = {
        request: request(source.request),
        availability,
      };
      // A forbidden definition resolves solely by request to the `forbidden` refusal. Its id,
      // face index, declared hash, and caller bytes are deliberately never inspected. The full
      // operation identity retains sampled diagnostics; the shared substrate does not.
      if (availability === 'forbidden') {
        return {
          ...resolution,
          ...(includeOperationContext
            ? { id: source.id, faceIndex: source.faceIndex, declaredHash: source.hash }
            : {}),
        };
      }
      const actualHash = preparedFontResourceActualHash(source);
      if (actualHash === undefined || actualHash === null) {
        throw new TypeError('Font configuration identity requires prepared source bytes');
      }
      return {
        ...resolution,
        ...(includeOperationContext ? { id: source.id } : {}),
        faceIndex: source.faceIndex,
        declaredHash: source.hash,
        actualHash,
        byteLength: source.bytes.byteLength,
      };
    }),
    substitutions: orderedSubstitutions.map(
      (substitution) =>
        ({
          from: request(substitution.from),
          to: request(substitution.to),
          lineMetrics: substitution.lineMetrics
            ? ({
                heightEm: substitution.lineMetrics.heightEm,
                baselineEm: substitution.lineMetrics.baselineEm,
              } satisfies Readonly<
                Record<keyof NonNullable<LayoutFontSubstitution['lineMetrics']>, unknown>
              >)
            : null,
        }) satisfies Readonly<Record<keyof LayoutFontSubstitution, unknown>>
    ),
    defaultFont: canonicalDefaultFont(configuration.defaultFont, includeOperationContext),
    language: configuration.language || 'en',
  } satisfies Readonly<Record<SharedShapingConfigurationKey, unknown>>;
  const operationContext = {
    epoch: configuration.epoch,
    maxFontBytes: configuration.maxFontBytes,
  } satisfies Readonly<
    Record<Exclude<keyof LayoutFontConfiguration, SharedShapingConfigurationKey>, unknown>
  >;
  return {
    version: 1,
    ...(includeOperationContext ? operationContext : {}),
    ...fields,
  };
}

const PREPARED_LAYOUT_FONT_CONFIGURATION_BRAND: unique symbol = Symbol(
  'prepared-layout-font-configuration'
);

/** Opaque owned configuration shared by cache identity and font admission. @public */
export interface PreparedLayoutFontConfiguration {
  readonly [PREPARED_LAYOUT_FONT_CONFIGURATION_BRAND]: true;
  /** Stable identity of the exact owned bytes and every layout-affecting font option. */
  readonly fingerprint: string;
}

interface PreparedLayoutFontConfigurationState {
  readonly configuration: LayoutFontConfiguration;
  /**
   * Immutable post-admission shaping content.
   *
   * Excludes the host-authored epoch and the byte ceiling: preparation has already proved every
   * source fits that ceiling, so neither can change the native substrate this handle will build.
   */
  readonly sharedShapingFingerprint: string;
}

const preparedLayoutFontConfigurations = new WeakMap<
  PreparedLayoutFontConfiguration,
  PreparedLayoutFontConfigurationState
>();

/** Whether a value was minted by {@link prepareLayoutFontConfiguration}. @internal */
export function isPreparedLayoutFontConfiguration(
  value: LayoutFontConfiguration | PreparedLayoutFontConfiguration
): value is PreparedLayoutFontConfiguration {
  return preparedLayoutFontConfigurations.has(value as PreparedLayoutFontConfiguration);
}

/** Retrieve private owned inputs from an opaque prepared handle. @internal */
export function configurationOfPreparedLayoutFonts(
  prepared: PreparedLayoutFontConfiguration
): LayoutFontConfiguration {
  const state = preparedLayoutFontConfigurations.get(prepared);
  if (!state) throw new TypeError('Invalid prepared layout font configuration');
  return state.configuration;
}

/** Immutable shaping-content identity for process-wide substrate sharing. @internal */
export function sharedShapingFingerprintOfPreparedLayoutFonts(
  prepared: PreparedLayoutFontConfiguration
): string {
  const state = preparedLayoutFontConfigurations.get(prepared);
  if (!state) throw new TypeError('Invalid prepared layout font configuration');
  return state.sharedShapingFingerprint;
}

/** Copy and hash each usable face once for shared cache identity and admission. @public */
export function prepareLayoutFontConfiguration(
  configuration: LayoutFontConfiguration,
  instrumentation?: LayoutShapingInstrumentation
): PreparedLayoutFontConfiguration {
  return prepareLayoutFontConfigurationInternal(configuration, instrumentation, false);
}

/** Prepare an internal composition whose sources are already owned and hashed. @internal */
export function prepareOwnedLayoutFontConfiguration(
  configuration: LayoutFontConfiguration,
  instrumentation?: LayoutShapingInstrumentation
): PreparedLayoutFontConfiguration {
  return prepareLayoutFontConfigurationInternal(configuration, instrumentation, true);
}

function prepareLayoutFontConfigurationInternal(
  configuration: LayoutFontConfiguration,
  instrumentation: LayoutShapingInstrumentation | undefined,
  preservePreparedSources: boolean
): PreparedLayoutFontConfiguration {
  const snapshot = snapshotLayoutFontConfigurationInternal(configuration, preservePreparedSources);
  const preparedConfiguration = Object.freeze({
    epoch: snapshot.epoch,
    maxFontBytes: snapshot.maxFontBytes,
    sources: Object.freeze(
      snapshot.sources.map((source) =>
        preservePreparedSources && preparedFontResourceActualHash(source) !== undefined
          ? source
          : prepareFontResourceDefinition(source, {
              onOwnedByteCopy: instrumentation?.onFontByteCopy,
              onHash: instrumentation?.onFontHash,
            })
      )
    ),
    substitutions: snapshot.substitutions,
    defaultFont: snapshot.defaultFont,
    language: snapshot.language,
  } satisfies Readonly<Record<keyof LayoutFontConfiguration, unknown>>) as LayoutFontConfiguration;
  const encoder = new TextEncoder();
  const canonical = canonicalFontConfiguration(preparedConfiguration, true);
  const bytes = encoder.encode(JSON.stringify(canonical));
  const sharedCanonical = canonicalFontConfiguration(preparedConfiguration, false);
  const sharedBytes = encoder.encode(JSON.stringify(sharedCanonical));
  const prepared = Object.freeze({
    [PREPARED_LAYOUT_FONT_CONFIGURATION_BRAND]: true as const,
    fingerprint: `font-config:${sha256FontBytes(bytes)}`,
  });
  preparedLayoutFontConfigurations.set(prepared, {
    configuration: preparedConfiguration,
    sharedShapingFingerprint: `shared-font-config:${sha256FontBytes(sharedBytes)}`,
  });
  return prepared;
}

/** Stable identity for every layout-affecting font configuration input. @public */
export function layoutFontConfigurationFingerprint(configuration: LayoutFontConfiguration): string {
  return prepareLayoutFontConfiguration(configuration).fingerprint;
}

function shapingAlgorithmFingerprint(
  environment: LayoutShapingOptions['environment'],
  shaperPolicy: LayoutHarfBuzzShaperPolicy
): string {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      environment,
      executionPolicy: layoutShaperExecutionPolicyFingerprint(shaperPolicy),
      ligatureCaretPolicy: LIGATURE_CARET_POLICY,
      fallback: FIXED_MEASURER_FINGERPRINT,
    })
  );
  return `shaping:${sha256FontBytes(bytes)}`;
}

/** Keep caller mutation outside the asynchronous hashing boundary. */
async function prepareBrowserLayoutFontConfiguration(
  configuration: LayoutFontConfiguration,
  instrumentation: LayoutShapingInstrumentation | undefined
): Promise<PreparedLayoutFontConfiguration> {
  const snapshot = snapshotLayoutFontConfigurationInternal(configuration, false);
  // Every call copies its bytes before returning a promise. All sources are owned
  // before this function yields, including sources later in the list.
  const sources = await Promise.all(
    snapshot.sources.map((source) =>
      prepareFontResourceDefinitionAsync(source, {
        onOwnedByteCopy: instrumentation?.onFontByteCopy,
        onHash: instrumentation?.onFontHash,
      })
    )
  );
  return prepareOwnedLayoutFontConfiguration({ ...snapshot, sources }, instrumentation);
}

async function createLayoutShapingInternal(
  configuration: LayoutFontConfiguration | PreparedLayoutFontConfiguration,
  instrumentation: LayoutShapingInstrumentation | undefined,
  sharedShaper: LayoutShapingOptions['shaper'] | undefined,
  shaperPolicy: LayoutHarfBuzzShaperPolicy,
  documentLigatures = false
): Promise<LayoutShapingOptions> {
  // Sample every caller-owned value before the asynchronous initialization boundary. A host
  // mutating its configuration while HarfBuzz loads must not create a half-old, half-new
  // operation identity.
  const alreadyPrepared = isPreparedLayoutFontConfiguration(configuration);
  const prepared = alreadyPrepared
    ? configuration
    : await prepareBrowserLayoutFontConfiguration(configuration, instrumentation);
  const snapshot = configurationOfPreparedLayoutFonts(prepared);
  const { epoch, maxFontBytes, sources, substitutions, defaultFont } = snapshot;
  const language = snapshot.language || 'en';
  const extensionFingerprint = prepared.fingerprint;

  const fonts = createFontResourceSnapshot({
    epoch,
    maxFontBytes,
    resources: sources,
    substitutions,
    validateFont: harfBuzzFontValidator,
    instrumentation: {
      onOwnedByteCopy: instrumentation?.onFontByteCopy,
      onHash: instrumentation?.onFontHash,
      onAdmission: instrumentation?.onFontAdmission,
    },
  });
  await initializeHarfBuzz();
  const environment = Object.freeze({
    script: DEFAULT_SHAPING_SCRIPT,
    variationAxes: Object.freeze({}),
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
    unicodeDataVersion: UNICODE_DATA_VERSION,
    normalization: NORMALIZATION_POLICY,
    language,
    features: FEATURES,
    ...(documentLigatures ? { documentLigatures: true } : {}),
    fixedPointScale: FIXED_POINT_SCALE,
    roundingMode: ROUNDING_MODE,
  });
  return Object.freeze({
    fonts,
    shaper: withFontShapingPolicy(
      sharedShaper ?? createHarfBuzzTextShaper(shaperPolicy),
      shaperPolicy,
      sharedShaper === undefined
    ),
    defaultFont,
    environment,
    ligatureCaretPolicy: LIGATURE_CARET_POLICY,
    operation: Object.freeze({
      resourceEpoch: fonts.epoch,
      configEpoch: epoch,
      extensionFingerprint,
      shapingHash: shapingAlgorithmFingerprint(environment, shaperPolicy),
      producerVersion: 1,
    }),
  });
}

/** Build one shaped-layout environment without importing an editor or DOM lane. @public */
export async function createLayoutShaping(
  configuration: LayoutFontConfiguration | PreparedLayoutFontConfiguration,
  instrumentation?: LayoutShapingInstrumentation,
  execution?: FontShapingOptions
): Promise<LayoutShapingOptions> {
  return createLayoutShapingInternal(
    configuration,
    instrumentation,
    undefined,
    fontShapingPolicy(execution)
  );
}

/** Build a layout environment over a caller-owned, already bounded shaper. @internal */
export async function createLayoutShapingWithTextShaper(
  configuration: LayoutFontConfiguration | PreparedLayoutFontConfiguration,
  shaper: LayoutShapingOptions['shaper'],
  shaperPolicy: LayoutHarfBuzzShaperPolicy,
  instrumentation?: LayoutShapingInstrumentation,
  documentLigatures = false
): Promise<LayoutShapingOptions> {
  return createLayoutShapingInternal(
    configuration,
    instrumentation,
    shaper,
    shaperPolicy,
    documentLigatures
  );
}

/** Release native resources held by a shaping environment. @public */
export function disposeLayoutShaping(shaping: LayoutShapingOptions): void {
  const shaper = shaping.shaper as LayoutShapingOptions['shaper'] & { dispose?: () => void };
  shaper.dispose?.();
}
