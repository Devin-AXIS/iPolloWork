import { WML_NAMESPACE_URI, type OoxmlElement } from '../store/package/ooxml-tree.ts';
import { escapeCssString } from '../store/package/sinks.ts';
import { attributeValueOf } from '../store/store/tree-op-nodes.ts';
import { HIGHLIGHT_COLOR_HEX } from '../output/semantic-paint.ts';

/** The painter's full ST_Underline vocabulary (output/semantic-paint.ts
 *  UNDERLINE_STYLE), as canonical emission values. The closed allowlist is what
 *  makes interpolating a value into `w:u w:val` or a `text-underline` CSS hint
 *  safe on both lanes. */
export const WORD_UNDERLINE_VALUES = [
  'single',
  'words',
  'double',
  'thick',
  'dotted',
  'dottedHeavy',
  'dash',
  'dashedHeavy',
  'dashLong',
  'dashLongHeavy',
  'dotDash',
  'dashDotHeavy',
  'dotDotDash',
  'dashDotDotHeavy',
  'wave',
  'wavyHeavy',
  'wavyDouble',
] as const;
export type HtmlUnderlineVal = (typeof WORD_UNDERLINE_VALUES)[number];

const WORD_PARAGRAPH_CLASSES: Readonly<Record<string, string>> = {
  Normal: 'MsoNormal',
  ListParagraph: 'MsoListParagraph',
  Title: 'MsoTitle',
  Subtitle: 'MsoSubtitle',
  Caption: 'MsoCaption',
  Quote: 'MsoQuote',
  IntenseQuote: 'MsoIntenseQuote',
  BodyText: 'MsoBodyText',
  FootnoteText: 'MsoFootnoteText',
  TOCHeading: 'MsoTocHeading',
  ...Object.fromEntries(
    Array.from({ length: 9 }, (_, index) => [`TOC${index + 1}`, `MsoToc${index + 1}`])
  ),
};

/**
 * Class → style id, the read lane's inverse of the table above. `MsoNormal` is
 * omitted ON PURPOSE: stamping `pStyle Normal` on every plain Word paragraph would
 * cover each paragraph mark and force the structural paste path. Word also emits
 * `CxSp` (contextual-spacing) variants of `MsoListParagraph`, which the read lane
 * accepts as plain `ListParagraph`.
 */
export const WORD_CLASS_PARAGRAPH_STYLES: ReadonlyMap<string, string> = new Map([
  ...Object.entries(WORD_PARAGRAPH_CLASSES)
    .filter(([styleId]) => styleId !== 'Normal')
    .map(([styleId, className]): [string, string] => [className, styleId]),
  ['MsoListParagraphCxSpFirst', 'ListParagraph'],
  ['MsoListParagraphCxSpMiddle', 'ListParagraph'],
  ['MsoListParagraphCxSpLast', 'ListParagraph'],
]);

export function wordParagraphClassOf(styleId: string | undefined): string | null {
  if (styleId === undefined) return null;
  if (/^Heading[7-9]$/.test(styleId)) return `Mso${styleId}`;
  // The style id is file-derived: guard the record lookup against prototype keys.
  return Object.hasOwn(WORD_PARAGRAPH_CLASSES, styleId) ? WORD_PARAGRAPH_CLASSES[styleId]! : null;
}

/** ST_HighlightColor names to CSS colors — the painter's own table, so copied HTML
 *  shows exactly the highlight the editor paints. */
export const WORD_HIGHLIGHT_COLORS: Readonly<Record<string, string>> =
  Object.fromEntries(HIGHLIGHT_COLOR_HEX);

/** `w:jc` values to CSS `text-align`. */
export const WORD_JC_TO_TEXT_ALIGN: Readonly<Record<string, string>> = {
  left: 'left',
  start: 'left',
  center: 'center',
  right: 'right',
  end: 'right',
  both: 'justify',
  distribute: 'justify',
};

/** Quote a file-supplied font name without removing Unicode letters. The
 *  allowlist strip comes FIRST: the read lane's inline-style parser splits on
 *  ';' and ':' without quote awareness, so a `;`/`:` surviving inside the quoted
 *  family would smuggle whole declarations out of an attacker-chosen font name.
 *  `escapeCssString` (the engine's ONE designated CSS escaper) then covers what
 *  the allowlist keeps. */
export function wordCssFontFamily(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 255) return null;
  const value = trimmed.replace(/[^\p{L}\p{N} _.,-]/gu, '');
  if (value.length === 0) return null;
  return `"${escapeCssString(value)}"`;
}

/** The painter's ST_Border → CSS style mapping (layout/table-borders.ts
 *  STYLE_FROM_VAL), collapsed to the CSS-representable set — the copy must show
 *  the same dashes the editor paints, and a missing `w:sz` defaults to the
 *  painter's 0.5pt hairline, never a fatter 1pt. */
const WORD_BORDER_CSS_STYLES: ReadonlyMap<string, string> = new Map([
  ['single', 'solid'],
  ['thick', 'solid'],
  ['double', 'double'],
  ['triple', 'double'],
  ['dotted', 'dotted'],
  ['dashed', 'dashed'],
  ['dashSmallGap', 'dashed'],
  ['dotDash', 'dashed'],
  ['dotDotDash', 'dashed'],
  ['wave', 'solid'],
  ['hairline', 'solid'],
  ['inset', 'solid'],
  ['outset', 'solid'],
]);

export function wordBorderCss(edge: OoxmlElement | null): string | null {
  if (edge === null) return null;
  const val = attributeValueOf(edge, 'val', WML_NAMESPACE_URI);
  if (val === undefined || val === 'nil' || val === 'none') return null;
  const style = WORD_BORDER_CSS_STYLES.get(val) ?? 'solid';
  const rawSize = attributeValueOf(edge, 'sz', WML_NAMESPACE_URI);
  const size =
    rawSize !== undefined && /^\d{1,4}$/.test(rawSize) ? Number.parseInt(rawSize, 10) : 0;
  const widthPt = size > 0 ? size / 8 : 0.5;
  const width = `${Math.round(widthPt * 100) / 100}pt`;
  const rawColor = attributeValueOf(edge, 'color', WML_NAMESPACE_URI);
  const color =
    rawColor !== undefined && /^[0-9A-Fa-f]{6}$/.test(rawColor) ? `#${rawColor}` : '#000000';
  return `${width} ${style} ${color.toLowerCase()}`;
}

export function wordLineSpacingCss(
  line: number | null,
  rule: string | undefined
): readonly string[] {
  if (line === null || line <= 0) return [];
  if (rule === 'exact' || rule === 'atLeast') {
    const points = `${Math.round((line / 20) * 100) / 100}pt`;
    return [
      `line-height:${points}`,
      `mso-line-height-rule:${rule === 'exact' ? 'exactly' : 'at-least'}`,
    ];
  }
  return [`line-height:${Math.round((line / 240) * 100) / 100}`];
}

/** The painter's ST_Underline → CSS decoration-style mapping (semantic-paint.ts
 *  UNDERLINE_STYLE), so the copy shows the same dashes the editor paints. */
const UNDERLINE_DECORATION_STYLE: ReadonlyMap<string, string> = new Map([
  ['double', 'double'],
  ['wavyDouble', 'double'],
  ['dotted', 'dotted'],
  ['dottedHeavy', 'dotted'],
  ['dash', 'dashed'],
  ['dashedHeavy', 'dashed'],
  ['dashLong', 'dashed'],
  ['dashLongHeavy', 'dashed'],
  ['dotDash', 'dashed'],
  ['dashDotHeavy', 'dashed'],
  ['dotDotDash', 'dashed'],
  ['dashDotDotHeavy', 'dashed'],
  ['wave', 'wavy'],
  ['wavyHeavy', 'wavy'],
]);
const UNDERLINE_HINT_VALUES: ReadonlySet<string> = new Set<string>(WORD_UNDERLINE_VALUES);

export function wordUnderlineCss(underline: OoxmlElement | null): readonly string[] {
  if (underline === null) return [];
  const value = attributeValueOf(underline, 'val', WML_NAMESPACE_URI);
  const rules: string[] = [];
  // Solid is the CSS default; emitting it would shadow the double-strike marker.
  const style = value === undefined ? undefined : UNDERLINE_DECORATION_STYLE.get(value);
  if (style !== undefined) rules.push(`text-decoration-style:${style}`);
  // The exact variant travels as Word's own `text-underline` hint, so the read
  // lane restores `w:u w:val="dotDash"` instead of degrading it to single.
  // Interpolation is safe: only closed-allowlist values pass.
  if (value !== undefined && value !== 'single' && UNDERLINE_HINT_VALUES.has(value)) {
    rules.push(`text-underline:${value}`);
  }
  const color = attributeValueOf(underline, 'color', WML_NAMESPACE_URI);
  if (color !== undefined && /^[0-9A-Fa-f]{6}$/.test(color)) {
    rules.push(`text-decoration-color:#${color.toLowerCase()}`);
  }
  if (value === 'thick') rules.push('text-decoration-thickness:2px');
  return rules;
}

export function wordTableRowCss(height: number | null, rule: string | undefined): string {
  if (height === null || height <= 0) return '';
  const points = Math.round((height / 20) * 100) / 100;
  return `height:${points}pt;mso-height-rule:${rule === 'exact' ? 'exactly' : 'at-least'}`;
}

export interface WordNoteBodyContext {
  readonly kind: 'footnote' | 'endnote';
  readonly id: number;
}

export function wordNoteReferenceHtml(
  node: OoxmlElement,
  noteBody: WordNoteBodyContext | null,
  ordinalOf: (kind: 'footnote' | 'endnote', id: number) => number,
  hasDefinition: (kind: 'footnote' | 'endnote', id: number) => boolean
): string {
  if (node.namespaceUri !== WML_NAMESPACE_URI) return '';
  const bodyKind =
    node.localName === 'footnoteRef'
      ? 'footnote'
      : node.localName === 'endnoteRef'
        ? 'endnote'
        : null;
  const referenceKind =
    node.localName === 'footnoteReference'
      ? 'footnote'
      : node.localName === 'endnoteReference'
        ? 'endnote'
        : null;
  const kind = bodyKind ?? referenceKind;
  if (kind === null) return '';
  const rawId = attributeValueOf(node, 'id', WML_NAMESPACE_URI);
  const id =
    bodyKind === null
      ? // Leading zeros are legal ST_DecimalNumber lexical forms ('007'); parseInt
        // normalizes them so the reference and its definition emit ONE id spelling.
        rawId !== undefined && /^\d{1,10}$/.test(rawId)
        ? Number.parseInt(rawId, 10)
        : undefined
      : noteBody?.id;
  if (id === undefined || !Number.isInteger(id) || id < 1) return '';
  if (bodyKind !== null && noteBody?.kind !== bodyKind) return '';
  // The store allocates ids up to int32 (striped collab ids); match its cap.
  if (id > 0x7fffffff) return '';
  // A reference whose definition the package does not carry (a note referenced only
  // from another note's body, or a dangling id) renders nothing: a dead anchor
  // would skew visible ordinals and point at a nonexistent note on paste.
  if (bodyKind === null && !hasDefinition(kind, id)) return '';
  const footnote = kind === 'footnote';
  const inNoteBody = bodyKind !== null;
  const className = footnote ? 'MsoFootnoteReference' : 'MsoEndnoteReference';
  const prefix = footnote ? 'ftn' : 'edn';
  const href = inNoteBody ? `#_${prefix}ref${id}` : `#_${prefix}${id}`;
  const name = inNoteBody ? `_${prefix}${id}` : `_${prefix}ref${id}`;
  // The visible text shows the note's DISPLAY ordinal (ids are arbitrary after
  // edits); the id stays in the machine-readable attributes for the definition pair.
  return (
    `<a style="mso-${footnote ? 'footnote' : 'endnote'}-id:${prefix}${id}" ` +
    `href="${href}" name="${name}"><span class="${className}">` +
    `<span style="mso-special-character:footnote">[${ordinalOf(kind, id)}]</span></span></a>`
  );
}

/** Map a closed-enumeration OOXML positional tab to Word clipboard HTML.
 *  Tolerant like `layout/field-pieces.ts`: `leftMargin` folds to margin and a
 *  missing `w:leader` means no leader — dropping the tab would run a TOC entry's
 *  title straight into its page number. */
export function wordPositionalTabHtml(node: OoxmlElement): string {
  if (node.namespaceUri !== WML_NAMESPACE_URI || node.localName !== 'ptab') return '';
  const alignment = attributeValueOf(node, 'alignment', WML_NAMESPACE_URI);
  const relativeToRaw = attributeValueOf(node, 'relativeTo', WML_NAMESPACE_URI);
  const leader = attributeValueOf(node, 'leader', WML_NAMESPACE_URI) ?? 'none';
  if (alignment !== 'left' && alignment !== 'center' && alignment !== 'right') return '';
  const relativeTo =
    relativeToRaw === 'margin' || relativeToRaw === 'leftMargin'
      ? 'margin'
      : relativeToRaw === 'indent'
        ? 'indent'
        : null;
  if (relativeTo === null) return '';
  if (
    leader !== 'none' &&
    leader !== 'dot' &&
    leader !== 'hyphen' &&
    leader !== 'underscore' &&
    leader !== 'middleDot' &&
    leader !== 'heavy'
  ) {
    return '';
  }
  return (
    `<w:PTab Alignment="${alignment.toUpperCase()}" ` +
    `RelativeTo="${relativeTo.toUpperCase()}" Leader="${leader.toUpperCase()}"></w:PTab>`
  );
}
