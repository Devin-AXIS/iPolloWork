import type { EquationExpression, LinearMathParseResult } from './omml-equation.ts';

function reversible(value: EquationExpression): boolean {
  // Compact syntax has no spelling for `m:ctrlPr` operator formatting.
  if ('controlProperties' in value && value.controlProperties) return false;
  switch (value.kind) {
    case 'fallback':
    case 'bar':
    case 'borderBox':
    case 'delimiter':
      return false;
    case 'text':
      return value.format === undefined && !/[{}[\]^_√∑]/u.test(value.value);
    case 'row':
      return value.items.every(reversible);
    case 'fraction':
      return reversible(value.numerator) && reversible(value.denominator);
    case 'radical':
      return reversible(value.radicand) && (!value.degree || reversible(value.degree));
    case 'script':
      return (
        reversible(value.base) &&
        (!value.subscript || reversible(value.subscript)) &&
        (!value.superscript || reversible(value.superscript))
      );
    case 'nary':
      return (
        value.operator === '∑' &&
        // Compact syntax writes limits below and above, so it has no spelling for `subSup`.
        value.limitLocation !== 'subSup' &&
        reversible(value.body) &&
        (!value.lowerLimit || reversible(value.lowerLimit)) &&
        (!value.upperLimit || reversible(value.upperLimit))
      );
  }
}

function render(value: EquationExpression): string {
  switch (value.kind) {
    case 'row':
      return value.items.map(render).join('');
    case 'text':
      return value.value;
    case 'fallback':
      return value.text;
    case 'bar':
    case 'borderBox':
      return render(value.body);
    case 'delimiter':
      return value.opening + value.items.map(render).join(value.separator) + value.closing;
    case 'fraction':
      return `{${render(value.numerator)}}/{${render(value.denominator)}}`;
    case 'radical':
      return `√${value.degree ? `[${render(value.degree)}]` : ''}{${render(value.radicand)}}`;
    case 'script':
      return (
        render(value.base) +
        (value.subscript ? `_{${render(value.subscript)}}` : '') +
        (value.superscript ? `^{${render(value.superscript)}}` : '')
      );
    case 'nary':
      return (
        value.operator +
        (value.lowerLimit ? `[${render(value.lowerLimit)}]` : '') +
        (value.upperLimit ? `^[${render(value.upperLimit)}]` : '') +
        `{${render(value.body)}}`
      );
  }
}

/** Render only expressions that the compact parser can recover without loss. */
export function renderReversibleLinearMath(
  expression: EquationExpression,
  parse: (input: string) => LinearMathParseResult
): string {
  if (!reversible(expression)) return '';
  const rendered = render(expression);
  const parsed = parse(rendered);
  // Parsing can regroup adjacent text into one script base without moving its visible exponent.
  return parsed.ok && render(parsed.expression) === rendered ? rendered : '';
}
