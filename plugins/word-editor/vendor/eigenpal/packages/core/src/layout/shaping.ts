// Shaping capability contract for layout caret-edge provenance (task 5.5).

/** Explicit navigation geometry capability — layout never invents exact caret edges. */
export interface ShapingCapability {
  /** Per-grapheme advances are trustworthy for keyboard navigation edges. */
  readonly caretEdges: 'per-grapheme-advance' | 'unsupported';
  /** Ligature clusters: disabled measures each grapheme; opaque hides interior caret stops. */
  readonly ligatures: 'disabled-per-grapheme' | 'opaque';
}

export const PER_GRAPHEME_SHAPING: ShapingCapability = {
  caretEdges: 'per-grapheme-advance',
  ligatures: 'disabled-per-grapheme',
};

export const ASCII_LATIN_SHAPING: ShapingCapability = {
  caretEdges: 'per-grapheme-advance',
  ligatures: 'disabled-per-grapheme',
};

export const UNSUPPORTED_SHAPING: ShapingCapability = {
  caretEdges: 'unsupported',
  ligatures: 'opaque',
};

/** Optional shaping-port hook: true when graphemeOffset is strictly inside an opaque ligature cluster. */
export type LigatureInteriorCaret = (fullText: string, graphemeOffset: number) => boolean;

/** Optional metrics hook: true when a single UTF-16 code unit has proven advance width. */
export type CharacterAdvanceProvable = (char: string) => boolean;
