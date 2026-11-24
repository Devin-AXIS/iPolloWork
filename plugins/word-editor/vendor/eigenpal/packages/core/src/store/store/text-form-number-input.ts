/** Normalize the protected numeric filling forms observed in Word. */
export function normalizeTextFormNumber(text: string): string | null {
  let input = text.replace(/[A-Za-z\s$#,]/g, '');
  const accounting = input.startsWith('(') && input.endsWith(')');
  if (accounting) input = input.slice(1, -1);
  const minus = input.indexOf('-');
  if (minus !== -1) {
    if (accounting || input.indexOf('-', minus + 1) !== -1) return null;
    input = input.slice(0, minus) + input.slice(minus + 1);
  }
  return (accounting || minus !== -1 ? '-' : '') + (input || '0');
}

/** Word's empty numeric picture truncates, rather than rounds, the result. */
export function truncateTextFormNumber(input: string): string {
  let integer = input.replace(/^[+-]/, '').replace(/%$/, '').split('.')[0] || '0';
  if (input.endsWith('%')) integer = integer.length > 2 ? integer.slice(0, -2) : '0';
  integer = integer.replace(/^0+(?=\d)/, '');
  return (input.startsWith('-') && integer !== '0' ? '-' : '') + integer;
}
