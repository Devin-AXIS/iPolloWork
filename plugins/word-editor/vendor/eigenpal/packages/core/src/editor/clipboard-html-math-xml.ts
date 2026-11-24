// Shared bounded state and run emitters for clipboard equation projection (OMML and MathML).
import { escapeXml } from '../store/package/sinks.ts';
import { rPrXml } from './clipboard-html-run-xml.ts';
import type { HtmlRunProps } from './clipboard-html-styles.ts';
import { xmlSafeText } from './clipboard-html-xml.ts';

export const MAX_EQUATION_DEPTH = 32;

export interface EquationState {
  left: number;
  visited: number;
  truncated: boolean;
}

/** Charge one visited node. False once the budget is spent; the state records truncation. */
export function charge(state: EquationState): boolean {
  if (state.left <= 0) {
    state.truncated = true;
    return false;
  }
  state.left -= 1;
  state.visited += 1;
  return true;
}

/**
 * Formatting a math run can carry. Bold and italic become the math style; the rest
 * becomes the run's `w:rPr`.
 */
export interface MathRunFormat {
  readonly bold?: boolean;
  readonly italic?: boolean;
  /**
   * Word's clipboard wraps every italic math run in `<i>`. In an equation that uses those
   * wrappers, a run without one is upright.
   */
  readonly uprightUnlessItalic?: boolean;
  readonly color?: string;
  readonly highlight?: string;
  readonly shdFill?: string;
  readonly szHalfPoints?: number;
}

export const NO_MATH_FORMAT: MathRunFormat = Object.freeze({});

/** Keep only the HTML run properties a math run can carry. */
export function mathFormatOf(props: HtmlRunProps, base: MathRunFormat): MathRunFormat {
  const next: {
    bold?: boolean;
    italic?: boolean;
    uprightUnlessItalic?: boolean;
    color?: string;
    highlight?: string;
    shdFill?: string;
    szHalfPoints?: number;
  } = { ...base };
  if (props.bold !== undefined) next.bold = props.bold;
  if (props.italic !== undefined) next.italic = props.italic;
  if (props.color !== undefined) next.color = props.color;
  if (props.highlight !== undefined) next.highlight = props.highlight;
  if (props.shdFill !== undefined) next.shdFill = props.shdFill;
  if (props.szHalfPoints !== undefined) next.szHalfPoints = props.szHalfPoints;
  return next;
}

function normalizedMathText(raw: string): string {
  // Word's HTML export spells spaces as NBSP and wraps long source lines; both are
  // ordinary space inside a math run. Invisible operators (U+2061 to U+2064) have no
  // OMML meaning and no glyph.
  return raw
    .replace(/ /g, ' ')
    .replace(/[⁡-⁤]/g, '')
    .replace(/[ \t\r\n\f\v]+/g, ' ');
}

/**
 * One `m:r`. `mathProperties` is the inner XML of `m:rPr`; the math style from bold
 * applies only when the source states no math properties of its own.
 */
export function mathRunXml(text: string, mathProperties: string, format: MathRunFormat): string {
  const value = escapeXml(xmlSafeText(normalizedMathText(text)));
  if (value.length === 0) return '';
  const upright = format.uprightUnlessItalic === true && format.italic !== true;
  const style = upright ? (format.bold ? 'b' : 'p') : format.bold ? 'bi' : null;
  const properties =
    mathProperties.length > 0 ? mathProperties : style ? `<m:sty m:val="${style}"/>` : '';
  const wordProperties = rPrXml({
    ...(format.color !== undefined ? { color: format.color } : {}),
    ...(format.highlight !== undefined ? { highlight: format.highlight } : {}),
    ...(format.shdFill !== undefined ? { shdFill: format.shdFill } : {}),
    ...(format.szHalfPoints !== undefined ? { szHalfPoints: format.szHalfPoints } : {}),
  });
  return (
    `<m:r>${properties.length > 0 ? `<m:rPr>${properties}</m:rPr>` : ''}${wordProperties}` +
    `<m:t xml:space="preserve">${value}</m:t></m:r>`
  );
}
