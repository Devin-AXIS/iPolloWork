import { expect, test } from 'bun:test';
import { createT, deepMerge, en, locales, type LocaleStrings, type TranslationKey } from './index';

function flatten(node: object, prefix = ''): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(node).flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return value !== null && typeof value === 'object'
        ? Object.entries(flatten(value, path))
        : [[path, value]];
    })
  );
}

function parameters(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(/\{(\w+)(?=[},])/g), (match) => match[1]!))].sort();
}

/** Optional catalog metadata that only some locales declare, such as `_dir: 'rtl'`. */
const OPTIONAL_METADATA = new Set(['_dir']);

const source = flatten(en);
for (const [code, catalog] of Object.entries(locales)) {
  test(`${code} ships complete translations with working interpolation`, () => {
    const strings = Object.fromEntries(
      Object.entries(flatten(catalog)).filter(([key]) => !OPTIONAL_METADATA.has(key))
    );
    expect(Object.keys(strings).sort()).toEqual(Object.keys(source).sort());
    const t = createT(deepMerge(en, catalog) as LocaleStrings, code);
    for (const [key, value] of Object.entries(strings)) {
      expect(typeof value, `${code}.${key}`).toBe('string');
      if (typeof value !== 'string') continue;
      expect(value.trim().length, `${code}.${key}`).toBeGreaterThan(0);
      expect(value, `${code}.${key}`).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/);
      const names = parameters(source[key] as string);
      expect(parameters(value), `${code}.${key}`).toEqual(names);
      if (names.length === 0) continue;
      // Exercise plural branches and plain placeholders through the public formatter.
      for (const count of [0, 1, 2, 5, 11, 21]) {
        const vars = Object.fromEntries(names.map((name) => [name, count]));
        expect(t(key as TranslationKey, vars), `${code}.${key} (${count})`).not.toMatch(/[{}]/);
      }
    }
  });
}
