// Paragraph-wide boundary analysis. A formatting, revision, or font-slot seam is
// not a Unicode boundary: segment the visible text once, then map cuts to pieces.
import type { FieldAwarePiece } from './field-projection.ts';
import { segmentGraphemes } from './grapheme.ts';
import { isParagraphText, paragraphBreakText, paragraphWordCuts } from './paragraph-word-cuts.ts';
import { paragraphWordBreaks } from './paragraph-word-breaks.ts';
import {
  CJK_NO_BREAK_AFTER,
  CJK_NO_BREAK_BEFORE,
  isIdeographicForLineBreak,
  lastCodePointOf,
  NO_BREAK_CHARACTER,
  isCombiningMark,
  marksContinue,
  stacksNext,
  wordBoundaries,
  ZERO_WIDTH_SPACE,
  type LineOpenDecision,
} from './cjk-line-break.ts';
import {
  eastAsianLanguage,
  eastAsiaIsKorean,
  kinsokuCharacters,
  koreanFinalMarkHangs,
  type CjkParagraphTypography,
} from './cjk-typography.ts';

export function isHangul(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x11ff) ||
    (cp >= 0x3130 && cp <= 0x318f) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7ff)
  );
}
export const isCjk = (cp: number): boolean => isIdeographicForLineBreak(cp) || isHangul(cp);
export const hasCjkText = (text: string): boolean =>
  /[\u1100-\u11ff\u2e80-\u318f\u31c0-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe30-\ufe4f\uff01-\uff9f\u{20000}-\u{323af}]/u.test(
    text
  );
const isFullwidthAlphanumeric = (cp: number): boolean =>
  (cp >= 0xff10 && cp <= 0xff19) ||
  (cp >= 0xff21 && cp <= 0xff3a) ||
  (cp >= 0xff41 && cp <= 0xff5a);
const isText = isParagraphText;

/**
 * Paragraph-wide break analysis, shared by line placement and the anchor-line probe.
 * `decision` takes the text placed before the candidate and the candidate itself, which the
 * per-piece analysis (`paragraph-word-breaks.ts`) passes to `lineOpenDecisionAt`; the East
 * Asian table ignores them.
 */
export interface CjkParagraphBreaks {
  boundaries(piece: FieldAwarePiece): readonly number[];
  decision(
    piece: FieldAwarePiece,
    offset: number,
    lastEmitted: string,
    candidate: string
  ): LineOpenDecision;
  cutAllowed(piece: FieldAwarePiece, candidateStart: number, index: number): boolean;
}

/** Whether a rule, kinsoku or not, protects the seam: the text on both sides is one group. */
export const protectsSeam = (decision: LineOpenDecision | undefined): boolean =>
  decision === 'forbidden' || decision === 'kinsoku';

/** Whether a protected seam joins the candidate ending at `boundary` to the next piece. */
export function protectedSeamAfter(
  breaks: CjkParagraphBreaks | null,
  pieces: readonly FieldAwarePiece[],
  pieceIndex: number,
  boundary: number,
  candidate: string
): boolean {
  const next = pieces[pieceIndex + 1];
  return (
    boundary === pieces[pieceIndex]!.text.length &&
    next !== undefined &&
    protectsSeam(breaks?.decision(next, 0, candidate, next.text))
  );
}

/** Select the East Asian analysis, rather than the ordinary run-spanning word cuts. */
export function usesEastAsianParagraphBreaks(
  pieces: readonly FieldAwarePiece[],
  policy: CjkParagraphTypography
): boolean {
  return (
    policy.characterWrap ||
    pieces.some(
      (piece) =>
        /[\u1100-\u11ff\u2e80-\ud7ff\uf900-\uffef\u{20000}-\u{323af}]/u.test(piece.text) ||
        eastAsianLanguage(piece.props)
    )
  );
}

export function cjkParagraphBreaks(
  pieces: readonly FieldAwarePiece[],
  policy: CjkParagraphTypography
): CjkParagraphBreaks | null {
  if (!usesEastAsianParagraphBreaks(pieces, policy)) {
    // A run that opens with a dash needs the text before it; any other paragraph without
    // East Asian text has no paragraph-wide analysis.
    const cuts = paragraphWordCuts(pieces);
    return cuts ? paragraphWordBreaks(cuts) : null;
  }
  // Layout-owned atoms form barriers. Their display characters have no one-to-one
  // model mapping and must not become inter-character placement candidates.
  const { text, starts } = paragraphBreakText(pieces);
  const clusters = segmentGraphemes(text);
  const decisions = new Map<number, LineOpenDecision>([
    [0, 'opens'],
    [text.length, 'opens'],
  ]);
  const latinCuts = new Set(wordBoundaries(text, false));
  // Numeric expressions and full-width alphabetic words are units, even when
  // runs split a decimal separator or currency sign from its digits.
  const numeric = new Set<number>();
  const figures =
    /[＄￥￡￦＋－$£¥+\-]?[0-9０-９]+(?:[．，：／.,:/][0-9０-９]+)*(?:[％%‰])?|[Ａ-Ｚａ-ｚ]+/gu;
  for (const match of text.matchAll(figures)) {
    if (!/[０-９Ａ-Ｚａ-ｚ]/u.test(match[0])) continue;
    for (let index = match.index + 1; index < match.index + match[0].length; index++)
      numeric.add(index);
  }
  let pieceIndex = 0;
  let leftPieceIndex = 0;
  const hasKorean = clusters.some((cluster) => isHangul(cluster.text.codePointAt(0)!));
  const detectedLanguage = hasKorean
    ? 'ko-kr'
    : /[\u3040-\u30ff\uff66-\uff9f]/u.test(text)
      ? 'ja-jp'
      : 'zh-cn';
  // Under word wrapping (`w:wordWrap`, ECMA-376 §17.3.1.45), Hangul breaks like a Latin letter,
  // so a Korean word keeps its punctuation, digits, and Latin letters. Ideographs and full-width forms still open East Asian boundaries.
  const opensEastAsian = (cp: number) => isCjk(cp) && (policy.characterWrap || !isHangul(cp));
  // Carry script context through punctuation, but never across a Latin word or space. Kinsoku
  // reads the script (`eastAsianContext`); a break after the punctuation reads `breakContext`.
  const eastAsianContext: boolean[] = [];
  const breakContext: boolean[] = [];
  let context = false;
  let breaking = false;
  for (const cluster of clusters) {
    const cp = cluster.text.codePointAt(0)!;
    if (!/^[\p{P}\p{S}\p{M}]+$/u.test(cluster.text)) {
      context = isCjk(cp);
      breaking = opensEastAsian(cp);
    }
    eastAsianContext.push(context || isCjk(cp));
    breakContext.push(breaking || opensEastAsian(cp));
  }
  const languages = pieces.map((piece) => eastAsianLanguage(piece.props));
  // Korean runs keep Latin words whole under character wrapping (`koreanWordWrap`).
  const koreanRuns = policy.koreanWordWrap
    ? pieces.map((piece) => eastAsiaIsKorean(piece.props))
    : undefined;
  let lastPieceIndex = 0;
  // The paragraph's last cluster before trailing whitespace.
  let lastVisible = clusters.length - 1;
  while (lastVisible > 0 && /^\s+$/u.test(clusters[lastVisible]!.text)) lastVisible--;
  const tables = new Map<string, ReturnType<typeof kinsokuCharacters>>();
  const tableFor = (language: string) => {
    let table = tables.get(language);
    if (!table) {
      table = kinsokuCharacters(language, policy.settings);
      tables.set(language, table);
    }
    return table;
  };
  for (let index = 1; index < clusters.length; index++) {
    const left = clusters[index - 1]!;
    const right = clusters[index]!;
    const at = right.utf16From;
    while (pieceIndex + 1 < pieces.length && starts.get(pieces[pieceIndex + 1]!)! <= at)
      pieceIndex++;
    while (
      leftPieceIndex + 1 < pieces.length &&
      starts.get(pieces[leftPieceIndex + 1]!)! <= left.utf16From
    )
      leftPieceIndex++;
    const before = lastCodePointOf(left.text)!;
    const beforeBase = left.text.codePointAt(0)!;
    const after = right.text.codePointAt(0)!;
    if (/[\t\n\f\ufffc]/u.test(left.text + right.text)) {
      decisions.set(at, 'opens');
      continue;
    }
    // UAX #14 LB7: no break before a zero-width space; the break comes after it. Nor after
    // a Khmer coeng or Myanmar virama before a letter, which it stacks under its base, nor
    // before a combining mark such as a Myanmar spacing vowel.
    if (
      right.text === ZERO_WIDTH_SPACE ||
      stacksNext(before, after) ||
      (isCombiningMark(after) && marksContinue(before))
    ) {
      decisions.set(at, 'forbidden');
      continue;
    }
    // Glue is independent of language and kinsoku. Neither character wrapping
    // nor emergency chopping may separate a non-breaking character's neighbours.
    if (NO_BREAK_CHARACTER.test(left.text + right.text)) {
      decisions.set(at, 'forbidden');
      continue;
    }
    let forbidden = false;
    if (policy.kinsoku) {
      const language =
        languages[pieceIndex] ??
        (policy.settings &&
        (isCjk(after) || (eastAsianContext[index - 1] && /^[\p{P}\p{S}]+$/u.test(right.text)))
          ? detectedLanguage
          : undefined);
      const previousLanguage =
        languages[leftPieceIndex] ??
        (policy.settings &&
        (isCjk(beforeBase) || (isCjk(after) && /^[\p{P}\p{S}]+$/u.test(left.text)))
          ? detectedLanguage
          : undefined);
      if (language || previousLanguage) {
        // Korean overflow punctuation wraps by itself. At the paragraph end only 。 and 、
        // do; any other final mark stays with its character and hangs.
        const koreanOverflowMark =
          language !== undefined &&
          /^ko(?:-|$)/.test(language) &&
          (policy.hangingPunctuation ?? policy.overflowPunctuation) &&
          /^[\p{Pe}\p{Pf}\p{Po}]$/u.test(right.text) &&
          (index < lastVisible ||
            '。、'.includes(right.text) ||
            !koreanFinalMarkHangs(policy.settings));
        forbidden =
          (!koreanOverflowMark &&
            (language
              ? tableFor(language).before.includes(String.fromCodePoint(after))
              : CJK_NO_BREAK_BEFORE.has(after))) ||
          (previousLanguage
            ? tableFor(previousLanguage).after.includes(String.fromCodePoint(before))
            : CJK_NO_BREAK_AFTER.has(before));
      } else {
        forbidden = CJK_NO_BREAK_BEFORE.has(after) || CJK_NO_BREAK_AFTER.has(before);
        // ASCII/scientific punctuation participates only beside East Asian text.
        // A Latin paragraph containing ℃ retains its ordinary word boundaries.
        if (eastAsianContext[index - 1] || isCjk(after)) {
          const inferred = isHangul(before) || isHangul(after) ? 'ko-kr' : 'ja-jp';
          const table = tableFor(inferred);
          forbidden ||=
            (eastAsianContext[index - 1]! && table.before.includes(String.fromCodePoint(after))) ||
            (isCjk(after) && table.after.includes(String.fromCodePoint(before)));
        }
      }
    }
    if (forbidden) {
      decisions.set(at, 'kinsoku');
      continue;
    }
    // Figure/letter groups move as words. Like an oversized Latin word, an
    // extremely long group can still use emergency chopping at safe boundaries.
    if (numeric.has(at)) {
      decisions.set(at, 'continues');
      continue;
    }
    const eastAsian =
      (opensEastAsian(beforeBase) && !isFullwidthAlphanumeric(beforeBase)) ||
      (opensEastAsian(after) && !isFullwidthAlphanumeric(after)) ||
      (breakContext[index - 1]! && /^[\p{P}\p{S}]+$/u.test(left.text));
    // Character wrapping opens every boundary, inside Latin words too, except in Korean text:
    // there, with a Korean paragraph mark and Korean runs on both sides, only Hangul
    // syllables wrap one by one and other words stay whole.
    // The left side is the run holding the boundary's previous code unit: a combining mark in
    // its own run belongs to the left cluster but sets the left run.
    while (lastPieceIndex + 1 < pieces.length && starts.get(pieces[lastPieceIndex + 1]!)! <= at - 1)
      lastPieceIndex++;
    const hangulPair = isHangul(beforeBase) && isHangul(after);
    const wrapCharacters =
      policy.characterWrap &&
      (hangulPair || !(koreanRuns?.[lastPieceIndex] && koreanRuns[pieceIndex]));
    const opens =
      latinCuts.has(at) ||
      /\s$/u.test(left.text) ||
      /^\s/u.test(right.text) ||
      eastAsian ||
      wrapCharacters;
    decisions.set(at, opens ? 'opens' : 'continues');
  }
  const boundaries = new Map<FieldAwarePiece, readonly number[]>();
  for (const piece of pieces) {
    const start = starts.get(piece)!;
    if (!isText(piece)) {
      boundaries.set(piece, wordBoundaries(piece.text, false));
      continue;
    }
    const cuts: number[] = [];
    // Walk each piece once; decisions are O(1), including cluster-interior vetoes.
    for (let offset = 1; offset < piece.text.length; offset++) {
      const decision = decisions.get(start + offset);
      if (decision === 'opens' || (numeric.has(start + offset) && decision === 'continues'))
        cuts.push(offset);
    }
    cuts.push(piece.text.length);
    boundaries.set(piece, cuts);
  }
  return {
    boundaries: (piece) => boundaries.get(piece)!,
    decision: (piece, offset) =>
      !isText(piece) ? 'opens' : (decisions.get(starts.get(piece)! + offset) ?? 'forbidden'),
    // The chop asks only about a group wider than its whole line, which kinsoku cannot hold.
    cutAllowed: (piece, candidateStart, index) =>
      decisions.get(starts.get(piece)! + candidateStart + index) !== 'forbidden' &&
      decisions.has(starts.get(piece)! + candidateStart + index),
  };
}
