import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkLocaleIntegrity, extractMessageInfo } from './i18n-integrity.mjs';
import { readLocaleCodes } from './locale-files.mjs';

// Lives at the package root (next to `locale-files.mjs`) so the repo-wide
// `bun test` run picks it up — `bunfig.toml` scopes the test root to
// `./packages`.
const I18N_DIR = import.meta.dirname;
const EN_PATH = join(I18N_DIR, 'en.json');

// Wrap a single message so `checkLocaleIntegrity`'s tree walk sees it as a
// one-key locale file. `_lang` matches the code, so leaf tests never trip the
// language-tag rule.
function leaf(enText, locText, code = 'ru') {
  return checkLocaleIntegrity({ message: enText }, { _lang: code, message: locText }, code);
}

function leafCodes(enText, locText, code = 'ru') {
  return leaf(enText, locText, code).violations.map((v) => v.code);
}

const EN_STEP = '{count, plural, one {# step} other {# steps}}';
const RU_STEP = '{count, plural, one {# шаг} few {# шага} many {# шагов} other {# шагов}}';
const EN_EXACT = '{count, plural, =0 {no steps} one {# step} other {# steps}}';

describe('extractMessageInfo', () => {
  test('parses plural blocks and simple tokens', () => {
    const info = extractMessageInfo('{name} — {count, plural, one {# item} other {# items}}');
    expect(info.simple).toEqual(['name']);
    expect(info.plurals).toEqual([
      {
        name: 'count',
        branches: [
          { label: 'one', text: '# item' },
          { label: 'other', text: '# items' },
        ],
      },
    ]);
    expect(info.malformedBraces).toBe(false);
  });

  test('keeps exact-match branch labels', () => {
    const info = extractMessageInfo('{count, plural, =0 {none} one {# item} other {# items}}');
    expect(info.plurals[0].branches.map((b) => b.label)).toEqual(['=0', 'one', 'other']);
  });

  test('does not treat brace-free branch text as a simple token', () => {
    const info = extractMessageInfo('{count, plural, one {male} other {female}}');
    expect(info.simple).toEqual([]);
    expect(info.malformedBraces).toBe(false);
  });

  test('flags stray or unbalanced braces', () => {
    expect(extractMessageInfo('{count').malformedBraces).toBe(true);
    expect(extractMessageInfo('count}').malformedBraces).toBe(true);
    expect(extractMessageInfo('{count} items').malformedBraces).toBe(false);
  });
});

describe('checkLocaleIntegrity violations', () => {
  test('placeholder_mismatch — missing placeholder', () => {
    expect(leafCodes('Delete {name}?', 'Удалить?')).toContain('placeholder_mismatch');
  });

  test('placeholder_mismatch — extra placeholder', () => {
    expect(leafCodes('Удалить?', 'Удалить {name}?')).toContain('placeholder_mismatch');
  });

  test('plural_var_mismatch — renamed plural variable', () => {
    const loc = '{total, plural, one {# шаг} other {# шагов}}';
    expect(leafCodes(EN_STEP, loc)).toContain('plural_var_mismatch');
  });

  test('plural_var_mismatch — plural over English without that placeholder', () => {
    expect(leafCodes('Итого: {count}', '{total, plural, other {#}}')).toContain(
      'plural_var_mismatch'
    );
  });

  test('invalid_branch_label', () => {
    expect(leafCodes(EN_STEP, '{count, plural, man {# шаг} other {# шагов}}')).toContain(
      'invalid_branch_label'
    );
  });

  test('rejects an invalid prefix before a plural branch label', () => {
    const loc = '{count, plural, bogus-one {один} other {много}}';
    expect(leaf(EN_STEP, loc).ok).toBe(false);
  });

  test('requires each exact branch on its original plural variable', () => {
    const en = '{a, plural, =0 {none} other {#}} {b, plural, other {#}}';
    const loc = '{a, plural, other {#}} {b, plural, =0 {нет} other {#}}';
    expect(leafCodes(en, loc)).toContain('missing_exact_branch');
  });

  test('missing_other', () => {
    expect(leafCodes(EN_STEP, '{count, plural, one {# шаг}}')).toContain('missing_other');
  });

  test('missing_exact_branch', () => {
    const loc = '{count, plural, one {# шаг} few {# шага} many {# шагов} other {# шагов}}';
    expect(leafCodes(EN_EXACT, loc)).toContain('missing_exact_branch');
  });

  test('missing_exact_branch — plain placeholder replaces a plural with =N', () => {
    const { violations } = leaf(EN_EXACT, '{count} шагов');
    expect(violations).toEqual([
      {
        key: 'message',
        code: 'missing_exact_branch',
        message: 'English exact-match branch "=0" must be preserved for "count"',
      },
    ]);
  });

  test('missing_exact_branch — plain placeholder reports each lost =N once', () => {
    const en = '{n, plural, =0 {none} other {#}} / {n, plural, =0 {zero} =1 {one} other {#}}';
    expect(leafCodes(en, '{n} / {n}')).toEqual(['missing_exact_branch', 'missing_exact_branch']);
  });

  test('missing_exact_branch — plain placeholder beside another plural block', () => {
    const en = '{a, plural, =0 {none} other {#}} {b, plural, other {#}}';
    const loc = '{a} {b, plural, one {# шаг} few {# шага} many {# шагов} other {# шагов}}';
    expect(leafCodes(en, loc)).toEqual(['missing_exact_branch']);
  });

  test('malformed_braces — unclosed brace', () => {
    expect(leafCodes('Элементов: {count}', 'Элементов: {count')).toContain('malformed_braces');
  });

  test('lang_mismatch', () => {
    const { violations } = checkLocaleIntegrity(
      { message: 'Hello' },
      { _lang: 'xx', message: 'Привет' },
      'ru'
    );
    expect(violations.map((v) => v.code)).toContain('lang_mismatch');
  });
});

describe('checkLocaleIntegrity clean cases', () => {
  test('Form B: plain interpolation of an English plural (Indonesian shape)', () => {
    const en = '{count, plural, one {# more item} other {# more items}}';
    expect(leaf(en, '{count} item lainnya', 'id').ok).toBe(true);
  });

  test('Russian plural with one/few/many/other', () => {
    expect(leaf(EN_STEP, RU_STEP).ok).toBe(true);
  });

  test('plural added over a simple English placeholder', () => {
    expect(leaf('{count}', RU_STEP).ok).toBe(true);
  });

  test('preserved =N exact branch', () => {
    const loc =
      '{count, plural, =0 {нет шагов} one {# шаг} few {# шага} many {# шагов} other {# шагов}}';
    expect(leaf(EN_EXACT, loc).ok).toBe(true);
  });

  test('English branch labels survive in locales without that CLDR category (id/zh-CN shape)', () => {
    const en = '{count, plural, one {# item} other {# items}}';
    const loc = '{count, plural, one {# item lagi} other {# item lagi}}';
    expect(leaf(en, loc, 'id').ok).toBe(true);
  });

  test('null translation is skipped', () => {
    const { ok } = checkLocaleIntegrity(
      { message: 'Hello {name}' },
      { _lang: 'ru', message: null },
      'ru'
    );
    expect(ok).toBe(true);
  });

  test('equal placeholder sets pass regardless of order', () => {
    expect(leaf('{first} {last}', '{last} {first}').ok).toBe(true);
  });

  test('placeholder nested inside a plural branch is rejected (runtime renders raw ICU)', () => {
    const loc = '{count, plural, one {Удалить {name}} other {Удалить {names}}}';
    expect(leafCodes(EN_STEP, loc)).toContain('malformed_braces');
  });

  test('ok true means empty violations', () => {
    const result = leaf(EN_STEP, RU_STEP);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });
});

describe('shipped locales integrity (regression)', () => {
  const en = JSON.parse(readFileSync(EN_PATH, 'utf-8'));
  const codes = readLocaleCodes(I18N_DIR).filter((code) => code !== 'en');

  test('discovers the shipped community locales', () => {
    expect(codes).toContain('id');
    expect(codes).toContain('pl');
    expect(codes.length).toBeGreaterThanOrEqual(9);
  });

  for (const code of codes) {
    test(`${code} — zero integrity violations`, () => {
      const locale = JSON.parse(readFileSync(join(I18N_DIR, `${code}.json`), 'utf-8'));
      const { violations } = checkLocaleIntegrity(en, locale, code);
      expect(violations).toEqual([]);
    });
  }
});

test('preserves separate exact branches across repeated uses of one variable', () => {
  const message = '{n, plural, =0 {none} other {#}} / {n, plural, =1 {one} other {#}}';
  expect(leaf(message, message).ok).toBe(true);
});
