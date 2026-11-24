// `settings.xml` presentation settings, which are all inversions waiting to happen.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  readViewSettings,
  DEFAULT_VIEW_SETTINGS,
} from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function settingsRoot(inner: string) {
  const result = readOoxmlPart(`<w:settings xmlns:w="${W}">${inner}</w:settings>`, {
    name: '/word/settings.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part.root;
}

describe('w:doNotShadeFormData', () => {
  test('absent means Word SHADES form fields', () => {
    // The element turns shading OFF, so its absence is the shading case. Reading the name as
    // "shade form data" inverts it and blanks the shading on every ordinary form.
    expect(readViewSettings(settingsRoot('')).doNotShadeFormData).toBe(false);
  });

  test('present turns shading off', () => {
    expect(readViewSettings(settingsRoot('<w:doNotShadeFormData/>')).doNotShadeFormData).toBe(true);
  });

  test('an explicit false turns shading back on', () => {
    // `ST_OnOff` presence means on unless `@w:val` spells a false — the trap the shared reader
    // exists to hold in one place.
    for (const value of ['0', 'false', 'off']) {
      const root = settingsRoot(`<w:doNotShadeFormData w:val="${value}"/>`);
      expect(readViewSettings(root).doNotShadeFormData).toBe(false);
    }
  });

  test('an explicit true is still true', () => {
    for (const value of ['1', 'true', 'on']) {
      const root = settingsRoot(`<w:doNotShadeFormData w:val="${value}"/>`);
      expect(readViewSettings(root).doNotShadeFormData).toBe(true);
    }
  });

  test('a document with no settings part gets the defaults', () => {
    expect(readViewSettings(null)).toEqual(DEFAULT_VIEW_SETTINGS);
    expect(readViewSettings(undefined).doNotShadeFormData).toBe(false);
  });
});
