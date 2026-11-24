// Accepted OOXML properties -> CSS, for the tree projection (task 6.1 display half).
//
// Without this the projection renders a formatted document as PLAIN TEXT: the property list
// travels on the mark, but nothing paints it. The same defect the legacy capsule had — a
// document full of bold, underline and colour showing up flat — and just as invisible to a
// test that only checks the model.
//
// SECURITY: every value here is file-derived and ends up in an inline `style`. Nothing is
// interpolated unchecked. Each property has an explicit reader that either produces a
// declaration from a validated token or produces nothing, so a crafted attribute cannot
// close the declaration and start its own.

import { readTwipsMeasure, type OoxmlProperty } from '@docx-editor.dev/core/store';

/** `w:val` of a property, or undefined. */
function val(property: OoxmlProperty): string | undefined {
  return property.attributes?.val;
}

/** OOXML toggle semantics: present means on unless `w:val` explicitly says otherwise. */
function isOn(property: OoxmlProperty): boolean {
  const value = val(property);
  return value === undefined || !(value === '0' || value === 'false' || value === 'off');
}

const HEX_COLOR = /^[0-9A-Fa-f]{6}$/;
const UNSIGNED = /^\d{1,6}$/;

/** `auto` resolves to the reader's default rather than a colour of its own. */
function colorValue(raw: string | undefined): string | null {
  if (raw === undefined || raw === 'auto') return null;
  return HEX_COLOR.test(raw) ? `#${raw}` : null;
}

/** ST_Underline -> the nearest `text-decoration-style`. CSS has four where OOXML has 18. */
const UNDERLINE_STYLE: Record<string, string> = {
  single: 'solid',
  words: 'solid',
  thick: 'solid',
  double: 'double',
  dotted: 'dotted',
  dottedHeavy: 'dotted',
  dash: 'dashed',
  dashedHeavy: 'dashed',
  dashLong: 'dashed',
  dashLongHeavy: 'dashed',
  dotDash: 'dashed',
  dashDotHeavy: 'dashed',
  dotDotDash: 'dashed',
  dashDotDotHeavy: 'dashed',
  wave: 'wavy',
  wavyHeavy: 'wavy',
  wavyDouble: 'wavy',
};

/** ST_HighlightColor — a closed enumeration, so the name maps straight to a CSS colour. */
const HIGHLIGHT: Record<string, string> = {
  black: '#000000',
  blue: '#0000ff',
  cyan: '#00ffff',
  darkBlue: '#000080',
  darkCyan: '#008080',
  darkGray: '#808080',
  darkGreen: '#008000',
  darkMagenta: '#800080',
  darkRed: '#800000',
  darkYellow: '#808000',
  green: '#00ff00',
  lightGray: '#c0c0c0',
  magenta: '#ff00ff',
  red: '#ff0000',
  yellow: '#ffff00',
  white: '#ffffff',
};

/** A font family name safe to place inside a quoted CSS value. */
function fontFamily(raw: string | undefined): string | null {
  if (!raw) return null;
  // Letters, digits, spaces and a few punctuation marks that appear in real font names.
  // Anything else — quotes, semicolons, backslashes, parentheses — is refused outright
  // rather than escaped, because a refused font is a cosmetic loss and an escaped one is a
  // guess about the CSS parser.
  if (!/^[\w \-.+]{1,64}$/.test(raw)) return null;
  return `"${raw}"`;
}

/** A twips attribute as whole twips, within the six-digit range this lane projects. */
function twipsOf(raw: string | undefined, allowNegative = false): number | null {
  const value = readTwipsMeasure(raw);
  if (value === null || Math.abs(value) > 999_999 || (!allowNegative && value < 0)) return null;
  return value;
}

/** Twips (1/20 pt) to a CSS `pt` length. */
function twipsToPt(raw: string | undefined, allowNegative = false): string | null {
  const value = twipsOf(raw, allowNegative);
  return value === null ? null : `${value / 20}pt`;
}

/**
 * CSS for one run's accepted properties.
 *
 * Returns declarations in a stable order so two runs with the same formatting produce the
 * same string, which keeps ProseMirror from redrawing on a re-projection.
 */
export function runPropsToCss(props: readonly OoxmlProperty[]): string {
  const declarations: string[] = [];
  const decorations: string[] = [];
  let underlineStyle: string | null = null;
  let underlineColor: string | null = null;

  for (const property of props) {
    switch (property.localName) {
      case 'b':
        declarations.push(`font-weight:${isOn(property) ? 'bold' : 'normal'}`);
        break;
      case 'i':
        declarations.push(`font-style:${isOn(property) ? 'italic' : 'normal'}`);
        break;
      case 'u': {
        const variant = val(property) ?? 'single';
        if (variant === 'none' || !isOn(property)) break;
        decorations.push('underline');
        underlineStyle = UNDERLINE_STYLE[variant] ?? 'solid';
        underlineColor = colorValue(property.attributes?.color);
        break;
      }
      case 'strike':
        if (isOn(property)) decorations.push('line-through');
        break;
      case 'dstrike':
        // CSS cannot draw a double strike; a single one is closer than nothing, and the
        // authored value is what round-trips regardless.
        if (isOn(property)) decorations.push('line-through');
        break;
      case 'caps':
        if (isOn(property)) declarations.push('text-transform:uppercase');
        break;
      case 'smallCaps':
        if (isOn(property)) declarations.push('font-variant:small-caps');
        break;
      case 'vertAlign': {
        const value = val(property);
        if (value === 'superscript') declarations.push('vertical-align:super', 'font-size:0.75em');
        else if (value === 'subscript') declarations.push('vertical-align:sub', 'font-size:0.75em');
        break;
      }
      case 'color': {
        const color = colorValue(val(property));
        if (color) declarations.push(`color:${color}`);
        break;
      }
      case 'highlight': {
        const highlight = HIGHLIGHT[val(property) ?? ''];
        if (highlight) declarations.push(`background-color:${highlight}`);
        break;
      }
      case 'sz': {
        // `w:sz` is HALF-points.
        const raw = val(property);
        if (raw !== undefined && UNSIGNED.test(raw))
          declarations.push(`font-size:${Number(raw) / 2}pt`);
        break;
      }
      case 'rFonts': {
        const family = fontFamily(property.attributes?.ascii ?? property.attributes?.hAnsi);
        if (family) declarations.push(`font-family:${family}`);
        break;
      }
      case 'spacing': {
        // Character spacing, in twips.
        const length = twipsToPt(val(property), true);
        if (length) declarations.push(`letter-spacing:${length}`);
        break;
      }
      default:
        // `w`, `kern`, `position`, `szCs`, `bCs`, `iCs` have no faithful inline CSS here.
        // They still round-trip; they are simply not painted by this surface.
        break;
    }
  }

  if (decorations.length > 0) {
    declarations.push(`text-decoration-line:${[...new Set(decorations)].join(' ')}`);
    if (underlineStyle) declarations.push(`text-decoration-style:${underlineStyle}`);
    if (underlineColor) declarations.push(`text-decoration-color:${underlineColor}`);
  }
  return declarations.join(';');
}

const ALIGNMENT: Record<string, string> = {
  left: 'left',
  start: 'left',
  right: 'right',
  end: 'right',
  center: 'center',
  both: 'justify',
  distribute: 'justify',
};

/** CSS for one paragraph's accepted properties. */
export function paragraphPropsToCss(props: readonly OoxmlProperty[]): string {
  const declarations: string[] = [];
  for (const property of props) {
    switch (property.localName) {
      case 'jc': {
        const align = ALIGNMENT[val(property) ?? ''];
        if (align) declarations.push(`text-align:${align}`);
        break;
      }
      case 'ind': {
        const left = twipsToPt(property.attributes?.left ?? property.attributes?.start, true);
        const right = twipsToPt(property.attributes?.right ?? property.attributes?.end, true);
        const firstLine = twipsToPt(property.attributes?.firstLine);
        const hanging = twipsToPt(property.attributes?.hanging);
        if (left) declarations.push(`margin-left:${left}`);
        if (right) declarations.push(`margin-right:${right}`);
        if (firstLine) declarations.push(`text-indent:${firstLine}`);
        else if (hanging) declarations.push(`text-indent:-${hanging}`);
        break;
      }
      case 'spacing': {
        const before = twipsToPt(property.attributes?.before);
        const after = twipsToPt(property.attributes?.after);
        if (before) declarations.push(`margin-top:${before}`);
        if (after) declarations.push(`margin-bottom:${after}`);
        const line = twipsOf(property.attributes?.line);
        const rule = property.attributes?.lineRule;
        if (line !== null && rule !== 'exact' && rule !== 'atLeast') {
          // `auto` line spacing is in 240ths of a line.
          declarations.push(`line-height:${(line / 240).toFixed(3)}`);
        } else if (line !== null) {
          declarations.push(`line-height:${line / 20}pt`);
        }
        break;
      }
      case 'shd': {
        const fill = colorValue(property.attributes?.fill);
        if (fill) declarations.push(`background-color:${fill}`);
        break;
      }
      case 'pageBreakBefore':
        if (isOn(property)) declarations.push('break-before:page');
        break;
      default:
        // `pStyle`, `numPr`, `tabs`, `keepNext`, `keepLines`, `widowControl` are resolved by
        // layout (section 7), not by an inline style on a projected paragraph.
        break;
    }
  }
  return declarations.join(';');
}
