// Exporter-neutral font-resolution evidence and session-owned admitted-face snapshots.

import type { DroppedEmbeddedFont } from '../layout/embedded-font-sources.ts';
import {
  ExecutionFontLimitError,
  FontOriginAdmissionError,
  type FontOriginFailure,
} from '../layout/font-resolver.ts';
import {
  FontResolutionError,
  HARD_MAX_FONT_SOURCES,
  trustedFontBytes,
  type FontRequest,
  type FontSubstitution,
  type ResolvedFont,
} from '../layout/font-resource.ts';
import { ExportResourceError } from './export-session.ts';

/** One paintable face in an export font-resolution report. @public */
export interface ExportFontFaceResolution {
  readonly weight: 400 | 700;
  readonly style: 'normal' | 'italic';
  readonly sourceFamily: string;
  readonly via: 'direct' | 'substitution';
  /** Admitted face identity (`hash#faceIndex`); remains after session disposal. */
  readonly identity?: string;
  readonly id?: string;
  readonly hash?: string;
  readonly faceIndex?: number;
  /** Full substitution evidence; `null` when the admitted face answers the request directly. */
  readonly substitution?: FontSubstitution | null;
}

/** Coverage of one family Core layout may request. @public */
export interface ExportFontFamilyResolution {
  readonly family: string;
  readonly coverage: 'complete' | 'partial' | 'none';
  readonly faces: readonly ExportFontFaceResolution[];
}

/** One document-embedded face the export mapper refused before composition. @public */
export interface ExportDroppedEmbeddedFont {
  readonly request: FontRequest;
  readonly partName: string;
  readonly reason: 'overLimit' | 'malformed';
}

/** Exporter-neutral evidence for the font policy behind one layout session. @public */
export interface ExportFontResolutionReport {
  readonly requestedFamilies: readonly string[];
  readonly defaultFamily: string;
  readonly families: readonly ExportFontFamilyResolution[];
  readonly originFailures: readonly FontOriginFailure[];
  /** Bounded drop evidence from the document-embedded font origin; omitted on legacy mocks. */
  readonly droppedEmbeddedFonts?: readonly ExportDroppedEmbeddedFont[];
}

/** Cap on embedded-font drop rows retained in one export resolution report. @internal */
export const MAX_EXPORT_DROPPED_EMBEDDED_FONTS = HARD_MAX_FONT_SOURCES;

/** Byte-free admitted face identity for laid-out text and evidence. @public */
export interface ExportAdmittedFontIdentity {
  readonly id: string;
  readonly identity: string;
  readonly family: string;
  readonly request: FontRequest;
  readonly byteLength: number;
  readonly hash: string;
  readonly faceIndex: number;
  readonly substitution: FontSubstitution | null;
}

/**
 * Session-visible admitted face whose bytes are shared with the session shaper and
 * content-hashed shaping cache. Treat {@link ExportAdmittedFontFace.bytes} as
 * strictly read-only; in-place mutation can corrupt later shaping after cache
 * eviction or before the first shape for that face.
 * @public
 */
export interface ExportAdmittedFontFace extends ExportAdmittedFontIdentity {
  /**
   * Shared font bytes owned by the session shaper and shaping cache. Not a copy.
   * Must be treated as read-only.
   */
  readonly bytes: Uint8Array;
}

/** Session capability that yields admitted face bytes on demand. @public */
export interface ExportAdmittedFontApi {
  /**
   * Exact admitted face bytes and identity used by this session's measurer.
   * Stops after disposal or abort; resolution evidence on `fontResolution` remains.
   */
  admittedFontFace(request: FontRequest): ExportAdmittedFontFace | null;
}

/** Whether a value publishes {@link ExportAdmittedFontApi}. @public */
export function hasExportAdmittedFont<T extends object>(
  value: T
): value is T & ExportAdmittedFontApi {
  return typeof (value as Partial<ExportAdmittedFontApi>).admittedFontFace === 'function';
}

export interface DocumentExportFontResolutionOptions {
  readonly fontPolicy?: 'best-effort' | 'strict';
  readonly onFontResolution?: (report: ExportFontResolutionReport) => void;
}

const REQUIRED_FACE_VARIANTS = Object.freeze([
  { weight: 400 as const, style: 'normal' as const },
  { weight: 700 as const, style: 'normal' as const },
  { weight: 400 as const, style: 'italic' as const },
  { weight: 700 as const, style: 'italic' as const },
]);

function freezeRequest(request: FontRequest): FontRequest {
  return Object.freeze({
    family: request.family,
    weight: request.weight,
    style: request.style,
  });
}

const admittedFontIdentities = new WeakMap<ResolvedFont, ExportAdmittedFontIdentity>();

/** Frozen identity without font bytes. Safe to retain per laid-out span. @internal */
export function describeAdmittedFontIdentity(resolved: ResolvedFont): ExportAdmittedFontIdentity {
  // A resolved font is immutable, so every span painted in it can share one frozen identity.
  let identity = admittedFontIdentities.get(resolved);
  if (!identity)
    admittedFontIdentities.set(resolved, (identity = admittedFontIdentityOf(resolved)));
  return identity;
}

function admittedFontIdentityOf(resolved: ResolvedFont): ExportAdmittedFontIdentity {
  const substitution = resolved.substitution;
  return Object.freeze({
    id: resolved.id,
    identity: resolved.identity,
    family: resolved.family,
    request: freezeRequest(resolved.request),
    byteLength: resolved.byteLength,
    hash: resolved.hash,
    faceIndex: resolved.faceIndex,
    substitution: substitution
      ? Object.freeze({
          requested: freezeRequest(substitution.requested),
          resolved: freezeRequest(substitution.resolved),
          ...(substitution.lineMetrics
            ? { lineMetrics: Object.freeze({ ...substitution.lineMetrics }) }
            : {}),
        })
      : null,
  });
}

/** Admitted face identity plus the session-owned shared byte buffer. @internal */
export function snapshotAdmittedFontFace(resolved: ResolvedFont): ExportAdmittedFontFace {
  return Object.freeze({
    ...describeAdmittedFontIdentity(resolved),
    bytes: trustedFontBytes(resolved),
  });
}

export function lookupAdmittedFontFace(
  resolve: ((request: FontRequest) => ResolvedFont | FontResolutionError) | undefined,
  request: FontRequest
): ExportAdmittedFontFace | null {
  if (!resolve) return null;
  try {
    const answer = resolve(request);
    if (!answer || answer instanceof FontResolutionError) return null;
    return snapshotAdmittedFontFace(answer);
  } catch {
    return null;
  }
}

/**
 * Refuse admitted-face byte access after abort or disposal; resolution evidence stays readable.
 * @internal
 */
export function bindSessionAdmittedFont(options: {
  readonly status: () => 'active' | 'aborted' | 'disposed';
  readonly unavailable: () => ExportResourceError;
  readonly resolve: () =>
    ((request: FontRequest) => ResolvedFont | FontResolutionError) | undefined;
}): ExportAdmittedFontApi['admittedFontFace'] {
  return (request: FontRequest): ExportAdmittedFontFace | null => {
    if (options.status() !== 'active') throw options.unavailable();
    return lookupAdmittedFontFace(options.resolve(), request);
  };
}

export function snapshotDroppedEmbeddedFonts(
  drops: readonly DroppedEmbeddedFont[]
): readonly ExportDroppedEmbeddedFont[] {
  return Object.freeze(
    drops.slice(0, MAX_EXPORT_DROPPED_EMBEDDED_FONTS).map((drop) =>
      Object.freeze({
        request: freezeRequest(drop.request),
        partName: drop.partName,
        reason: drop.reason,
      })
    )
  );
}

export function fontResolutionReport(
  requestedFamilies: readonly string[],
  defaultFamily: string,
  originFailures: readonly FontOriginFailure[],
  resolve?: (request: FontRequest) => ResolvedFont | FontResolutionError,
  droppedEmbeddedFonts: readonly DroppedEmbeddedFont[] = [],
  /** Families drawn in a stand-in reached through a host substitute; see `hostChainedDocumentFallbacks`. */
  standInFamilies: ReadonlySet<string> = new Set()
): ExportFontResolutionReport {
  const familyNames = new Map<string, string>();
  for (const family of [...requestedFamilies, defaultFamily]) {
    const fold = family.toLowerCase();
    if (!familyNames.has(fold)) familyNames.set(fold, family);
  }
  const families = [...familyNames.values()].map((family): ExportFontFamilyResolution => {
    const faces: ExportFontFaceResolution[] = [];
    for (const variant of REQUIRED_FACE_VARIANTS) {
      const answer = resolve?.({ family, ...variant });
      if (!answer || answer instanceof FontResolutionError) continue;
      faces.push(
        Object.freeze({
          ...variant,
          sourceFamily: answer.family,
          via: answer.substitution ? ('substitution' as const) : ('direct' as const),
          identity: answer.identity,
          id: answer.id,
          hash: answer.hash,
          faceIndex: answer.faceIndex,
          substitution: answer.substitution,
        })
      );
    }
    // A stand-in shows in `faces` as evidence, but does not cover the family.
    const covering = standInFamilies.has(family.trim().toLowerCase())
      ? faces.filter((face) => face.via === 'direct').length
      : faces.length;
    return Object.freeze({
      family,
      coverage: covering === 4 ? 'complete' : covering > 0 ? 'partial' : 'none',
      faces: Object.freeze(faces),
    });
  });
  return Object.freeze({
    requestedFamilies: Object.freeze([...requestedFamilies]),
    defaultFamily,
    families: Object.freeze(families),
    originFailures: Object.freeze([...originFailures]),
    droppedEmbeddedFonts: snapshotDroppedEmbeddedFonts(droppedEmbeddedFonts),
  });
}

export function publishFontResolutionReport(
  report: ExportFontResolutionReport,
  options: DocumentExportFontResolutionOptions
): void {
  if (options.onFontResolution) {
    try {
      const result = (options.onFontResolution as (value: ExportFontResolutionReport) => unknown)(
        report
      );
      void Promise.resolve(result).catch((cause: unknown) => {
        console.warn('[fonts] font-resolution diagnostics callback failed', cause);
      });
    } catch (cause) {
      console.warn('[fonts] font-resolution diagnostics callback failed', cause);
    }
    return;
  }
  for (const failure of report.originFailures) {
    console.warn('[fonts] a document export font origin failed and was skipped', failure);
  }
  for (const drop of report.droppedEmbeddedFonts ?? []) {
    console.warn('[fonts] a document embedded font face was dropped during export', drop);
  }
}

export function enforceStrictFontPolicy(
  report: ExportFontResolutionReport,
  options: DocumentExportFontResolutionOptions,
  glyphFallbacks: readonly FontRequest[] = []
): void {
  const normalize = (family: string): string => family.trim().toLowerCase();
  const required = new Set([...report.requestedFamilies, report.defaultFamily].map(normalize));
  const optional = new Set(glyphFallbacks.map((face) => normalize(face.family)));
  const isRequiredFailure = (cause: unknown): boolean => {
    if (!(cause instanceof ExecutionFontLimitError)) return true;
    const family = normalize(cause.request.family);
    return required.has(family) || !optional.has(family);
  };
  const hasRequiredFailure = report.originFailures.some(({ cause }) =>
    cause instanceof FontOriginAdmissionError
      ? cause.causes.length === 0 || cause.causes.some(isRequiredFailure)
      : isRequiredFailure(cause)
  );
  if (
    options.fontPolicy !== 'strict' ||
    (!hasRequiredFailure && report.families.every((family) => family.coverage === 'complete'))
  ) {
    return;
  }
  const incomplete = report.families
    .filter((family) => family.coverage !== 'complete')
    .map((family) => family.family)
    .join(', ');
  throw new ExportResourceError(
    'layoutFailed',
    `Strict font policy refused export${incomplete ? `; incomplete families: ${incomplete}` : '; a font origin failed'}`
  );
}
