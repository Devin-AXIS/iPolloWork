// Formatting the protocol can answer, and formatting an op may author.
//
// INTERNAL. Two directions that are deliberately not symmetrical.
//
// READING IS AGREEMENT. "Is this range bold" has three answers, not two: every run that
// contributes characters says yes, every one says no, or they do not agree. The third is `null`,
// and it is also the answer when NOTHING in the range authors the property at all — because this
// lane reads what the document AUTHORS, never the cascade.
//
// That last point is the load-bearing one. The style cascade lives in the layout lane, which a
// DOM-free automation lane may not import, so there is no honest way to answer "what does this
// text LOOK like" from here. But there is more to it than reachability: the value a formatting
// WRITE merges against is the direct one, so a read that echoed the cascade would let a caller
// read a heading's inherited size, write it back unchanged, and silently freeze an inherited
// value into the paragraph as direct formatting. The divergence from upstream — which answers
// the effective value — is recorded in `compat/manifest.json`.
//
// Paragraph direction is the one exception: its read resolves the cascade, and its write states
// `w:bidi` only where the paragraph does not already read the asked way. Writing back a direction
// read here is therefore a no-op, so the freezing hazard above does not arise.
//
// WRITING IS THE ACCEPTED PROPERTY BOUNDARY (design D8). Every field below maps to exactly one
// element in `ACCEPTED_RUN_PROPERTIES` / `ACCEPTED_PARAGRAPH_PROPERTIES`, and a value the
// boundary cannot express is REFUSED rather than approximated. Numbers are converted at this
// edge and nowhere else: the protocol speaks points, because that is what a document's own
// vocabulary is for a reader, and OOXML speaks twips and half-points.
//
// UNTRUSTED VALUES. A font name reaching `setFont` is caller input and a font name read back is
// file input. Both are validated as XML text here; the serializer escapes on the way out. This
// file builds no markup, no URL and no CSS.

import { extendedFontProperties, highlightHex, underlineName } from './font-values.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import type { OoxmlElement, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { isValidXmlText } from '../store/package/sinks.ts';
import {
  directParagraphProperties,
  mergedProperties,
  runsCovering,
} from '../store/store/direct-properties.ts';
import {
  DEFAULT_FORMATTING_DISPLAY_MODE,
  type FormattingDisplayMode,
} from '../store/store/formattable-runs.ts';
import {
  namedChild,
  paragraphPropertiesNodeOf,
  runPropertiesNodeOf,
} from '../store/store/tree-op-nodes.ts';
import {
  paragraphStyleName,
  styleIdFor,
  type AutomationStyleIndex,
  type InheritedLineSpacing,
} from './styles.ts';
import type { OoxmlProperty } from '../store/store/tree-ops.ts';
import type { ParagraphBorderEdgeWrite } from '../store/store/tree-op-paragraph-borders.ts';
import { paragraphBordersPlan, type AutomationParagraphBordersWrite } from './paragraph-borders.ts';
import { points, pointsToTwips, readTwipsMeasure, twips, twipsToPoints } from '../store/units.ts';

/** Widest value `w:ind`/`w:spacing` will be authored with, in twips — 22 inches of slack. */
const MAX_TWIPS = 31680;
/** Half-points, so 1..999 points. `w:sz` is a half-point measure (17.3.2.38). */
const MAX_HALF_POINTS = 1999;

/** Alignment as this protocol publishes it. `Mixed`/`Unknown` are read-only answers. */
export type AutomationAlignment = 'Mixed' | 'Unknown' | 'Left' | 'Centered' | 'Right' | 'Justified';

/**
 * A paragraph's base direction (`w:bidi`) as this protocol publishes it: the direction the
 * paragraph reads in, after its style cascade.
 */
export type AutomationReadingOrder = 'LeftToRight' | 'RightToLeft';

/**
 * What a range agrees about its characters' formatting.
 *
 * `null` means "no agreed value": the runs disagree, or none of them authors the property. The
 * two are one answer on purpose — a caller that must not guess is told not to guess, and a
 * caller writing a value writes it unconditionally either way.
 */
export interface AutomationFontRead {
  readonly bold: boolean | null;
  readonly italic: boolean | null;
  readonly underline: string | null;
  readonly strikeThrough: boolean | null;
  readonly highlightColor: string | null;
  readonly subscript: boolean | null;
  readonly superscript: boolean | null;
  /** `w:rFonts/@w:ascii`. */
  readonly name: string | null;
  /** Points. */
  readonly size: number | null;
  /** `#RRGGBB`. `null` for `auto`, which names no colour. */
  readonly color: string | null;
}

/** What a caller asks to author. Every field is optional; an empty request is refused. */
export interface AutomationFontWrite {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: string;
  readonly strikeThrough?: boolean;
  readonly highlightColor?: string | null;
  readonly subscript?: boolean;
  readonly superscript?: boolean;
  readonly name?: string;
  readonly size?: number;
  readonly color?: string;
}

/**
 * How a paragraph's line spacing is measured. `Single`, `OnePointFive`, and `Double` are the
 * multiple rule at one, one and a half, and two lines; `Multiple` is any other number of lines.
 */
export type AutomationLineSpacingRule =
  'Single' | 'OnePointFive' | 'Double' | 'AtLeast' | 'Exactly' | 'Multiple';

/** `w:line` for the rules that fix the spacing, in 240ths of a line. */
const FIXED_LINE_BY_RULE: Readonly<Partial<Record<AutomationLineSpacingRule, string>>> = {
  Single: '240',
  OnePointFive: '360',
  Double: '480',
};

/** `w:lineRule` each rule writes. */
const LINE_RULE_BY_RULE: Readonly<Record<AutomationLineSpacingRule, string>> = {
  Single: 'auto',
  OnePointFive: 'auto',
  Double: 'auto',
  AtLeast: 'atLeast',
  Exactly: 'exact',
  Multiple: 'auto',
};

/** A `w:line` this lane can carry: a positive whole number of a size `w:spacing` takes. */
const LINE_VALUE = /^[1-9]\d{0,4}$/;

/**
 * The line spacing a paragraph shows: its own `w:line` and `w:lineRule` over what it inherits,
 * attribute by attribute, else single spacing.
 */
function lineSpacingInForce(
  own: Readonly<Record<string, string>>,
  inherited: InheritedLineSpacing
): { line: string; lineRule: string } {
  // The nearest statement decides, as layout reads it. With no usable `w:line` the paragraph
  // shows single spacing, whatever rule a level states on its own.
  const line = own.line ?? inherited.line;
  if (line === undefined || !LINE_VALUE.test(line)) return { line: '240', lineRule: 'auto' };
  const lineRule = own.lineRule ?? inherited.lineRule;
  return {
    line,
    lineRule: lineRule === 'atLeast' || lineRule === 'exact' ? lineRule : 'auto',
  };
}

/** The rule a `w:line` and `w:lineRule` pair reads as. */
function lineSpacingRuleOf(spacing: { line: string; lineRule: string }): AutomationLineSpacingRule {
  if (spacing.lineRule === 'atLeast') return 'AtLeast';
  if (spacing.lineRule === 'exact') return 'Exactly';
  if (spacing.line === '240') return 'Single';
  if (spacing.line === '360') return 'OnePointFive';
  if (spacing.line === '480') return 'Double';
  return 'Multiple';
}

/** One paragraph's own paragraph properties, in points. `null` = the paragraph authors none. */
export interface AutomationParagraphFormatRead {
  readonly alignment: AutomationAlignment;
  /**
   * The paragraph style's NAME, or null where the document names none.
   *
   * Read here rather than through its own operation so that one load of a paragraph's properties is
   * one round trip: the style lives in the same `w:pPr`, and a caller asking for its name and its
   * indent should not pay for two.
   */
  readonly style: string | null;
  readonly firstLineIndent: number | null;
  readonly leftIndent: number | null;
  readonly rightIndent: number | null;
  /**
   * The line spacing in force, in points: the paragraph's own `w:line` over its style cascade's,
   * else single spacing (12). Unlike the other spacing fields, never null, so it always pairs
   * with `lineSpacingRule`.
   */
  readonly lineSpacing: number | null;
  /**
   * How the line spacing in force is measured: the paragraph's own `w:spacing` line attributes
   * over its style cascade's, else single spacing.
   */
  readonly lineSpacingRule: AutomationLineSpacingRule;
  readonly spaceBefore: number | null;
  readonly spaceAfter: number | null;
  readonly widowControl: boolean | null;
  /** The direction the paragraph reads in: its own `w:bidi` if any, else the style cascade's. */
  readonly readingOrder: AutomationReadingOrder;
}

/**
 * A paragraph-property write. Every field optional; omitted means "leave alone".
 *
 * Deliberately ONE request covering style and spacing together, because both rewrite `w:pPr` —
 * two ops naming the same paragraph in one batch are refused, since the second would carry
 * properties the first had already replaced.
 */
export interface AutomationParagraphFormatWrite {
  readonly alignment?: AutomationAlignment;
  /**
   * A paragraph style name the document already defines. An unknown name is refused.
   *
   * In the same request as the rest so that applying a style and adjusting a spacing is ONE write:
   * both rewrite `w:pPr`, and two ops naming it in one batch are refused because the second would
   * carry properties the first had already replaced.
   */
  readonly style?: string;
  readonly firstLineIndent?: number;
  readonly leftIndent?: number;
  readonly rightIndent?: number;
  /** Points. Keeps the rule in force: under `auto`, 12 points is one line. */
  readonly lineSpacing?: number;
  /**
   * The rule to measure line spacing by. `Single`, `OnePointFive`, and `Double` set the spacing
   * too; the other rules keep the points in force. With `lineSpacing` in the same write, the
   * rule applies first.
   */
  readonly lineSpacingRule?: AutomationLineSpacingRule;
  readonly spaceBefore?: number;
  readonly spaceAfter?: number;
  readonly widowControl?: boolean;
  /**
   * The direction the paragraph should read in. Nothing is written when it already does. Else the
   * paragraph's own `w:bidi` is removed when that alone set the other direction, or stated:
   * `<w:bidi/>`, or `<w:bidi w:val="0"/>` over a right-to-left style.
   */
  readonly readingOrder?: AutomationReadingOrder;
  /**
   * Border assignments, applied in order. In the same request as the rest because a border
   * write rewrites the same `w:pPr`, and two ops naming it in one batch are refused.
   */
  readonly borders?: AutomationParagraphBordersWrite;
}

/** Why a formatting value could not be authored. Named so a caller learns the field. */
export interface FormattingRefusal {
  readonly detail: string;
}

export type FormattingPlan<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

const NO_FONT: AutomationFontRead = Object.freeze({
  bold: null,
  italic: null,
  underline: null,
  strikeThrough: null,
  highlightColor: null,
  subscript: null,
  superscript: null,
  name: null,
  size: null,
  color: null,
});

function attributeOf(element: OoxmlElement | undefined, localName: string): string | null {
  if (!element) return null;
  for (const entry of element.attributes) {
    if (entry.localName === localName) return entry.value;
  }
  return null;
}

/**
 * An OOXML on/off attribute, as ECMA-376 §17.17.4 defines it.
 *
 * A toggle element with no `@w:val` is ON — `<w:b/>` is bold — and the off spellings are the
 * four the standard names. Treating a missing `@w:val` as anything but true would read half the
 * bold text Word writes as unformatted.
 */
function onOff(element: OoxmlElement | undefined): boolean | null {
  if (!element) return null;
  const value = attributeOf(element, 'val');
  if (value === null) return true;
  const normalized = value.trim().toLowerCase();
  if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'none')
    return false;
  return true;
}

/** A `#RRGGBB` projection of `w:color/@w:val`, or null when it names no concrete colour. */
function hexColour(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!/^[0-9a-fA-F]{6}$/.test(trimmed)) return null;
  return `#${trimmed.toUpperCase()}`;
}

/** Half-points to points, refusing a value the file wrote as something else. */
function pointsFromHalfPoints(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed / 2;
}

function pointsFromTwips(value: string | null): number | null {
  const parsed = readTwipsMeasure(value ?? undefined);
  return parsed === null ? null : twipsToPoints(twips(parsed));
}

/** One value if every voice agrees on it, else null. An empty set of voices agrees on nothing. */
function agreed<T>(values: readonly (T | null)[]): T | null {
  if (values.length === 0) return null;
  const first = values[0] as T | null;
  if (first === null) return null;
  for (const value of values) {
    if (value !== first) return null;
  }
  return first;
}

/**
 * What the runs of `[start, end)` agree about, across paragraphs.
 *
 * `spans` is one entry per paragraph the range covers, each with the offsets inside that
 * paragraph the range reaches — so a range crossing a paragraph mark asks every paragraph it
 * touches and agrees across all of them, exactly as a selection would.
 */
export function fontRead(
  part: OoxmlPart,
  spans: readonly { readonly paragraphId: string; readonly start: number; readonly end: number }[],
  displayMode: FormattingDisplayMode = DEFAULT_FORMATTING_DISPLAY_MODE
): AutomationFontRead {
  const properties: (OoxmlElement | undefined)[] = [];
  for (const span of spans) {
    // The same reach the WRITE uses. A span whose surviving text is uniform must not read
    // Mixed because a differently formatted hidden half sits inside it.
    for (const run of runsCovering(part, span.paragraphId, span.start, span.end, displayMode)) {
      properties.push(runPropertiesNodeOf(run));
    }
  }
  if (properties.length === 0) return NO_FONT;
  return {
    bold: agreed(properties.map((rPr) => onOff(namedChild(rPr, 'b')))),
    italic: agreed(properties.map((rPr) => onOff(namedChild(rPr, 'i')))),
    underline: agreed(
      properties.map((rPr) => underlineName(attributeOf(namedChild(rPr, 'u'), 'val')))
    ),
    strikeThrough: agreed(properties.map((rPr) => onOff(namedChild(rPr, 'strike')))),
    highlightColor: agreed(
      properties.map((rPr) => highlightHex(attributeOf(namedChild(rPr, 'highlight'), 'val')))
    ),
    subscript: agreed(properties.map((rPr) => scriptValue(rPr, 'subscript'))),
    superscript: agreed(properties.map((rPr) => scriptValue(rPr, 'superscript'))),
    name: agreed(
      properties.map((rPr) => {
        const fonts = namedChild(rPr, 'rFonts');
        const ascii = attributeOf(fonts, 'ascii');
        return ascii === null || ascii.length === 0 ? null : ascii;
      })
    ),
    size: agreed(
      properties.map((rPr) => pointsFromHalfPoints(attributeOf(namedChild(rPr, 'sz'), 'val')))
    ),
    color: agreed(properties.map((rPr) => hexColour(attributeOf(namedChild(rPr, 'color'), 'val')))),
  };
}

const ALIGNMENT_BY_JC: Readonly<Record<string, AutomationAlignment>> = Object.freeze({
  left: 'Left',
  start: 'Left',
  center: 'Centered',
  right: 'Right',
  end: 'Right',
  both: 'Justified',
  distribute: 'Justified',
});

/** The `@w:val` each writable alignment authors. `Mixed`/`Unknown` are absent: they are reads. */
const JC_BY_ALIGNMENT: Readonly<Record<string, string>> = Object.freeze({
  Left: 'left',
  Centered: 'center',
  Right: 'right',
  Justified: 'both',
});

/**
 * The paragraph's own `w:bidi`, read as the layout reads it: the LAST one wins, and no value, `1`,
 * `true` and `on` are right to left while every other value is left to right. `null` when the
 * paragraph states none.
 */
function ownRtl(properties: OoxmlElement | undefined): boolean | null {
  let rtl: boolean | null = null;
  for (const child of properties?.children ?? []) {
    if (child.kind === 'textValue' || child.localName !== 'bidi') continue;
    const value = attributeOf(child, 'val');
    rtl = value === null || ['1', 'true', 'on'].includes(value);
  }
  return rtl;
}

function alignmentOf(properties: OoxmlElement | undefined): AutomationAlignment {
  const value = attributeOf(namedChild(properties, 'jc'), 'val');
  if (value === null) return 'Unknown';
  return ALIGNMENT_BY_JC[value.trim().toLowerCase()] ?? 'Unknown';
}

/**
 * One paragraph's own `w:pPr` values, in points.
 *
 * `lineSpacing` is `@w:line / 20` under BOTH line rules, which is not a coincidence: an `auto`
 * rule measures in 240ths of a line and Word calls one line twelve points, so `line/240 * 12`
 * and `line/20` are the same number. An `exact`/`atLeast` rule measures in twips, which is also
 * `line/20`. So the conversion is the same either way and the rule does not have to be guessed
 * at on the way out.
 */
export function paragraphFormatRead(
  part: OoxmlPart,
  paragraphId: string,
  styles: AutomationStyleIndex
): AutomationParagraphFormatRead | null {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return null;
  const pPr = paragraphPropertiesNodeOf(paragraph);
  const spacing = namedChild(pPr, 'spacing');
  const indent = namedChild(pPr, 'ind');
  const lineInForce = lineSpacingInForce(
    attributesOf(spacing),
    styles.inheritedLineSpacing(part, paragraph)
  );
  return {
    alignment: alignmentOf(pPr),
    style: paragraphStyleName(part, paragraphId, styles),
    firstLineIndent: firstLineIndentOf(indent),
    leftIndent: pointsFromTwips(attributeOf(indent, 'left') ?? attributeOf(indent, 'start')),
    rightIndent: pointsFromTwips(attributeOf(indent, 'right') ?? attributeOf(indent, 'end')),
    // The value and rule in force, so a style's exact spacing reads with its points.
    lineSpacing: pointsFromTwips(lineInForce.line),
    lineSpacingRule: lineSpacingRuleOf(lineInForce),
    spaceBefore: pointsFromTwips(attributeOf(spacing, 'before')),
    spaceAfter: pointsFromTwips(attributeOf(spacing, 'after')),
    widowControl: onOff(namedChild(pPr, 'widowControl')),
    // Direction is the one paragraph property this lane resolves through the style cascade. A
    // write states `w:bidi` only where the paragraph does not already read the asked way, so
    // writing back the effective direction read here changes nothing and freezes nothing.
    readingOrder:
      (ownRtl(pPr) ?? styles.inheritsRtl(part, paragraph)) ? 'RightToLeft' : 'LeftToRight',
  };
}

/**
 * `@w:firstLine`, or the NEGATIVE of `@w:hanging`.
 *
 * One number in upstream's vocabulary, two mutually exclusive attributes in OOXML: a hanging
 * indent is a first line that starts further left than the rest, which is what a negative
 * first-line indent means. Reading only `@w:firstLine` would report zero for every hanging
 * paragraph — and a caller who wrote that zero back would flatten the hang.
 */
function firstLineIndentOf(indent: OoxmlElement | undefined): number | null {
  // HANGING WINS (§17.3.1.12). The two are one setting spelled two ways, not two settings,
  // and an element stating both is a real shape — this engine's own `writeFirstLine` emits
  // the unused one as an explicit zero. Preferring `w:firstLine` made this lane report a
  // positive indent for a paragraph the page hangs, and a caller writing that back flattened
  // it. Every other reader here already resolves the pair this way.
  const hanging = pointsFromTwips(attributeOf(indent, 'hanging'));
  if (hanging !== null && hanging > 0) return -hanging;
  const firstLine = pointsFromTwips(attributeOf(indent, 'firstLine'));
  if (firstLine !== null) return firstLine;
  return hanging === null ? null : -hanging;
}

function twipsFor(value: number, field: string): FormattingPlan<number> {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return { ok: false, detail: `${field}: not a measurement` };
  const authored = pointsToTwips(points(value));
  if (Math.abs(authored) > MAX_TWIPS) return { ok: false, detail: `${field}: out of range` };
  return { ok: true, value: authored };
}

/**
 * The `w:rPr` children a font request authors.
 *
 * A boolean asked for as `false` is written as an explicit off spelling rather than omitted:
 * omitting it would let the style cascade put the property back, so "not bold" would read as
 * bold on the next open. An absent field is simply not in the list — the caller merges these over
 * each run's own authored bag (`runPropertyEdits`), which is what keeps a size change from
 * deleting a run's colour.
 */
export function fontProperties(request: AutomationFontWrite): FormattingPlan<OoxmlProperty[]> {
  const extra = extendedFontProperties(request);
  if (!extra.ok) return extra;
  const properties: OoxmlProperty[] = extra.value;
  if (request.bold !== undefined) {
    if (typeof request.bold !== 'boolean') return { ok: false, detail: 'bold: not a boolean' };
    properties.push({ localName: 'b', ...(request.bold ? {} : { attributes: { val: '0' } }) });
  }
  if (request.italic !== undefined) {
    if (typeof request.italic !== 'boolean') return { ok: false, detail: 'italic: not a boolean' };
    properties.push({ localName: 'i', ...(request.italic ? {} : { attributes: { val: '0' } }) });
  }
  if (request.name !== undefined) {
    const name = request.name;
    if (typeof name !== 'string' || name.length === 0 || name.length > 128)
      return { ok: false, detail: 'name: not a font name' };
    // The value goes into an attribute the serializer escapes; what it must NOT carry is a
    // character XML cannot hold at all, which escaping does not fix.
    if (!isValidXmlText(name)) return { ok: false, detail: 'name: not valid XML text' };
    // Latin and high-range slots only. Writing `cs` too meant a font pick rewrote the
    // complex-script face as well, and the whole element replaced the run's own — see
    // `mergedFontProperty`, which the write path merges through.
    properties.push({
      localName: 'rFonts',
      attributes: { ascii: name, hAnsi: name },
    });
  }
  if (request.size !== undefined) {
    const size = request.size;
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0)
      return { ok: false, detail: 'size: not a positive number of points' };
    const halfPoints = Math.round(size * 2);
    if (halfPoints < 1 || halfPoints > MAX_HALF_POINTS)
      return { ok: false, detail: 'size: out of range' };
    properties.push({ localName: 'sz', attributes: { val: String(halfPoints) } });
    // `w:szCs` keeps complex-script runs the same size, which is what Word writes; leaving it
    // behind sizes Latin text and leaves Arabic or Hebrew in the same run at the old size.
    properties.push({ localName: 'szCs', attributes: { val: String(halfPoints) } });
  }
  if (request.color !== undefined) {
    const colour = request.color;
    if (typeof colour !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(colour.trim()))
      return { ok: false, detail: 'color: not a #RRGGBB triplet' };
    properties.push({
      localName: 'color',
      attributes: { val: colour.trim().slice(1).toUpperCase() },
    });
  }
  if (
    properties.length === 0 &&
    request.subscript === undefined &&
    request.superscript === undefined
  )
    return { ok: false, detail: 'no formatting was asked for' };
  return { ok: true, value: properties };
}

/**
 * The `w:pPr` children a paragraph-format request authors.
 *
 * `w:ind` and `w:spacing` are single elements carrying several attributes, so a request that
 * touches one attribute of either must carry the attributes the paragraph already had — a
 * property write REPLACES the element it names. The prior values are read from the tree here
 * rather than left to the caller, because a caller that had to read-modify-write would make
 * every indent change two round trips and a race. The same reasoning one level up gives the
 * whole-container merge at the end.
 */
export function paragraphFormatProperties(
  part: OoxmlPart,
  paragraphId: string,
  request: AutomationParagraphFormatWrite,
  styles: AutomationStyleIndex
): FormattingPlan<OoxmlProperty[]> & {
  readonly unchanged?: boolean;
  /** The paragraph's own border edges as they should stand, or null for no border change. */
  readonly borders?: readonly ParagraphBorderEdgeWrite[] | null;
} {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return { ok: false, detail: 'not a paragraph' };
  const pPr = paragraphPropertiesNodeOf(paragraph);
  const properties: OoxmlProperty[] = [];

  let styleId: string | undefined;
  if (request.style !== undefined) {
    const resolved = styleIdFor(request.style, styles);
    if (!resolved.ok) return { ok: false, detail: resolved.detail };
    styleId = resolved.styleId;
    properties.push({ localName: 'pStyle', attributes: { val: resolved.styleId } });
  }

  if (request.alignment !== undefined) {
    const jc = JC_BY_ALIGNMENT[request.alignment];
    if (jc === undefined) return { ok: false, detail: `alignment: ${String(request.alignment)}` };
    properties.push({ localName: 'jc', attributes: { val: jc } });
  }

  const indent = namedChild(pPr, 'ind');
  const indentAttributes: Record<string, string> = attributesOf(indent);
  let touchedIndent = false;
  if (request.firstLineIndent !== undefined) {
    const twips = twipsFor(request.firstLineIndent, 'firstLineIndent');
    if (!twips.ok) return twips;
    // Exactly one of the two may be present: `w:firstLine` and `w:hanging` are alternatives,
    // and leaving the other behind would let the paragraph carry both.
    delete indentAttributes.firstLine;
    delete indentAttributes.hanging;
    if (twips.value < 0) indentAttributes.hanging = String(-twips.value);
    else indentAttributes.firstLine = String(twips.value);
    touchedIndent = true;
  }
  for (const [field, attribute, alias] of [
    ['leftIndent', 'left', 'start'],
    ['rightIndent', 'right', 'end'],
  ] as const) {
    const asked = request[field];
    if (asked === undefined) continue;
    const twips = twipsFor(asked, field);
    if (!twips.ok) return twips;
    // The `w:start`/`w:end` spellings are the same measurement under a different name; keeping
    // a stale one beside the value just written would leave the paragraph self-contradictory.
    delete indentAttributes[alias];
    indentAttributes[attribute] = String(twips.value);
    touchedIndent = true;
  }
  if (touchedIndent) properties.push({ localName: 'ind', attributes: indentAttributes });

  const spacing = namedChild(pPr, 'spacing');
  const spacingAttributes: Record<string, string> = attributesOf(spacing);
  let touchedSpacing = false;
  for (const [field, attribute] of [
    ['spaceBefore', 'before'],
    ['spaceAfter', 'after'],
  ] as const) {
    const asked = request[field];
    if (asked === undefined) continue;
    const twips = twipsFor(asked, field);
    if (!twips.ok) return twips;
    if (twips.value < 0) return { ok: false, detail: `${field}: out of range` };
    spacingAttributes[attribute] = String(twips.value);
    touchedSpacing = true;
  }
  let lineSatisfied = false;
  if (request.lineSpacing !== undefined || request.lineSpacingRule !== undefined) {
    // Against the line spacing in force, the style this same write applies included: a value
    // keeps the rule the paragraph shows, and a rule keeps the points the paragraph shows.
    const inForce = lineSpacingInForce(
      spacingAttributes,
      styles.inheritedLineSpacing(part, paragraph, styleId)
    );
    let { line, lineRule } = inForce;
    // The rule applies first, then the value, so `lineSpacingRule` and `lineSpacing` in one
    // write give the asked rule at the asked points.
    if (request.lineSpacingRule !== undefined) {
      const asked = request.lineSpacingRule as AutomationLineSpacingRule;
      if (typeof asked !== 'string' || !Object.hasOwn(LINE_RULE_BY_RULE, asked))
        return { ok: false, detail: `lineSpacingRule: ${String(asked)}` };
      lineRule = LINE_RULE_BY_RULE[asked];
      if (Object.hasOwn(FIXED_LINE_BY_RULE, asked)) line = FIXED_LINE_BY_RULE[asked]!;
    }
    if (request.lineSpacing !== undefined) {
      const twips = twipsFor(request.lineSpacing, 'lineSpacing');
      if (!twips.ok) return twips;
      if (twips.value <= 0) return { ok: false, detail: 'lineSpacing: out of range' };
      line = String(twips.value);
    }
    // Spacing the paragraph already shows is a request satisfied: no direct formatting added.
    if (line !== inForce.line || lineRule !== inForce.lineRule) {
      spacingAttributes.line = line;
      spacingAttributes.lineRule = lineRule;
      touchedSpacing = true;
    } else lineSatisfied = true;
  }
  if (touchedSpacing) properties.push({ localName: 'spacing', attributes: spacingAttributes });

  if (request.widowControl !== undefined) {
    if (typeof request.widowControl !== 'boolean')
      return { ok: false, detail: 'widowControl: not a boolean' };
    properties.push({
      localName: 'widowControl',
      ...(request.widowControl ? {} : { attributes: { val: '0' } }),
    });
  }

  let removeBidi = false;
  if (request.readingOrder !== undefined) {
    if (request.readingOrder !== 'RightToLeft' && request.readingOrder !== 'LeftToRight')
      return { ok: false, detail: `readingOrder: ${String(request.readingOrder)}` };
    const wanted = request.readingOrder === 'RightToLeft';
    const own = ownRtl(pPr);
    // Against the style this same write applies, so a style and a direction can share a sync.
    const inherited = styles.inheritsRtl(part, paragraph, styleId);
    // The same rule as the editor's direction command: no write when the paragraph already reads
    // that way, and otherwise the smallest statement that makes it.
    if ((own ?? inherited) !== wanted) {
      if (inherited === wanted) removeBidi = true;
      else properties.push({ localName: 'bidi', ...(wanted ? {} : { attributes: { val: '0' } }) });
    }
  }

  let borders: readonly ParagraphBorderEdgeWrite[] | null = null;
  if (request.borders !== undefined) {
    // Against the style this same write applies, so a style and a border can share a sync.
    const planned = paragraphBordersPlan(part, paragraph, request.borders, styles, styleId);
    if (!planned.ok) return planned;
    borders = planned.edges;
  }

  // A direction, border, or line spacing the paragraph already has is a request satisfied, not
  // a refusal.
  if (
    properties.length === 0 &&
    !removeBidi &&
    request.readingOrder === undefined &&
    request.borders === undefined &&
    !lineSatisfied
  )
    return { ok: false, detail: 'no formatting was asked for' };
  // `setParagraphProperties` REPLACES the container: an authorable property the op does not name
  // is DROPPED. So the op has to carry the paragraph's existing bag forward, or setting alignment
  // would delete its style, its numbering and its spacing.
  const current = directParagraphProperties(part, paragraphId);
  const merged = mergedProperties(current, properties);
  const value = removeBidi ? merged.filter((property) => property.localName !== 'bidi') : merged;
  // A write of what the paragraph already states is no edit: no op, no change event, no undo step.
  return { ok: true, value, unchanged: sameProperties(current, value), borders };
}

/** Whether two property bags state the same elements with the same attributes, in any order. */
function sameProperties(left: readonly OoxmlProperty[], right: readonly OoxmlProperty[]): boolean {
  if (left.length !== right.length) return false;
  const key = (property: OoxmlProperty) =>
    JSON.stringify([
      property.localName,
      Object.entries(property.attributes ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ]);
  const keys = new Set(left.map(key));
  return right.every((property) => keys.has(key(property)));
}

/** A property element's `w:`-namespace attributes as a plain record, safe to copy from. */
function attributesOf(element: OoxmlElement | undefined): Record<string, string> {
  const record: Record<string, string> = Object.create(null) as Record<string, string>;
  if (!element) return record;
  for (const entry of element.attributes) {
    // Attribute NAMES come from a file. Assigning one as an object key is the
    // prototype-pollution hazard the repository audits for; a null-prototype record has no
    // `__proto__` to reach, so the class of problem is absent rather than filtered.
    record[entry.localName] = entry.value;
  }
  return record;
}

// Conditional false writes must preserve the opposite vertical alignment on each run.
// Use this after merging the ordinary incoming properties with the run or paragraph mark.
export function fontVerticalProperties(
  properties: readonly OoxmlProperty[],
  request: AutomationFontWrite
): OoxmlProperty[] {
  if (request.subscript === undefined && request.superscript === undefined) return [...properties];
  const current = properties.find((p) => p.localName === 'vertAlign')?.attributes?.val;
  const val =
    request.subscript === true
      ? 'subscript'
      : request.superscript === true
        ? 'superscript'
        : current === 'subscript' && request.subscript === false
          ? 'baseline'
          : current === 'superscript' && request.superscript === false
            ? 'baseline'
            : (current ?? 'baseline');
  return mergedProperties(properties, [{ localName: 'vertAlign', attributes: { val } }]);
}

function scriptValue(rPr: OoxmlElement | undefined, expected: string): boolean | null {
  const value = attributeOf(namedChild(rPr, 'vertAlign'), 'val');
  return value === null ? null : value === expected;
}
