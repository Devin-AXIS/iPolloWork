// The editor's font configuration contract. Split from `editor.ts`, which re-exports it.

/** A concrete font face requested by authored document content. */
export interface FontFaceRequest {
  readonly family: string;
  readonly weight: number;
  readonly style: 'normal' | 'italic';
}

/** Immutable, byte-backed font face supplied to layout and browser paint. */
export interface FontSource {
  readonly request: FontFaceRequest;
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly hash: string;
  readonly faceIndex: number;
  readonly availability?: 'available' | 'forbidden';
}

/** An explicit authored-font substitution. No implicit platform fallback is performed. */
export interface FontSourceSubstitution {
  readonly from: FontFaceRequest;
  readonly to: FontFaceRequest;
  /** Word line-box metrics for the requested face, expressed as em ratios. */
  readonly lineMetrics?: {
    readonly heightEm: number;
    readonly baselineEm: number;
  };
}

/**
 * Public font source configuration sampled when an adapter mounts. It must be immutable for that
 * editor lifetime; remount the adapter to replace bytes or substitutions atomically.
 */
export interface FontConfiguration {
  /** Selectable provider families, independent of loaded bytes. Listing them performs no fetch. */
  readonly supportedFamilies?: readonly string[];
  readonly epoch: number;
  readonly maxFontBytes: number;
  readonly sources: readonly FontSource[];
  readonly substitutions?: readonly FontSourceSubstitution[];
  readonly defaultFont: {
    readonly family: string;
    readonly sizeHalfPoints: number;
  };
  readonly language?: string;
}

/**
 * Why a font was not admitted.
 *
 * Distinguished rather than collapsed because the responses differ: `overLimit` and `malformed`
 * are the caller's own bytes, while `forbidden` and `hashMismatch` mean the source was not what
 * it claimed and the load should not be retried. `wasmUnavailable` alone is a HOST fault — the
 * shaper's WASM never loaded, `diagnostic` carries the remedy — surface it as a setup error.
 */
export type EditorFontErrorCode =
  | 'initializationFailed'
  | 'wasmUnavailable'
  | 'missing'
  | 'forbidden'
  | 'overLimit'
  | 'malformed'
  | 'hashMismatch'
  | 'metadataMismatch'
  | 'fontFaceLoadFailed'
  | 'unsupportedFaceIndex'
  | 'missingFont'
  | 'hashInvalid'
  | 'fontMismatch'
  | 'unsupportedFace'
  | 'loadFailed';
