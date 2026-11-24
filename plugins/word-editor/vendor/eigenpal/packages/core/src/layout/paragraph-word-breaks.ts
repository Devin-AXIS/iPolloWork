// Break analysis for a paragraph without East Asian text whose word boundaries need the
// paragraph text (`paragraph-word-cuts.ts`): a run that opens with a dash.
//
// It is the ordinary per-piece analysis with those boundaries. Seams keep
// `lineOpenDecisionAt`, so fields, pictures, punctuation, no-break spaces, and combining
// marks keep the rules every other paragraph uses.

import { cjkChopCutAllowedAt, lineOpenDecisionAt } from './cjk-line-break.ts';
import type { CjkParagraphBreaks } from './cjk-paragraph-breaks.ts';
import type { ParagraphWordCuts } from './paragraph-word-cuts.ts';

export function paragraphWordBreaks(cuts: ParagraphWordCuts): CjkParagraphBreaks {
  return {
    boundaries: (piece) => cuts.boundaries(piece),
    decision: (_piece, offset, lastEmitted, candidate) =>
      lineOpenDecisionAt(lastEmitted, candidate, offset > 0),
    cutAllowed(piece, candidateStart, index) {
      // The chop asks about one candidate: from its start to the next boundary.
      const end = cuts.boundaries(piece).find((boundary) => boundary > candidateStart);
      return cjkChopCutAllowedAt(piece.text.slice(candidateStart, end), index);
    },
  };
}
