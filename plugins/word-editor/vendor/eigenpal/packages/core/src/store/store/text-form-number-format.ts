/** Round a validated decimal without binary floating-point rounding artifacts. */
export function textFormFixedDecimal(
  input: string,
  decimals: 0 | 2,
  percent: boolean
): string | null {
  const negative = input.startsWith('-');
  const hasPercent = input.endsWith('%');
  const raw = input.replaceAll(',', '').replace(/^[+-]/, '').replace(/%$/, '');
  let [integer = '0', fraction = ''] = raw.split('.');
  integer = (integer || '0').replace(/^0+(?=\d)/, '');
  // Only two decimal places are emitted. Six source places also cover the two-place
  // percentage shift and the rounding digit, without allocating from an authored count.
  fraction = fraction.slice(0, 6);
  const shift = (percent ? 2 : 0) - (hasPercent ? 2 : 0);
  if (shift > 0) {
    integer += fraction.padEnd(2, '0').slice(0, 2);
    fraction = fraction.slice(2);
  } else if (shift < 0) {
    fraction = integer.padStart(2, '0').slice(-2) + fraction;
    integer = integer.length > 2 ? integer.slice(0, -2) : '0';
  }
  integer = integer.replace(/^0+(?=\d)/, '');
  if (integer.length > 21) return null;
  const kept = fraction.padEnd(decimals + 1, '0');
  let scaled = BigInt(integer + kept.slice(0, decimals));
  if (kept[decimals]! >= '5') scaled++;
  const digits = scaled.toString().padStart(decimals + 1, '0');
  const result = decimals ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}` : digits;
  return (negative && scaled !== 0n ? '-' : '') + result;
}
