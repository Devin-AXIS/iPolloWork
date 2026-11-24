// The numbering part the external-HTML projection assembles for its lists — split from
// clipboard-html-read.ts at the max-lines cap. Same shape the store's numbering writer
// produces; the projection allocates the numIds and this module renders the definitions.

import { escapeXmlAttribute } from '../store/package/sinks.ts';
import {
  wordListLevelFormat,
  wordListRuleDeclarations,
  type ListLevelRuleFormat,
} from './clipboard-html-list-level-rule.ts';
import { parseInlineStyle } from './clipboard-html-styles.ts';

const WML_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export type HtmlListKind =
  'bullet' | 'none' | 'decimal' | 'upperRoman' | 'lowerRoman' | 'upperLetter' | 'lowerLetter';

export type HtmlListAlign = 'left' | 'center' | 'right';

export type HtmlListLevel = {
  readonly kind: HtmlListKind;
  readonly start: number;
  /** Word's `mso-level-number-position`; absent, the format decides. */
  readonly align?: HtmlListAlign;
  /** Level text, marker format, and geometry from the `@list` level rule; absent, defaults. */
  readonly format?: ListLevelRuleFormat;
};

export type HtmlListAllocation = {
  readonly numId: string;
  /** Format and start per OBSERVED `w:ilvl`; unobserved levels take defaults. */
  readonly levels: Map<number, HtmlListLevel>;
};

// Symbol-font codepoints Word writes (private-use range), as escapes so they are not
// invisible literals in the source; see store/package/numbering-part.ts.
const BULLET_LEVELS = [
  { text: '\uF0B7', font: 'Symbol' },
  { text: 'o', font: 'Courier New' },
  { text: '\uF0A7', font: 'Wingdings' },
] as const;

/** The level `w:pPr`: the `num` tab stop, then the indent. */
function levelParagraphXml(
  format: ListLevelRuleFormat | undefined,
  ilvl: number,
  hang: number
): string {
  const left = format?.leftTwips ?? 720 * (ilvl + 1);
  const firstLine = format?.firstLineTwips ?? -hang;
  const tabs =
    format?.tabTwips !== undefined && format.tabTwips > 0
      ? `<w:tabs><w:tab w:val="num" w:pos="${format.tabTwips}"/></w:tabs>`
      : '';
  const indent = firstLine < 0 ? `w:hanging="${-firstLine}"` : `w:firstLine="${firstLine}"`;
  return `<w:pPr>${tabs}<w:ind w:left="${left}" ${indent}/></w:pPr>`;
}

/**
 * One `w:lvl` in strict CT_Lvl order: start, numFmt, lvlText, lvlJc, pPr, rPr.
 *
 * The `@list` level rule, when the clipboard has one, gives the level text, the marker run
 * properties, and the indents. What it leaves out takes the defaults below.
 */
function levelXml({ kind, start, align, format }: HtmlListLevel, ilvl: number): string {
  if (kind === 'bullet') {
    const bullet = BULLET_LEVELS[ilvl % BULLET_LEVELS.length]!;
    // A stated glyph keeps the rule's own run properties: a Wingdings glyph names Wingdings.
    const runXml =
      format?.text !== undefined
        ? (format.runXml ?? '')
        : `<w:rPr><w:rFonts w:ascii="${bullet.font}" w:hAnsi="${bullet.font}" w:hint="default"/></w:rPr>`;
    return (
      `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="bullet"/>` +
      `<w:lvlText w:val="${escapeXmlAttribute(format?.text ?? bullet.text)}"/>` +
      `<w:lvlJc w:val="${align ?? 'left'}"/>${levelParagraphXml(format, ilvl, 360)}${runXml}</w:lvl>`
    );
  }
  // Without Word's stated position, roman markers right-align in a narrower 180-twip
  // hanging slot — the geometry the store's numbering writer synthesizes, so pasted and
  // toolbar-made lists match.
  const jc = align ?? (kind === 'lowerRoman' || kind === 'upperRoman' ? 'right' : 'left');
  const text = format?.text ?? `%${ilvl + 1}.`;
  return (
    `<w:lvl w:ilvl="${ilvl}"><w:start w:val="${start}"/>` +
    `<w:numFmt w:val="${kind}"/>` +
    `<w:lvlText w:val="${escapeXmlAttribute(text)}"/><w:lvlJc w:val="${jc}"/>` +
    `${levelParagraphXml(format, ilvl, jc === 'right' ? 180 : 360)}${format?.runXml ?? ''}</w:lvl>`
  );
}

const ROMAN_DIGIT_VALUES: ReadonlyMap<string, number> = new Map([
  ['i', 1],
  ['v', 5],
  ['x', 10],
  ['l', 50],
  ['c', 100],
  ['d', 500],
  ['m', 1000],
]);

const WORD_LEVEL_FORMATS: ReadonlyMap<string, HtmlListKind> = new Map([
  ['alpha-lower', 'lowerLetter'],
  ['alpha-upper', 'upperLetter'],
  ['roman-lower', 'lowerRoman'],
  ['roman-upper', 'upperRoman'],
  ['bullet', 'bullet'],
  ['image', 'bullet'],
  ['decimal', 'decimal'],
  ['arabic', 'decimal'],
]);

export interface WordListLevelDefinition {
  readonly kind: HtmlListKind;
  readonly start: number | null;
  readonly align?: HtmlListAlign;
  readonly format?: ListLevelRuleFormat;
}

const WORD_NUMBER_POSITIONS: ReadonlyMap<string, HtmlListAlign> = new Map([
  ['left', 'left'],
  ['center', 'center'],
  ['right', 'right'],
]);

// Bounded: the block is a character class capped at 2048 (no backtracking blowup).
// Word writes the override selector colon-joined (`@list l0:level1:lfo2`); the
// space-separated form is tolerated too.
const WORD_LIST_LEVEL_RULE =
  /@list\s+l(\d{1,4}):level([1-9])(?:[\s:]+lfo(\d{1,4}))?\s*\{([^{}]{0,2048})\}/g;

/**
 * Bounded scan of Word's head `@list lN:levelM` rules: the STRUCTURED number format
 * and start-at, so marker-glyph sniffing is only a fallback. A rule with no
 * `mso-level-number-format` is decimal (Word omits the default); an unknown format
 * yields no entry and leaves the level to the sniffer.
 */
export function wordListDefinitionsFromStyleText(
  css: string
): ReadonlyMap<string, WordListLevelDefinition> {
  const out = new Map<string, WordListLevelDefinition>();
  if (css.length === 0 || css.length > 262_200) return out;
  WORD_LIST_LEVEL_RULE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let rules = 0;
  while ((match = WORD_LIST_LEVEL_RULE.exec(css)) !== null && rules < 512) {
    rules += 1;
    let kind: HtmlListKind | null = 'decimal';
    let start: number | null = null;
    let align: HtmlListAlign | undefined;
    const declarations = wordListRuleDeclarations(match[4]!);
    for (const [name, raw] of declarations) {
      const value = raw.toLowerCase();
      if (name === 'mso-level-number-format') {
        kind = WORD_LEVEL_FORMATS.get(value) ?? null;
      } else if (name === 'mso-level-start-at' && /^\d{1,5}$/.test(value)) {
        start = Math.min(32_767, Number.parseInt(value, 10));
      } else if (name === 'mso-level-number-position') {
        align = WORD_NUMBER_POSITIONS.get(value);
      }
    }
    if (kind === null) continue;
    // Word's lvlOverride CSS carries an `lfo<N>` suffix; the override rule and the
    // base rule are DIFFERENT definitions, keyed apart so the reader can prefer
    // the list-format-override its paragraphs actually name.
    const key =
      match[3] === undefined
        ? `l${match[1]}:level${match[2]}`
        : `l${match[1]}:level${match[2]}:lfo${match[3]}`;
    const format = wordListLevelFormat(declarations);
    if (!out.has(key)) {
      out.set(key, { kind, start, ...(align ? { align } : {}), ...(format ? { format } : {}) });
    }
  }
  return out;
}

/** The ordinal a marker glyph names UNDER a known format, or null when it does not parse. */
export function htmlListStartFromMarker(marker: string, kind: HtmlListKind): number | null {
  const trimmed = marker.trim().replace(/^\(/, '');
  if (kind === 'decimal') {
    // A multilevel marker like '2.1.' names THIS level with its LAST ordinal.
    const dotted = /^(\d{1,5}(?:\.\d{1,5})*)/.exec(trimmed);
    if (!dotted) return null;
    const segments = dotted[1]!.split('.');
    return Math.min(32_767, Number.parseInt(segments[segments.length - 1]!, 10));
  }
  if (kind === 'lowerRoman' || kind === 'upperRoman') {
    const run = /^([A-Za-z]{1,8})/.exec(trimmed);
    return run ? romanValueOf(run[1]!) : null;
  }
  if (kind === 'lowerLetter' || kind === 'upperLetter') {
    const run = /^(([A-Za-z])\2{0,4})(?![A-Za-z])/.exec(trimmed);
    if (!run) return null;
    const code = run[2]!.toLowerCase().charCodeAt(0);
    return Math.min(32_767, (run[1]!.length - 1) * 26 + (code - 96));
  }
  return null;
}

const ROMAN_GRAMMAR = /^m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;

/** The ordinal a valid roman marker names ('iv' → 4), or null for invalid grammar. */
function romanValueOf(token: string): number | null {
  const lower = token.toLowerCase();
  if (!ROMAN_GRAMMAR.test(lower)) return null;
  let total = 0;
  let previous = 0;
  for (const char of lower) {
    const value = ROMAN_DIGIT_VALUES.get(char);
    if (value === undefined) return null;
    total += value;
    if (previous > 0 && previous < value) total -= 2 * previous;
    previous = value;
  }
  return total > 0 && total <= 32_767 ? total : null;
}

export function htmlListKindAndStart(marker: string): {
  readonly kind: HtmlListKind;
  readonly start: number;
} {
  // Word wraps some formats in parentheses — '(1)', '(a)' — so the matchers see the
  // ordinal itself. The closing bracket then satisfies the `[.)]` terminator. A
  // multilevel marker like '2.1.' names THIS level with its LAST ordinal.
  const trimmed = marker.trim().replace(/^\(/, '');
  const decimal = /^(\d{1,5}(?:\.\d{1,5})*)[.)]/.exec(trimmed);
  if (decimal) {
    const segments = decimal[1]!.split('.');
    return {
      kind: 'decimal',
      start: Math.min(32_767, Number.parseInt(segments[segments.length - 1]!, 10)),
    };
  }
  // Single letters are ambiguous. 'i', 'v', 'x' read as roman (values 1/5/10 are
  // plausible slice starts, and roman lists routinely show them), while 'c.' or
  // 'l.' read as letter lists mid-alphabet — a roman list rarely reaches 50+.
  const letter = /^([A-Za-z])[.)]/.exec(trimmed);
  if (letter) {
    const lower = letter[1]!.toLowerCase();
    if (lower === 'i' || lower === 'v' || lower === 'x') {
      const start = lower === 'i' ? 1 : lower === 'v' ? 5 : 10;
      return { kind: letter[1] === lower ? 'lowerRoman' : 'upperRoman', start };
    }
    const code = letter[1]!.charCodeAt(0);
    return code >= 97
      ? { kind: 'lowerLetter', start: code - 96 }
      : { kind: 'upperLetter', start: code - 64 };
  }
  const run = /^([A-Za-z]{2,8})[.)]/.exec(trimmed);
  if (run) {
    const token = run[1]!;
    const lower = token === token.toLowerCase();
    const sameLetter = /^([A-Za-z])\1+$/.test(token);
    // Same-letter runs are letter lists past 'z' ('cc.' is item 29) — EXCEPT an
    // 'i' run, which is overwhelmingly a roman 2 or 3. Mixed runs must parse as
    // valid roman grammar; the start keeps the slice's visible numbers.
    if (!sameLetter || /^[iI]+$/.test(token)) {
      const roman = romanValueOf(token);
      if (roman !== null) {
        return { kind: lower ? 'lowerRoman' : 'upperRoman', start: roman };
      }
    }
    if (sameLetter) {
      const code = token.toLowerCase().charCodeAt(0);
      const start = Math.min(32_767, (token.length - 1) * 26 + (code - 96));
      return { kind: lower ? 'lowerLetter' : 'upperLetter', start };
    }
  }
  // Any remaining digit-bearing marker ('3', '1º', 'Article 1') stays an ordered list.
  const digits = /\d{1,5}/.exec(trimmed);
  if (digits) {
    return { kind: 'decimal', start: Math.min(32_767, Number.parseInt(digits[0]!, 10)) };
  }
  return { kind: 'bullet', start: 1 };
}

const LIST_STYLE_TYPE_KINDS: ReadonlyMap<string, HtmlListKind> = new Map([
  ['none', 'none'],
  ['decimal', 'decimal'],
  ['upper-alpha', 'upperLetter'],
  ['upper-latin', 'upperLetter'],
  ['lower-alpha', 'lowerLetter'],
  ['lower-latin', 'lowerLetter'],
  ['upper-roman', 'upperRoman'],
  ['lower-roman', 'lowerRoman'],
]);

export function semanticHtmlListKind(element: Element): HtmlListKind {
  if (element.localName.toLowerCase() !== 'ol') return 'bullet';
  // The outbound writer emits `list-style-type` CSS, not the legacy attribute.
  const listStyle = parseInlineStyle(element).get('list-style-type')?.trim().toLowerCase();
  const fromCss = listStyle === undefined ? undefined : LIST_STYLE_TYPE_KINDS.get(listStyle);
  if (fromCss !== undefined) return fromCss;
  const type = element.getAttribute('type');
  if (type === 'A') return 'upperLetter';
  if (type === 'a') return 'lowerLetter';
  if (type === 'I') return 'upperRoman';
  if (type === 'i') return 'lowerRoman';
  return 'decimal';
}

export function semanticHtmlListStart(element: Element): number {
  const raw = element.getAttribute('start')?.trim();
  return raw !== undefined && /^\d{1,5}$/.test(raw)
    ? Math.min(32_767, Number.parseInt(raw, 10))
    : 1;
}

export function numberingPartXml(allocations: readonly HtmlListAllocation[]): string {
  const abstracts = allocations
    .map((allocation, index) => {
      const fallback: HtmlListLevel = allocation.levels.get(0) ??
        allocation.levels.values().next().value ?? { kind: 'decimal', start: 1 };
      const levels = Array.from({ length: 9 }, (_, ilvl) => {
        // An observed level keeps its detected format and start; the rest default —
        // bullets cascade, ordered lists restart as decimal.
        const observed = allocation.levels.get(ilvl);
        if (observed) return levelXml(observed, ilvl);
        return levelXml(
          { kind: fallback.kind === 'bullet' ? 'bullet' : 'decimal', start: 1 },
          ilvl
        );
      }).join('');
      return (
        `<w:abstractNum w:abstractNumId="${index}">` +
        `<w:multiLevelType w:val="hybridMultilevel"/>${levels}</w:abstractNum>`
      );
    })
    .join('');
  const nums = allocations
    .map(
      (allocation, index) =>
        `<w:num w:numId="${allocation.numId}"><w:abstractNumId w:val="${index}"/></w:num>`
    )
    .join('');
  return `${XML_DECL}<w:numbering xmlns:w="${WML_NS}">${abstracts}${nums}</w:numbering>`;
}
