// The implementation lives in the store lane (`store/package/sha256.ts`), where both
// byte-fingerprinting trust boundaries sit; this import + re-export keeps the layout entry
// point and every shaping consumer unchanged. layout → store is a lane-legal edge.
import { sha256FontBytes, sha256OwnedFontBytesAsync } from '../store/package/sha256.ts';
export { sha256FontBytes };

/**
 * A face, as something asks for it: family plus the two axes this engine admits.
 *
 * Only static weights and slants. Variable-font axes are deliberately outside this vocabulary —
 * the shaper refuses variation axes, and a variable file admitted here would render bold at
 * regular weight.
 */
export interface FontRequest {
  readonly family: string;
  readonly weight: number;
  readonly style: 'normal' | 'italic';
}

/**
 * A request that was answered by a DIFFERENT face than the one asked for.
 *
 * Recorded rather than silently applied, because a substitution changes measurement: it is part
 * of the shaping fingerprint, so a cached run shaped against a substitute is never reused for the
 * real face.
 */
export interface FontSubstitution {
  readonly requested: FontRequest;
  readonly resolved: FontRequest;
  readonly lineMetrics?: {
    readonly heightEm: number;
    readonly baselineEm: number;
  };
}

const RESOLVED_FONT_BRAND: unique symbol = Symbol('validated-resolved-font');
const MAX_SUBSTITUTION_LINE_HEIGHT_EM = 4;

/**
 * A face that passed admission: the bytes are present, within limits, hash-verified, and parse as
 * a font.
 *
 * Branded, so a `ResolvedFont` cannot be constructed by an object literal. Holding one is proof
 * the checks ran — which is what lets shaping skip re-validating on every call.
 */
export interface ResolvedFont {
  readonly [RESOLVED_FONT_BRAND]: true;
  readonly id: string;
  readonly identity: string;
  readonly request: FontRequest;
  readonly family: string;
  /** Owned byte length, available without creating a defensive byte copy. */
  readonly byteLength: number;
  readonly bytes: Uint8Array;
  readonly hash: string;
  readonly faceIndex: number;
  readonly substitution: FontSubstitution | null;
}

/**
 * Largest single face this engine will ever admit, whatever a caller configures.
 *
 * A CEILING, not a default: a host may set a smaller `maxFontBytes`, but nothing can raise it
 * past this. Font bytes come from files, and an unbounded face is a memory-exhaustion vector.
 */
export const HARD_MAX_FONT_BYTES = 64 * 1024 * 1024;

/** Most faces one snapshot may hold, whatever a caller configures. */
export const HARD_MAX_FONT_SOURCES = 256;

/** Most bytes all admitted faces may total, whatever a caller configures. */
export const HARD_MAX_AGGREGATE_FONT_BYTES = 128 * 1024 * 1024;

/**
 * Why a face was not admitted.
 *
 * `forbidden` and `hashMismatch` are adversarial signals rather than ordinary failures: the first
 * is a face the host declared off-limits, the second is bytes that are not what their source
 * claimed.
 */
export type FontResolutionErrorCode =
  'missing' | 'forbidden' | 'overLimit' | 'malformed' | 'hashMismatch';

/**
 * A face that could not be admitted, carrying whatever evidence the refusal produced.
 *
 * RETURNED rather than thrown by `FontResourceSnapshot.resolve`, because a missing face is an
 * ordinary condition — layout falls back and carries on. It extends `Error` so a caller that
 * would rather throw can.
 */
export class FontResolutionError extends Error {
  readonly name = 'FontResolutionError';
  readonly request: FontRequest;
  readonly code: FontResolutionErrorCode;
  readonly limit?: number;
  readonly actual?: number;
  readonly diagnostic?: string;
  readonly expectedHash?: string;
  readonly actualHash?: string;

  constructor(
    code: FontResolutionErrorCode,
    request: FontRequest,
    details: {
      readonly limit?: number;
      readonly actual?: number;
      readonly diagnostic?: string;
      readonly expectedHash?: string;
      readonly actualHash?: string;
    } = {}
  ) {
    // The family and part come from the document: they travel in `request`, never in the
    // message, because hosts send error messages to their logs and error trackers.
    super(`Font resolution failed (${code})`);
    this.code = code;
    this.request = freezeRequest(request);
    this.limit = details.limit;
    this.actual = details.actual;
    this.diagnostic = details.diagnostic;
    this.expectedHash = details.expectedHash;
    this.actualHash = details.actualHash;
    // Resolution caches keep this refusal for the life of a measurer. Until its stack is read,
    // the engine holds the captured call frames, and with them every closure on the stack of
    // the first lookup (a whole layout pass). Formatting it once keeps a string instead.
    void this.stack;
  }
}

/**
 * One face offered to a snapshot, before admission.
 *
 * `hash` is checked against the bytes, so a source cannot claim a face it did not supply. Setting
 * `availability` to `forbidden` declares a face that exists but must not be used, which resolves
 * as a typed refusal rather than as "missing".
 */
export interface FontResourceDefinition {
  readonly request: FontRequest;
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly hash: string;
  readonly faceIndex: number;
  readonly availability?: 'available' | 'forbidden';
}

/**
 * A host-declared redirect: requests for `from` resolve to `to`.
 *
 * How a metric-compatible substitute is wired in — a document naming Calibri resolves to Carlito
 * without the document being rewritten.
 */
export interface DeclaredFontSubstitution {
  readonly from: FontRequest;
  readonly to: FontRequest;
  readonly lineMetrics?: {
    readonly heightEm: number;
    readonly baselineEm: number;
  };
}

/** Whether bytes parse as a usable font, with a diagnostic when they do not. */
export type FontValidationResult =
  { readonly valid: true } | { readonly valid: false; readonly diagnostic: string };

/**
 * The injected check that bytes really are a font.
 *
 * Injected because it is the shaper that knows — HarfBuzz can open a face and read its tables,
 * and this layer must not duplicate that judgement. Every byte reaching it is file input.
 */
export type FontByteValidator = (bytes: Uint8Array, faceIndex: number) => FontValidationResult;

/**
 * An immutable set of admitted faces, and the only way to reach one.
 *
 * `epoch` identifies the snapshot: fonts change by REPLACING it, never by mutation, so a layout
 * pass holds one snapshot for its whole run and cannot observe a face appearing or vanishing
 * midway.
 */
export interface FontResourceSnapshot {
  readonly epoch: number;
  /** The admitted face, or a typed refusal. Never throws. */
  resolve(request: FontRequest): ResolvedFont | FontResolutionError;
}

/**
 * How a snapshot is built: which faces, under what limits, validated how.
 *
 * `maxFontBytes` is clamped to {@link HARD_MAX_FONT_BYTES} — a caller may tighten the budget but
 * never widen it past the engine's own ceiling.
 */
export interface FontResourceSnapshotOptions {
  readonly epoch: number;
  readonly maxFontBytes: number;
  readonly resources: readonly FontResourceDefinition[];
  readonly substitutions?: readonly DeclaredFontSubstitution[];
  readonly validateFont: FontByteValidator;
  readonly instrumentation?: FontResourceInstrumentation;
}

/**
 * Optional counters for the operations font admission is expected to do RARELY.
 *
 * Exists so tests can assert the absence of work: hashing and byte-copying a 64 MB face on every
 * resolve would not be visible in output, only in a stalled document, so the checks assert these
 * fire once rather than per call.
 */
export interface FontResourceInstrumentation {
  readonly onOwnedByteCopy?: () => void;
  readonly onHash?: () => void;
  readonly onTableScan?: () => void;
  readonly onAdmission?: () => void;
}

type StoredResource =
  | { readonly kind: 'resolved'; readonly font: ResolvedFont }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'overLimit'; readonly actual: number }
  | { readonly kind: 'malformed'; readonly diagnostic: string }
  | { readonly kind: 'hashMismatch'; readonly expectedHash: string; readonly actualHash: string };

const assertRequest = (request: FontRequest): void => {
  if (request.family.trim().length === 0) throw new TypeError('Font family must not be empty');
  if (!Number.isInteger(request.weight) || request.weight < 1 || request.weight > 1000) {
    throw new RangeError('Font weight must be an integer from 1 through 1000');
  }
  if (request.style !== 'normal' && request.style !== 'italic') {
    throw new TypeError('Font style must be normal or italic');
  }
};

const freezeRequest = (request: FontRequest): FontRequest => {
  assertRequest(request);
  return Object.freeze({ family: request.family, weight: request.weight, style: request.style });
};

const sampleRequest = (request: FontRequest): FontRequest => {
  const sampled = { family: request.family, weight: request.weight, style: request.style };
  return freezeRequest(sampled);
};

const PREPARED_FONT_RESOURCE_BRAND: unique symbol = Symbol('prepared-font-resource');
const preparedFontResourceHashes = new WeakMap<object, string | null>();
const EMPTY_FORBIDDEN_RESOURCE_BYTES = new Uint8Array(0);
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayLength = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, 'length')!.get!;
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  'byteLength'
)!.get!;

/** Authenticate a byte-sized typed array without invoking caller-owned accessors. @internal */
export function fontByteLength(bytes: Uint8Array): number {
  if (!ArrayBuffer.isView(bytes)) throw new TypeError('Font bytes must be a genuine byte array');
  let length: number;
  let byteLength: number;
  try {
    length = typedArrayLength.call(bytes) as number;
    byteLength = typedArrayByteLength.call(bytes) as number;
  } catch {
    throw new TypeError('Font bytes must be a genuine byte array');
  }
  if (length !== byteLength) throw new TypeError('Font bytes must use one-byte elements');
  return byteLength;
}

function copyFontBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(fontByteLength(bytes));
  Uint8Array.prototype.set.call(copy, bytes);
  return copy;
}

/** One source whose caller-owned bytes were copied and hashed exactly once. @internal */
export interface PreparedFontResourceDefinition extends FontResourceDefinition {
  readonly [PREPARED_FONT_RESOURCE_BRAND]: true;
  /** Null for forbidden sources, whose bytes admission deliberately never touches. */
  readonly actualHash: string | null;
}

/** Own and fingerprint one source before cache identity and admission share it. @internal */
export function prepareFontResourceDefinition(
  definition: FontResourceDefinition,
  instrumentation?: Pick<FontResourceInstrumentation, 'onOwnedByteCopy' | 'onHash'>
): PreparedFontResourceDefinition {
  const request = freezeRequest(definition.request);
  if (definition.availability === 'forbidden') {
    const prepared = Object.freeze({
      ...definition,
      request,
      actualHash: null,
      [PREPARED_FONT_RESOURCE_BRAND]: true as const,
    });
    preparedFontResourceHashes.set(prepared, null);
    return prepared;
  }
  const bytes = copyFontBytes(definition.bytes);
  instrumentation?.onOwnedByteCopy?.();
  instrumentation?.onHash?.();
  const actualHash = sha256FontBytes(bytes);
  const prepared = Object.freeze({
    ...definition,
    request,
    bytes,
    actualHash,
    [PREPARED_FONT_RESOURCE_BRAND]: true as const,
  });
  preparedFontResourceHashes.set(prepared, actualHash);
  return prepared;
}

/** Prepared digest, or undefined when the source has not crossed preparation. @internal */
export function preparedFontResourceActualHash(
  definition: FontResourceDefinition
): string | null | undefined {
  return preparedFontResourceHashes.get(definition);
}

/** Copy before yielding, then verify the owned bytes with the browser's crypto provider. @internal */
export async function prepareFontResourceDefinitionAsync(
  definition: FontResourceDefinition,
  instrumentation?: Pick<FontResourceInstrumentation, 'onOwnedByteCopy' | 'onHash'>
): Promise<PreparedFontResourceDefinition> {
  if (definition.availability === 'forbidden') {
    return prepareFontResourceDefinition(definition, instrumentation);
  }
  const request = freezeRequest(definition.request);
  const bytes = copyFontBytes(definition.bytes);
  const sampled = { ...definition, request, bytes };
  instrumentation?.onOwnedByteCopy?.();
  instrumentation?.onHash?.();
  const actualHash = await sha256OwnedFontBytesAsync(bytes);
  const prepared = Object.freeze({
    ...sampled,
    actualHash,
    [PREPARED_FONT_RESOURCE_BRAND]: true as const,
  });
  preparedFontResourceHashes.set(prepared, actualHash);
  return prepared;
}

const freezeLineMetrics = (
  metrics: NonNullable<DeclaredFontSubstitution['lineMetrics']>
): NonNullable<FontSubstitution['lineMetrics']> => {
  if (
    !Number.isFinite(metrics.heightEm) ||
    !Number.isFinite(metrics.baselineEm) ||
    metrics.heightEm <= 0 ||
    metrics.heightEm > MAX_SUBSTITUTION_LINE_HEIGHT_EM ||
    metrics.baselineEm < 0 ||
    metrics.baselineEm > metrics.heightEm
  ) {
    throw new RangeError('Font substitution line metrics must fit within a bounded em box');
  }
  return Object.freeze({ heightEm: metrics.heightEm, baselineEm: metrics.baselineEm });
};

/**
 * The canonical string identifying one face request.
 *
 * Case- and whitespace-normalized, so `"Times New Roman"` and `"times new roman"` are one key —
 * a document may name a family either way and both must reach the same face.
 */
export const fontRequestKey = (request: FontRequest): string => {
  assertRequest(request);
  return JSON.stringify([request.family.trim().toLowerCase(), request.weight, request.style]);
};

class OwnedResolvedFont implements ResolvedFont {
  readonly [RESOLVED_FONT_BRAND] = true;
  readonly id: string;
  readonly identity: string;
  readonly request: FontRequest;
  readonly family: string;
  readonly byteLength: number;
  readonly hash: string;
  readonly faceIndex: number;
  readonly substitution: FontSubstitution | null;

  constructor(
    definition: Omit<FontResourceDefinition, 'bytes'> & { readonly byteLength: number },
    substitution?: FontSubstitution
  ) {
    if (definition.id.length === 0) throw new TypeError('Resolved font id must not be empty');
    if (!Number.isInteger(definition.faceIndex) || definition.faceIndex < 0) {
      throw new RangeError('Font face index must be a non-negative integer');
    }
    this.id = definition.id;
    this.request = freezeRequest(definition.request);
    this.family = this.request.family;
    this.hash = definition.hash;
    this.faceIndex = definition.faceIndex;
    this.identity = `${this.hash}#${this.faceIndex}`;
    this.byteLength = definition.byteLength;
    this.substitution = null;
    if (substitution) {
      this.substitution = Object.freeze({
        requested: freezeRequest(substitution.requested),
        resolved: freezeRequest(substitution.resolved),
        ...(substitution.lineMetrics
          ? { lineMetrics: freezeLineMetrics(substitution.lineMetrics) }
          : {}),
      });
    }
    Object.freeze(this);
  }

  get bytes(): Uint8Array {
    return trustedFontBytes(this).slice();
  }
}

const validatedFonts = new WeakSet<object>();
const ownedFontBytes = new WeakMap<object, Uint8Array>();
const ownedFontTableTags = new WeakMap<object, ReadonlySet<string>>();

const createOwnedResolvedFont = (
  definition: Omit<FontResourceDefinition, 'bytes'> & { readonly byteLength: number },
  bytes: Uint8Array,
  tableTags: ReadonlySet<string>,
  substitution?: FontSubstitution
): ResolvedFont => {
  const font = new OwnedResolvedFont(definition, substitution);
  ownedFontBytes.set(font, bytes);
  ownedFontTableTags.set(font, tableTags);
  validatedFonts.add(font);
  return font;
};

/** Module-internal capability for trusted shaping and font-installation code. */
export const trustedFontBytes = (font: ResolvedFont): Uint8Array => {
  assertValidatedResolvedFont(font);
  const bytes = ownedFontBytes.get(font);
  if (!bytes) throw new TypeError('Resolved font has no owned byte capability');
  return bytes;
};

/** Module-internal admission metadata; table directories are never rescanned while shaping. */
export const trustedFontTableTags = (font: ResolvedFont): ReadonlySet<string> => {
  assertValidatedResolvedFont(font);
  const tags = ownedFontTableTags.get(font);
  if (!tags) throw new TypeError('Resolved font has no admitted table metadata');
  return tags;
};

/** Internal package assertion used by shaping contracts; not re-exported from the package entry. */
export const assertValidatedResolvedFont: (font: unknown) => asserts font is ResolvedFont = (
  font
) => {
  if (typeof font !== 'object' || font === null || !validatedFonts.has(font)) {
    throw new TypeError('Shaping requires a validated resolved font');
  }
};

const readUint16 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset]! << 8) | bytes[offset + 1]!;
const readUint32 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset]! * 0x1000000 +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!) >>>
  0;

const validateSfntAt = (bytes: Uint8Array, base: number): FontValidationResult => {
  if (base > bytes.byteLength - 12) return { valid: false, diagnostic: 'truncated sfnt header' };
  const signature = String.fromCharCode(
    bytes[base]!,
    bytes[base + 1]!,
    bytes[base + 2]!,
    bytes[base + 3]!
  );
  const isTrueType =
    bytes[base] === 0 && bytes[base + 1] === 1 && bytes[base + 2] === 0 && bytes[base + 3] === 0;
  if (!isTrueType && signature !== 'OTTO' && signature !== 'true' && signature !== 'typ1') {
    return { valid: false, diagnostic: 'unsupported sfnt signature' };
  }
  const tableCount = readUint16(bytes, base + 4);
  const directoryEnd = base + 12 + tableCount * 16;
  if (!Number.isSafeInteger(directoryEnd) || directoryEnd > bytes.byteLength) {
    return { valid: false, diagnostic: 'truncated sfnt table directory' };
  }
  for (let index = 0; index < tableCount; index += 1) {
    const record = base + 12 + index * 16;
    const offset = readUint32(bytes, record + 8);
    const length = readUint32(bytes, record + 12);
    if (offset > bytes.byteLength || length > bytes.byteLength - offset) {
      return { valid: false, diagnostic: 'sfnt table range exceeds font bytes' };
    }
  }
  return { valid: true };
};

const sfntTableTags = (bytes: Uint8Array, faceIndex: number): ReadonlySet<string> => {
  const signature = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  const base = signature === 'ttcf' ? readUint32(bytes, 12 + faceIndex * 4) : 0;
  const tableCount = readUint16(bytes, base + 4);
  const tags = new Set<string>();
  for (let index = 0; index < tableCount; index += 1) {
    const record = base + 12 + index * 16;
    tags.add(
      String.fromCharCode(
        bytes[record]!,
        bytes[record + 1]!,
        bytes[record + 2]!,
        bytes[record + 3]!
      )
    );
  }
  return Object.freeze(tags);
};

/** Bounded minimum sfnt/TTC check; Task 4 supplies full parser-backed validation. */
export const boundedStructuralFontValidator: FontByteValidator = (bytes, faceIndex) => {
  if (!Number.isSafeInteger(faceIndex) || faceIndex < 0) {
    return { valid: false, diagnostic: 'invalid font face index' };
  }
  if (bytes.byteLength < 12) return { valid: false, diagnostic: 'truncated sfnt header' };
  const signature = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (signature !== 'ttcf') {
    if (faceIndex !== 0) {
      return { valid: false, diagnostic: 'standalone sfnt has only face index zero' };
    }
    return validateSfntAt(bytes, 0);
  }
  const version = readUint32(bytes, 4);
  if (version !== 0x00010000 && version !== 0x00020000) {
    return { valid: false, diagnostic: 'unsupported TTC version' };
  }
  const faceCount = readUint32(bytes, 8);
  const offsetsEnd = 12 + faceCount * 4;
  if (
    faceCount === 0 ||
    !Number.isSafeInteger(offsetsEnd) ||
    offsetsEnd > bytes.byteLength ||
    faceIndex >= faceCount
  ) {
    return { valid: false, diagnostic: 'invalid TTC face directory' };
  }
  const faceOffset = readUint32(bytes, 12 + faceIndex * 4);
  if (faceOffset < offsetsEnd) return { valid: false, diagnostic: 'invalid TTC face offset' };
  return validateSfntAt(bytes, faceOffset);
};

const storeResource = (
  definition: FontResourceDefinition,
  maxFontBytes: number,
  validateFont: FontByteValidator,
  instrumentation?: FontResourceInstrumentation
): StoredResource => {
  if (definition.availability === 'forbidden') return { kind: 'forbidden' };
  const byteLength = fontByteLength(definition.bytes);
  if (byteLength > maxFontBytes) {
    return { kind: 'overLimit', actual: byteLength };
  }
  const preparedHash = preparedFontResourceActualHash(definition);
  const ownedBytes =
    preparedHash === undefined ? copyFontBytes(definition.bytes) : definition.bytes;
  if (preparedHash === undefined) instrumentation?.onOwnedByteCopy?.();
  if (preparedHash === undefined) instrumentation?.onHash?.();
  const actualHash = preparedHash ?? sha256FontBytes(ownedBytes);
  if (definition.hash !== actualHash) {
    return { kind: 'hashMismatch', expectedHash: definition.hash, actualHash };
  }
  const structural = boundedStructuralFontValidator(ownedBytes, definition.faceIndex);
  if (!structural.valid) return { kind: 'malformed', diagnostic: structural.diagnostic };
  instrumentation?.onTableScan?.();
  const tableTags = sfntTableTags(ownedBytes, definition.faceIndex);
  try {
    const validation = validateFont(ownedBytes, definition.faceIndex);
    if (!validation.valid) return { kind: 'malformed', diagnostic: validation.diagnostic };
  } catch (error) {
    return {
      kind: 'malformed',
      diagnostic: error instanceof Error ? error.message : 'font validator threw',
    };
  }
  const stored = {
    kind: 'resolved',
    font: createOwnedResolvedFont(
      { ...definition, byteLength: ownedBytes.byteLength },
      ownedBytes,
      tableTags
    ),
  } as const;
  instrumentation?.onAdmission?.();
  return stored;
};

/**
 * Admit a set of faces and return the immutable snapshot layout resolves against.
 *
 * Admission is the trust boundary for font bytes: counts and sizes are checked against the hard
 * ceilings, each face's hash is re-derived and compared, and the bytes are handed to the injected
 * validator. A face failing any of these is recorded as a typed refusal rather than dropped, so
 * `resolve` can explain itself instead of answering "missing".
 */
export const createFontResourceSnapshot = (
  options: FontResourceSnapshotOptions
): FontResourceSnapshot => {
  const epoch = options.epoch;
  const maxFontBytes = options.maxFontBytes;
  const validateFont = options.validateFont;
  const instrumentation = options.instrumentation;
  const resourceInput = options.resources;
  const substitutionInput = options.substitutions;
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    throw new RangeError('Font resource epoch must be a non-negative safe integer');
  }
  if (
    !Number.isSafeInteger(maxFontBytes) ||
    maxFontBytes <= 0 ||
    maxFontBytes > HARD_MAX_FONT_BYTES
  ) {
    throw new RangeError(
      `Font byte ceiling must be a positive safe integer no greater than ${HARD_MAX_FONT_BYTES}`
    );
  }
  if (typeof validateFont !== 'function') {
    throw new TypeError('Font snapshot requires a validator');
  }
  const resourceCount = resourceInput.length;
  const substitutionCount = substitutionInput?.length ?? 0;
  if (resourceCount > HARD_MAX_FONT_SOURCES) {
    throw new RangeError(`Font source count must not exceed ${HARD_MAX_FONT_SOURCES}`);
  }
  if (substitutionCount > HARD_MAX_FONT_SOURCES) {
    throw new RangeError(`Font substitution count must not exceed ${HARD_MAX_FONT_SOURCES}`);
  }

  let aggregateFontBytes = 0;
  const sampledResources: FontResourceDefinition[] = [];
  for (let index = 0; index < resourceCount; index += 1) {
    const definition = resourceInput[index]!;
    if (preparedFontResourceActualHash(definition) !== undefined) {
      const byteLength =
        definition.availability === 'forbidden' ? 0 : fontByteLength(definition.bytes);
      if (byteLength > HARD_MAX_AGGREGATE_FONT_BYTES - aggregateFontBytes) {
        throw new RangeError(
          `Aggregate font bytes must not exceed ${HARD_MAX_AGGREGATE_FONT_BYTES}`
        );
      }
      aggregateFontBytes += byteLength;
      sampledResources.push(definition);
      continue;
    }

    const request = sampleRequest(definition.request);
    const id = definition.id;
    const hash = definition.hash;
    const faceIndex = definition.faceIndex;
    const availability = definition.availability;
    const bytes = availability === 'forbidden' ? EMPTY_FORBIDDEN_RESOURCE_BYTES : definition.bytes;
    const byteLength = availability === 'forbidden' ? 0 : fontByteLength(bytes);
    if (byteLength > HARD_MAX_AGGREGATE_FONT_BYTES - aggregateFontBytes) {
      throw new RangeError(`Aggregate font bytes must not exceed ${HARD_MAX_AGGREGATE_FONT_BYTES}`);
    }
    aggregateFontBytes += byteLength;
    sampledResources.push(
      Object.freeze({
        request,
        id,
        bytes,
        hash,
        faceIndex,
        ...(availability ? { availability } : {}),
      })
    );
  }

  const sampledSubstitutions: DeclaredFontSubstitution[] = [];
  if (substitutionInput) {
    for (let index = 0; index < substitutionCount; index += 1) {
      const substitution = substitutionInput[index]!;
      const from = sampleRequest(substitution.from);
      const to = sampleRequest(substitution.to);
      const lineMetrics = substitution.lineMetrics;
      sampledSubstitutions.push(
        Object.freeze({
          from,
          to,
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

  // The key is case- and whitespace-folded, so 'Arial' and 'ARIAL' collide by contract.
  // First-wins, matching the composed origin dedupe: a per-face skip degrades one duplicate,
  // where a throw would degrade the whole document to fixed-metric measurement.
  const resources = new Map<string, StoredResource>();
  for (const definition of sampledResources) {
    const key = fontRequestKey(definition.request);
    if (resources.has(key)) continue;
    resources.set(key, storeResource(definition, maxFontBytes, validateFont, instrumentation));
  }

  const substitutions = new Map<
    string,
    {
      readonly to: FontRequest;
      readonly lineMetrics?: NonNullable<FontSubstitution['lineMetrics']>;
    }
  >();
  for (const substitution of sampledSubstitutions) {
    const key = fontRequestKey(substitution.from);
    if (substitutions.has(key)) continue;
    substitutions.set(
      key,
      Object.freeze({
        to: freezeRequest(substitution.to),
        ...(substitution.lineMetrics
          ? { lineMetrics: freezeLineMetrics(substitution.lineMetrics) }
          : {}),
      })
    );
  }

  const resolve = (requested: FontRequest): ResolvedFont | FontResolutionError => {
    const safeRequested = freezeRequest(requested);
    const requestedKey = fontRequestKey(safeRequested);
    const substituted = substitutions.get(requestedKey);
    const resolvedRequest = substituted?.to ?? safeRequested;
    const stored = resources.get(fontRequestKey(resolvedRequest));
    if (!stored) return new FontResolutionError('missing', safeRequested);
    if (stored.kind === 'forbidden') {
      return new FontResolutionError('forbidden', safeRequested);
    }
    if (stored.kind === 'overLimit') {
      return new FontResolutionError('overLimit', safeRequested, {
        limit: maxFontBytes,
        actual: stored.actual,
      });
    }
    if (stored.kind === 'malformed') {
      return new FontResolutionError('malformed', safeRequested, {
        diagnostic: stored.diagnostic,
      });
    }
    if (stored.kind === 'hashMismatch') {
      return new FontResolutionError('hashMismatch', safeRequested, {
        expectedHash: stored.expectedHash,
        actualHash: stored.actualHash,
      });
    }
    if (!substituted) return stored.font;
    return createOwnedResolvedFont(
      {
        request: stored.font.request,
        id: stored.font.id,
        hash: stored.font.hash,
        faceIndex: stored.font.faceIndex,
        byteLength: stored.font.byteLength,
      },
      trustedFontBytes(stored.font),
      trustedFontTableTags(stored.font),
      {
        requested: safeRequested,
        resolved: substituted.to,
        ...(substituted.lineMetrics ? { lineMetrics: substituted.lineMetrics } : {}),
      }
    );
  };

  return Object.freeze({ epoch, resolve });
};
