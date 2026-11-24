import { stableHash } from '../store/comparators/canonical.ts';

const tokens = new WeakMap<ReadonlyMap<string, string>, string>();

/** Hash each distinct result once per pass, then retain only a compact map token. */
export function characterStyleValuesToken(
  values: ReadonlyMap<string, string>,
  texts = new Map<string, string>()
): string {
  const cached = tokens.get(values);
  if (cached !== undefined) return cached;
  const entries: string[][] = [];
  for (const [key, value] of values) {
    let token = texts.get(value);
    if (token === undefined) {
      token = stableHash(value);
      texts.set(value, token);
    }
    entries.push([key, token]);
  }
  const token = stableHash(JSON.stringify(entries));
  tokens.set(values, token);
  return token;
}
