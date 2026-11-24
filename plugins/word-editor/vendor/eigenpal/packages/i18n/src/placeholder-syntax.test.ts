// Placeholders are `{name}`. A key written in some other convention is not a syntax error
// anywhere — `formatMessage` simply leaves the text alone, `i18n:validate` only compares
// key SHAPE between locales, and the string reaches the screen with its braces showing.
// A tab stop at 2.5 inches shipped as `{2.5} in` for exactly that reason.

import { describe, expect, test } from 'bun:test';
import en from '../en.json';

/** Every leaf string in the catalogue, with the dotted key that reaches it. */
function* leaves(node: unknown, path: string[] = []): Generator<[string, string]> {
  if (typeof node === 'string') {
    yield [path.join('.'), node];
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) yield* leaves(value, [...path, key]);
}

const ALL = [...leaves(en)];

describe('catalogue placeholder syntax', () => {
  test('the catalogue is not empty, so an empty walk cannot pass this file', () => {
    expect(ALL.length).toBeGreaterThan(100);
  });

  test('no string wraps a placeholder in a second pair of braces', () => {
    // The Mustache/Handlebars spelling. `formatMessage` reads `{name}`, so `{{name}}`
    // interpolates the inner pair and leaves the outer one on screen: `{2.5} in`.
    const doubled = ALL.filter(([, value]) => /\{\{\w+\}\}/.test(value)).map(([key]) => key);
    expect(doubled).toEqual([]);
  });

  test('no string uses a sigil convention formatMessage does not read', () => {
    // `%s`, `%(name)s`, `$name` and `${name}` all pass every other gate and all render raw.
    const foreign = ALL.filter(([, value]) => /%[sd(]|\$\{?\w/.test(value)).map(([key]) => key);
    expect(foreign).toEqual([]);
  });

  test('every brace pair is a placeholder name or an ICU plural form', () => {
    // `formatMessage` matches `/\{(\w+)\}/g` for plain placeholders, and reads ICU plural
    // blocks separately. A brace pair that is neither is text the reader will see.
    const isIcuPlural = (value: string) => /\{\s*\w+\s*,\s*plural\s*,/.test(value);
    const malformed = ALL.filter(([, value]) => {
      if (isIcuPlural(value)) return false;
      const braced = value.match(/\{[^}]*\}/g) ?? [];
      return braced.some((token) => !/^\{\w+\}$/.test(token));
    }).map(([key]) => key);
    expect(malformed).toEqual([]);
  });
});
