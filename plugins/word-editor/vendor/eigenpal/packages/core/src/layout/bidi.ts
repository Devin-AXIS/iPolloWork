import bidiFactory from 'bidi-js';

/**
 * UAX #9 embedding levels, one per UTF-16 code unit, plus the paragraph ranges they were resolved
 * within.
 *
 * The level is EXACT, not a direction: its parity gives direction, but the numeric value is what
 * reordering needs, and collapsing it early loses nested isolates.
 */
export interface BidiEmbeddingLevels {
  readonly levels: Uint8Array;
  readonly paragraphs: readonly {
    readonly start: number;
    readonly end: number;
    readonly level: number;
  }[];
}

/** Pinned Unicode Bidirectional Algorithm implementation used for paragraph policy. */
export const bidiAlgorithm = bidiFactory();
