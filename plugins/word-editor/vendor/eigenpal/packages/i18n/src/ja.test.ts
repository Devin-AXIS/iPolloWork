import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createT, deepMerge, en, ja, locales, type LocaleStrings } from './index';
import jaSubpath from './ja';
import catalog from '../ja.json';

function flatten(value: object, prefix = ''): Record<string, string | null> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return entry === null || typeof entry === 'string'
        ? [[path, entry]]
        : Object.entries(flatten(entry, path));
    })
  );
}

function flattenStrings(value: object): Record<string, string> {
  return Object.fromEntries(
    Object.entries(flatten(value)).map(([key, entry]) => {
      assert.ok(typeof entry === 'string', key);
      return [key, entry];
    })
  );
}

function parameters(message: string) {
  return [...new Set(Array.from(message.matchAll(/\{(\w+)(?=[},])/g), (match) => match[1]))].sort();
}

describe('Japanese editor locale', () => {
  const source = flattenStrings(en);
  const rawCatalog = flatten(catalog);
  const translated = flattenStrings(deepMerge(en, ja));

  it('covers the source catalog without empty strings or extra keys', () => {
    assert.deepEqual(Object.keys(rawCatalog).sort(), Object.keys(source).sort());
    for (const [key, value] of Object.entries(translated)) {
      assert.notEqual(value.trim(), '', key);
    }
    assert.equal(catalog._lang, 'ja');
    assert.equal(locales.ja, jaSubpath);
  });

  it('uses the source string for each null translation', () => {
    for (const [key, value] of Object.entries(rawCatalog)) {
      if (value === null) assert.equal(translated[key], source[key], key);
    }
  });

  it('preserves interpolation parameters and keyboard shortcuts', () => {
    for (const [key, value] of Object.entries(source)) {
      assert.deepEqual(parameters(translated[key]), parameters(value), key);
      const shortcuts = value.match(/\b(?:Ctrl|Alt|Shift|Meta)(?:\+[A-Za-z0-9=]+)+/g) ?? [];
      for (const shortcut of shortcuts) {
        assert.ok(translated[key].includes(shortcut), `${key}: ${shortcut}`);
      }
    }
  });

  it('renders Japanese counters for zero, one, and multiple results', () => {
    const t = createT(deepMerge(en, ja) as LocaleStrings, 'ja');
    for (const count of [0, 1, 2, 15]) {
      assert.equal(t('navigation.find.total', { total: count }), `${count} 件`);
      assert.equal(t('navigation.find.totalTruncated', { total: count }), `${count} 件以上`);
      assert.equal(t('collaboration.moreParticipants', { count }), `他 ${count} 人`);
    }
    assert.equal(t('navigation.find.counter', { current: 2, total: 15 }), '15 件中 2 件目');
    assert.equal(
      t('toolbar.exportFailed', { message: '接続エラー' }),
      'エクスポートに失敗しました: 接続エラー'
    );
    assert.equal(t('unknown.key' as never), 'unknown.key');
  });
});
