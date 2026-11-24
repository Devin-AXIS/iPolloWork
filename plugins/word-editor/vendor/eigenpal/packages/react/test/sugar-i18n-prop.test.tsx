// `<DocxEditor i18n={...}>` — the chrome's language, without a provider.
//
// Before it existed, `LocaleProvider` was the ONLY way to language the packaged frame,
// while the i18n guide showed `<DocxEditor i18n={de} />` — a prop the component did not
// have, so the call typechecked as an unknown extra and silently did nothing.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import type { Translations } from '@docx-editor.dev/i18n';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { LocaleProvider } from '../src/i18n/index.ts';

afterEach(cleanup);

const de = {
  _lang: 'de',
  formattingBar: { boldShortcut: 'Fett (Strg+B)' },
  toolbar: { file: 'Datei' },
} as Translations;

const fr = { _lang: 'fr', toolbar: { file: 'Fichier' } } as Translations;

const spoken = (root: HTMLElement, text: string) =>
  Boolean(root.querySelector(`[aria-label="${text}"], [title="${text}"]`)) ||
  (root.textContent ?? '').includes(text);

describe('the packaged frame takes a catalogue', () => {
  test('i18n languages the chrome', () => {
    const { container } = render(<DocxEditor i18n={de} />);
    expect(spoken(container, 'Fett (Strg+B)')).toBe(true);
    expect(spoken(container, 'Datei')).toBe(true);
    // Keys the locale leaves out fall through to English, not to the raw key.
    expect(spoken(container, 'Insert')).toBe(true);
  });

  test('with no i18n it inherits an outer LocaleProvider', () => {
    const { container } = render(
      <LocaleProvider i18n={de}>
        <DocxEditor />
      </LocaleProvider>
    );
    expect(spoken(container, 'Fett (Strg+B)')).toBe(true);
  });

  test('the prop wins over an outer provider, for this editor only', () => {
    const { container } = render(
      <LocaleProvider i18n={de}>
        <DocxEditor i18n={fr} />
      </LocaleProvider>
    );
    expect(spoken(container, 'Fichier')).toBe(true);
    expect(spoken(container, 'Datei')).toBe(false);
    // The provider still shows through for what the prop's locale leaves out.
    expect(spoken(container, 'Fett (Strg+B)')).toBe(true);
  });
});
