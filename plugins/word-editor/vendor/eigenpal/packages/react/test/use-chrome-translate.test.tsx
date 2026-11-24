// `useChromeTranslate`: the catalogue-backed resolver a composing host passes as any
// part's `t`. Pins the override-first chain, the catalogue fallback, params
// interpolation, prototype-safety of the override Map, and that `LocaleProvider`
// drives the fallback — the guarantees the deleted hand-written wrappers used to
// carry in comments.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { cleanup, render } from '@testing-library/react';
import { createT, en, type TranslationKey, type Translations } from '@docx-editor.dev/i18n';
import { LocaleProvider, useChromeTranslate, type ChromeTranslate } from '../src/i18n';

const english = createT(en);

/** Renders nothing; hands the hook's resolver to the test. */
function Probe({
  overrides,
  onT,
}: {
  overrides?: ReadonlyMap<string, string>;
  onT: (t: ChromeTranslate) => void;
}) {
  onT(useChromeTranslate(overrides));
  return null;
}

function resolve(overrides?: ReadonlyMap<string, string>, wrap?: (node: ReactNode) => ReactNode) {
  let t: ChromeTranslate | null = null;
  const probe = <Probe overrides={overrides} onT={(value) => (t = value)} />;
  render(<>{wrap ? wrap(probe) : probe}</>);
  return t!;
}

afterEach(() => {
  cleanup();
});

describe('useChromeTranslate', () => {
  test('an override wins; everything else falls back to the catalogue, never the key', () => {
    const t = resolve(new Map([['toolbar.bold', 'Heavy']]));
    expect(t('toolbar.bold')).toBe('Heavy');
    // Not overridden: the bundled English catalogue, pinned to the LITERAL string so a
    // broken catalogue (which would fall back to the key) cannot pass silently.
    expect(t('toolbar.file')).toBe('File');
    expect(t('toolbar.file')).toBe(english('toolbar.file' as TranslationKey));
  });

  test('params interpolate through the catalogue path', () => {
    const t = resolve();
    const counter = t('navigation.find.counter', { current: 3, total: 15 });
    expect(counter).toBe('Result 3 of 15');
    expect(counter).not.toContain('{current}');
  });

  test('prototype-chain keys resolve to themselves, never to functions', () => {
    // The override Map is the proto-safe layer, and `createT`'s lookup only returns
    // string leaves — so a hostile or accidental key can never surface a function.
    const t = resolve(new Map([['toolbar.bold', 'Heavy']]));
    for (const key of ['constructor', 'toString', '__proto__', 'constructor.name']) {
      const result = t(key);
      expect(typeof result).toBe('string');
      expect(result).toBe(key);
    }
  });

  test('LocaleProvider drives the fallback catalogue', () => {
    const de = { _lang: 'de', toolbar: { file: 'Datei' } } as Translations;
    const t = resolve(undefined, (probe) => <LocaleProvider i18n={de}>{probe}</LocaleProvider>);
    expect(t('toolbar.file')).toBe('Datei');
    // Keys the locale leaves out fall through to English, not to the raw key.
    expect(t('toolbar.insert')).toBe('Insert');
  });

  test('a nested LocaleProvider composes with the one above it', () => {
    // It used to merge onto bundled English, so a provider inside a provider threw the
    // outer catalogue away — and one with no `i18n` reverted the subtree to English.
    const de = { _lang: 'de', toolbar: { file: 'Datei', insert: 'Einfügen' } } as Translations;
    const scoped = { toolbar: { insert: 'Hinzufügen' } } as Translations;

    const nested = resolve(undefined, (probe) => (
      <LocaleProvider i18n={de}>
        <LocaleProvider i18n={scoped}>{probe}</LocaleProvider>
      </LocaleProvider>
    ));
    expect(nested('toolbar.insert')).toBe('Hinzufügen');
    expect(nested('toolbar.file')).toBe('Datei');

    const bare = resolve(undefined, (probe) => (
      <LocaleProvider i18n={de}>
        <LocaleProvider>{probe}</LocaleProvider>
      </LocaleProvider>
    ));
    expect(bare('toolbar.file')).toBe('Datei');
  });
});
