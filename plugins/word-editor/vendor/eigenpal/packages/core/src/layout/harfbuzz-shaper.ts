import { fontUnitsConverter, exactFontUnitsConverter } from './harfbuzz-font-units.ts';
import {
  assertValidatedResolvedFont,
  boundedStructuralFontValidator,
  trustedFontBytes,
  trustedFontTableTags,
  type FontByteValidator,
  type ResolvedFont,
} from './font-resource.ts';
import { fontHasSymbolCmap, toSymbolCmapText } from './symbol-cmap.ts';
import { unkernedTextRanges } from './run-kerning.ts';
import { hasSoundMark, spacedSoundMarks, withSpacingSoundMarks } from './sound-mark-spacing.ts';
import {
  createShapedRun,
  createShapingEnvironment,
  fixedPoint,
  MAX_SHAPING_CONTEXT,
  markFacePreservingShaper,
  type GlyphOutline,
  type ShapeInput,
  type ShapedCluster,
  type ShapedGlyph,
  type ShapedRun,
  type TextShaper,
  type VersionedShapingLibrary,
} from './shaped-run.ts';
import { ShapeCacheKeys } from './shape-cache-key.ts';
import {
  harfBuzzUnsupportedRuntimeDiagnostic,
  harfBuzzVersionMismatchDiagnostic,
  harfBuzzWasmUnavailableDiagnostic,
  isUnsupportedNodeRuntime,
} from './harfbuzz-wasm-binary.ts';

export { roundFontUnitToFixedPoint } from './harfbuzz-font-units.ts';

type HarfBuzzModule = typeof import('harfbuzzjs');
type HarfBuzzBlob = InstanceType<HarfBuzzModule['Blob']>;
type HarfBuzzBuffer = InstanceType<HarfBuzzModule['Buffer']>;
type HarfBuzzFace = InstanceType<HarfBuzzModule['Face']>;
type HarfBuzzFont = InstanceType<HarfBuzzModule['Font']>;

/**
 * The exact HarfBuzz build this engine shapes against.
 *
 * Pinned and verified at load: a runtime reporting a different version is REFUSED rather than
 * used, because glyph positioning can change between releases and a cached measurement taken
 * under one build must not be trusted under another.
 */
export const HARFBUZZ_SHAPING_LIBRARY: VersionedShapingLibrary = Object.freeze({
  name: 'HarfBuzz',
  version: '15.0.0',
});

let harfBuzzModule: HarfBuzzModule | null = null;
let harfBuzzInitialization: Promise<void> | null = null;

/** Load and verify the HarfBuzz WASM runtime without adding top-level await to import graphs. */
export function initializeHarfBuzz(): Promise<void> {
  if (harfBuzzModule) return Promise.resolve();
  if (harfBuzzInitialization) return harfBuzzInitialization;
  harfBuzzInitialization = import('harfbuzzjs')
    .then((module) => {
      const version = module.versionString();
      if (version !== HARFBUZZ_SHAPING_LIBRARY.version) {
        throw new HarfBuzzShapingError('shapingLibraryMismatch', {
          // A self-hosted binary makes this the SECOND step of the workflow the docs send
          // esbuild and Bun consumers down: copy the file, then upgrade the package and
          // forget to re-copy it. `expected X, loaded Y` alone names no file and no remedy,
          // which is the dead end the rest of this error handling exists to remove.
          diagnostic: harfBuzzVersionMismatchDiagnostic(HARFBUZZ_SHAPING_LIBRARY.version, version),
        });
      }
      harfBuzzModule = module;
    })
    .catch((error: unknown) => {
      harfBuzzInitialization = null;
      // Anything that is not the version pin above means the runtime did not come up, and
      // the reason is always the same class of problem: the WASM could not be loaded.
      //
      // Deliberately NOT a match on the abort text. Emscripten words each failure
      // differently — `both async and sync fetching of the wasm failed` for a 404,
      // `expected magic word` when a SPA dev server answers with its HTML fallback,
      // `ENOENT` when a deploy step copied the JS but not the asset, and an `EvalError`
      // under a CSP without `wasm-unsafe-eval`. Matching phrases meant the two most likely
      // server and enterprise failures fell through to a raw abort with no remedy attached.
      if (error instanceof HarfBuzzShapingError) throw error;
      // Except the one failure no URL fixes: a Node that predates `process.getBuiltinModule`.
      // Its own code keeps hosts branching on `wasmUnavailable` from prescribing a WASM fix
      // for a runtime problem.
      if (isUnsupportedNodeRuntime(error)) {
        throw new HarfBuzzShapingError('unsupportedRuntime', {
          diagnostic: harfBuzzUnsupportedRuntimeDiagnostic(error),
          cause: error,
        });
      }
      throw new HarfBuzzShapingError('wasmUnavailable', {
        diagnostic: harfBuzzWasmUnavailableDiagnostic(error),
        cause: error,
      });
    });
  return harfBuzzInitialization;
}

/** Whether the WASM runtime is loaded and shaping can proceed synchronously. */
export function isHarfBuzzInitialized(): boolean {
  return harfBuzzModule !== null;
}

function requireHarfBuzz(): HarfBuzzModule {
  if (!harfBuzzModule) {
    throw new HarfBuzzShapingError('notInitialized', {
      diagnostic: 'Call initializeHarfBuzz() before creating a text shaper',
    });
  }
  return harfBuzzModule;
}

/**
 * Why shaping refused.
 *
 * Mostly RESOURCE limits, because every input here derives from a file: text length, codepoint
 * count, glyph count and outline size are all attacker-influenced, and an unbounded shape call is
 * a denial-of-service vector rather than a rendering bug.
 */
export type HarfBuzzShapingErrorCode =
  | 'notInitialized'
  | 'wasmUnavailable'
  | 'unsupportedRuntime'
  | 'fontOverLimit'
  | 'malformedFont'
  | 'textOverLimit'
  | 'codepointsOverLimit'
  | 'glyphOverLimit'
  | 'outlineOverLimit'
  | 'shapedRunOverLimit'
  | 'unsupportedVariationAxes'
  | 'unsupportedFallback'
  | 'unsupportedColorFont'
  | 'unsupportedNormalization'
  | 'invalidBidiLevel'
  | 'shapingLibraryMismatch'
  | 'disposed';

/**
 * A shaping call that was refused, carrying the limit it exceeded where there was one.
 *
 * Thrown rather than returned: unlike a missing font, a run that cannot be shaped has no sensible
 * fallback measurement, and continuing would lay text out at made-up widths.
 */
export class HarfBuzzShapingError extends Error {
  readonly name = 'HarfBuzzShapingError';
  readonly code: HarfBuzzShapingErrorCode;
  readonly limit?: number;
  readonly actual?: number;
  readonly diagnostic?: string;

  constructor(
    code: HarfBuzzShapingErrorCode,
    details: {
      readonly limit?: number;
      readonly actual?: number;
      readonly diagnostic?: string;
      readonly cause?: unknown;
    } = {}
  ) {
    super(`HarfBuzz shaping failed (${code})`, { cause: details.cause });
    this.code = code;
    this.limit = details.limit;
    this.actual = details.actual;
    this.diagnostic = details.diagnostic;
  }
}

/**
 * Resource budgets and cache sizes for one shaper. Every field optional.
 *
 * The caches exist because shaping is the expensive step: a face is opened once and reused, and
 * identical runs return their previous result. The caps exist because file-derived input decides
 * how much work is asked for.
 */
export interface HarfBuzzTextShaperOptions {
  readonly maxFontBytes?: number;
  readonly maxInputUtf16?: number;
  readonly maxCodepoints?: number;
  readonly maxGlyphs?: number;
  readonly maxCachedFaces?: number;
  /** Aggregate retained native font bytes; oversized faces are shaped without retention. */
  readonly maxCachedFontBytes?: number;
  readonly maxCachedShapes?: number;
  readonly maxOutlineBytes?: number;
  readonly maxCachedOutlineBytes?: number;
  readonly maxShapedRunBytes?: number;
  readonly maxCachedShapeBytes?: number;
  readonly instrumentation?: HarfBuzzTextShaperInstrumentation;
}

/** One face-cache transition, for instrumentation. */
export interface HarfBuzzFaceCacheEvent {
  readonly kind: 'created' | 'hit' | 'evicted';
  readonly identity: string;
}

/**
 * Optional counters for the work a shaper is expected to do rarely.
 *
 * Exists so tests can assert the ABSENCE of work — re-opening a face or re-copying its bytes per
 * shape call would not change any output, only make typing slow, which no rendering assertion
 * would catch.
 */
export interface HarfBuzzTextShaperInstrumentation {
  readonly onFaceCacheEvent?: (event: HarfBuzzFaceCacheEvent) => void;
  readonly onShapeCacheEvent?: (event: HarfBuzzShapeCacheEvent) => void;
  readonly onByteCopy?: () => void;
  readonly onTableScan?: () => void;
  readonly onShapeCall?: () => void;
  readonly onOutlinePathCall?: () => void;
  readonly onOutlineCacheEvent?: (event: HarfBuzzOutlineCacheEvent) => void;
}

/** One shape-cache transition, for instrumentation. */
export interface HarfBuzzShapeCacheEvent {
  readonly kind: 'hit' | 'miss' | 'stored' | 'evicted' | 'skipped' | 'cleared';
  readonly retainedBytes: number;
}

/** One outline-cache transition, for instrumentation. */
export interface HarfBuzzOutlineCacheEvent {
  readonly kind: 'created' | 'hit' | 'evicted' | 'skipped' | 'cleared';
  readonly retainedBytes: number;
}

/**
 * A {@link TextShaper} backed by HarfBuzz, holding WASM resources.
 *
 * {@link HarfBuzzTextShaper.dispose} is not optional housekeeping: the cached faces are WASM
 * allocations that garbage collection cannot reclaim, so a shaper outliving its editor leaks
 * until the page goes away.
 */
export interface HarfBuzzTextShaper extends TextShaper {
  dispose(): void;
}

const DEFAULT_MAX_FONT_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_INPUT_UTF16 = 1_000_000;
const DEFAULT_MAX_CODEPOINTS = 1_000_000;
const DEFAULT_MAX_GLYPHS = 1_000_000;
const DEFAULT_MAX_CACHED_FACES = 4;
const DEFAULT_MAX_CACHED_SHAPES = 512;
const DEFAULT_MAX_OUTLINE_BYTES = 1024 * 1024;
const DEFAULT_MAX_CACHED_OUTLINE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_SHAPED_RUN_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_CACHED_SHAPE_BYTES = 64 * 1024 * 1024;
const HARD_MAX_FONT_BYTES = 64 * 1024 * 1024;
const HARD_MAX_INPUT_UTF16 = 1_000_000;
const HARD_MAX_CODEPOINTS = 1_000_000;
const HARD_MAX_GLYPHS = 1_000_000;
const HARD_MAX_CACHED_FACES = 64;
const HARD_MAX_CACHED_SHAPES = 4096;
const HARD_MAX_OUTLINE_BYTES = 4 * 1024 * 1024;
const HARD_MAX_CACHED_OUTLINE_BYTES = 64 * 1024 * 1024;
const HARD_MAX_SHAPED_RUN_BYTES = 64 * 1024 * 1024;
const HARD_MAX_CACHED_SHAPE_BYTES = 256 * 1024 * 1024;
const COLOR_TABLES = new Set(['COLR', 'CPAL', 'CBDT', 'CBLC', 'sbix', 'SVG ']);
const REQUIRED_TABLES = ['cmap', 'head', 'hhea', 'hmtx', 'maxp'] as const;

const readUint16 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset]! << 8) | bytes[offset + 1]!;

const readUint32 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset]! * 0x1000000 +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!) >>>
  0;

const sfntOffset = (bytes: Uint8Array, faceIndex: number): number => {
  const signature = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  return signature === 'ttcf' ? readUint32(bytes, 12 + faceIndex * 4) : 0;
};

const tableTags = (bytes: Uint8Array, faceIndex: number): ReadonlySet<string> => {
  const base = sfntOffset(bytes, faceIndex);
  const count = readUint16(bytes, base + 4);
  const tags = new Set<string>();
  for (let index = 0; index < count; index += 1) {
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
  return tags;
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const validateRequiredTables: FontByteValidator = (bytes, faceIndex) => {
  const structural = boundedStructuralFontValidator(bytes, faceIndex);
  if (!structural.valid) return structural;
  const tags = tableTags(bytes, faceIndex);
  for (const required of REQUIRED_TABLES) {
    if (!tags.has(required)) {
      return { valid: false, diagnostic: `missing required ${required} table` };
    }
  }
  return { valid: true };
};

/** Structural sfnt validation that does not construct native HarfBuzz objects. */
export const harfBuzzFontValidator: FontByteValidator = validateRequiredTables;

const assertPositiveLimit = (value: number, name: string, hardMaximum: number): number => {
  if (!Number.isSafeInteger(value) || value <= 0 || value > hardMaximum) {
    throw new RangeError(`${name} must be a positive safe integer no greater than ${hardMaximum}`);
  }
  return value;
};

const clustersFromGlyphs = (
  text: string,
  glyphs: readonly ShapedGlyph[],
  direction: 'ltr' | 'rtl'
): readonly ShapedCluster[] => {
  if (glyphs.length === 0) return [];
  // MONOTONE_CHARACTERS keeps equal clusters together and orders their starts by direction.
  // Adjacent groups therefore give logical ends without a set, sort, or per-cluster slice.
  const clusters: ShapedCluster[] = [];
  let glyphStart = 0;
  while (glyphStart < glyphs.length) {
    const textStart = glyphs[glyphStart]!.cluster;
    let glyphEnd = glyphStart + 1;
    let advance = glyphs[glyphStart]!.advanceX as number;
    while (glyphEnd < glyphs.length && glyphs[glyphEnd]!.cluster === textStart) {
      advance += glyphs[glyphEnd]!.advanceX;
      glyphEnd += 1;
    }
    const safeAdvance = fixedPoint(advance);
    clusters.push({
      textStart,
      textEnd:
        direction === 'rtl'
          ? (glyphs[glyphStart - 1]?.cluster ?? text.length)
          : (glyphs[glyphEnd]?.cluster ?? text.length),
      glyphStart,
      glyphEnd,
      advance: safeAdvance,
      caretEdges: Object.freeze([fixedPoint(0), safeAdvance]),
      fontSpan: 0,
    });
    glyphStart = glyphEnd;
  }
  return clusters;
};

interface ActiveHarfBuzzFont {
  readonly identity: string;
  readonly blob: HarfBuzzBlob;
  readonly face: HarfBuzzFace;
  readonly font: HarfBuzzFont;
  readonly unitsPerEm: number;
  readonly byteLength: number;
}

const OBJECT_OVERHEAD_BYTES = 64;
const REFERENCE_BYTES = 8;
const NUMBER_STORAGE_BYTES = 8;
const ARRAY_OVERHEAD_BYTES = 32;
const MAP_ENTRY_OVERHEAD_BYTES = OBJECT_OVERHEAD_BYTES + 2 * REFERENCE_BYTES;
const CACHED_OUTLINE_WRAPPER_BYTES = OBJECT_OVERHEAD_BYTES + REFERENCE_BYTES + NUMBER_STORAGE_BYTES;
const CACHED_SHAPE_WRAPPER_BYTES =
  OBJECT_OVERHEAD_BYTES + REFERENCE_BYTES + 2 * NUMBER_STORAGE_BYTES;
const OUTLINE_OBJECT_BYTES = OBJECT_OVERHEAD_BYTES + REFERENCE_BYTES + NUMBER_STORAGE_BYTES;
const SHAPED_RUN_OBJECT_BYTES = OBJECT_OVERHEAD_BYTES + 8 * REFERENCE_BYTES;
const GLYPH_OBJECT_BYTES = OBJECT_OVERHEAD_BYTES + 8 * NUMBER_STORAGE_BYTES + REFERENCE_BYTES;
const CLUSTER_OBJECT_BYTES = OBJECT_OVERHEAD_BYTES + 6 * NUMBER_STORAGE_BYTES + REFERENCE_BYTES;
const FONT_SPAN_OBJECT_BYTES =
  OBJECT_OVERHEAD_BYTES + 3 * NUMBER_STORAGE_BYTES + 2 * REFERENCE_BYTES;
const METRICS_OBJECT_BYTES = OBJECT_OVERHEAD_BYTES + 3 * NUMBER_STORAGE_BYTES;

const stringStorageBytes = (value: string): number =>
  OBJECT_OVERHEAD_BYTES + value.length * Uint16Array.BYTES_PER_ELEMENT;

const outlineStorageBytes = (path: string): number =>
  OUTLINE_OBJECT_BYTES + stringStorageBytes(path);

const arrayStorageBytes = (length: number): number =>
  ARRAY_OVERHEAD_BYTES + length * REFERENCE_BYTES;

const outlineCacheEntryStorageBytes = (key: string, path: string): number =>
  MAP_ENTRY_OVERHEAD_BYTES +
  stringStorageBytes(key) +
  CACHED_OUTLINE_WRAPPER_BYTES +
  outlineStorageBytes(path);

const conservativeCandidateRunBytes = (text: string): number =>
  SHAPED_RUN_OBJECT_BYTES +
  stringStorageBytes(text) +
  arrayStorageBytes(text.length) +
  text.length * GLYPH_OBJECT_BYTES;

const shapedRunStorageBytes = (run: ShapedRun): number => {
  const uniqueOutlines = new Set(run.glyphs.map((glyph) => glyph.outline));
  return (
    SHAPED_RUN_OBJECT_BYTES +
    stringStorageBytes(run.text) +
    arrayStorageBytes(run.glyphs.length) +
    run.glyphs.length * GLYPH_OBJECT_BYTES +
    arrayStorageBytes(run.clusters.length) +
    run.clusters.length * CLUSTER_OBJECT_BYTES +
    run.clusters.reduce((sum, cluster) => sum + arrayStorageBytes(cluster.caretEdges.length), 0) +
    arrayStorageBytes(run.fontSpans.length) +
    run.fontSpans.length * FONT_SPAN_OBJECT_BYTES +
    (run.exactAdvancesX === undefined
      ? 0
      : ARRAY_OVERHEAD_BYTES + run.exactAdvancesX.length * NUMBER_STORAGE_BYTES) +
    METRICS_OBJECT_BYTES +
    [...uniqueOutlines].reduce((sum, outline) => sum + outlineStorageBytes(outline.path), 0)
  );
};

const shapeCacheEntryStorageBytes = (key: string, retainedRunBytes: number): number =>
  MAP_ENTRY_OVERHEAD_BYTES +
  stringStorageBytes(key) +
  CACHED_SHAPE_WRAPPER_BYTES +
  retainedRunBytes;

interface CachedOutline {
  readonly outline: GlyphOutline;
  readonly bytes: number;
  readonly identity: string;
  readonly glyphId: number;
}

interface CachedShape {
  readonly run: ShapedRun;
  readonly bytes: number;
  /** The recency stamp when the entry last went to the young end of the map. */
  stamp: number;
}

class ProductionHarfBuzzTextShaper implements HarfBuzzTextShaper {
  readonly #harfBuzz: HarfBuzzModule;
  readonly #maxFontBytes: number;
  readonly #maxInputUtf16: number;
  readonly #maxCodepoints: number;
  readonly #maxGlyphs: number;
  readonly #maxCachedFaces: number;
  readonly #maxCachedFontBytes: number;
  #fontBytes = 0;
  readonly #maxCachedShapes: number;
  readonly #maxOutlineBytes: number;
  readonly #maxCachedOutlineBytes: number;
  readonly #maxShapedRunBytes: number;
  readonly #maxCachedShapeBytes: number;
  readonly #onFaceCacheEvent: ((event: HarfBuzzFaceCacheEvent) => void) | undefined;
  readonly #instrumentation: HarfBuzzTextShaperInstrumentation | undefined;
  readonly #faces = new Map<string, ActiveHarfBuzzFont>();
  readonly #outlines = new Map<string, Map<number, CachedOutline>>();
  readonly #outlineLru = new Map<CachedOutline, undefined>();
  readonly #shapeResults = new Map<string, CachedShape>();
  readonly #keys = new ShapeCacheKeys(() => {
    this.#shapeResults.clear();
    this.#shapeBytes = 0;
    this.#instrumentation?.onShapeCacheEvent?.(
      Object.freeze({ kind: 'cleared', retainedBytes: 0 })
    );
  });
  #outlineBytes = 0;
  #shapeBytes = 0;
  #shapeStamp = 0;
  #buffer: HarfBuzzBuffer | undefined;

  constructor(harfBuzz: HarfBuzzModule, options: HarfBuzzTextShaperOptions) {
    // It refuses a fallback order, so every run it shapes is in the environment's face.
    markFacePreservingShaper(this);
    this.#harfBuzz = harfBuzz;
    this.#maxFontBytes = assertPositiveLimit(
      options.maxFontBytes ?? DEFAULT_MAX_FONT_BYTES,
      'maximum font bytes',
      HARD_MAX_FONT_BYTES
    );
    this.#maxInputUtf16 = assertPositiveLimit(
      options.maxInputUtf16 ?? DEFAULT_MAX_INPUT_UTF16,
      'maximum input UTF-16 code units',
      HARD_MAX_INPUT_UTF16
    );
    this.#maxCodepoints = assertPositiveLimit(
      options.maxCodepoints ?? DEFAULT_MAX_CODEPOINTS,
      'maximum input code points',
      HARD_MAX_CODEPOINTS
    );
    this.#maxGlyphs = assertPositiveLimit(
      options.maxGlyphs ?? DEFAULT_MAX_GLYPHS,
      'maximum shaped glyphs',
      HARD_MAX_GLYPHS
    );
    this.#maxCachedFontBytes = assertPositiveLimit(
      options.maxCachedFontBytes ?? 64 * 1024 * 1024,
      'maximum cached font bytes',
      64 * 1024 * 1024
    );
    this.#maxCachedFaces = assertPositiveLimit(
      options.maxCachedFaces ?? DEFAULT_MAX_CACHED_FACES,
      'maximum cached faces',
      HARD_MAX_CACHED_FACES
    );
    this.#maxCachedShapes = assertPositiveLimit(
      options.maxCachedShapes ?? DEFAULT_MAX_CACHED_SHAPES,
      'maximum cached shape results',
      HARD_MAX_CACHED_SHAPES
    );
    this.#maxOutlineBytes = assertPositiveLimit(
      options.maxOutlineBytes ?? DEFAULT_MAX_OUTLINE_BYTES,
      'maximum outline bytes',
      HARD_MAX_OUTLINE_BYTES
    );
    this.#maxCachedOutlineBytes = assertPositiveLimit(
      options.maxCachedOutlineBytes ?? DEFAULT_MAX_CACHED_OUTLINE_BYTES,
      'maximum cached outline bytes',
      HARD_MAX_CACHED_OUTLINE_BYTES
    );
    this.#maxShapedRunBytes = assertPositiveLimit(
      options.maxShapedRunBytes ?? DEFAULT_MAX_SHAPED_RUN_BYTES,
      'maximum shaped run bytes',
      HARD_MAX_SHAPED_RUN_BYTES
    );
    this.#maxCachedShapeBytes = assertPositiveLimit(
      options.maxCachedShapeBytes ?? DEFAULT_MAX_CACHED_SHAPE_BYTES,
      'maximum cached shape bytes',
      HARD_MAX_CACHED_SHAPE_BYTES
    );
    this.#onFaceCacheEvent = options.instrumentation?.onFaceCacheEvent;
    this.#instrumentation = options.instrumentation;
    this.#buffer = new this.#harfBuzz.Buffer();
  }

  dispose(): void {
    this.#faces.clear();
    this.#fontBytes = 0;
    this.#outlines.clear();
    this.#outlineLru.clear();
    this.#shapeResults.clear();
    this.#keys.clear();
    this.#outlineBytes = 0;
    this.#shapeBytes = 0;
    this.#instrumentation?.onOutlineCacheEvent?.(
      Object.freeze({ kind: 'cleared', retainedBytes: 0 })
    );
    this.#instrumentation?.onShapeCacheEvent?.(
      Object.freeze({ kind: 'cleared', retainedBytes: 0 })
    );
    this.#buffer = undefined;
  }

  #loadFont(fontResource: ResolvedFont, bytes: Uint8Array): ActiveHarfBuzzFont {
    const cached = this.#faces.get(fontResource.identity);
    if (cached) {
      this.#faces.delete(fontResource.identity);
      this.#faces.set(fontResource.identity, cached);
      this.#onFaceCacheEvent?.(Object.freeze({ kind: 'hit', identity: fontResource.identity }));
      return cached;
    }
    const tags = trustedFontTableTags(fontResource);
    for (const required of REQUIRED_TABLES) {
      if (!tags.has(required)) {
        throw new HarfBuzzShapingError('malformedFont', {
          diagnostic: `missing required ${required} table`,
        });
      }
    }
    this.#instrumentation?.onByteCopy?.();
    const blob = new this.#harfBuzz.Blob(toArrayBuffer(bytes));
    const face = new this.#harfBuzz.Face(blob, fontResource.faceIndex);
    const font = new this.#harfBuzz.Font(face);
    const metrics = font.hExtents();
    if (
      !Number.isSafeInteger(face.upem) ||
      face.upem <= 0 ||
      !Number.isSafeInteger(metrics.ascender) ||
      !Number.isSafeInteger(metrics.descender) ||
      !Number.isSafeInteger(metrics.lineGap)
    ) {
      throw new HarfBuzzShapingError('malformedFont', {
        diagnostic: 'invalid font units or horizontal metrics',
      });
    }
    font.setScale(face.upem, face.upem);
    const active = {
      identity: fontResource.identity,
      blob,
      face,
      font,
      unitsPerEm: face.upem,
      byteLength: bytes.byteLength,
    };
    if (bytes.byteLength <= this.#maxCachedFontBytes) {
      while (
        this.#faces.size >= this.#maxCachedFaces ||
        this.#fontBytes + bytes.byteLength > this.#maxCachedFontBytes
      ) {
        const oldest = this.#faces.keys().next().value;
        if (oldest === undefined) break;
        this.#fontBytes -= this.#faces.get(oldest)!.byteLength;
        this.#faces.delete(oldest);
        this.#onFaceCacheEvent?.(Object.freeze({ kind: 'evicted', identity: oldest }));
      }
      this.#faces.set(fontResource.identity, active);
      this.#fontBytes += bytes.byteLength;
    }
    this.#onFaceCacheEvent?.(Object.freeze({ kind: 'created', identity: fontResource.identity }));
    return active;
  }

  #outline(active: ActiveHarfBuzzFont, glyphId: number): GlyphOutline {
    // Variation axes are refused before shaping. The admitted face identity and glyph id
    // therefore identify an outline without serializing the font identity for each lookup.
    const cached = this.#outlines.get(active.identity)?.get(glyphId);
    if (cached) {
      this.#outlineLru.delete(cached);
      this.#outlineLru.set(cached, undefined);
      this.#instrumentation?.onOutlineCacheEvent?.(
        Object.freeze({ kind: 'hit', retainedBytes: this.#outlineBytes })
      );
      return cached.outline;
    }

    this.#instrumentation?.onOutlinePathCall?.();
    const path = active.font.glyphToPath(glyphId);
    const outlineBytes = outlineStorageBytes(path);
    if (outlineBytes > this.#maxOutlineBytes) {
      throw new HarfBuzzShapingError('outlineOverLimit', {
        limit: this.#maxOutlineBytes,
        actual: outlineBytes,
      });
    }
    const outline = Object.freeze({ path, unitsPerEm: active.unitsPerEm });
    // Charge the face key and both indexes to each entry, including singleton face maps.
    const bytes =
      outlineCacheEntryStorageBytes(active.identity, path) +
      3 * MAP_ENTRY_OVERHEAD_BYTES +
      2 * NUMBER_STORAGE_BYTES;
    if (bytes > this.#maxCachedOutlineBytes) {
      this.#instrumentation?.onOutlineCacheEvent?.(
        Object.freeze({ kind: 'skipped', retainedBytes: this.#outlineBytes })
      );
      return outline;
    }
    while (this.#outlineBytes + bytes > this.#maxCachedOutlineBytes) {
      const evicted = this.#outlineLru.keys().next().value;
      if (evicted === undefined) break;
      this.#outlineLru.delete(evicted);
      const byGlyph = this.#outlines.get(evicted.identity)!;
      byGlyph.delete(evicted.glyphId);
      if (byGlyph.size === 0) this.#outlines.delete(evicted.identity);
      this.#outlineBytes -= evicted.bytes;
      this.#instrumentation?.onOutlineCacheEvent?.(
        Object.freeze({ kind: 'evicted', retainedBytes: this.#outlineBytes })
      );
    }
    let byGlyph = this.#outlines.get(active.identity);
    if (!byGlyph) this.#outlines.set(active.identity, (byGlyph = new Map()));
    const entry = { outline, bytes, identity: active.identity, glyphId };
    byGlyph.set(glyphId, entry);
    this.#outlineLru.set(entry, undefined);
    this.#outlineBytes += bytes;
    this.#instrumentation?.onOutlineCacheEvent?.(
      Object.freeze({ kind: 'created', retainedBytes: this.#outlineBytes })
    );
    return outline;
  }

  #assertTextBudget(text: string): void {
    if (text.length > this.#maxInputUtf16) {
      throw new HarfBuzzShapingError('textOverLimit', {
        limit: this.#maxInputUtf16,
        actual: text.length,
      });
    }
    let codePoints = 0;
    for (let offset = 0; offset < text.length;) {
      const codePoint = text.codePointAt(offset)!;
      offset += codePoint > 0xffff ? 2 : 1;
      codePoints += 1;
      if (codePoints > this.#maxCodepoints) {
        throw new HarfBuzzShapingError('codepointsOverLimit', {
          limit: this.#maxCodepoints,
          actual: codePoints,
        });
      }
    }
  }

  shape(input: ShapeInput): ShapedRun {
    if (!this.#buffer) throw new HarfBuzzShapingError('disposed');
    assertValidatedResolvedFont(input.environment.font);
    if (input.environment.font.byteLength > this.#maxFontBytes) {
      throw new HarfBuzzShapingError('fontOverLimit', {
        limit: this.#maxFontBytes,
        actual: input.environment.font.byteLength,
      });
    }
    this.#assertTextBudget(input.text);
    const candidateBytes = conservativeCandidateRunBytes(input.text);
    if (candidateBytes > this.#maxShapedRunBytes) {
      throw new HarfBuzzShapingError('shapedRunOverLimit', {
        limit: this.#maxShapedRunBytes,
        actual: candidateBytes,
      });
    }
    const environment = createShapingEnvironment(input.environment);
    const cacheKey = this.#keys.keyOf(input, environment);
    const cached = this.#shapeResults.get(cacheKey);
    if (cached) {
      // Approximate recency: an entry in the younger half stays put, so a hot run survives in
      // at worst a half-size true LRU. A delete and re-insert on every hit was a hot spot.
      if (this.#shapeStamp - cached.stamp >= Math.max(1, this.#shapeResults.size >> 1)) {
        this.#shapeResults.delete(cacheKey);
        this.#shapeResults.set(cacheKey, cached);
        cached.stamp = ++this.#shapeStamp;
      }
      this.#instrumentation?.onShapeCacheEvent?.(
        Object.freeze({ kind: 'hit', retainedBytes: this.#shapeBytes })
      );
      return cached.run;
    }
    this.#instrumentation?.onShapeCacheEvent?.(
      Object.freeze({ kind: 'miss', retainedBytes: this.#shapeBytes })
    );
    if (
      environment.shapingLibrary.name !== HARFBUZZ_SHAPING_LIBRARY.name ||
      environment.shapingLibrary.version !== HARFBUZZ_SHAPING_LIBRARY.version
    ) {
      throw new HarfBuzzShapingError('shapingLibraryMismatch');
    }
    if (environment.normalization !== 'none') {
      throw new HarfBuzzShapingError('unsupportedNormalization');
    }
    if (
      !Number.isSafeInteger(input.bidiLevel) ||
      input.bidiLevel < 0 ||
      ((input.bidiLevel & 1) === 1) !== (environment.direction === 'rtl')
    ) {
      throw new HarfBuzzShapingError('invalidBidiLevel');
    }
    if (Object.keys(environment.variationAxes).length > 0) {
      throw new HarfBuzzShapingError('unsupportedVariationAxes');
    }
    if (environment.fallbackOrder.length > 0) {
      throw new HarfBuzzShapingError('unsupportedFallback');
    }
    const bytes = trustedFontBytes(environment.font);
    const tags = trustedFontTableTags(environment.font);
    // A color face shapes like any other when it also carries outlines: the export writer
    // paints its COLR layers itself, and a browser draws them from the same face. A face
    // whose color glyphs are bitmaps or SVG alone, with no outline table, has no ink this
    // engine can measure or embed, and stays refused.
    if ([...COLOR_TABLES].some((tag) => tags.has(tag)) && !tags.has('glyf') && !tags.has('CFF ')) {
      throw new HarfBuzzShapingError('unsupportedColorFont');
    }

    const text = input.text;
    this.#assertTextBudget(text);
    const before = input.context?.before ?? '';
    const after = input.context?.after ?? '';
    const limit = MAX_SHAPING_CONTEXT;
    const actual = Math.max(String(before).length, String(after).length);
    if (typeof before !== 'string' || typeof after !== 'string' || actual > limit)
      throw new HarfBuzzShapingError('textOverLimit', { limit, actual });

    try {
      const active = this.#loadFont(environment.font, bytes);
      const { face, font } = active;
      const buffer = this.#buffer;
      buffer.reset();
      // Context is read for contextual forms and never shaped. HarfBuzz reports clusters as
      // offsets into the whole string, so they shift back by the leading context below.
      // A symbol cmap face answers a plain byte at U+F000 plus the code (`symbol-cmap.ts`).
      const symbolText = fontHasSymbolCmap(environment.font, bytes) ? toSymbolCmapText : String;
      const shapedText = before + text + after;
      // A face that draws a sound mark in its own cell shapes it as its spacing form.
      const soundMarks = hasSoundMark(shapedText) ? spacedSoundMarks(active) : undefined;
      const mapped = (value: string) =>
        symbolText(soundMarks ? withSpacingSoundMarks(value, soundMarks) : value);
      if (before || after)
        buffer.addText(mapped(before + text + after), before.length, text.length);
      else buffer.addText(mapped(text));
      buffer.setDirection(
        environment.direction === 'rtl'
          ? this.#harfBuzz.Direction.RTL
          : this.#harfBuzz.Direction.LTR
      );
      buffer.setScript(environment.script);
      buffer.setLanguage(environment.language);
      buffer.setClusterLevel(this.#harfBuzz.ClusterLevel.MONOTONE_CHARACTERS);
      const features = Object.entries(environment.features).map(
        ([tag, value]) => new this.#harfBuzz.Feature(tag, value)
      );
      // Pair kerning leaves full-width East Asian text alone; Latin text in the run still kerns.
      // Clusters count from the start of the shaped context, so the ranges do too.
      if ((environment.features.kern ?? 1) !== 0) {
        for (const [start, end] of unkernedTextRanges(before + text + after))
          features.push(new this.#harfBuzz.Feature('kern', 0, start, end));
      }
      this.#instrumentation?.onShapeCall?.();
      this.#harfBuzz.shape(font, buffer, features);
      const glyphCount = buffer.getLength();
      if (glyphCount > this.#maxGlyphs) {
        throw new HarfBuzzShapingError('glyphOverLimit', {
          limit: this.#maxGlyphs,
          actual: glyphCount,
        });
      }
      // The combined getter defines internal metadata properties on every glyph.
      // Layout only needs glyph identities and positions, available without those properties.
      const shaped = buffer.getGlyphInfos();
      const positions = buffer.getGlyphPositions();

      const convert = fontUnitsConverter(
        face.upem,
        input.fontSizeHalfPoints,
        environment.fixedPointScale,
        environment.roundingMode
      );
      const exactAdvance = exactFontUnitsConverter(
        face.upem,
        input.fontSizeHalfPoints,
        environment.fixedPointScale
      );
      const exactAdvancesX: number[] = [];
      let originX = fixedPoint(0);
      let originY = fixedPoint(0);
      const runOutlines = new Map<number, GlyphOutline>();
      const glyphs: ShapedGlyph[] = shaped.map((glyph, index) => {
        const position = positions[index];
        // The face's own mark glyph and advance replace the spacing form it was shaped as.
        const soundMark = soundMarks?.get(shapedText.charCodeAt(glyph.cluster));
        const xAdvance = soundMark?.advance ?? position?.xAdvance ?? 0;
        exactAdvancesX.push(exactAdvance(xAdvance));
        const advanceX = convert(xAdvance);
        const advanceY = convert(position?.yAdvance ?? 0);
        const glyphId = soundMark?.glyph ?? glyph.codepoint;
        const positioned = {
          id: glyphId,
          cluster: glyph.cluster - before.length,
          originX,
          originY,
          advanceX,
          advanceY,
          offsetX: convert(position?.xOffset ?? 0),
          offsetY: convert(position?.yOffset ?? 0),
          outline:
            runOutlines.get(glyphId) ??
            (() => {
              const outline = this.#outline(active, glyphId);
              runOutlines.set(glyphId, outline);
              return outline;
            })(),
        };
        originX = fixedPoint(originX + advanceX);
        originY = fixedPoint(originY + advanceY);
        return positioned;
      });
      const extents = font.hExtents();
      const result = createShapedRun(
        {
          text,
          direction: environment.direction,
          bidiLevel: input.bidiLevel,
          glyphs,
          exactAdvancesX,
          clusters: clustersFromGlyphs(text, glyphs, environment.direction),
          fontSpans:
            glyphs.length === 0
              ? []
              : [
                  {
                    glyphStart: 0,
                    glyphEnd: glyphs.length,
                    font: environment.font,
                    fallbackIndex: null,
                  },
                ],
          metrics: {
            ascent: convert(extents.ascender),
            descent: convert(-extents.descender),
            lineGap: convert(extents.lineGap),
          },
        },
        environment
      );
      const resultBytes = shapedRunStorageBytes(result);
      if (resultBytes > this.#maxShapedRunBytes) {
        throw new HarfBuzzShapingError('shapedRunOverLimit', {
          limit: this.#maxShapedRunBytes,
          actual: resultBytes,
        });
      }
      const cachedBytes = shapeCacheEntryStorageBytes(cacheKey, resultBytes);
      if (cachedBytes > this.#maxCachedShapeBytes) {
        this.#instrumentation?.onShapeCacheEvent?.(
          Object.freeze({ kind: 'skipped', retainedBytes: this.#shapeBytes })
        );
        return result;
      }
      while (
        this.#shapeResults.size >= this.#maxCachedShapes ||
        this.#shapeBytes + cachedBytes > this.#maxCachedShapeBytes
      ) {
        const oldest = this.#shapeResults.keys().next().value;
        if (oldest === undefined) break;
        const evicted = this.#shapeResults.get(oldest)!;
        this.#shapeResults.delete(oldest);
        this.#shapeBytes -= evicted.bytes;
        this.#instrumentation?.onShapeCacheEvent?.(
          Object.freeze({ kind: 'evicted', retainedBytes: this.#shapeBytes })
        );
      }
      this.#shapeResults.set(cacheKey, {
        run: result,
        bytes: cachedBytes,
        stamp: ++this.#shapeStamp,
      });
      this.#shapeBytes += cachedBytes;
      this.#instrumentation?.onShapeCacheEvent?.(
        Object.freeze({ kind: 'stored', retainedBytes: this.#shapeBytes })
      );
      return result;
    } catch (error) {
      if (error instanceof HarfBuzzShapingError) throw error;
      throw new HarfBuzzShapingError('malformedFont', {
        diagnostic: error instanceof Error ? error.message : 'HarfBuzz shaping failed',
      });
    }
  }
}

/**
 * Build a HarfBuzz-backed shaper.
 *
 * Requires `initializeHarfBuzz()` to have resolved — shaping is synchronous, so the WASM runtime
 * must already be loaded. Dispose the result when the editor goes away, or its cached faces leak.
 */
export const createHarfBuzzTextShaper = (
  options: HarfBuzzTextShaperOptions = {}
): HarfBuzzTextShaper => new ProductionHarfBuzzTextShaper(requireHarfBuzz(), options);
