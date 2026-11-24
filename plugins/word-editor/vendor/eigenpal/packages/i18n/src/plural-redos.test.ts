import { describe, expect, test } from 'bun:test';

import { createT, en } from './index';

describe('i18n plural formatting', () => {
  // An unknown key falls back to using the key itself as the template, which
  // lets us exercise the plural formatter directly. Cast through the branded
  // TranslationKey type since these raw templates aren't real catalog keys.
  const t = createT(en) as (key: string, vars?: Record<string, string | number>) => string;

  test('selects the correct plural branch', () => {
    const tmpl = '{count, plural, one {# file} other {# files}}';
    expect(t(tmpl, { count: 1 })).toBe('1 file');
    expect(t(tmpl, { count: 3 })).toBe('3 files');
  });

  test('stays linear on adversarial plural templates (no ReDoS)', () => {
    const evil = '{n, plural, ' + ' '.repeat(200_000);
    const start = performance.now();
    t(evil, { n: 2 });
    expect(performance.now() - start).toBeLessThan(5_000);
  });
});
