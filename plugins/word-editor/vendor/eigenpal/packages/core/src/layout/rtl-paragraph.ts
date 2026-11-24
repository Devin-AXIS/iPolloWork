import { RIGHT_TO_LEFT_LETTER } from './rtl-letter.ts';
import { arabicScriptLanguage } from './arabic-script-language.ts';
import { unchangedLtrLine } from './unchanged-ltr-line.ts';
import { PAGE_BREAK_CHAR, type OoxmlProperty } from '@docx-editor.dev/core/store';
import { coalesceBidiPieces } from './bidi-piece-coalescing.ts';
import { bidiAlgorithm } from './bidi.ts';
import {
  directedEmbeddingLevels,
  hasBidiDirectives,
  hasRtlBidiDirective,
  withCarriedBidiDirectives,
  overrideDirection,
} from './bidi-directives.ts';
import { PICTURE_CHAR } from './line-picture-alignment.ts';
import type { FieldAwarePiece } from './field-pieces.ts';
import { isCollapsibleLineEndWhitespace } from './line-end-whitespace.ts';
import { itemizeScriptFontSlots } from './script-itemization.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';
import { measureDisplayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import { MAX_SHAPING_CONTEXT, type ShapingContext } from './shaped-run.ts';

export function paragraphIsRtl(props: readonly OoxmlProperty[]): boolean {
  let rtl = false;
  for (const prop of props) {
    if (prop.localName === 'bidi') {
      const value = prop.attributes?.val;
      rtl = value === undefined || value === '1' || value === 'true' || value === 'on';
    }
  }
  return rtl;
}

function runIsRtl(props: readonly OoxmlProperty[]): boolean {
  let rtl = false;
  for (const prop of props) {
    if (prop.localName !== 'rtl') continue;
    const value = prop.attributes?.val;
    rtl = value === undefined || value === '1' || value === 'true' || value === 'on';
  }
  return rtl;
}

/** The run-direction group of a piece: its run's, unless a wrapper left open sets one. */
function runGroupIsRtl(piece: FieldAwarePiece): boolean {
  return piece.bidiRunGroup ? piece.bidiRunGroup === 'rtl' : runIsRtl(piece.props);
}

const HAS_BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

/**
 * A slash between ASCII digits. In a right-to-left run of an Arabic-script language it separates
 * the numbers instead of joining them into one, so `17/08/96` reads `96/08/17`. Resolution sees a
 * neutral in its place (UAX #9 class ON instead of CS); the source text does not change. A Hebrew
 * run keeps `852/20` one left-to-right number, as UAX #9 does.
 */
const RTL_RUN_DIGIT_SLASH = /(?<=[0-9])\/(?=[0-9])/gu;
const NEUTRAL_SLASH = '!';

/** Resolve contiguous run-direction groups without changing source text or offsets. */
function runDirectionLevels(pieces: readonly FieldAwarePiece[], text: string, rtl: boolean) {
  // `w:dir` and `w:bdo` wrappers resolve as explicit embeddings and overrides.
  const directed = hasBidiDirectives(pieces);
  const levelsOf = (
    start: number,
    end: number,
    groupText: string,
    direction: 'ltr' | 'rtl',
    rtlRunGroup = false
  ) => {
    if (!directed) return bidiAlgorithm.getEmbeddingLevels(groupText, direction);
    const innermost = pieces[end - 1]?.bidiDirectives?.at(-1);
    const continues = innermost !== undefined && !!pieces[end]?.bidiDirectives?.includes(innermost);
    return directedEmbeddingLevels(pieces.slice(start, end), groupText, direction, {
      rtlRunGroup,
      continues,
    });
  };
  const embedding = levelsOf(0, pieces.length, text, rtl ? 'rtl' : 'ltr');
  // Keep authored Unicode controls on the established full-paragraph UAX #9 path.
  if (HAS_BIDI_CONTROLS.test(text)) return embedding;
  let offset = 0;
  for (let start = 0; start < pieces.length;) {
    const direction = runIsRtl(pieces[start]!.props);
    let end = start;
    let length = 0;
    while (end < pieces.length && runIsRtl(pieces[end]!.props) === direction) {
      length += pieces[end]!.text.length;
      end++;
    }
    const group = text.slice(offset, offset + length);
    const context = levelsOf(
      start,
      end,
      direction && arabicScriptLanguage(pieces[start]!.props)
        ? group.replace(RTL_RUN_DIGIT_SLASH, NEUTRAL_SLASH)
        : group,
      direction ? 'rtl' : 'ltr',
      direction
    );
    embedding.levels.set(context.levels, offset);
    offset += length;
    start = end;
  }
  return embedding;
}

/**
 * Resolve paragraph-wide levels before wrapping; source offsets remain logical.
 *
 * With `pageBreaksIgnored` (a table cell), a page break is laid out as absent, so it is
 * absent for bidi resolution, itemization and joining too; see {@link withoutIgnoredBreaks}.
 */
export function bidiPieces(
  authoredPieces: readonly FieldAwarePiece[],
  rtl: boolean,
  sourceBoundaries?: ReadonlySet<number>,
  pageBreaksIgnored = false
): readonly FieldAwarePiece[] {
  const pieces = withCarriedBidiDirectives(authoredPieces, (piece) => runIsRtl(piece.props));
  // Cached picture slices share an atomic field range, like projected field text.
  // Preserve those slices for line alignment instead of indexing them by a shared offset.
  if (pieces.some((piece) => piece.inlineDrawing && piece.fieldAtom)) return pieces;
  // An inline picture is its U+FFFC in the text, and it gets its own piece back afterwards with
  // the level it resolved to. Its run's own `w:rtl` does not place it; the nearest text with
  // letters or digits on each side does (spaces and other neutral runs are passed over). Between
  // two runs of one direction it takes that direction, and between two directions the
  // paragraph's. With no such text after it, it reads with the text before it; with none before
  // it, it reads in the paragraph's direction.
  const atoms = new Map<number, FieldAwarePiece>();
  const isPicture = (piece: FieldAwarePiece | undefined) =>
    piece?.inlineDrawing !== undefined && piece.text === PICTURE_CHAR;
  const text = pieces.map((piece) => piece.text).join('');
  if (
    !rtl &&
    !RIGHT_TO_LEFT_LETTER.test(text) &&
    !hasRtlBidiDirective(pieces) &&
    !pieces.some((piece) => !isPicture(piece) && runIsRtl(piece.props))
  )
    return pieces;
  const resolvable = pieces.map((piece, index): FieldAwarePiece => {
    // Numeric fields and note marks occupy one model character regardless of display width.
    // Resolve one digit with the same bidi class, then restore the complete atom unchanged.
    if (
      piece.end - piece.start === 1 &&
      (piece.noteNav || (piece.fieldAtom && !piece.fieldAtom.formControl)) &&
      /^[0-9]+$/u.test(piece.text)
    ) {
      atoms.set(piece.start, piece);
      const { projected: _projected, measureText: _measureText, ...plain } = piece;
      return { ...plain, text: piece.text[0]! };
    }
    // Any other opaque one-unit atom (an anchored drawing's placeholder, a `w:sym` glyph, an
    // equation, a projected mark) resolves as the object replacement character, which is a
    // neutral (UAX #9 class ON): the text around it keeps its own order and joining, and the
    // atom takes the level of its neighbours. One such atom once dropped the whole paragraph
    // back to left-to-right order with unjoined letters.
    if (!isPicture(piece)) {
      if (!isOpaqueUnit(piece)) return piece;
      atoms.set(piece.start, piece);
      const {
        projected: _projected,
        measureText: _measureText,
        equation: _equation,
        anchoredAtom: _anchored,
        inlineDrawing: _drawing,
        ...plain
      } = piece;
      return { ...plain, text: OBJECT_CHAR };
    }
    atoms.set(piece.start, piece);
    const { projected: _projected, inlineDrawing: _picture, ...plain } = piece;
    const side = (step: number) => {
      let at = index + step;
      while (pieces[at] && (isPicture(pieces[at]) || !STRONG_TEXT.test(pieces[at]!.text)))
        at += step;
      return pieces[at] ? runIsRtl(pieces[at]!.props) : undefined;
    };
    const before = side(-1);
    const after = side(1);
    // Inside a `w:bdo` override the override gives the picture its level. It keeps its own
    // run's direction group, so it reverses in one sequence with the text around it.
    const direction =
      overrideDirection(piece) !== undefined
        ? runIsRtl(piece.props)
        : after === undefined
          ? (before ?? rtl)
          : before === undefined
            ? rtl
            : before === after
              ? before
              : rtl;
    const props = piece.props.filter((prop) => prop.localName !== 'rtl');
    return { ...plain, props: direction ? [...props, { localName: 'rtl' }] : props };
  });
  // Atom placement has separate advances and is not an ordinary text run. A tab is: it is a
  // segment separator (UAX #9 class S), so it takes the paragraph level below and the text
  // on each side of it resolves as usual. Bailing out on tabs left every tab-aligned RTL form
  // label unshaped and in left-to-right order.
  if (
    resolvable.some(
      (p) =>
        !isZeroWidthOpaque(p) &&
        ((!isOptionalHyphenPiece(p) && p.projected) ||
          p.inlineDrawing ||
          p.equation ||
          p.positionalTab ||
          (!isOptionalHyphenPiece(p) && p.measureText !== undefined) ||
          p.end - p.start !== p.text.length)
    )
  )
    return pieces;
  const ignored = pageBreaksIgnored && resolvable.some(isPageBreak);
  // An optional hyphen is resolved like an ignored break: absent, then at a neighbour's level.
  // So is zero-width opaque content, which holds no model offset to resolve.
  const neutral = (piece: FieldAwarePiece | undefined) =>
    (ignored && isPageBreak(piece)) || isOptionalHyphenPiece(piece) || isZeroWidthOpaque(piece);
  const items = resolvable.some(neutral)
    ? withoutIgnoredBreaks(resolvable, rtl, sourceBoundaries, neutral)
    : resolvedItems(resolvable, rtl, sourceBoundaries);
  return items ? withAtoms(withJoiningContext(items, ignored), atoms) : pieces;
}

/** Restore each atom's full display text, source range, and metadata at its resolved level. */
function withAtoms(
  items: FieldAwarePiece[],
  atoms: ReadonlyMap<number, FieldAwarePiece>
): FieldAwarePiece[] {
  if (atoms.size === 0) return items;
  const starts = [...atoms.keys()].sort((left, right) => left - right);
  const result: FieldAwarePiece[] = [];
  for (const item of items) {
    let from = item.start;
    const keep = (to: number) => {
      if (to <= from) return;
      const text = item.text.slice(from - item.start, to - item.start);
      result.push({ ...item, text, start: from, end: to });
    };
    // Source items remain logical, but a binary search also handles omitted source ranges.
    // Do not rescan every preceding atom for each script item in a long paragraph.
    let low = 0;
    let high = starts.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (starts[middle]! < item.start) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < starts.length && starts[index]! < item.end; index++) {
      const at = starts[index]!;
      const atom = atoms.get(at)!;
      keep(at);
      result.push({ ...atom, style: { ...atom.style, shaping: item.style.shaping } });
      from = at + 1;
    }
    keep(item.end);
  }
  return result;
}

const isPageBreak = (piece: FieldAwarePiece | undefined) => piece?.text === PAGE_BREAK_CHAR;

/** U+FFFC OBJECT REPLACEMENT CHARACTER, a bidi neutral that stands in for an opaque atom. */
const OBJECT_CHAR = '\uFFFC';

/**
 * A one-unit piece whose displayed text or advance is not its model text: an anchored
 * drawing's placeholder, a `w:sym` glyph, an equation, or a projected mark. Inline pictures,
 * numeric marks, and optional hyphens have their own resolution and are not included.
 */
function isOpaqueUnit(piece: FieldAwarePiece): boolean {
  if (piece.end - piece.start !== 1 || piece.positionalTab || isOptionalHyphenPiece(piece))
    return false;
  if (piece.inlineDrawing && !piece.anchoredAtom) return false;
  return (
    piece.projected === true ||
    piece.anchoredAtom === true ||
    piece.equation !== undefined ||
    piece.measureText !== undefined ||
    piece.text.length !== 1
  );
}

/** Opaque content with no model offset, such as an unsupported element's placeholder. */
const isZeroWidthOpaque = (piece: FieldAwarePiece | undefined) =>
  piece !== undefined &&
  piece.start === piece.end &&
  piece.unsupported !== undefined &&
  !piece.positionalTab;
/** A `w:softHyphen`: one model character laid out as U+00AD with no advance. */
const isOptionalHyphenPiece = (piece: FieldAwarePiece | undefined) =>
  piece?.text === '\u00ad' && piece.measureText === '' && piece.end - piece.start === 1;

/** Text that decides a neighbouring picture's direction: any letter or digit. */
const STRONG_TEXT = /[\p{L}\p{N}]/u;

/**
 * Resolve the pieces as though every page break were absent, then put the breaks back.
 *
 * Inside a table cell a page break has no geometry, so the text on its two sides must read as
 * the text without it. As a whitespace character (UAX #9 class WS) it split a number into
 * two digit groups that reordered separately, and took a level of its own that displaced a
 * tab. Here it acts as UAX #9 X9 treats a boundary neutral (BN): it is removed before
 * resolution, and then takes the level of a logical neighbour. The source pieces on its two
 * sides coalesce and itemize as one, so a shaped item the break falls inside is split at the
 * break into halves with one style. Every piece keeps its authored source offsets.
 */
function withoutIgnoredBreaks(
  pieces: readonly FieldAwarePiece[],
  rtl: boolean,
  sourceBoundaries: ReadonlySet<number> | undefined,
  isNeutral: (piece: FieldAwarePiece | undefined) => boolean
): FieldAwarePiece[] | null {
  // Each break is one UTF-16 unit or none (zero-width opaque content; the caller refuses
  // other pieces whose text and range differ). `at` is where it sits in the offsets without
  // breaks, and `shift` is the units removed before it.
  const breaks: { piece: FieldAwarePiece; at: number; shift: number }[] = [];
  const kept: FieldAwarePiece[] = [];
  let removed = 0;
  for (const piece of pieces) {
    if (isNeutral(piece)) {
      breaks.push({ piece, at: piece.start - removed, shift: removed });
      removed += piece.end - piece.start;
    } else
      kept.push(
        removed ? { ...piece, start: piece.start - removed, end: piece.end - removed } : piece
      );
  }
  // The units removed before a source offset. The breaks are in source order, so this is a
  // binary search. A scan per boundary was quadratic in merged-paragraph members that each
  // end with a break.
  const unitsBefore = (boundary: number) => {
    let low = 0;
    let high = breaks.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (breaks[mid]!.piece.start < boundary) low = mid + 1;
      else high = mid;
    }
    const last = breaks[low - 1];
    return last ? last.shift + last.piece.end - last.piece.start : 0;
  };
  const boundaries = sourceBoundaries
    ? new Set([...sourceBoundaries].map((boundary) => boundary - unitsBefore(boundary)))
    : undefined;
  const items = resolvedItems(kept, rtl, boundaries);
  if (!items) return null;
  const result: FieldAwarePiece[] = [];
  let next = 0;
  // The units of the breaks already placed, which is the shift back to source offsets.
  let placed = 0;
  const placeBreaks = (at: number) => {
    for (; next < breaks.length && breaks[next]!.at <= at; next++) {
      const piece = breaks[next]!.piece;
      result.push(piece);
      placed += piece.end - piece.start;
    }
  };
  for (const item of items) {
    placeBreaks(item.start);
    let from = item.start;
    const slice = (to: number) => {
      result.push({
        ...item,
        text: item.text.slice(from - item.start, to - item.start),
        start: from + placed,
        end: to + placed,
      });
      from = to;
    };
    while (next < breaks.length && breaks[next]!.at < item.end) {
      slice(breaks[next]!.at);
      placeBreaks(from);
    }
    slice(item.end);
  }
  placeBreaks(Infinity);
  // The level of the logical neighbour: the following text, else (trailing breaks) the last
  // text. A caret at an offset sits on the span that starts there, so a break placed at the
  // leading edge of the text after it keeps each caret where the text without it puts it.
  let neighbour: FieldAwarePiece | undefined;
  for (const piece of result) if (!isNeutral(piece)) neighbour = piece;
  for (let index = result.length - 1; index >= 0; index--) {
    const piece = result[index]!;
    if (!isNeutral(piece)) {
      neighbour = piece;
      continue;
    }
    const shaping = neighbour?.style.shaping;
    const level = shaping?.level ?? (rtl ? 1 : 0);
    const runDirection = neighbour
      ? shaping?.runDirection
      : runIsRtl(piece.props)
        ? ('rtl' as const)
        : ('ltr' as const);
    result[index] = {
      ...piece,
      style: {
        ...piece.style,
        shaping: {
          script: 'Zyyy',
          direction: level % 2 ? ('rtl' as const) : ('ltr' as const),
          level,
          baseLevel: rtl ? 1 : 0,
          ...(runDirection ? { runDirection } : {}),
        },
      },
    };
  }
  return result;
}

/** Levels, script items and shaping styles for pieces that bidi resolution accepts. */
function resolvedItems(
  pieces: readonly FieldAwarePiece[],
  rtl: boolean,
  sourceBoundaries: ReadonlySet<number> | undefined
): FieldAwarePiece[] | null {
  const text = pieces.map((piece) => piece.text).join('');
  // Contiguous runs with the same w:rtl state share one directional context.
  // Unmarked runs use LTR context; strong Arabic and Arabic-Indic digits retain
  // their Unicode classes inside it. Paragraph bidi still controls outer layout.
  const embedding = runDirectionLevels(pieces, text, rtl);
  const usesRunGroups = !HAS_BIDI_CONTROLS.test(text);
  const result: FieldAwarePiece[] = [];
  let offset = 0;
  for (const piece of coalesceBidiPieces(pieces, sourceBoundaries)) {
    let items;
    try {
      items = itemizeScriptFontSlots(piece.text, offset, embedding);
    } catch {
      return null;
    }
    for (const item of items) {
      // UAX #9 L1: a segment separator is reset to the paragraph embedding level.
      const separator = /^\t+$/u.test(piece.text.slice(item.from, item.to));
      const level = separator ? (rtl ? 1 : 0) : item.bidiLevel;
      const override = separator ? undefined : overrideDirection(piece);
      const style = {
        ...piece.style,
        shaping: {
          script: item.script,
          direction: separator ? (rtl ? ('rtl' as const) : ('ltr' as const)) : item.direction,
          level,
          baseLevel: rtl ? 1 : 0,
          ...(override ? { override } : {}),
          ...(usesRunGroups && piece.bidiRunGroup ? { wrapperGroup: true as const } : {}),
          ...(usesRunGroups
            ? {
                runDirection: runGroupIsRtl(piece) ? ('rtl' as const) : ('ltr' as const),
              }
            : {}),
        },
      };
      result.push({
        ...piece,
        text: piece.text.slice(item.from, item.to),
        start: piece.start + item.from,
        end: piece.start + item.to,
        style,
      });
    }
    offset += piece.text.length;
  }
  return result;
}

/** Scripts whose letters change form with their neighbours (Unicode joining types). */
const JOINING_SCRIPTS: ReadonlySet<string> = new Set([
  'Adlm',
  'Arab',
  'Mand',
  'Mong',
  'Nkoo',
  'Phag',
  'Rohg',
  'Syrc',
]);

/**
 * Give each joining-script piece the neighbouring text it joins with.
 *
 * A word split into two formatting runs (a colour change mid-word) is shaped as two pieces,
 * and each half drew its boundary letter in an isolated or final form. HarfBuzz joins across
 * the split when each half sees the other's letters as context. The context reaches the
 * measurer and the exporters through the style, so width and paint shape the same way.
 *
 * Bounded: only adjacent pieces at the same bidi level, only for joining scripts, only when
 * no whitespace sits at the boundary, and at most {@link MAX_SHAPING_CONTEXT} units on each
 * side. Only the edge word carries the outside context. Line breaks come later; a word does
 * not break mid-word, so a boundary inside one keeps both halves on one line. Context changes
 * glyph forms only: a kern or cursive offset between the two halves is not applied.
 *
 * With `breaksIgnored`, a page break between two pieces is absent: the pieces on its two
 * sides join as they would without it.
 */
function withJoiningContext(pieces: FieldAwarePiece[], breaksIgnored: boolean): FieldAwarePiece[] {
  if (!pieces.some((piece) => JOINING_SCRIPTS.has(piece.style.shaping?.script ?? ''))) {
    return pieces;
  }
  const levelOf = (piece: FieldAwarePiece | undefined) => piece?.style.shaping?.level;
  // Optional hyphens stepped over on the way to a neighbour, kept in the context as U+00AD:
  // the shaper treats it as transparent, so letters join across it inside a line, and a line
  // that breaks there trims it with the context beyond (`trimJoiningAtHyphen`).
  let hyphens = '';
  // The adjacent piece in `step` direction, stepping over contiguous ignored breaks and
  // optional hyphens.
  const neighbourOf = (index: number, step: -1 | 1) => {
    let at = index + step;
    let edge = step < 0 ? pieces[index]!.start : pieces[index]!.end;
    hyphens = '';
    for (
      ;
      (breaksIgnored && isPageBreak(pieces[at])) || isOptionalHyphenPiece(pieces[at]);
      at += step
    ) {
      const next = pieces[at]!;
      if ((step < 0 ? next.end : next.start) !== edge) return undefined;
      edge = step < 0 ? next.start : next.end;
      if (isOptionalHyphenPiece(next)) hyphens += next.text;
    }
    const neighbour = pieces[at];
    return neighbour && (step < 0 ? neighbour.end : neighbour.start) === edge
      ? neighbour
      : undefined;
  };
  const result: FieldAwarePiece[] = [];
  pieces.forEach((piece, index) => {
    const shaping = piece.style.shaping;
    if (!shaping || !JOINING_SCRIPTS.has(shaping.script)) {
      result.push(piece);
      return;
    }
    const previous = neighbourOf(index, -1);
    const hyphensBefore = hyphens;
    const next = neighbourOf(index, 1);
    const hyphensAfter = hyphens;
    // Nothing joins across whitespace, so a boundary with a space on either side needs none.
    const before =
      previous &&
      levelOf(previous) === shaping.level &&
      !BREAKS_JOINING.test(previous.text.slice(-1)) &&
      !BREAKS_JOINING.test(piece.text.slice(0, 1))
        ? (previous.text + hyphensBefore).slice(-MAX_SHAPING_CONTEXT)
        : '';
    const after =
      next &&
      levelOf(next) === shaping.level &&
      !BREAKS_JOINING.test(piece.text.slice(-1)) &&
      !BREAKS_JOINING.test(next.text.slice(0, 1))
        ? (hyphensAfter + next.text).slice(0, MAX_SHAPING_CONTEXT)
        : '';
    if (!before && !after) {
      result.push(piece);
      return;
    }
    // The outside context belongs to the edge WORD only. Every slice layout measures and
    // every span paint shapes inherits its piece's style, so a piece-wide context made the
    // later words of the piece shape as if joined to the neighbour run. The piece is split at
    // its first and last whitespace; the pieces between keep the plain style. A literal piece
    // splits freely: piece boundaries are not break opportunities.
    const text = piece.text;
    const slice = (from: number, to: number, context?: ShapingContext): void => {
      if (to <= from) return;
      result.push({
        ...piece,
        text: text.slice(from, to),
        start: piece.start + from,
        end: piece.start + to,
        style: context ? { ...piece.style, shaping: { ...shaping, context } } : piece.style,
      });
    };
    const first = text.search(BREAKS_JOINING);
    if (first === -1) {
      // One word: it reads both sides.
      slice(0, text.length, { before, after });
      return;
    }
    let last = text.length - 1;
    while (!BREAKS_JOINING.test(text[last]!)) last--;
    // Inside the piece, each edge word reads its real neighbours, which start or end with
    // the whitespace that stops the join.
    const head = before ? first : 0;
    const tail = after ? last + 1 : text.length;
    if (before) slice(0, head, { before, after: text.slice(head, head + MAX_SHAPING_CONTEXT) });
    slice(head, tail);
    if (after)
      slice(tail, text.length, {
        before: text.slice(Math.max(0, tail - MAX_SHAPING_CONTEXT), tail),
        after,
      });
  });
  return result;
}

/** Characters no joining script joins across. */
const BREAKS_JOINING = /\s/u;

/**
 * Where the line-end whitespace that UAX #9 L1 resets to the paragraph level starts in
 * `spans[start, end)`. With `pageBreaksIgnored`, page breaks directly after visible text are
 * not line-end whitespace when only breaks follow them: without the breaks that text ends the
 * line, so the breaks keep its level and stay beside it. When whitespace follows the breaks,
 * that whitespace starts at the break offset without them, so the breaks reset with it.
 */
function lineEndWhitespaceStart(
  spans: readonly StyleSpanRecord[],
  start: number,
  end: number,
  pageBreaksIgnored: boolean
): number {
  let trailing = end;
  while (
    trailing > start &&
    Array.from(spans[trailing - 1]!.text).every((character) =>
      ['WS', 'B', 'S'].includes(bidiAlgorithm.getBidiCharTypeName(character))
    )
  )
    trailing--;
  if (!pageBreaksIgnored || trailing === start) return trailing;
  let skipped = trailing;
  while (skipped < end && spans[skipped]!.text === PAGE_BREAK_CHAR) skipped++;
  return skipped === end ? skipped : trailing;
}

function bidiOrder(
  spans: readonly StyleSpanRecord[],
  levels: number[],
  start: number,
  end: number,
  rtl: boolean,
  pageBreaksIgnored: boolean,
  spacesKeepLevel = false
): number[] {
  for (
    let index = lineEndWhitespaceStart(spans, start, end, pageBreaksIgnored);
    index < end;
    index++
  ) {
    if (spacesKeepLevel && isCollapsibleLineEndWhitespace(spans[index]!.text)) continue;
    levels[index] =
      spacesKeepLevel && index > start && breakAfterSpaces(spans, index)
        ? levels[index - 1]!
        : rtl
          ? 1
          : 0;
  }
  return visualOrderOfLevels(levels, start, end);
}

/** Whether `spans[index]` is a zero-width line or page break after line-end spaces. */
function breakAfterSpaces(spans: readonly StyleSpanRecord[], index: number): boolean {
  let before = index;
  while (
    before > 0 &&
    spans[before]!.box.width === 0 &&
    (spans[before]!.text === '\n' || spans[before]!.text === PAGE_BREAK_CHAR)
  )
    before--;
  return before < index && isCollapsibleLineEndWhitespace(spans[before]!.text);
}

/** UAX #9 L2 over `levels[start, end)`: the source indices in visual (left-to-right) order. */
export function visualOrderOfLevels(
  levels: readonly number[],
  start = 0,
  end = levels.length
): number[] {
  const order = Array.from({ length: end - start }, (_, index) => start + index);
  let maximum = 0;
  let lowestOdd = Infinity;
  for (let index = start; index < end; index++) {
    maximum = Math.max(maximum, levels[index]!);
    if (levels[index]! % 2) lowestOdd = Math.min(lowestOdd, levels[index]!);
  }
  for (let level = maximum; level >= lowestOdd; level--) {
    for (let i = 0; i < order.length;) {
      if (levels[order[i]!]! < level) {
        i++;
        continue;
      }
      let end = i + 1;
      while (end < order.length && levels[order[end]!]! >= level) end++;
      for (let left = i, right = end - 1; left < right; left++, right--)
        [order[left], order[right]] = [order[right]!, order[left]!];
      i = end;
    }
  }
  return order;
}

/** UAX #9 L1/L2 at the line boundary. Keep the array in source order for selection. */
export function reorderBidiSpans(
  spans: readonly StyleSpanRecord[],
  paragraphRtl = spans.some((span) => span.style.shaping?.baseLevel === 1),
  pageBreaksIgnored = false
): readonly StyleSpanRecord[] {
  if (!paragraphRtl && unchangedLtrLine(spans)) return spans;
  if (!spans.some((s) => s.style.shaping)) return spans;
  // Exclusion passages have fixed physical gaps. Reorder only within each passage.
  if (spans.some((span, index) => index > 0 && (span.wrapAdvanceBefore ?? 0) > 0)) {
    const result: StyleSpanRecord[] = [];
    let start = 0;
    for (let end = 1; end <= spans.length; end++) {
      if (end < spans.length && !(spans[end]!.wrapAdvanceBefore! > 0)) continue;
      for (const span of reorderBidiSpans(spans.slice(start, end), paragraphRtl, pageBreaksIgnored))
        result.push(span);
      start = end;
    }
    return result;
  }
  const levels = spans.map((s) => s.style.shaping?.level ?? 0);
  const order: number[] = [];
  if (!spans.every((span) => span.style.shaping?.runDirection !== undefined)) {
    for (const index of bidiOrder(spans, levels, 0, spans.length, paragraphRtl, pageBreaksIgnored))
      order.push(index);
  } else {
    // L1 puts line-ending tabs and breaks back in the paragraph context, outside the
    // run-direction group whose visible text precedes them. Line-ending spaces keep their
    // run's group and their resolved level, so they stay beside the text they follow.
    const trailing = lineEndWhitespaceStart(spans, 0, spans.length, pageBreaksIgnored);
    const directionAt = (index: number): boolean => {
      // A break after the spaces stays beside them, so the caret before it does too.
      if (index >= trailing && breakAfterSpaces(spans, index)) return directionAt(index - 1);
      return index >= trailing &&
        !isCollapsibleLineEndWhitespace(spans[index]!.text) &&
        // An ignored page break is absent: it keeps the direction of the text beside it.
        !(pageBreaksIgnored && spans[index]!.text === PAGE_BREAK_CHAR)
        ? paragraphRtl
        : spans[index]!.style.shaping?.runDirection === 'rtl';
    };
    const groups: Array<{ start: number; end: number; rtl: boolean }> = [];
    for (let start = 0; start < spans.length;) {
      const direction = directionAt(start);
      let end = start + 1;
      while (end < spans.length && directionAt(end) === direction) end++;
      groups.push({ start, end, rtl: direction });
      start = end;
    }
    // Word places direction groups in paragraph order, then resolves each group's
    // internal Unicode order. A numeric LTR group remains intact beside an RTL run.
    if (paragraphRtl) groups.reverse();
    for (const group of groups) {
      for (const index of bidiOrder(
        spans,
        levels,
        group.start,
        group.end,
        group.rtl,
        pageBreaksIgnored,
        true
      ))
        order.push(index);
    }
  }
  const result = [...spans];
  let x = spans.reduce((min, s) => Math.min(min, s.box.x), Infinity);
  const advances = spans.map(
    (s, i) =>
      s.box.width +
      Math.max(0, (spans[i + 1]?.box.x ?? s.box.x + s.box.width) - s.box.x - s.box.width)
  );
  for (const index of order) {
    const span = spans[index]!;
    const direction = levels[index]! % 2 ? 'rtl' : 'ltr';
    const gap = advances[index]! - span.box.width;
    const spaces = span.text.split(' ').length - 1;
    const wordSpacingPt = spaces > 0 ? gap / spaces : 0;
    result[index] = {
      ...span,
      style: span.style.shaping
        ? {
            ...span.style,
            shaping: {
              ...span.style.shaping,
              direction,
              ...(wordSpacingPt > 0
                ? { wordSpacingPt: (span.style.shaping.wordSpacingPt ?? 0) + wordSpacingPt }
                : {}),
            },
          }
        : span.style,
      box: { ...span.box, x, width: advances[index]! },
    };
    x += advances[index]!;
  }
  return result;
}

export function nearestBidiSpan(
  spans: readonly StyleSpanRecord[],
  x: number
): StyleSpanRecord | null {
  if (!spans.some((span) => span.style.shaping !== undefined)) return null;
  let chosen: StyleSpanRecord | null = null;
  let distance = Infinity;
  for (const span of spans) {
    const gap = Math.max(span.box.x - x, x - span.box.x - span.box.width, 0);
    if (gap < distance) {
      chosen = span;
      distance = gap;
    }
  }
  return chosen;
}

/** Split only after wrapping, so nonbreaking spaces cannot create new break opportunities. */
export function splitBidiTrailingWhitespace(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer
): readonly StyleSpanRecord[] {
  if (!spans.some((span) => span.style.shaping)) return spans;
  for (let index = spans.length - 1; index >= 0; index--) {
    const span = spans[index]!;
    let from = span.text.length;
    while (
      from > 0 &&
      ['WS', 'B', 'S'].includes(bidiAlgorithm.getBidiCharTypeName(span.text[from - 1]!))
    )
      from--;
    if (from === 0) continue;
    if (from === span.text.length) return spans;
    const tail = span.text.slice(from);
    const width = Math.min(
      span.box.width,
      measureDisplayText(tail, styleForFontSlot(span.style, span.fontSlot), measurer)
    );
    const textSpan = {
      ...span,
      text: span.text.slice(0, from),
      range: { ...span.range, end: span.range.start + from },
      box: { ...span.box, width: span.box.width - width },
    };
    // The tail sits right after the text, so a float's jump stays on the text piece only.
    const { wrapAdvanceBefore: _jump, ...rest } = span;
    const tailSpan = {
      ...rest,
      text: tail,
      range: { ...span.range, start: span.range.start + from },
      box: { ...span.box, x: span.box.x + span.box.width - width, width },
    };
    return [...spans.slice(0, index), textSpan, tailSpan, ...spans.slice(index + 1)];
  }
  return spans;
}
