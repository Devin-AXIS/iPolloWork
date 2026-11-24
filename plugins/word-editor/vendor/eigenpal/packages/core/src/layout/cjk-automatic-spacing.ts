import { authoredCjkGapMetric } from './cjk-auto-spacing-metric-port.ts';
import { knownFamilyReverseGap } from './authored-average-widths.ts';
import type { TextMeasurer } from './text-measurer.ts';
// OOXML inter-script advances. Source text and UTF-16 model offsets never change.
// autoSpaceDN/DE inherit through the ordinary paragraph cascade and default to true.
import type { CjkParagraphTypography } from './cjk-typography.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import type { FieldAwarePiece } from './field-pieces.ts';
import type { StyleSpanRecord } from './semantic-records.ts';
import { styleForFontSlot } from './script-itemization.ts';
import { paragraphSpanMetadata } from './paragraph-span-metadata.ts';
import { balancedSpaceWidth, widenBalancedSpaces } from './balanced-space-widths.ts';

interface TextBoundary {
  readonly text: string;
  readonly style: ResolvedRunStyle;
  readonly projected?: boolean;
  readonly equation?: unknown;
  readonly fieldAtom?: unknown;
  readonly positionalTab?: unknown;
  readonly inlineDrawing?: unknown;
  readonly measureText?: string;
  readonly noteNav?: unknown;
  readonly noteSeparator?: unknown;
}

const automaticBefore = Symbol('automatic-inter-script-advance');
type Spaced = { readonly [automaticBefore]?: { readonly gap: number; readonly start: number } };

/** Enumerable metadata survives copies; only the original start owns the advance. */
export function withAutomaticTextSpacing<T extends { readonly range: { readonly start: number } }>(
  value: T,
  gap: number
): T {
  // A zero advance has no layout state. Do not mark unrelated text spans.
  if (gap === 0) {
    if (!(automaticBefore in value)) return value;
    const result = { ...value };
    delete (result as { [automaticBefore]?: unknown })[automaticBefore];
    return result;
  }
  return { ...value, [automaticBefore]: { gap, start: value.range.start } };
}

export function automaticTextSpacingBefore(value: {
  readonly range: { readonly start: number };
}): number {
  const marker = (value as Spaced)[automaticBefore];
  return marker?.start === value.range.start ? marker.gap : 0;
}

function ordinaryText(item: TextBoundary): boolean {
  const style = item.style;
  return (
    !item.projected &&
    !item.equation &&
    !item.fieldAtom &&
    !item.positionalTab &&
    !item.inlineDrawing &&
    item.measureText === undefined &&
    !item.noteNav &&
    !item.noteSeparator &&
    !style.latinLane &&
    style.shaping?.direction !== 'rtl' &&
    style.characterSpacingPt === 0 &&
    style.horizontalScalePercent === 100 &&
    style.verticalAlign === 'baseline' &&
    style.baselineShiftPt === 0
  );
}

type Script = 'eastAsian' | 'latin' | 'number' | null;
function script(character: string): Script {
  const cp = character.codePointAt(0);
  if (cp === undefined || (cp >= 0xff00 && cp <= 0xffef)) return null;
  if (/^[0-9]$/u.test(character)) return 'number';
  if (/^\p{Script=Latin}$/u.test(character)) return 'latin';
  return /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\p{Script=Yi}]$/u.test(
    character
  )
    ? 'eastAsian'
    : null;
}

function lastBase(text: string): string {
  // Preserve combining marks. They neither introduce a boundary nor orphan a base.
  let end = text.length;
  while (end > 0) {
    const tail = text.charCodeAt(end - 1);
    const start = tail >= 0xdc00 && tail <= 0xdfff && end > 1 ? end - 2 : end - 1;
    const character = text.slice(start, end);
    if (!/^\p{M}$/u.test(character)) return character;
    end = start;
  }
  return '';
}

/**
 * False when neither side of a boundary can be East Asian, read from code units alone. Every
 * East Asian script this module spaces lies at U+1100 or above, and no combining mark lies
 * below U+0300, so a last unit below U+0300 is its own base. Empty text stays undecided.
 */
function boundaryMayBeEastAsian(before: string, after: string): boolean {
  return !(before.charCodeAt(before.length - 1) < 0x0300 && after.charCodeAt(0) < 0x1100);
}

/** A same-line boundary advance; callers omit it after a break or an exclusion jump. */
export function automaticTextGap(
  before: TextBoundary,
  after: TextBoundary,
  policy: CjkParagraphTypography,
  measurer?: TextMeasurer
): number {
  if (!boundaryMayBeEastAsian(before.text, after.text)) return 0;
  if (!ordinaryText(before) || !ordinaryText(after)) return 0;
  const left = script(lastBase(before.text));
  const right = script(String.fromCodePoint(after.text.codePointAt(0) ?? 0));
  if (left !== 'eastAsian' && right !== 'eastAsian') return 0;
  const other = left === 'eastAsian' ? right : left;
  if (
    other === 'number'
      ? policy.autoSpaceDN === false
      : other === 'latin'
        ? policy.autoSpaceDE === false
        : true
  )
    return 0;
  const eastAsianSide = left === 'eastAsian' ? before.style : after.style;
  if (policy.automaticSpacingNeedsEastAsianFont && eastAsianSide.eastAsianFontAuthored !== true)
    return 0;
  if (left === 'eastAsian') {
    const size = before.style.fontSizePt;
    return Number.isFinite(size) && size > 0 ? size / 4 : 0;
  }
  // Only the authored Latin/digit face owns the reverse boundary metric. An absent authored
  // face cannot borrow a substitute file's average width; a known family uses its recorded one.
  // Balanced widths make it half the balanced space width: a quarter em beside an East Asian face.
  const gap =
    policy.settings?.balancedWidths === true
      ? (balancedSpaceWidth(before.style, measurer) ?? NaN) / 2
      : (authoredCjkGapMetric(measurer, before.style) ?? knownFamilyReverseGap(before.style));
  return gap !== undefined && Number.isFinite(gap) && gap >= 0 && gap <= before.style.fontSizePt
    ? gap
    : 0;
}

interface SourceTextBoundary extends TextBoundary {
  readonly start: number;
  readonly end: number;
}

/** Price inter-script advances without splitting or reshaping a source word. */
export function automaticTextSpacingAdvance(
  before: SourceTextBoundary | undefined,
  current: SourceTextBoundary,
  policy: CjkParagraphTypography,
  measurer?: TextMeasurer
): number {
  let gap = before?.end === current.start ? automaticTextGap(before, current, policy, measurer) : 0;
  let previousBase = '';
  for (const character of current.text) {
    gap += automaticTextGap(
      { ...current, text: previousBase },
      { ...current, text: character },
      policy,
      measurer
    );
    if (!/^\p{M}$/u.test(character)) previousBase = character;
  }
  return gap;
}

const EAST_ASIAN_TEXT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\p{Script=Yi}]/u;
const LATIN_OR_DIGIT_TEXT = /[0-9\p{Script=Latin}]/u;

/**
 * Split literal pieces where an automatic advance falls inside them. Line layout prices an
 * advance only at a span seam, so text that cannot break between its East Asian and Latin
 * sides (one font, kinsoku before small kana) would otherwise draw without the advance that
 * table AutoFit counts. Spaces at the balanced width become pieces of their own first
 * ({@link widenBalancedSpaces}). Pieces with no such boundary are returned as they are.
 */
export function splitAtAutomaticSpacing(
  source: FieldAwarePiece[],
  policy: CjkParagraphTypography,
  measurer?: TextMeasurer
): FieldAwarePiece[] {
  const pieces = widenBalancedSpaces(source, policy, measurer);
  if (policy.autoSpaceDE === false && policy.autoSpaceDN === false) return pieces;
  let out: FieldAwarePiece[] | null = null;
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index]!;
    const cuts = automaticSpacingCuts(piece, policy, measurer);
    if (cuts.length === 0) {
      out?.push(piece);
      continue;
    }
    out ??= pieces.slice(0, index);
    let from = 0;
    for (const to of [...cuts, piece.text.length]) {
      out.push({
        ...piece,
        text: piece.text.slice(from, to),
        start: piece.start + from,
        end: piece.start + to,
      });
      from = to;
    }
  }
  return out ?? pieces;
}

function automaticSpacingCuts(
  piece: FieldAwarePiece,
  policy: CjkParagraphTypography,
  measurer?: TextMeasurer
): number[] {
  const literal = piece.end - piece.start === piece.text.length;
  if (
    !literal ||
    piece.text.length < 2 ||
    !EAST_ASIAN_TEXT.test(piece.text) ||
    !LATIN_OR_DIGIT_TEXT.test(piece.text) ||
    !ordinaryText(piece)
  )
    return [];
  // The piece passed the source checks above; price each boundary in the drawn face, as line
  // layout and AutoFit do.
  const style = styleForFontSlot(piece.style, piece.fontSlot);
  const cuts: number[] = [];
  let previousBase = '';
  let offset = 0;
  for (const character of piece.text) {
    if (
      previousBase !== '' &&
      automaticTextGap(
        { text: previousBase, style },
        { text: character, style },
        policy,
        measurer
      ) > 0
    )
      cuts.push(offset);
    if (!/^\p{M}$/u.test(character)) previousBase = character;
    offset += character.length;
  }
  return cuts;
}

/** Re-read the destination line after wrapping. A new line has no leading advance. */
export function automaticLineTextGap(
  line: { readonly spans: readonly StyleSpanRecord[]; readonly width: number },
  lineOrigin: () => number,
  paragraphId: string,
  start: number,
  piece: FieldAwarePiece,
  text: string,
  faceStyle: ResolvedRunStyle,
  policy: CjkParagraphTypography,
  measurer?: TextMeasurer
): number {
  const previous = line.spans.at(-1);
  if (
    !previous ||
    previous.range.paragraphId !== paragraphId ||
    previous.range.end !== start ||
    Math.abs(lineOrigin() + line.width - previous.box.x - previous.box.width) > 0.001 ||
    !boundaryMayBeEastAsian(previous.text, text)
  )
    return 0;
  return automaticTextGap(
    { ...previous, style: styleForFontSlot(previous.style, previous.fontSlot) },
    { ...piece, text, style: faceStyle },
    policy,
    measurer
  );
}

/**
 * Whether a paragraph laid out from these pieces can take any automatic gap. Every gap has an
 * East Asian side, and every boundary line layout prices is cut from these pieces' text, so
 * without East Asian text (or with both policies off) every gap is 0.
 */
export function piecesMayTakeAutomaticSpacing(
  pieces: readonly { readonly text: string }[],
  policy: CjkParagraphTypography
): boolean {
  if (policy.autoSpaceDE === false && policy.autoSpaceDN === false) return false;
  return pieces.some((piece) => EAST_ASIAN_TEXT.test(piece.text));
}

/** What {@link candidateAutomaticGap} needs to price a candidate against its line. */
export interface CandidateGapContext {
  /** The line being filled now; paragraph flow replaces it when a line closes. */
  readonly line: () => { readonly spans: readonly StyleSpanRecord[]; readonly width: number };
  readonly lineOrigin: () => number;
  readonly paragraphId: string;
  readonly typography: CjkParagraphTypography;
  readonly measurer?: TextMeasurer | undefined;
}

const noAutomaticGap = (): number => 0;

/**
 * The automatic gap before one candidate, asked several times while it is placed. The answer
 * is kept while every input {@link automaticLineTextGap} reads is unchanged: the line's last
 * span (its text, end and box), the line width, the pen origin, and the asked text and start.
 * A wrap or an optical fit changes one of them, so the gap is priced again on the new line.
 * Without a context (a paragraph that cannot take a gap) the answer is always 0.
 */
export function candidateAutomaticGap(
  context: CandidateGapContext | false,
  piece: FieldAwarePiece,
  faceStyle: ResolvedRunStyle,
  candidate: string,
  candidateStart: number
): (text?: string, start?: number) => number {
  if (!context) return noAutomaticGap;
  let key: readonly unknown[] | undefined;
  let value = 0;
  return (text = candidate, start = candidateStart) => {
    const line = context.line();
    const last = line.spans.at(-1);
    const origin = context.lineOrigin();
    const next = [
      last,
      last?.text,
      last?.range.end,
      last?.box.x,
      last?.box.width,
      line.width,
      origin,
      text,
      start,
    ];
    if (key && next.every((part, index) => part === key![index])) return value;
    value = automaticLineTextGap(
      line,
      context.lineOrigin,
      context.paragraphId,
      start,
      piece,
      text,
      faceStyle,
      context.typography,
      context.measurer
    );
    key = next;
    return value;
  };
}

/**
 * The room a justified line can win back to keep a kinsoku group whole: half of every
 * automatic gap on the line, `pendingGap` (the one before the next candidate) included. Such a
 * group is cut only when it is wider than its line even with those gaps at half width.
 */
export function justifiedGroupGapSlack(
  spans: readonly StyleSpanRecord[],
  pendingGap: number
): number {
  let total = pendingGap;
  for (const span of spans) total += automaticTextSpacingBefore(span);
  return total / 2;
}

/** Build the same drawn span and keep its original source range and metadata. */
export function automaticTextSpan(
  piece: FieldAwarePiece,
  range: StyleSpanRecord['range'],
  text: string,
  style: ResolvedRunStyle,
  x: number,
  width: number,
  height: number,
  gap: number,
  projected: boolean,
  lineEndWhitespace = false
): StyleSpanRecord {
  return withAutomaticTextSpacing(
    {
      range,
      text,
      props: piece.props,
      style,
      box: { x, y: 0, width, height },
      ...(piece.link ? { link: piece.link } : {}),
      ...(projected ? { projected: true as const } : {}),
      ...(piece.noteNav ? { noteNav: piece.noteNav } : {}),
      ...(piece.fontSlot ? { fontSlot: piece.fontSlot } : {}),
      ...(piece.glyphOffsetPt !== undefined ? { glyphOffsetPt: piece.glyphOffsetPt } : {}),
      ...(lineEndWhitespace ? { lineEndWhitespace: true as const } : {}),
      ...paragraphSpanMetadata(piece),
    },
    gap
  );
}
