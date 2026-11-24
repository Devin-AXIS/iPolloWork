import { withExportGlyphFallbacks } from './export-glyph-fallback.ts';
// Process-wide shaped measurement shared by Node exporters.

import {
  createFixedMeasurer,
  createHarfBuzzTextShaper,
  createLayoutShapedMeasurer,
  HARD_MAX_AGGREGATE_FONT_BYTES,
  HARD_MAX_FONT_BYTES,
  initializeHarfBuzz,
  type PreparedLayoutFontConfiguration,
  type LayoutShapingInstrumentation,
  type LayoutShapingOptions,
  type TextMeasurer,
  type TextShaper,
} from '../layout/index.ts';
import { FIXED_MEASURER_FINGERPRINT } from '../layout/fixed-measurer.ts';
import {
  FontResolutionError,
  type FontRequest,
  type ResolvedFont,
} from '../layout/font-resource.ts';
import {
  EXPORT_HARFBUZZ_SHAPER_POLICY,
  layoutShaperExecutionPolicyFingerprint,
} from '../layout/layout-shaper-policy.ts';
import {
  fontShapingPolicy,
  withFontShapingPolicy,
  type FontShapingOptions,
} from '../layout/font-shaping-policy.ts';
import {
  configurationOfPreparedLayoutFonts,
  createLayoutShapingWithTextShaper,
  isPreparedLayoutFontConfiguration,
  sharedShapingFingerprintOfPreparedLayoutFonts,
} from '../layout/layout-shaping.ts';
import { bindExportLaidOutText, type ExportLaidOutTextApi } from './export-laid-out-text.ts';
import {
  createShapingFontResolutionCache,
  resolveShapingFontFromStyle,
} from './export-shaping-font-resolution.ts';

/** Immutable handle over process-wide measurement state reusable by every exporter. @public */
export interface SharedExportShaping {
  /** Create one document-scoped measurement cache over the process-wide immutable substrate. */
  createMeasurer(): TextMeasurer;
  /** Stable cache/diagnostic producer identity for export layout sessions. */
  readonly producer: string;
  /** Font and substitution identity shared with browser layout caches. */
  readonly extensionFingerprint: string;
}

/** Core-produced shared shaping with exact laid-out text. @public */
export type SharedExportShapingCapabilities = SharedExportShaping & ExportLaidOutTextApi;

/** Session-owned shaping plus the exact admitted face lookup used by its measurer. @internal */
export interface SessionExportShaping extends SharedExportShaping, ExportLaidOutTextApi {
  resolveFont(request: FontRequest): ResolvedFont | FontResolutionError;
}

interface SharedExportShapingSubstrate {
  createMeasurer(): TextMeasurer;
  readonly shapeLaidOutText: ExportLaidOutTextApi['shapeLaidOutText'];
  readonly shapingHash: string;
  readonly producerVersion: number;
}

const sharedShaping = new Map<string, Promise<SharedExportShapingSubstrate>>();
const sharedShapingViews = new WeakMap<
  PreparedLayoutFontConfiguration,
  Map<string, Promise<SharedExportShapingCapabilities>>
>();
let retainedOrReservedFontBytes = 0;
let processWideExportShaper: Promise<TextShaper> | undefined;
let defaultExportShaperView: Promise<TextShaper> | undefined;

/** Process-wide ceiling preventing host-derived cache keys from retaining unbounded font sets. @public */
export const MAX_SHARED_EXPORT_SHAPING_CONFIGURATIONS = 32;

/** Aggregate process-wide font-byte budget across every successful shared configuration. */
export const MAX_SHARED_EXPORT_SHAPING_FONT_BYTES = HARD_MAX_AGGREGATE_FONT_BYTES;

/**
 * One process-wide HarfBuzz shaper makes its face/outline/shape LRUs aggregate exporter bounds.
 * A rejected initialization is retryable, matching failed substrate initialization below.
 * @internal
 */
function acquireNativeProcessWideExportShaper(): Promise<TextShaper> {
  if (processWideExportShaper) return processWideExportShaper;
  const pending = (async (): Promise<TextShaper> => {
    await initializeHarfBuzz();
    return createHarfBuzzTextShaper({
      ...EXPORT_HARFBUZZ_SHAPER_POLICY,
      maxFontBytes: HARD_MAX_FONT_BYTES,
    });
  })();
  processWideExportShaper = pending;
  void pending.catch(() => {
    if (processWideExportShaper === pending) processWideExportShaper = undefined;
  });
  return pending;
}

/** Default-bound view of the one process-wide native shaper. @internal */
export function acquireProcessWideExportShaper(): Promise<TextShaper> {
  if (defaultExportShaperView) return defaultExportShaperView;
  const pending = acquireNativeProcessWideExportShaper().then((shaper) => {
    const bounded = withFontShapingPolicy(shaper, EXPORT_HARFBUZZ_SHAPER_POLICY);
    return Object.freeze({ shape: bounded.shape });
  });
  defaultExportShaperView = pending;
  void pending.catch(() => {
    if (defaultExportShaperView === pending) defaultExportShaperView = undefined;
  });
  return pending;
}

function shapedMeasurer(shaping: LayoutShapingOptions): TextMeasurer {
  const resolved = createShapingFontResolutionCache();
  return createLayoutShapedMeasurer(shaping, {
    resolveFont(style) {
      return resolveShapingFontFromStyle(shaping, resolved, style);
    },
    fallback: createFixedMeasurer(),
  });
}

/**
 * Build an exporter shaping view without retaining its document-specific configuration in the
 * process-wide configuration cache. The HarfBuzz engine remains shared and independently bounded;
 * the returned closures own only this configuration's admitted font snapshot and become
 * collectible with the export session that holds them.
 *
 * @internal
 */
export async function createSessionExportShaping(
  prepared: PreparedLayoutFontConfiguration,
  instrumentation?: LayoutShapingInstrumentation,
  glyphFallbacks: readonly FontRequest[] = [],
  documentLigatures = false,
  execution?: FontShapingOptions
): Promise<SessionExportShaping> {
  if (!isPreparedLayoutFontConfiguration(prepared)) {
    throw new TypeError('Session exporter shaping requires a prepared font handle');
  }
  const policy = fontShapingPolicy(execution, EXPORT_HARFBUZZ_SHAPER_POLICY);
  const shaper = await acquireNativeProcessWideExportShaper();
  const shaping = withExportGlyphFallbacks(
    await createLayoutShapingWithTextShaper(
      prepared,
      shaper,
      policy,
      instrumentation,
      documentLigatures
    ),
    glyphFallbacks
  );
  return Object.freeze({
    createMeasurer: () => shapedMeasurer(shaping),
    resolveFont: (request: FontRequest) => shaping.fonts.resolve(request),
    shapeLaidOutText: bindExportLaidOutText(shaping),
    producer: [
      'node-export-session',
      JSON.stringify(glyphFallbacks),
      prepared.fingerprint,
      shaping.operation.shapingHash,
      `producer:${shaping.operation.producerVersion}`,
      `fallback:${FIXED_MEASURER_FINGERPRINT}`,
    ].join('|'),
    extensionFingerprint: prepared.fingerprint,
  });
}

/**
 * Acquire one process-wide shaped measurement substrate for a host configuration.
 *
 * Failed initialization is evicted so a corrected transient resource can retry. Successful
 * native shaping and admitted font bytes intentionally live for the process lifetime; export
 * sessions retain only their own layout caches and remain independently disposable.
 * @public
 */
export function acquireSharedExportShaping(
  prepared: PreparedLayoutFontConfiguration,
  instrumentation?: LayoutShapingInstrumentation,
  execution?: FontShapingOptions
): Promise<SharedExportShapingCapabilities> {
  if (!isPreparedLayoutFontConfiguration(prepared)) {
    return Promise.reject(new TypeError('Shared exporter shaping requires a prepared font handle'));
  }
  const policy = fontShapingPolicy(execution, EXPORT_HARFBUZZ_SHAPER_POLICY);
  const policyKey = layoutShaperExecutionPolicyFingerprint(policy);
  let views = sharedShapingViews.get(prepared);
  const existingView = views?.get(policyKey);
  if (existingView) return existingView;
  // A host epoch invalidates that host's operation caches, but cannot change an already owned
  // immutable byte/configuration snapshot. Key the process-wide native substrate by the latter:
  // otherwise byte-identical reloads consume one permanent slot and byte budget per epoch.
  const cacheKey = `${sharedShapingFingerprintOfPreparedLayoutFonts(prepared)}|${policyKey}`;
  let substrate = sharedShaping.get(cacheKey);
  if (!substrate) {
    if (sharedShaping.size >= MAX_SHARED_EXPORT_SHAPING_CONFIGURATIONS) {
      return Promise.reject(
        new RangeError(
          `Shared exporter shaping is limited to ${MAX_SHARED_EXPORT_SHAPING_CONFIGURATIONS} process-wide configurations`
        )
      );
    }
    substrate = (async (): Promise<SharedExportShapingSubstrate> => {
      const configuration = configurationOfPreparedLayoutFonts(prepared);
      const byteSize = configuration.sources.reduce(
        (total, source) =>
          total + (source.availability === 'forbidden' ? 0 : source.bytes.byteLength),
        0
      );
      if (retainedOrReservedFontBytes + byteSize > MAX_SHARED_EXPORT_SHAPING_FONT_BYTES) {
        throw new RangeError(
          `Shared exporter shaping font bytes are limited to ${MAX_SHARED_EXPORT_SHAPING_FONT_BYTES} process-wide`
        );
      }
      // Reserve synchronously before native initialization yields, so concurrent distinct keys
      // cannot each observe the same remaining budget. Successful substrates retain the bytes.
      retainedOrReservedFontBytes += byteSize;
      let shaping: LayoutShapingOptions;
      try {
        const shaper = await acquireNativeProcessWideExportShaper();
        shaping = await createLayoutShapingWithTextShaper(
          prepared,
          shaper,
          policy,
          instrumentation
        );
      } catch (error) {
        retainedOrReservedFontBytes -= byteSize;
        throw error;
      }
      return Object.freeze({
        createMeasurer: () => shapedMeasurer(shaping),
        shapeLaidOutText: bindExportLaidOutText(shaping),
        shapingHash: shaping.operation.shapingHash,
        producerVersion: shaping.operation.producerVersion,
      });
    })();
    sharedShaping.set(cacheKey, substrate);
    void substrate.catch(() => {
      if (sharedShaping.get(cacheKey) === substrate) sharedShaping.delete(cacheKey);
    });
  }

  // Keep the host operation fingerprint (including epoch) on the cache-facing view. Only the
  // hidden immutable native substrate is deduplicated by content.
  const extensionFingerprint = prepared.fingerprint;
  const pending = substrate.then((shared): SharedExportShapingCapabilities =>
    Object.freeze({
      createMeasurer: shared.createMeasurer,
      shapeLaidOutText: shared.shapeLaidOutText,
      producer: [
        'node-export',
        extensionFingerprint,
        shared.shapingHash,
        `producer:${shared.producerVersion}`,
        `fallback:${FIXED_MEASURER_FINGERPRINT}`,
      ].join('|'),
      extensionFingerprint,
    })
  );
  if (!views) sharedShapingViews.set(prepared, (views = new Map()));
  views.set(policyKey, pending);
  void pending.catch(() => {
    if (views?.get(policyKey) === pending) views.delete(policyKey);
  });
  return pending;
}
