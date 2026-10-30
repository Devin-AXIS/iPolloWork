import { DataError } from '../server/errors'

// Opt-in rounding before the existing numeric field validator. Work in decimal strings
// so values near the database's upper bound never lose precision through Number().
export function roundApiDecimal(value: unknown, places: number): string {
  const match = /^(-?)(\d{1,14})(?:\.(\d{1,100}))?$/.exec(String(value))
  if (!match || !Number.isInteger(places) || places < 0 || places > 4)
    throw new DataError('API 返回的数字无法按所选小数位数转换')
  const fraction = (match[3] ?? '').padEnd(places, '0')
  let scaled = BigInt(match[2] + fraction.slice(0, places))
  if (fraction.length > places && fraction[places] >= '5') scaled += 1n
  const digits = scaled.toString().padStart(places + 1, '0')
  const result = places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits
  return match[1] && scaled !== 0n ? `-${result}` : result
}
