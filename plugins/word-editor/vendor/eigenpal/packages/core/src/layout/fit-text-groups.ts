// Run-level `w:fitText` (ECMA-376 §17.3.2.14): text that takes an exact width.
//
// Consecutive runs whose `w:fitText` carries the same `w:id` form ONE group (an absent id
// matches an absent id), and a run without the property ends it. The group takes the
// `w:val` of its first run, in twips, whatever width its characters have:
//
// - Narrower text spreads: every character except the last gets the same extra advance, so
//   the last character ends exactly at the stated width. A one-character group carries the
//   whole extra advance after that character.
// - Wider text compresses: every character advance scales by the same factor.
//
// The group recomputes its spacing from its own text, so the authored `w:spacing` and `w:w`
// of its runs do not apply inside it. Text typed into the group joins it and the group fits
// again; text typed right after its last character starts a run without the property (see
// `fit-text-typing-boundary.ts`). A field result is an ordinary group character. A tab ends
// the group, and the text after it keeps its natural width. The group is one unit for line
// breaking and for the table AutoFit minimum: no line opens inside it. Justification,
// distribution and space shrinking leave its spacing alone (`insideFitTextGroup`), and a
// space inside it is never clipped or hung as line-end whitespace.
//
// This module rewrites piece STYLES only (character spacing and horizontal scale), which
// every measurer and painter already honors, and splits off the group's last character so
// it keeps its own advance. Source text and model offsets never change.

import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import { lineOpenDecisionAt, type LineOpenDecision } from './cjk-line-break.ts';
import type { CjkParagraphBreaks } from './cjk-paragraph-breaks.ts';
import type { FieldAwarePiece } from './field-pieces.ts';
import { isLayoutOwnedPiece } from './layout-owned-piece.ts';
import { displayText, type ResolvedRunStyle } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { TextMeasurer } from './text-measurer.ts';

/** Largest stated width honored, in twips (22 inches, the widest page the schema allows). */
const MAX_FIT_TEXT_TWIPS = 31_680;
/** Longest `w:id` compared; a longer one is file noise and leaves the run unfitted. */
const MAX_FIT_TEXT_ID_CHARS = 64;

const fitTextGroupStart = Symbol('fit-text-group-start');
type Grouped = { readonly [fitTextGroupStart]?: number };

interface FitTextSpec {
  readonly widthPt: number;
  readonly id: string;
}

/** Twips per unit of an ST_UniversalMeasure (`2in`, `5.08cm`, `144pt`, `12pc`). */
const TWIPS_PER_UNIT: Readonly<Record<string, number>> = {
  in: 1440,
  cm: 1440 / 2.54,
  mm: 144 / 2.54,
  pt: 20,
  pc: 240,
  pi: 240,
};

/** `w:val` in twips: a whole number, or a bounded universal measure; null when unusable. */
function fitTextTwips(raw: string): number | null {
  if (/^\d{1,6}$/.test(raw)) return Number(raw);
  const measure = /^(\d{1,5}(?:\.\d{1,4})?)(in|cm|mm|pt|pc|pi)$/.exec(raw);
  return measure ? Number(measure[1]) * TWIPS_PER_UNIT[measure[2]!]! : null;
}

/** The run's `w:fitText`, or null when it states none or states an unusable width. */
function fitTextOf(props: readonly OoxmlProperty[]): FitTextSpec | null {
  let found: OoxmlProperty | undefined;
  for (const property of props) if (property.localName === 'fitText') found = property;
  if (!found) return null;
  const raw = found.attributes?.val;
  const twips = raw === undefined ? null : fitTextTwips(raw);
  if (twips === null || !(twips > 0) || twips > MAX_FIT_TEXT_TWIPS) return null;
  const id = found.attributes?.id ?? '';
  if (id.length > MAX_FIT_TEXT_ID_CHARS) return null;
  return { widthPt: twips / 20, id };
}

/** Whether a piece that carries `w:fitText` can be a group character. */
function fittablePiece(piece: FieldAwarePiece): boolean {
  if (
    piece.text.length === 0 ||
    piece.measureText !== undefined ||
    piece.inlineDrawing ||
    piece.equation ||
    piece.positionalTab ||
    piece.breakKind ||
    piece.noteSeparator ||
    piece.unsupported ||
    piece.anchoredAtom ||
    /[\n\r\f]/.test(piece.text)
  )
    return false;
  // A field result is an ordinary group character, unless its text is replaced later (page
  // numbers and page references) or it is a form control.
  const atom = piece.fieldAtom;
  if (atom) return !atom.pageField && !atom.pageRef && !atom.formControl;
  return !isLayoutOwnedPiece(piece);
}

function withStyle(
  piece: FieldAwarePiece,
  style: ResolvedRunStyle,
  groupStart: number,
  from = 0,
  to = piece.text.length
): FieldAwarePiece {
  if (from === 0 && to === piece.text.length) {
    return { ...piece, style, [fitTextGroupStart]: groupStart } as FieldAwarePiece;
  }
  return {
    ...piece,
    text: piece.text.slice(from, to),
    start: piece.start + from,
    end: piece.start + to,
    style,
    [fitTextGroupStart]: groupStart,
  } as FieldAwarePiece;
}

/** Cut a literal piece at `at` (a UTF-16 offset); a layout-owned piece is never cut. */
function cutPiece(piece: FieldAwarePiece, at: number): [FieldAwarePiece, FieldAwarePiece] {
  return [
    { ...piece, text: piece.text.slice(0, at), end: piece.start + at },
    { ...piece, text: piece.text.slice(at), start: piece.start + at },
  ];
}

/** Code points in `text`: a surrogate pair is one character and takes one gap. */
function characterCount(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

const ASTRAL = /[\uD800-\uDBFF][\uDC00-\uDFFF]/;

/**
 * Spread pieces: every character but the last gets `gap` after it. Spacing applies per UTF-16
 * unit, so a surrogate pair takes half the gap on each of its two units.
 */
function spreadPieces(
  group: readonly FieldAwarePiece[],
  plain: readonly ResolvedRunStyle[],
  gap: number,
  groupStart: number
): FieldAwarePiece[] {
  const out: FieldAwarePiece[] = [];
  const lastIndex = group.length - 1;
  group.forEach((piece, index) => {
    const style = (spacing: number) => ({ ...plain[index]!, characterSpacingPt: spacing });
    const owned = isLayoutOwnedPiece(piece);
    if (owned || !ASTRAL.test(piece.text)) {
      // A layout-owned piece is not cut: when it is last, its last character keeps the gap.
      const isLast = index === lastIndex && !owned;
      const lastLength = isLast ? (/[\uD800-\uDBFF][\uDC00-\uDFFF]$/.test(piece.text) ? 2 : 1) : 0;
      const cut = piece.text.length - lastLength;
      if (cut > 0) out.push(withStyle(piece, style(gap), groupStart, 0, cut));
      if (lastLength > 0) out.push(withStyle(piece, plain[index]!, groupStart, cut));
      return;
    }
    // Runs of ordinary characters and of surrogate pairs, each with its own per-unit spacing.
    const characters = [...piece.text];
    let from = 0;
    characters.forEach((character, position) => {
      const to = from + character.length;
      const last = index === lastIndex && position === characters.length - 1;
      const spacing = last ? 0 : character.length === 2 ? gap / 2 : gap;
      const previous = out.at(-1);
      if (
        previous &&
        position > 0 &&
        previous.style.characterSpacingPt === spacing &&
        previous.end === piece.start + from
      ) {
        out[out.length - 1] = withStyle(
          piece,
          style(spacing),
          groupStart,
          previous.start - piece.start,
          to
        );
      } else out.push(withStyle(piece, style(spacing), groupStart, from, to));
      from = to;
    });
  });
  return out;
}

function fitGroup(
  group: readonly FieldAwarePiece[],
  widthPt: number,
  measurer: TextMeasurer
): FieldAwarePiece[] {
  // Measured unspaced and unscaled: the group's own spacing replaces the authored values.
  const plain = group.map((piece) => ({
    ...piece.style,
    characterSpacingPt: 0,
    horizontalScalePercent: 100,
  }));
  let natural = 0;
  let characters = 0;
  group.forEach((piece, index) => {
    const face = styleForFontSlot(plain[index]!, piece.fontSlot);
    natural += measurer.measure(displayText(piece.text, face), face);
    characters += characterCount(piece.text);
  });
  const groupStart = group[0]!.start;
  if (!(natural > 0) || !Number.isFinite(natural)) {
    return group.map((piece, index) => withStyle(piece, plain[index]!, groupStart));
  }
  if (natural >= widthPt) {
    const horizontalScalePercent = (100 * widthPt) / natural;
    return group.map((piece, index) =>
      withStyle(piece, { ...plain[index]!, horizontalScalePercent }, groupStart)
    );
  }
  // The last character keeps its own advance, unless it is the only one (then it carries the
  // whole extra advance) or it sits in a field result that cannot be cut.
  const lastOwned = isLayoutOwnedPiece(group[group.length - 1]!);
  const gaps = characters > 1 && !lastOwned ? characters - 1 : characters;
  const gap = (widthPt - natural) / gaps;
  if (characters === 1) {
    const unitGap = gap / group[0]!.text.length;
    return [withStyle(group[0]!, { ...plain[0]!, characterSpacingPt: unitGap }, groupStart)];
  }
  return spreadPieces(group, plain, gap, groupStart);
}

/**
 * Fit every `w:fitText` group in a paragraph's pieces to its stated width.
 *
 * A tab ends its group: the text after it, with the same `w:id`, keeps its natural width. A
 * group therefore starts again only after text without the property or with another id.
 *
 * Returns `pieces` itself when no piece carries the property, so paragraphs without fitted
 * text pay one property scan per piece.
 */
export function fitTextGroups(
  pieces: readonly FieldAwarePiece[],
  measurer: TextMeasurer
): FieldAwarePiece[] {
  let out: FieldAwarePiece[] | null = null;
  /** The id of a group a tab closed; its later pieces stay unfitted. */
  let closedId: string | null = null;
  const queue = [...pieces];
  let index = 0;
  while (index < queue.length) {
    const piece = queue[index]!;
    const spec = fitTextOf(piece.props);
    if (!spec || !fittablePiece(piece) || spec.id === closedId) {
      if (!spec) closedId = null;
      else if (spec.id !== closedId) closedId = null;
      out?.push(piece);
      index += 1;
      continue;
    }
    let end = index;
    let tabbed = false;
    while (end < queue.length) {
      const next = queue[end]!;
      if (end > index && next.start !== queue[end - 1]!.end) break;
      const nextSpec = end === index ? spec : fitTextOf(next.props);
      if (!nextSpec || nextSpec.id !== spec.id || !fittablePiece(next)) break;
      const tab = next.text.indexOf('\t');
      if (tab >= 0) {
        // The text before the tab joins the group; the tab and the rest stay unfitted.
        tabbed = true;
        if (tab > 0 && !isLayoutOwnedPiece(next)) {
          const [before, after] = cutPiece(next, tab);
          queue.splice(end, 1, before, after);
          end += 1;
        }
        break;
      }
      end += 1;
    }
    out ??= queue.slice(0, index);
    if (end > index) out.push(...fitGroup(queue.slice(index, end), spec.widthPt, measurer));
    closedId = tabbed ? spec.id : null;
    if (end === index) {
      out.push(piece);
      end += 1;
    }
    index = end;
  }
  return out ?? (pieces as FieldAwarePiece[]);
}

/** The group start of a fitted piece or span, or undefined outside a group. */
export function fitTextGroupOf(value: object): number | undefined {
  return (value as Grouped)[fitTextGroupStart];
}

/** Whether a fitted piece continues a group that started in an earlier piece. */
export function continuesFitTextGroup(piece: FieldAwarePiece): boolean {
  const start = fitTextGroupOf(piece);
  return start !== undefined && piece.start > start;
}

/** The marker a span cut from `piece` carries, so line adjustments can find the group. */
export function fitTextSpanMarker(piece: object): { readonly [fitTextGroupStart]?: number } {
  const start = fitTextGroupOf(piece);
  return start === undefined ? {} : { [fitTextGroupStart]: start };
}

/**
 * Whether the boundary between two neighbouring spans of one line lies inside a fitted group.
 * The group sets its own spacing, so justification, distribution and space shrinking leave
 * such a boundary, and the spaces in a group, alone.
 */
export function insideFitTextGroup(before: object, after: object): boolean {
  const start = fitTextGroupOf(before);
  return start !== undefined && start === fitTextGroupOf(after);
}

/**
 * The line-open decision inside a fitted group: no line opens after its first character, so
 * the group moves to the next line whole. A group wider than its line is cut like any word.
 */
export function fitTextOpenDecision(
  piece: FieldAwarePiece,
  consumed: number,
  decision: LineOpenDecision
): LineOpenDecision {
  const groupStart = fitTextGroupOf(piece);
  if (decision !== 'opens' || groupStart === undefined) return decision;
  return piece.start + consumed > groupStart ? 'continues' : decision;
}

/**
 * The line-open decision for one candidate of `piece`, the same in line breaking and in the
 * anchor probe: the paragraph's break rules, then the fitted-group rule.
 */
export function fittedLineOpenDecision(
  piece: FieldAwarePiece,
  consumed: number,
  lastEmitted: string,
  candidate: string,
  cjkBreaks: CjkParagraphBreaks | null | undefined
): LineOpenDecision {
  return fitTextOpenDecision(
    piece,
    consumed,
    cjkBreaks?.decision(piece, consumed, lastEmitted, candidate) ??
      lineOpenDecisionAt(lastEmitted, candidate, consumed > 0)
  );
}
